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
import { uuid } from '../../lib/crypto.js';
import { validate } from '../../lib/validate.js';
import { NotFoundError, ConflictError, ValidationError } from '../../lib/errors.js';

/* ============================ Narzędzia wspólne ========================= */

const PL_CHARS = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

/** Kod z nazwy: „Zrębka Produkcyjna Leśna” → „ZREBKA-PRODUKCYJNA-LESNA”. */
export function slugCode(name, prefix = '') {
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

  const params = { id };
  const sets = entries.map(([column, value], i) => {
    params[`p${i}`] = value;
    return `${column} = :p${i}`;
  });
  db.run(`UPDATE ${table} SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = :id`, params);
}

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
 */
function createCatalog(spec) {
  const {
    table, label, schema, columns, toApi, naturalKey = 'name',
    codePrefix = '', orderBy = 'name', insertDefaults = {}, beforeWrite,
  } = spec;
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

    create(input) {
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
      db.tx(() => {
        spec.onWrite?.(d, null);
        db.run(
          `INSERT INTO ${table}(${cols.join(', ')}) VALUES (${cols.map((c) => `:${c}`).join(', ')})`,
          values,
        );
      });
      return api.get(id);
    },

    update(id, input) {
      api.get(id);
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
      return api.get(id);
    },

    /** Zakłada pozycję, jeśli nie istnieje (wprowadzanie dokumentu, import). */
    ensure(value, defaults = {}) {
      if (!value) return null;
      return api.findByName(value) ?? api.create({ [naturalKey]: value, ...defaults });
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
  isActive: { type: 'bool', default: true, label: 'Aktywny' },
};

export const warehouses = createCatalog({
  table: 'warehouses',
  label: 'magazynu',
  schema: WAREHOUSE_SCHEMA,
  codePrefix: 'MAG',
  orderBy: 'is_default DESC, name',
  insertDefaults: { is_default: 0, is_active: 1 },
  columns: { code: 'code', name: 'name', address: 'address', isDefault: 'is_default', isActive: 'is_active' },
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
products.deactivate = (id) => {
  const stock = db.value('SELECT COALESCE(SUM(qty_mp), 0) FROM stock_moves WHERE product_id = :id', { id });
  if (Math.abs(stock) > 0.001) {
    throw new ConflictError(
      `Nie można wyłączyć produktu — na magazynie pozostaje ${stock.toFixed(3)} MP. Rozlicz stan przed dezaktywacją.`,
    );
  }
  return products.update(id, { isActive: false });
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

  createDistrict(input) {
    const d = validate(input, {
      name: { type: 'string', required: true, max: 120, label: 'Nadleśnictwo' },
      region: { type: 'string', max: 120, label: 'RDLP' },
    });
    const existing = db.get('SELECT * FROM forest_districts WHERE name = :name COLLATE NOCASE', { name: d.name });
    if (existing) {
      return { id: existing.id, name: existing.name, region: existing.region, isActive: !!existing.is_active };
    }
    const id = uuid();
    db.run('INSERT INTO forest_districts(id, name, region) VALUES (:id, :name, :region)',
      { id, name: d.name, region: d.region ?? null });
    return { id, name: d.name, region: d.region ?? null, isActive: true };
  },

  createRange(input) {
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
    db.run('INSERT INTO forest_ranges(id, district_id, name) VALUES (:id, :districtId, :name)',
      { id, districtId: d.districtId, name: d.name });
    return { id, districtId: d.districtId, name: d.name, isActive: true };
  },

  /** Zapisuje nadleśnictwo i leśnictwo podane w dokumencie jako tekst. */
  ensure(districtName, rangeName) {
    if (!districtName) return;
    const district = forest.createDistrict({ name: districtName });
    if (rangeName) forest.createRange({ districtId: district.id, name: rangeName });
  },
};

/* ========================= Miejsca załadunku =========================== */

export const loadingPlaces = {
  list({ includeInactive = false } = {}) {
    return db.all(
      `SELECT * FROM loading_places WHERE 1 = 1 ${includeInactive ? '' : 'AND is_active = 1'} ORDER BY name`,
    ).map((r) => ({ id: r.id, name: r.name, address: r.address, isActive: !!r.is_active }));
  },

  ensure(name) {
    if (!name) return null;
    const found = db.get('SELECT * FROM loading_places WHERE name = :name COLLATE NOCASE', { name });
    if (found) return { id: found.id, name: found.name, address: found.address, isActive: !!found.is_active };
    const id = uuid();
    db.run('INSERT INTO loading_places(id, name) VALUES (:id, :name)', { id, name });
    return { id, name, address: null, isActive: true };
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
export function resolvePartners(wanted, kinds = {}) {
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
      found.set(key, partners.create({ name, kind: kinds[role] ?? 'OBA' }).id);
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
 * @returns {{supplierId:string|null, recipientId:string|null}}
 */
export function ensureDictionaries(row, existing = null) {
  const changed = (column) => !existing || existing[column] !== row[column];

  const ids = resolvePartners(
    {
      supplierId: row.supplier_name,
      recipientId: row.recipient_name,
      carrierId: changed('carrier_name') ? row.carrier_name : null,
    },
    { supplierId: 'DOSTAWCA', recipientId: 'ODBIORCA', carrierId: 'PRZEWOZNIK' },
  );

  if (row.vehicle_plate && changed('vehicle_plate')) {
    vehicles.ensure(row.vehicle_plate, { carrierName: row.carrier_name });
  }
  if (row.forest_district && (changed('forest_district') || changed('forest_range'))) {
    forest.ensure(row.forest_district, row.forest_range);
  }
  if (row.loading_place && changed('loading_place')) {
    loadingPlaces.ensure(row.loading_place);
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
