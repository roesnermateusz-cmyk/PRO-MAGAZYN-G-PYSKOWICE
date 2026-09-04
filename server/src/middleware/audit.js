/**
 * Dziennik audytu — nieusuwalny ślad zdarzeń istotnych dla kontroli
 * (certyfikacja KZR/SURE, kontrola skarbowa, audyt wewnętrzny).
 *
 * Zapis jest odporny na błędy: awaria audytu nie może przerwać operacji
 * biznesowej, ale jest odnotowywana w dzienniku technicznym.
 */
import db from '../db/index.js';
import logger from '../lib/logger.js';

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

/** Odczyt dziennika audytu z filtrowaniem (tylko dla ADMIN / KIEROWNIK). */
export function listAudit({ entity, entityId, userId, from, to, limit = 200, offset = 0 } = {}) {
  const where = ['1 = 1'];
  const params = { limit: Math.min(Number(limit) || 200, 1000), offset: Number(offset) || 0 };
  if (entity) { where.push('entity = :entity'); params.entity = entity; }
  if (entityId) { where.push('entity_id = :entityId'); params.entityId = entityId; }
  if (userId) { where.push('user_id = :userId'); params.userId = userId; }
  if (from) { where.push('ts >= :from'); params.from = from; }
  if (to) { where.push('ts <= :to'); params.to = `${to} 23:59:59`; }

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
    items: rows.map((r) => ({
      id: r.id,
      timestamp: r.ts,
      user: r.user_email,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      ip: r.ip,
      detail: r.detail ? JSON.parse(r.detail) : null,
    })),
    total,
  };
}
