/**
 * Dostęp użytkowników do magazynów.
 *
 * Firma ma kilka placów składowych. Magazynier z Rokitek nie ma powodu
 * księgować na Brąszewicach, a pomyłka w wyborze magazynu przenosi towar tam,
 * gdzie go fizycznie nie ma — i wychodzi dopiero przy inwentaryzacji.
 *
 * ZASADA DOMYŚLNA: brak wpisów = dostęp do wszystkich aktywnych magazynów.
 * Ograniczenie zaczyna obowiązywać dopiero wtedy, gdy administrator świadomie
 * przypisze komuś magazyny. Dzięki temu aktualizacja istniejącej instalacji
 * nikomu nie odbiera dostępu w dniu wdrożenia.
 *
 * ADMINISTRATOR ma dostęp do wszystkiego niezależnie od wpisów — inaczej dałoby
 * się zamknąć samego siebie poza systemem i zostać bez drogi powrotnej.
 *
 * ZAKRES (`scope`) to tablica kluczy magazynów albo `null` oznaczający „bez
 * ograniczeń”. `null` zamiast pustej tablicy jest celowy: pusta tablica
 * w zapytaniu `IN ()` znaczy „nic”, a to dokładnie odwrotność tego, o co chodzi.
 */
import db from '../../db/index.js';
import {
  ForbiddenError, NotFoundError, ValidationError, ConflictError,
} from '../../lib/errors.js';
import { cache, TAG } from '../../lib/cache.js';
import { auditChange } from '../../middleware/audit.js';

/** Role widzące cały obrót firmy niezależnie od przypisań. */
const UNRESTRICTED_ROLES = new Set(['ADMIN']);

/**
 * Zakres liczy się kilka razy w obrębie jednego żądania: przy liście, przy
 * podsumowaniu, przy raporcie. Zapamiętujemy go na czas życia pokolenia
 * pamięci podręcznej kartotek i kont — czyli do najbliższej zmiany przypisań,
 * kartoteki magazynów albo statusu konta.
 */
const scopeMemo = new Map();
let memoStamp = '';

function memoKey() {
  return `${cache.generation(TAG.USERS)}:${cache.generation(TAG.catalog('warehouses'))}:${cache.generation(TAG.CATALOG)}`;
}

/** Klucze magazynów przypisanych użytkownikowi (bez interpretacji). */
export function grantedWarehouseIds(userId) {
  return db.all(
    'SELECT warehouse_id FROM user_warehouses WHERE user_id = :userId ORDER BY warehouse_id',
    { userId },
  ).map((r) => r.warehouse_id);
}

/**
 * Zakres magazynów użytkownika.
 * @returns {string[]|null} klucze magazynów albo `null` = bez ograniczeń
 */
export function warehouseScope(user) {
  if (!user) return null;
  if (UNRESTRICTED_ROLES.has(user.role)) return null;

  const stamp = memoKey();
  if (stamp !== memoStamp) {
    scopeMemo.clear();
    memoStamp = stamp;
  }
  if (scopeMemo.has(user.id)) return scopeMemo.get(user.id);

  const computed = computeScope(user);
  scopeMemo.set(user.id, computed);
  return computed;
}

function computeScope(user) {
  const granted = grantedWarehouseIds(user.id);
  if (!granted.length) return null;

  // Przypisanie do magazynu, który tymczasem zdezaktywowano, nie może zostawić
  // użytkownika z pustym zakresem — to zamknęłoby mu system bez komunikatu.
  const active = granted.filter((id) => db.value(
    'SELECT 1 FROM warehouses WHERE id = :id AND is_active = 1', { id },
  ));
  return active.length ? active : null;
}

/** Czy użytkownik może pracować we wskazanym magazynie. */
export function canUseWarehouse(user, warehouseId) {
  if (!warehouseId) return true;
  const scope = warehouseScope(user);
  return scope === null || scope.includes(warehouseId);
}

/**
 * Kontrola dostępu przed zapisem. Rzuca, gdy magazyn jest poza zakresem.
 * @param {object} user
 * @param {string|null} warehouseId
 * @param {string} [field] pole formularza, którego dotyczy — trafia do błędu
 */
export function assertWarehouseAccess(user, warehouseId, field = 'warehouse') {
  if (canUseWarehouse(user, warehouseId)) return;
  const name = db.value('SELECT name FROM warehouses WHERE id = :id', { id: warehouseId }) ?? warehouseId;
  throw new ForbiddenError(
    `Nie masz dostępu do magazynu „${name}”. Poproś administratora o przypisanie magazynu do konta.`,
    [{ field, message: `Magazyn „${name}” jest poza Twoim zakresem.` }],
  );
}

/** Magazyny, w których użytkownik może pracować — do przełącznika w interfejsie. */
export function warehousesForUser(user) {
  const scope = warehouseScope(user);
  const rows = scope === null
    ? db.all('SELECT id, code, name, address, is_default FROM warehouses WHERE is_active = 1 ORDER BY is_default DESC, name')
    : db.all(
      `SELECT id, code, name, address, is_default FROM warehouses
        WHERE is_active = 1 AND id IN (${scope.map((_, i) => `:w${i}`).join(', ')})
        ORDER BY is_default DESC, name`,
      Object.fromEntries(scope.map((id, i) => [`w${i}`, id])),
    );
  return rows.map((r) => ({
    id: r.id, code: r.code, name: r.name, address: r.address, isDefault: !!r.is_default,
  }));
}

/**
 * Warunek SQL zawężający zapytanie do zakresu użytkownika.
 *
 * Klucze pochodzą z bazy, nie z żądania, ale i tak idą przez parametry —
 * sklejanie identyfikatorów w treść zapytania to nawyk, który kiedyś trafi
 * na wartość spoza bazy.
 *
 * @param {string[]|null} scope
 * @param {string[]} columns kolumny magazynu w zapytaniu
 * @param {string} [prefix] przedrostek nazw parametrów (unikalność w zapytaniu)
 * @returns {{sql:string, params:object}} pusty `sql` = brak ograniczenia
 */
export function scopeCondition(scope, columns, prefix = 'scope') {
  if (scope === null || !scope.length) return { sql: '', params: {} };
  const names = scope.map((_, i) => `:${prefix}${i}`);
  const params = Object.fromEntries(scope.map((id, i) => [`${prefix}${i}`, id]));
  const list = names.join(', ');
  const sql = `(${columns.map((col) => `${col} IN (${list})`).join(' OR ')})`;
  return { sql, params };
}

/* ------------------------- Zarządzanie przypisaniem --------------------- */

/**
 * Ustawia komplet magazynów użytkownika.
 *
 * Pusta lista = zdjęcie ograniczeń (dostęp do wszystkich aktywnych magazynów),
 * co jest zgodne z zasadą domyślną i daje administratorowi drogę powrotną.
 *
 * @param {string} userId
 * @param {string[]} warehouseIds
 * @param {object} ctx kontekst żądania (audyt)
 */
export function setUserWarehouses(userId, warehouseIds, ctx) {
  const user = db.get('SELECT id, email, full_name FROM users WHERE id = :id', { id: userId });
  if (!user) throw new NotFoundError('Nie znaleziono użytkownika.');

  const ids = [...new Set((warehouseIds ?? []).filter(Boolean).map(String))];
  for (const id of ids) {
    if (!db.value('SELECT 1 FROM warehouses WHERE id = :id AND is_active = 1', { id })) {
      throw new ValidationError('Wskazano magazyn, którego nie ma w kartotece albo jest nieaktywny.', [
        { field: 'warehouseIds', message: `Nieznany magazyn: ${id}` },
      ]);
    }
  }

  const before = namesOf(grantedWarehouseIds(userId));

  db.tx(() => {
    db.run('DELETE FROM user_warehouses WHERE user_id = :userId', { userId });
    for (const warehouseId of ids) {
      db.run(
        `INSERT INTO user_warehouses(user_id, warehouse_id, granted_by)
              VALUES (:userId, :warehouseId, :grantedBy)`,
        { userId, warehouseId, grantedBy: ctx?.user?.id ?? null },
      );
    }
  });

  // Zakres wchodzi do kluczy pamięci podręcznej list i raportów, więc zmiana
  // przypisania musi je unieważnić — inaczej użytkownik zobaczyłby wynik
  // policzony dla poprzedniego zakresu.
  cache.bump([TAG.USERS, TAG.DOCUMENTS, TAG.STOCK, TAG.CATALOG]);

  auditChange(ctx, 'UPDATE', 'user_warehouses', userId,
    { magazyny: before }, { magazyny: namesOf(ids) },
    { user: user.email });

  return { userId, warehouseIds: ids, unrestricted: ids.length === 0 };
}

/** Nazwy magazynów — czytelne w dzienniku audytu zamiast surowych kluczy. */
function namesOf(ids) {
  if (!ids.length) return [];
  return db.all(
    `SELECT name FROM warehouses WHERE id IN (${ids.map((_, i) => `:w${i}`).join(', ')}) ORDER BY name`,
    Object.fromEntries(ids.map((id, i) => [`w${i}`, id])),
  ).map((r) => r.name);
}

/** Użytkownicy przypisani do magazynu — kontrola przed dezaktywacją placu. */
export const usersOfWarehouse = (warehouseId) => db.all(
  `SELECT u.id, u.email, u.full_name FROM user_warehouses uw
     JOIN users u ON u.id = uw.user_id
    WHERE uw.warehouse_id = :warehouseId AND u.is_active = 1
    ORDER BY u.full_name`,
  { warehouseId },
).map((r) => ({ id: r.id, email: r.email, fullName: r.full_name }));

/* --------------------------- Cykl życia magazynu ------------------------ */

/**
 * Dezaktywuje plac składowy.
 *
 * Magazyn nie znika — dokumenty sprzed dezaktywacji muszą dalej wskazywać
 * miejsce, w którym towar rzeczywiście leżał. Plac przestaje być wybieralny
 * w nowych dokumentach i znika z przełącznika.
 *
 * Trzy rzeczy blokują dezaktywację, wszystkie z tego samego powodu: po niej
 * system musi nadal działać i zgadzać się z rzeczywistością.
 *  • NIEZEROWY STAN — towar nie parował z placu przez zmianę ustawienia;
 *    najpierw przesunięcie MM albo wydanie,
 *  • OSTATNI AKTYWNY MAGAZYN — bez magazynu nie da się zaksięgować dokumentu,
 *  • MAGAZYN DOMYŚLNY — dokumenty bez wskazanego miejsca nie miałyby dokąd
 *    trafić; najpierw trzeba wskazać inny plac jako domyślny.
 */
export function deactivateWarehouse(id, ctx) {
  const row = db.get('SELECT * FROM warehouses WHERE id = :id', { id });
  if (!row) throw new NotFoundError('Nie znaleziono magazynu.');
  if (!row.is_active) throw new ConflictError('Ten magazyn jest już nieaktywny.');

  // Kolejność kontroli od najtańszej do naprawienia: ustawienie, konfiguracja
  // kartoteki, a na końcu stan — bo ten wymaga fizycznego ruchu towaru.
  if (row.is_default) {
    throw new ConflictError(
      `Magazyn „${row.name}” jest magazynem domyślnym. Wskaż najpierw inny plac jako domyślny.`,
    );
  }
  if (db.value('SELECT COUNT(*) FROM warehouses WHERE is_active = 1') <= 1) {
    throw new ConflictError('To jedyny aktywny magazyn — bez niego nie da się zaksięgować dokumentu.');
  }

  const onHand = db.all(
    `SELECT product_name, qty_mp FROM v_stock_current
      WHERE warehouse_id = :id AND ABS(qty_mp) > 0.001 ORDER BY ABS(qty_mp) DESC`,
    { id },
  );
  if (onHand.length) {
    const lista = onHand.slice(0, 3).map((r) => `${r.product_name} ${r.qty_mp} MP`).join(', ');
    throw new ConflictError(
      `Magazyn „${row.name}” ma niezerowy stan (${lista}${onHand.length > 3 ? ', …' : ''}). `
      + 'Przesuń towar dokumentem MM albo wydaj go, zanim zamkniesz plac.',
    );
  }

  const przypisani = usersOfWarehouse(id);

  db.tx(() => {
    db.run("UPDATE warehouses SET is_active = 0, updated_at = datetime('now') WHERE id = :id", { id });
    // Przypisania do zamkniętego placu nie mają już znaczenia, a zostawione
    // zawężałyby komuś zakres do magazynu, którego nie da się wybrać.
    db.run('DELETE FROM user_warehouses WHERE warehouse_id = :id', { id });
  });
  cache.bump([TAG.CATALOG, TAG.catalog('warehouses'), TAG.USERS, TAG.STOCK, TAG.DOCUMENTS]);

  auditChange(ctx, 'DEACTIVATE', 'warehouses', id,
    { aktywny: true }, { aktywny: false },
    { magazyn: row.name, zdjetePrzypisania: przypisani.map((u) => u.email) });

  return { id, name: row.name, isActive: false, releasedUsers: przypisani.length };
}

/** Przywraca plac składowy do użytku. */
export function activateWarehouse(id, ctx) {
  const row = db.get('SELECT * FROM warehouses WHERE id = :id', { id });
  if (!row) throw new NotFoundError('Nie znaleziono magazynu.');
  if (row.is_active) throw new ConflictError('Ten magazyn jest już aktywny.');

  db.run("UPDATE warehouses SET is_active = 1, updated_at = datetime('now') WHERE id = :id", { id });
  cache.bump([TAG.CATALOG, TAG.catalog('warehouses'), TAG.USERS]);
  auditChange(ctx, 'ACTIVATE', 'warehouses', id,
    { aktywny: false }, { aktywny: true }, { magazyn: row.name });

  return { id, name: row.name, isActive: true };
}
