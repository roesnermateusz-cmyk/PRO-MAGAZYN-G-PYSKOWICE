/**
 * Kartoteki (słowniki) systemu: magazyny, produkty, kontrahenci, pojazdy,
 * nadleśnictwa, leśnictwa, miejsca załadunku.
 *
 * Wspólne zasady:
 *  • Pozycji użytych w dokumentach nie usuwamy — dezaktywujemy (`is_active = 0`).
 *  • Kod (`code`) jest stabilnym identyfikatorem biznesowym; nazwa może się zmienić.
 *  • `ensure` służy do „miękkiego” zakładania pozycji podczas wprowadzania
 *    dokumentu — magazynier nie musi przerywać pracy, żeby dodać kontrahenta.
 *
 * Cztery kartoteki mają identyczny cykl życia (lista → odczyt → utworzenie →
 * aktualizacja → ensure), więc ten cykl jest napisany raz, w `createCatalog`,
 * a poszczególne kartoteki różnią się wyłącznie deklaracją: tabelą, schematem
 * walidacji i mapowaniem kolumn.
 */
import db, { LIKE_ESCAPE, likePattern } from '../../db/index.js';
import { cache, TAG } from '../../lib/cache.js';
import { uuid } from '../../lib/crypto.js';
import { validate } from '../../lib/validate.js';
import { NotFoundError, ConflictError, ValidationError } from '../../lib/errors.js';
import { auditChange } from '../../middleware/audit.js';
import { registerLabels } from '../../domain/field-labels.js';

/* ============================ Narzędzia wspólne ========================= */

const PL_CHARS = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

/** Kod z nazwy: „Zrębka Produkcyjna Leśna” → „ZREBKA-PRODUKCYJNA-LESNA”. */
function slugCode(name, prefix = '') {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => PL_CHARS[c] ?? c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 40);
  return (prefix ? `${prefix}-` : '') + (base || 'POZYCJA');
}

/**
 * Nadaje kod unikalny w obrębie tabeli.
 * Zajęte kody pobieramy jednym zapytaniem — wcześniej każda próba kolizji
 * kosztowała osobny SELECT w pętli.
 */
function uniqueCode(table, name, prefix = '') {
  const base = slugCode(name, prefix);
  const taken = new Set(
    db.all(`SELECT code FROM ${table} WHERE code = :base OR code LIKE :pattern`,
      { base, pattern: `${base}-%` }).map((r) => r.code),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${uuid().slice(0, 8)}`;
}

/** Aktualizacja częściowa — pomija pola `undefined`, zawsze ustawia `updated_at`. */
function applyPatch(table, id, patch) {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  cache.bump([TAG.CATALOG, TAG.catalog(table)]);

  const params = { id };
  const sets = entries.map(([column, value], i) => {
    params[`p${i}`] = value;
    return `${column} = :p${i}`;
  });
  db.run(`UPDATE ${table} SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = :id`, params);
}

/**
 * Stan pozycji w formie trafiającej do dziennika audytu.
 *
 * Identyfikator pomijamy — siedzi już w kolumnie `entity_id`, a powtórzony
 * w treści zmiany byłby tylko szumem.
 */
const auditable = (item) => {
  const { id, ...reszta } = item ?? {};
  return reszta;
};

/* ========================= Fabryka kartoteki ============================ */

/**
 * Buduje standardowy zestaw operacji kartoteki.
 *
 * @param {object} spec
 * @param {string} spec.table nazwa tabeli
 * @param {string} spec.label nazwa w komunikatach błędów („magazynu”, „produktu”)
 * @param {object} spec.schema schemat walidacji
 * @param {Record<string,string>} spec.columns mapa `poleApi → kolumnaBazy`
 * @param {(row:object)=>object} spec.toApi mapowanie wiersza na obiekt API
 * @param {string} [spec.naturalKey] pole rozstrzygające unikalność (domyślnie `name`)
 * @param {string} [spec.codePrefix] prefiks generowanego kodu
 * @param {string} [spec.orderBy] klauzula sortowania listy
 * @param {Record<string,any>} [spec.insertDefaults] wartości kolumn NOT NULL,
 *   których schemat nie wypełnia (np. `is_active`)
 * @param {(data:object)=>void} [spec.beforeWrite] dodatkowa walidacja przed zapisem
 * @param {(data:object, id:string|null)=>void} [spec.onWrite] efekt uboczny w transakcji zapisu
 *
 * Zapis do dziennika audytu robi sama fabryka — z wartością PRZED i PO. Gdyby
 * robiły to trasy, każda nowa kartoteka byłaby okazją, żeby o tym zapomnieć;
 * pojazdy i nadleśnictwa właśnie tak wypadły z dziennika. Kontekst żądania
 * (`ctx`) jest opcjonalny: wołania z seeda i migracji audytu nie potrzebują.
 */
function createCatalog(spec) {
  const {
    table, label, schema, columns, toApi, naturalKey = 'name',
    codePrefix = '', orderBy = 'name', insertDefaults = {}, beforeWrite,
  } = spec;

  // Polskie nazwy pól idą do wspólnego rejestru, żeby historia zmian pokazała
  // „Przelicznik MP → tona”, a nie `mpToTonne`. Robi to fabryka, więc nowa
  // kartoteka jest czytelna w dzienniku bez dopisywania czegokolwiek.
  registerLabels(table, schema, { isActive: 'Aktywny' });
  const keyColumn = columns[naturalKey] ?? naturalKey;
  const hasCode = 'code' in columns;

  /** Wiersz surowy po kluczu — wewnętrzne, bez mapowania. */
  const findRow = (id) => db.get(`SELECT * FROM ${table} WHERE id = :id`, { id });

  const api = {
    /** Lista pozycji; domyślnie tylko aktywne. */
    list({ includeInactive = false, ...extra } = {}) {
      const params = {};
      const where = ['1 = 1'];
      if (!includeInactive) where.push('is_active = 1');
      for (const [field, value] of Object.entries(extra)) {
        if (!value || !(field in columns)) continue;
        where.push(`${columns[field]} = :${field}`);
        params[field] = value;
      }
      return db.all(
        `SELECT * FROM ${table} WHERE ${where.join(' AND ')} ORDER BY ${orderBy}`, params,
      ).map(toApi);
    },

    get(id) {
      const row = findRow(id);
      if (!row) throw new NotFoundError(`Nie znaleziono ${label}.`);
      return toApi(row);
    },

    /** Surowy wiersz bazy — potrzebny tam, gdzie liczą się nazwy kolumn. */
    getRaw(id) {
      const row = findRow(id);
      if (!row) throw new NotFoundError(`Nie znaleziono ${label}.`);
      return row;
    },

    /** Wyszukanie po kluczu naturalnym, bez rozróżniania wielkości liter. */
    findByName(value) {
      const row = api.findRowByName(value);
      return row ? toApi(row) : null;
    },

    /** Jak `findByName`, ale zwraca surowy wiersz — bez powtórnego odczytu. */
    findRowByName(value) {
      if (!value) return null;
      return db.get(`SELECT * FROM ${table} WHERE ${keyColumn} = :value COLLATE NOCASE`, { value }) ?? null;
    },

    /**
     * @param {object} input dane pozycji
     * @param {object|null} [ctx] kontekst żądania — bez niego wpis audytu
     *   powstaje bez autora (zapis z wiersza poleceń, dane demonstracyjne)
     */
    create(input, ctx = null) {
      const d = validate(input, schema);
      if (db.get(`SELECT 1 AS x FROM ${table} WHERE ${keyColumn} = :value COLLATE NOCASE`, { value: d[naturalKey] })) {
        throw new ConflictError(`Pozycja „${d[naturalKey]}” już istnieje w kartotece.`);
      }
      beforeWrite?.(d);

      const id = uuid();
      const values = { id, ...insertDefaults };
      for (const [field, column] of Object.entries(columns)) {
        if (d[field] !== undefined) values[column] = d[field];
        else values[column] ??= null;
      }
      if (hasCode) values[columns.code] = d.code || uniqueCode(table, d[naturalKey], codePrefix);

      const cols = Object.keys(values);
      cache.bump([TAG.CATALOG, TAG.catalog(table)]);
      db.tx(() => {
        spec.onWrite?.(d, null);
        db.run(
          `INSERT INTO ${table}(${cols.join(', ')}) VALUES (${cols.map((c) => `:${c}`).join(', ')})`,
          values,
        );
      });

      const item = api.get(id);
      auditChange(ctx, 'CREATE', table, id, {}, auditable(item), { pozycja: item[naturalKey] });
      return item;
    },

    /**
     * @param {string} id
     * @param {object} input pola do zmiany (pominięte zostają bez zmian)
     * @param {object|null} [ctx] kontekst żądania
     * @param {string} [action] etykieta akcji w dzienniku — `deactivate`
     *   podmienia ją na DEACTIVATE, żeby dało się filtrować wyłączenia
     */
    update(id, input, ctx = null, action = 'UPDATE') {
      // Odczyt sprzed zmiany służy podwójnie: sprawdza istnienie pozycji
      // i daje stan PRZED do dziennika — bez dodatkowego zapytania.
      const before = api.get(id);
      const d = validate(input, schema, { partial: true });
      beforeWrite?.(d);

      const patch = {};
      for (const [field, column] of Object.entries(columns)) {
        if (d[field] !== undefined) patch[column] = d[field];
      }
      db.tx(() => {
        spec.onWrite?.(d, id);
        applyPatch(table, id, patch);
      });

      const after = api.get(id);
      auditChange(ctx, action, table, id, auditable(before), auditable(after),
        { pozycja: after[naturalKey] });
      return after;
    },

    /**
     * Zakłada pozycję, jeśli nie istnieje (wprowadzanie dokumentu, import).
     * Pozycja założona „przy okazji” dokumentu też jest zmianą kartoteki,
     * więc `ctx` idzie dalej i trafia do dziennika razem z autorem.
     */
    ensure(value, defaults = {}, ctx = null) {
      if (!value) return null;
      return api.findByName(value) ?? api.create({ [naturalKey]: value, ...defaults }, ctx);
    },
  };
  return api;
}

/* ============================== Magazyny =============================== */

const WAREHOUSE_SCHEMA = {
  name: { type: 'string', required: true, max: 120, label: 'Nazwa magazynu' },
  code: { type: 'string', max: 40, upper: true, label: 'Kod' },
  address: { type: 'string', max: 250, label: 'Adres' },
  isDefault: { type: 'bool', default: false, label: 'Magazyn domyślny' },
  // Bez `isActive`: patrz komentarz przy kolumnach poniżej — zamknięcie placu
  // ma osobną, zabezpieczoną drogę.
};

export const warehouses = createCatalog({
  table: 'warehouses',
  label: 'magazynu',
  schema: WAREHOUSE_SCHEMA,
  codePrefix: 'MAG',
  orderBy: 'is_default DESC, name',
  insertDefaults: { is_default: 0, is_active: 1 },
  // `isActive` celowo NIE jest polem edytowalnym zwykłą aktualizacją.
  // Zamknięcie placu ma własną drogę (`deactivateWarehouse`) z kontrolą stanu,
  // magazynu domyślnego i przypisań. Gdyby dało się je ustawić tutaj, wszystkie
  // te zabezpieczenia omijałaby jedna zwykła edycja formularza.
  columns: { code: 'code', name: 'name', address: 'address', isDefault: 'is_default' },
  toApi: (r) => ({
    id: r.id, code: r.code, name: r.name, address: r.address,
    isDefault: !!r.is_default, isActive: !!r.is_active,
  }),
  // Magazyn domyślny może być tylko jeden — poprzedni traci flagę w tej samej transakcji.
  onWrite: (d) => { if (d.isDefault) db.run('UPDATE warehouses SET is_default = 0'); },
});

/** Magazyn domyślny — pierwszy wybór przy uzupełnianiu dokumentu. */
warehouses.getDefault = () => {
  const row = db.get('SELECT * FROM warehouses WHERE is_default = 1 AND is_active = 1 LIMIT 1')
    ?? db.get('SELECT * FROM warehouses WHERE is_active = 1 ORDER BY name LIMIT 1');
  if (!row) throw new NotFoundError('W systemie nie zdefiniowano żadnego magazynu.');
  return { id: row.id, code: row.code, name: row.name, address: row.address, isDefault: !!row.is_default, isActive: true };
};

/* ============================== Produkty =============================== */

const PRODUCT_SCHEMA = {
  name: { type: 'string', required: true, max: 120, label: 'Nazwa produktu' },
  code: { type: 'string', max: 40, upper: true, label: 'Kod' },
  category: { type: 'enum', values: ['SUROWIEC', 'ZREBKA', 'PRODUKT_UBOCZNY', 'INNE'], default: 'INNE', label: 'Kategoria' },
  defaultUnit: { type: 'enum', values: ['M3', 'MP', 'TONA'], default: 'MP', label: 'Jednostka domyślna' },
  m3ToMp: { type: 'number', min: 0.001, max: 100, label: 'Przelicznik m³ → MP' },
  mpToTonne: { type: 'number', min: 0.001, max: 100, label: 'Przelicznik MP → tona' },
  tonneToGj: { type: 'number', min: 0.001, max: 100, label: 'Przelicznik tona → GJ' },
  notes: { type: 'string', max: 500, label: 'Uwagi' },
  isActive: { type: 'bool', default: true, label: 'Aktywny' },
};

export const products = createCatalog({
  table: 'products',
  label: 'produktu w kartotece',
  schema: PRODUCT_SCHEMA,
  orderBy: 'category, name',
  insertDefaults: { is_active: 1 },
  columns: {
    code: 'code', name: 'name', category: 'category', defaultUnit: 'default_unit',
    m3ToMp: 'm3_to_mp', mpToTonne: 'mp_to_tonne', tonneToGj: 'tonne_to_gj',
    notes: 'notes', isActive: 'is_active',
  },
  toApi: (r) => ({
    id: r.id, code: r.code, name: r.name, category: r.category, defaultUnit: r.default_unit,
    m3ToMp: r.m3_to_mp, mpToTonne: r.mp_to_tonne, tonneToGj: r.tonne_to_gj,
    notes: r.notes, isActive: !!r.is_active,
  }),
});

/** Blokuje dezaktywację produktu z niezerowym stanem magazynowym. */
products.deactivate = (id, ctx = null) => {
  const stock = db.value('SELECT COALESCE(SUM(qty_mp), 0) FROM stock_moves WHERE product_id = :id', { id });
  if (Math.abs(stock) > 0.001) {
    throw new ConflictError(
      `Nie można wyłączyć produktu — na magazynie pozostaje ${stock.toFixed(3)} MP. Rozlicz stan przed dezaktywacją.`,
    );
  }
  return products.update(id, { isActive: false }, ctx, 'DEACTIVATE');
};

/* ============================ Kontrahenci ============================== */

const PARTNER_SCHEMA = {
  name: { type: 'string', required: true, max: 160, label: 'Nazwa kontrahenta' },
  code: { type: 'string', max: 40, upper: true, label: 'Kod' },
  kind: { type: 'enum', values: ['DOSTAWCA', 'ODBIORCA', 'OBA', 'PRZEWOZNIK'], default: 'OBA', label: 'Rodzaj' },
  nip: { type: 'string', max: 20, label: 'NIP' },
  address: { type: 'string', max: 250, label: 'Adres' },
  email: { type: 'string', max: 120, label: 'E-mail' },
  phone: { type: 'string', max: 40, label: 'Telefon' },
  notes: { type: 'string', max: 500, label: 'Uwagi' },
  isActive: { type: 'bool', default: true, label: 'Aktywny' },
};

export const partners = createCatalog({
  table: 'partners',
  label: 'kontrahenta',
  schema: PARTNER_SCHEMA,
  codePrefix: 'K',
  insertDefaults: { is_active: 1 },
  columns: {
    code: 'code', name: 'name', kind: 'kind', nip: 'nip', address: 'address',
    email: 'email', phone: 'phone', notes: 'notes', isActive: 'is_active',
  },
  toApi: (r) => ({
    id: r.id, code: r.code, name: r.name, kind: r.kind, nip: r.nip,
    address: r.address, email: r.email, phone: r.phone, notes: r.notes, isActive: !!r.is_active,
  }),
  beforeWrite: (d) => {
    if (d.nip && !/^[0-9-]{10,15}$/.test(d.nip)) {
      throw new ValidationError('NIP może zawierać wyłącznie cyfry i myślniki (10–15 znaków).');
    }
  },
});

/** Lista kontrahentów z filtrem rodzaju i wyszukiwaniem — poza standardem fabryki. */
partners.search = ({ includeInactive = false, kind = '', q = '' } = {}) => {
  const where = ['1 = 1'];
  const params = {};
  if (!includeInactive) where.push('is_active = 1');
  if (kind) { where.push("(kind = :kind OR kind = 'OBA')"); params.kind = kind; }
  if (q) {
    where.push(`(name LIKE :q ${LIKE_ESCAPE} OR COALESCE(nip,'') LIKE :q ${LIKE_ESCAPE}
                 OR COALESCE(code,'') LIKE :q ${LIKE_ESCAPE})`);
    params.q = likePattern(q);
  }
  return db.all(`SELECT * FROM partners WHERE ${where.join(' AND ')} ORDER BY name`, params)
    .map((r) => ({
      id: r.id, code: r.code, name: r.name, kind: r.kind, nip: r.nip,
      address: r.address, email: r.email, phone: r.phone, notes: r.notes, isActive: !!r.is_active,
    }));
};

/* ============================== Pojazdy ================================ */

const VEHICLE_SCHEMA = {
  plate: { type: 'string', required: true, max: 20, upper: true, label: 'Numer rejestracyjny' },
  carrierId: { type: 'string', max: 40, label: 'Przewoźnik (kartoteka)' },
  carrierName: { type: 'string', max: 160, label: 'Przewoźnik / kierowca' },
  description: { type: 'string', max: 200, label: 'Opis' },
  isActive: { type: 'bool', default: true, label: 'Aktywny' },
};

export const vehicles = createCatalog({
  table: 'vehicles',
  label: 'pojazdu',
  schema: VEHICLE_SCHEMA,
  naturalKey: 'plate',
  orderBy: 'plate',
  insertDefaults: { is_active: 1 },
  columns: {
    plate: 'plate', carrierId: 'carrier_id', carrierName: 'carrier_name',
    description: 'description', isActive: 'is_active',
  },
  toApi: (r) => ({
    id: r.id, plate: r.plate, carrierId: r.carrier_id,
    carrierName: r.carrier_name ?? r.carrier_partner_name ?? null,
    description: r.description, isActive: !!r.is_active,
  }),
});

/** Lista pojazdów z nazwą przewoźnika z kartoteki kontrahentów. */
vehicles.listWithCarrier = ({ includeInactive = false } = {}) => db.all(
  `SELECT v.*, p.name AS carrier_partner_name
     FROM vehicles v LEFT JOIN partners p ON p.id = v.carrier_id
    WHERE 1 = 1 ${includeInactive ? '' : 'AND v.is_active = 1'}
    ORDER BY v.plate`,
).map((r) => ({
  id: r.id, plate: r.plate, carrierId: r.carrier_id,
  carrierName: r.carrier_name ?? r.carrier_partner_name ?? null,
  description: r.description, isActive: !!r.is_active,
}));

/* ==================== Nadleśnictwa i leśnictwa ========================= */

registerLabels('forest_districts', {}, {
  name: 'Nadleśnictwo', region: 'RDLP', isActive: 'Aktywny',
});
registerLabels('forest_ranges', {}, {
  name: 'Leśnictwo', districtId: 'Nadleśnictwo', isActive: 'Aktywny',
});
registerLabels('loading_places', {}, {
  name: 'Miejsce załadunku', address: 'Adres', isActive: 'Aktywny',
});

export const forest = {
  listDistricts({ includeInactive = false } = {}) {
    return db.all(
      `SELECT * FROM forest_districts WHERE 1 = 1 ${includeInactive ? '' : 'AND is_active = 1'} ORDER BY name`,
    ).map((r) => ({ id: r.id, name: r.name, region: r.region, isActive: !!r.is_active }));
  },

  listRanges({ districtId = '', includeInactive = false } = {}) {
    const params = {};
    let sql = `SELECT r.*, d.name AS district_name
                 FROM forest_ranges r JOIN forest_districts d ON d.id = r.district_id
                WHERE 1 = 1 ${includeInactive ? '' : 'AND r.is_active = 1'}`;
    if (districtId) { sql += ' AND r.district_id = :districtId'; params.districtId = districtId; }
    return db.all(`${sql} ORDER BY d.name, r.name`, params).map((r) => ({
      id: r.id, districtId: r.district_id, districtName: r.district_name,
      name: r.name, isActive: !!r.is_active,
    }));
  },

  // Nadleśnictwa, leśnictwa i miejsca załadunku nie przechodzą przez fabrykę
  // (mają własne reguły unikalności), więc wpis do dziennika robią same.
  // Zapisujemy wyłącznie faktyczne założenie pozycji — trafienie w istniejącą
  // nie jest zmianą i nie ma czego odnotowywać.
  createDistrict(input, ctx = null) {
    const d = validate(input, {
      name: { type: 'string', required: true, max: 120, label: 'Nadleśnictwo' },
      region: { type: 'string', max: 120, label: 'RDLP' },
    });
    const existing = db.get('SELECT * FROM forest_districts WHERE name = :name COLLATE NOCASE', { name: d.name });
    if (existing) {
      return { id: existing.id, name: existing.name, region: existing.region, isActive: !!existing.is_active };
    }
    const id = uuid();
    cache.bump([TAG.CATALOG, TAG.catalog('forest_districts')]);
    db.run('INSERT INTO forest_districts(id, name, region) VALUES (:id, :name, :region)',
      { id, name: d.name, region: d.region ?? null });

    const item = { id, name: d.name, region: d.region ?? null, isActive: true };
    auditChange(ctx, 'CREATE', 'forest_districts', id, {}, auditable(item), { pozycja: item.name });
    return item;
  },

  createRange(input, ctx = null) {
    const d = validate(input, {
      districtId: { type: 'string', required: true, label: 'Nadleśnictwo' },
      name: { type: 'string', required: true, max: 120, label: 'Leśnictwo' },
    });
    if (!db.get('SELECT 1 AS x FROM forest_districts WHERE id = :id', { id: d.districtId })) {
      throw new NotFoundError('Nie znaleziono nadleśnictwa.');
    }
    const existing = db.get(
      'SELECT * FROM forest_ranges WHERE district_id = :districtId AND name = :name COLLATE NOCASE', d,
    );
    if (existing) return { id: existing.id, districtId: existing.district_id, name: existing.name, isActive: true };

    const id = uuid();
    cache.bump([TAG.CATALOG, TAG.catalog('forest_ranges')]);
    db.run('INSERT INTO forest_ranges(id, district_id, name) VALUES (:id, :districtId, :name)',
      { id, districtId: d.districtId, name: d.name });

    const item = { id, districtId: d.districtId, name: d.name, isActive: true };
    auditChange(ctx, 'CREATE', 'forest_ranges', id, {}, auditable(item), { pozycja: item.name });
    return item;
  },

  /** Zapisuje nadleśnictwo i leśnictwo podane w dokumencie jako tekst. */
  ensure(districtName, rangeName, ctx = null) {
    if (!districtName) return;
    const district = forest.createDistrict({ name: districtName }, ctx);
    if (rangeName) forest.createRange({ districtId: district.id, name: rangeName }, ctx);
  },
};

/* ========================= Miejsca załadunku =========================== */

export const loadingPlaces = {
  list({ includeInactive = false } = {}) {
    return db.all(
      `SELECT * FROM loading_places WHERE 1 = 1 ${includeInactive ? '' : 'AND is_active = 1'} ORDER BY name`,
    ).map((r) => ({ id: r.id, name: r.name, address: r.address, isActive: !!r.is_active }));
  },

  ensure(name, ctx = null) {
    if (!name) return null;
    const found = db.get('SELECT * FROM loading_places WHERE name = :name COLLATE NOCASE', { name });
    if (found) return { id: found.id, name: found.name, address: found.address, isActive: !!found.is_active };
    const id = uuid();
    cache.bump([TAG.CATALOG, TAG.catalog('loading_places')]);
    db.run('INSERT INTO loading_places(id, name) VALUES (:id, :name)', { id, name });

    const item = { id, name, address: null, isActive: true };
    auditChange(ctx, 'CREATE', 'loading_places', id, {}, auditable(item), { pozycja: name });
    return item;
  },
};

/* ================= Uzupełnianie kartotek przy zapisie ================== */

/**
 * Rozwiązuje nazwy kontrahentów na klucze kartoteki jednym zapytaniem,
 * zakładając wyłącznie te pozycje, których jeszcze nie ma.
 *
 * @param {Record<string,string|null>} wanted mapa `rola → nazwa`
 * @param {Record<string,string>} kinds mapa `rola → rodzaj kontrahenta`
 * @returns {Record<string,string|null>} mapa `rola → identyfikator`
 */
export function resolvePartners(wanted, kinds = {}, ctx = null) {
  const names = [...new Set(Object.values(wanted).filter(Boolean))];
  if (!names.length) return Object.fromEntries(Object.keys(wanted).map((role) => [role, null]));

  const placeholders = names.map((_, i) => `:n${i}`).join(', ');
  const params = Object.fromEntries(names.map((n, i) => [`n${i}`, n]));
  const found = new Map(
    db.all(`SELECT id, name FROM partners WHERE name COLLATE NOCASE IN (${placeholders})`, params)
      .map((r) => [r.name.toLowerCase(), r.id]),
  );

  const out = {};
  for (const [role, name] of Object.entries(wanted)) {
    if (!name) { out[role] = null; continue; }
    const key = name.toLowerCase();
    if (!found.has(key)) {
      found.set(key, partners.create({ name, kind: kinds[role] ?? 'OBA' }, ctx).id);
    }
    out[role] = found.get(key);
  }
  return out;
}

/**
 * Uzupełnia kartoteki pomocnicze na podstawie zapisywanego dokumentu.
 *
 * Pracuje wyłącznie na wartościach, które faktycznie się zmieniły względem
 * dokumentu edytowanego — przy poprawce pola niezwiązanego ze słownikami
 * (np. samych uwag) nie wykonuje ani jednego zapytania.
 *
 * @param {object} row wiersz dokumentu przygotowany do zapisu
 * @param {object|null} existing dokument sprzed edycji
 * @param {object|null} [ctx] kontekst żądania — pozycja założona przy okazji
 *   dokumentu trafia do dziennika z autorem, a nie jako zmiana bez sprawcy
 * @returns {{supplierId:string|null, recipientId:string|null}}
 */
export function ensureDictionaries(row, existing = null, ctx = null) {
  const changed = (column) => !existing || existing[column] !== row[column];

  const ids = resolvePartners(
    {
      supplierId: row.supplier_name,
      recipientId: row.recipient_name,
      carrierId: changed('carrier_name') ? row.carrier_name : null,
    },
    { supplierId: 'DOSTAWCA', recipientId: 'ODBIORCA', carrierId: 'PRZEWOZNIK' },
    ctx,
  );

  if (row.vehicle_plate && changed('vehicle_plate')) {
    vehicles.ensure(row.vehicle_plate, { carrierName: row.carrier_name }, ctx);
  }
  if (row.forest_district && (changed('forest_district') || changed('forest_range'))) {
    forest.ensure(row.forest_district, row.forest_range, ctx);
  }
  if (row.loading_place && changed('loading_place')) {
    loadingPlaces.ensure(row.loading_place, ctx);
  }

  return { supplierId: ids.supplierId, recipientId: ids.recipientId };
}

/** Komplet kartotek dla ekranu wprowadzania dokumentu (jedno żądanie). */
export function catalogSnapshot() {
  return {
    warehouses: warehouses.list(),
    products: products.list(),
    partners: partners.list(),
    vehicles: vehicles.listWithCarrier(),
    forestDistricts: forest.listDistricts(),
    forestRanges: forest.listRanges(),
    loadingPlaces: loadingPlaces.list(),
  };
}
