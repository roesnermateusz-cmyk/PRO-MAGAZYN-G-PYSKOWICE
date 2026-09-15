/**
 * Dziennik audytu — nieusuwalny ślad zdarzeń istotnych dla kontroli
 * (certyfikacja KZR/SURE, kontrola skarbowa, audyt wewnętrzny).
 *
 * Zapis jest odporny na błędy: awaria audytu nie może przerwać operacji
 * biznesowej, ale jest odnotowywana w dzienniku technicznym.
 */
import db, { LIKE_ESCAPE, likePattern } from '../db/index.js';
import logger from '../lib/logger.js';
import { labelFor } from '../domain/field-labels.js';

/**
 * @param {object} ctx kontekst żądania (dla IP, user-agent, użytkownika)
 * @param {string} action LOGIN | LOGOUT | CREATE | UPDATE | CANCEL | DELETE | EXPORT | IMPORT | CLOSE_PERIOD ...
 * @param {string} entity nazwa encji, np. `operations`
 * @param {string|null} entityId identyfikator rekordu
 * @param {object} [detail] dodatkowe dane (serializowane do JSON)
 */
export function audit(ctx, action, entity, entityId = null, detail = undefined) {
  try {
    db.run(
      `INSERT INTO audit_log(user_id, user_email, action, entity, entity_id, ip, user_agent, detail)
            VALUES (:userId, :userEmail, :action, :entity, :entityId, :ip, :userAgent, :detail)`,
      {
        userId: ctx?.user?.id ?? null,
        userEmail: ctx?.user?.email ?? null,
        action,
        entity,
        entityId,
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
        detail: detail === undefined ? null : JSON.stringify(detail),
      },
    );
  } catch (err) {
    logger.exception('Nie udało się zapisać wpisu audytu', err, { action, entity, entityId });
  }
}

/**
 * Wpis audytu z wartością PRZED i PO zmianie.
 *
 * Sam fakt „ktoś edytował kartotekę o 14:32” nie wystarcza kontroli: pytanie
 * brzmi, co konkretnie się zmieniło i jak było wcześniej. Dokumenty mają do
 * tego osobny rejestr korekt; dla kartotek, ustawień i kont ten ślad trzyma
 * dziennik audytu.
 *
 * Zapisujemy WYŁĄCZNIE pola, które faktycznie się zmieniły. Zrzut całego
 * obiektu przy każdej edycji zamienia dziennik w ścianę szumu, przez którą
 * nikt nie przebrnie — a wtedy przestaje pełnić swoją funkcję.
 *
 * @param {object} ctx kontekst żądania
 * @param {string} action CREATE | UPDATE | DELETE | DEACTIVATE …
 * @param {string} entity nazwa encji
 * @param {string|null} entityId identyfikator rekordu
 * @param {object} before stan przed zmianą
 * @param {object} after stan po zmianie
 * @param {object} [extra] dodatkowy kontekst (np. nazwa, numer dokumentu)
 */
export function auditChange(ctx, action, entity, entityId, before = {}, after = {}, extra = undefined) {
  const changes = {};
  for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    const from = before?.[key];
    const to = after?.[key];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes[key] = { przed: from ?? null, po: to ?? null };
  }
  if (!Object.keys(changes).length && action === 'UPDATE') return;
  audit(ctx, action, entity, entityId, { ...(extra ?? {}), zmiany: changes });
}

/**
 * Zamienia surowe `zmiany` na listę gotową do pokazania człowiekowi.
 *
 * W bazie leży `{"mpToTonne":{"przed":0.35,"po":0.38}}`. Kontrola ma zobaczyć
 * „Przelicznik MP → tona: 0,35 → 0,38”, a nie klucz z API. Etykiety biorą się
 * z rejestru zasilanego schematami walidacji — tam, gdzie polskie nazwy pól
 * już istnieją i tak (`domain/field-labels.js`).
 */
function opiszZmiany(entity, detail) {
  const zmiany = detail?.zmiany;
  if (!zmiany || typeof zmiany !== 'object') return [];
  return Object.entries(zmiany).map(([pole, wartosci]) => ({
    field: pole,
    label: labelFor(entity, pole),
    before: wartosci?.przed ?? null,
    after: wartosci?.po ?? null,
  }));
}

/**
 * Odczyt dziennika audytu z filtrowaniem (uprawnienie `audit:read`).
 *
 * Wpisy wracają z rozwiniętymi zmianami (`changes`) oraz resztą szczegółów
 * (`detail`) — ta druga zostaje, bo część akcji nie jest porównaniem stanów
 * (eksport, zamknięcie okresu, nieudane logowanie) i niesie własne pola.
 */
export function listAudit({
  entity, entityId, userId, userEmail, action, q, from, to, limit = 200, offset = 0,
} = {}) {
  const where = ['1 = 1'];
  const params = { limit: Math.min(Number(limit) || 200, 1000), offset: Number(offset) || 0 };
  if (entity) { where.push('entity = :entity'); params.entity = entity; }
  if (entityId) { where.push('entity_id = :entityId'); params.entityId = entityId; }
  if (userId) { where.push('user_id = :userId'); params.userId = userId; }
  if (userEmail) { where.push('user_email = :userEmail'); params.userEmail = userEmail; }
  if (action) { where.push('action = :action'); params.action = action; }
  if (from) { where.push('ts >= :from'); params.from = from; }
  if (to) { where.push('ts <= :to'); params.to = `${to} 23:59:59`; }
  // Szukanie po treści zmiany — „kto ruszał Brąszewice” bez znajomości kluczy.
  // `likePattern` obowiązkowo: surowy tekst wpuściłby do wzorca `%` i `_`.
  if (q) {
    where.push(`(COALESCE(entity_id, '') LIKE :q ${LIKE_ESCAPE}
                 OR COALESCE(user_email, '') LIKE :q ${LIKE_ESCAPE}
                 OR COALESCE(detail, '') LIKE :q ${LIKE_ESCAPE})`);
    params.q = likePattern(q);
  }

  const rows = db.all(
    `SELECT id, ts, user_email, action, entity, entity_id, ip, detail
       FROM audit_log
      WHERE ${where.join(' AND ')}
      ORDER BY id DESC
      LIMIT :limit OFFSET :offset`,
    params,
  );
  const total = db.value(`SELECT COUNT(*) FROM audit_log WHERE ${where.join(' AND ')}`, params);
  return {
    items: rows.map((r) => {
      const detail = r.detail ? JSON.parse(r.detail) : null;
      const { zmiany, ...reszta } = detail ?? {};
      return {
        id: r.id,
        timestamp: r.ts,
        user: r.user_email,
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        ip: r.ip,
        changes: opiszZmiany(r.entity, detail),
        detail: Object.keys(reszta).length ? reszta : null,
      };
    }),
    total,
  };
}

/**
 * Wartości do zbudowania filtrów widoku historii.
 *
 * Osobny punkt, a nie lista kont z `/users`: historię czyta także audytor
 * i księgowość, a te role nie mają wglądu w kartotekę użytkowników. Filtr ma
 * pokazywać tych, którzy faktycznie coś w dzienniku zostawili.
 */
export function auditFilters() {
  const kolumna = (col) => db.all(
    `SELECT DISTINCT ${col} AS v FROM audit_log WHERE ${col} IS NOT NULL ORDER BY ${col}`,
  ).map((r) => r.v);
  return { users: kolumna('user_email'), actions: kolumna('action'), entities: kolumna('entity') };
}
