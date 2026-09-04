/**
 * Kartoteki (słowniki) systemu: magazyny, produkty, kontrahenci, pojazdy,
 * nadleśnictwa, leśnictwa, miejsca załadunku.
 *
 * Wspólne zasady:
 *  • Pozycji użytych w dokumentach nie usuwamy — dezaktywujemy (`is_active = 0`).
 *  • Kod (`code`) jest stabilnym identyfikatorem biznesowym; nazwa może się zmienić.
 *  • `ensure*` służy do „miękkiego” zakładania pozycji podczas wprowadzania
 *    dokumentu — magazynier nie musi przerywać pracy, żeby dodać kontrahenta.
 */
import db from '../../db/index.js';
import { uuid } from '../../lib/crypto.js';
import { validate } from '../../lib/validate.js';
import { NotFoundError, ConflictError, ValidationError } from '../../lib/errors.js';

/* ----------------------------- Narzędzia ------------------------------ */

/** Kod z nazwy: „Zrębka Produkcyjna Leśna” → „ZREBKA-PRODUKCYJNA-LESNA”. */
export function slugCode(name, prefix = '') {
  const map = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
  const base = String(name || '')
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => map[c] || c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 40);
  return (prefix ? `${prefix}-` : '') + (base || 'POZYCJA');
}

/** Nadaje kod unikalny w obrębie tabeli (dokleja licznik przy kolizji). */
function uniqueCode(table, name, prefix = '') {
  const base = slugCode(name, prefix);
  let code = base;
  let n = 1;
  while (db.get(`SELECT 1 AS x FROM ${table} WHERE code = :code`, { code })) {
    n += 1;
    code = `${base}-${n}`;
  }
  return code;
}

const activeFilter = (includeInactive) => (includeInactive ? '' : 'AND is_active = 1');

/* ------------------------------ Magazyny ------------------------------ */

const WAREHOUSE_SCHEMA = {
  name: { type: 'string', required: true, max: 120, label: 'Nazwa magazynu' },
  code: { type: 'string', max: 40, upper: true, label: 'Kod' },
  address: { type: 'string', max: 250, label: 'Adres' },
  isDefault: { type: 'bool', label: 'Magazyn domyślny' },
  isActive: { type: 'bool', label: 'Aktywny' },
};

export const warehouses = {
  list({ includeInactive = false } = {}) {
    return db.all(
      `SELECT id, code, name, address, is_default, is_active
         FROM warehouses WHERE 1=1 ${activeFilter(includeInactive)} ORDER BY is_default DESC, name`,
    ).map(mapWarehouse);
  },

  get(id) {
    const row = db.get('SELECT * FROM warehouses WHERE id = :id', { id });
    if (!row) throw new NotFoundError('Nie znaleziono magazynu.');
    return mapWarehouse(row);
  },

  getDefault() {
    const row = db.get('SELECT * FROM warehouses WHERE is_default = 1 AND is_active = 1 LIMIT 1')
      || db.get('SELECT * FROM warehouses WHERE is_active = 1 ORDER BY name LIMIT 1');
    if (!row) throw new NotFoundError('W systemie nie zdefiniowano żadnego magazynu.');
    return mapWarehouse(row);
  },

  create(input) {
    const d = validate(input, WAREHOUSE_SCHEMA);
    if (db.get('SELECT 1 AS x FROM warehouses WHERE name = :name', { name: d.name })) {
      throw new ConflictError(`Magazyn „${d.name}” już istnieje.`);
    }
    const id = uuid();
    db.tx(() => {
      if (d.isDefault) db.run('UPDATE warehouses SET is_default = 0');
      db.run(
        `INSERT INTO warehouses(id, code, name, address, is_default, is_active)
              VALUES (:id, :code, :name, :address, :isDefault, :isActive)`,
        {
          id,
          code: d.code || uniqueCode('warehouses', d.name, 'MAG'),
          name: d.name,
          address: d.address ?? null,
          isDefault: d.isDefault ?? false,
          isActive: d.isActive ?? true,
        },
      );
    });
    return warehouses.get(id);
  },

  update(id, input) {
    warehouses.get(id);
    const d = validate(input, WAREHOUSE_SCHEMA, { partial: true });
    db.tx(() => {
      if (d.isDefault) db.run('UPDATE warehouses SET is_default = 0');
      applyPatch('warehouses', id, {
        code: d.code, name: d.name, address: d.address,
        is_default: d.isDefault, is_active: d.isActive,
      });
    });
    return warehouses.get(id);
  },

  /** Zakłada magazyn, jeśli nie istnieje (import danych, praca w terenie). */
  ensure(name) {
    if (!name) return null;
    const found = db.get('SELECT * FROM warehouses WHERE name = :name COLLATE NOCASE', { name });
    if (found) return mapWarehouse(found);
    return warehouses.create({ name });
  },
};

const mapWarehouse = (r) => ({
  id: r.id, code: r.code, name: r.name, address: r.address,
  isDefault: !!r.is_default, isActive: !!r.is_active,
});

/* ------------------------------ Produkty ------------------------------ */

const PRODUCT_SCHEMA = {
  name: { type: 'string', required: true, max: 120, label: 'Nazwa produktu' },
  code: { type: 'string', max: 40, upper: true, label: 'Kod' },
  category: { type: 'enum', values: ['SUROWIEC', 'ZREBKA', 'PRODUKT_UBOCZNY', 'INNE'], default: 'INNE', label: 'Kategoria' },
  defaultUnit: { type: 'enum', values: ['M3', 'MP', 'TONA'], default: 'MP', label: 'Jednostka domyślna' },
  m3ToMp: { type: 'number', min: 0.001, max: 100, label: 'Przelicznik m³ → MP' },
  mpToTonne: { type: 'number', min: 0.001, max: 100, label: 'Przelicznik MP → tona' },
  tonneToGj: { type: 'number', min: 0.001, max: 100, label: 'Przelicznik tona → GJ' },
  notes: { type: 'string', max: 500, label: 'Uwagi' },
  isActive: { type: 'bool', label: 'Aktywny' },
};

export const products = {
  list({ includeInactive = false, category = '' } = {}) {
    const params = {};
    let sql = `SELECT * FROM products WHERE 1=1 ${activeFilter(includeInactive)}`;
    if (category) { sql += ' AND category = :category'; params.category = category; }
    return db.all(`${sql} ORDER BY category, name`, params).map(mapProduct);
  },

  get(id) {
    const row = db.get('SELECT * FROM products WHERE id = :id', { id });
    if (!row) throw new NotFoundError('Nie znaleziono produktu w kartotece.');
    return mapProduct(row);
  },

  /** Surowy wiersz — potrzebny silnikowi jednostek (nazwy kolumn bazy). */
  getRaw(id) {
    const row = db.get('SELECT * FROM products WHERE id = :id', { id });
    if (!row) throw new NotFoundError('Nie znaleziono produktu w kartotece.');
    return row;
  },

  findByName(name) {
    if (!name) return null;
    const row = db.get('SELECT * FROM products WHERE name = :name COLLATE NOCASE', { name });
    return row ? mapProduct(row) : null;
  },

  create(input) {
    const d = validate(input, PRODUCT_SCHEMA);
    if (db.get('SELECT 1 AS x FROM products WHERE name = :name COLLATE NOCASE', { name: d.name })) {
      throw new ConflictError(`Produkt „${d.name}” już istnieje w kartotece.`);
    }
    const id = uuid();
    db.run(
      `INSERT INTO products(id, code, name, category, default_unit, m3_to_mp, mp_to_tonne, tonne_to_gj, notes, is_active)
            VALUES (:id, :code, :name, :category, :defaultUnit, :m3ToMp, :mpToTonne, :tonneToGj, :notes, :isActive)`,
      {
        id,
        code: d.code || uniqueCode('products', d.name),
        name: d.name,
        category: d.category,
        defaultUnit: d.defaultUnit,
        m3ToMp: d.m3ToMp ?? null,
        mpToTonne: d.mpToTonne ?? null,
        tonneToGj: d.tonneToGj ?? null,
        notes: d.notes ?? null,
        isActive: d.isActive ?? true,
      },
    );
    return products.get(id);
  },

  update(id, input) {
    products.get(id);
    const d = validate(input, PRODUCT_SCHEMA, { partial: true });
    applyPatch('products', id, {
      code: d.code, name: d.name, category: d.category, default_unit: d.defaultUnit,
      m3_to_mp: d.m3ToMp, mp_to_tonne: d.mpToTonne, tonne_to_gj: d.tonneToGj,
      notes: d.notes, is_active: d.isActive,
    });
    return products.get(id);
  },

  /** Blokuje dezaktywację produktu z niezerowym stanem magazynowym. */
  deactivate(id) {
    const stock = db.value(
      'SELECT COALESCE(SUM(qty_mp), 0) FROM stock_moves WHERE product_id = :id', { id },
    );
    if (Math.abs(stock) > 0.001) {
      throw new ConflictError(
        `Nie można wyłączyć produktu — na magazynie pozostaje ${stock.toFixed(3)} MP. Rozlicz stan przed dezaktywacją.`,
      );
    }
    return products.update(id, { isActive: false });
  },

  /** Zakłada produkt na podstawie samej nazwy (wprowadzanie dokumentu). */
  ensure(name, category = 'INNE') {
    if (!name) return null;
    return products.findByName(name) || products.create({ name, category });
  },
};

const mapProduct = (r) => ({
  id: r.id,
  code: r.code,
  name: r.name,
  category: r.category,
  defaultUnit: r.default_unit,
  m3ToMp: r.m3_to_mp,
  mpToTonne: r.mp_to_tonne,
  tonneToGj: r.tonne_to_gj,
  notes: r.notes,
  isActive: !!r.is_active,
});

/* ---------------------------- Kontrahenci ----------------------------- */

const PARTNER_SCHEMA = {
  name: { type: 'string', required: true, max: 160, label: 'Nazwa kontrahenta' },
  code: { type: 'string', max: 40, upper: true, label: 'Kod' },
  kind: { type: 'enum', values: ['DOSTAWCA', 'ODBIORCA', 'OBA', 'PRZEWOZNIK'], default: 'OBA', label: 'Rodzaj' },
  nip: { type: 'string', max: 20, label: 'NIP' },
  address: { type: 'string', max: 250, label: 'Adres' },
  email: { type: 'string', max: 120, label: 'E-mail' },
  phone: { type: 'string', max: 40, label: 'Telefon' },
  notes: { type: 'string', max: 500, label: 'Uwagi' },
  isActive: { type: 'bool', label: 'Aktywny' },
};

export const partners = {
  list({ includeInactive = false, kind = '', q = '' } = {}) {
    const params = {};
    let sql = `SELECT * FROM partners WHERE 1=1 ${activeFilter(includeInactive)}`;
    if (kind) {
      sql += " AND (kind = :kind OR kind = 'OBA')";
      params.kind = kind;
    }
    if (q) {
      sql += ' AND (name LIKE :q OR COALESCE(nip, \'\') LIKE :q OR COALESCE(code, \'\') LIKE :q)';
      params.q = `%${q}%`;
    }
    return db.all(`${sql} ORDER BY name`, params).map(mapPartner);
  },

  get(id) {
    const row = db.get('SELECT * FROM partners WHERE id = :id', { id });
    if (!row) throw new NotFoundError('Nie znaleziono kontrahenta.');
    return mapPartner(row);
  },

  findByName(name) {
    if (!name) return null;
    const row = db.get('SELECT * FROM partners WHERE name = :name COLLATE NOCASE', { name });
    return row ? mapPartner(row) : null;
  },

  create(input) {
    const d = validate(input, PARTNER_SCHEMA);
    if (db.get('SELECT 1 AS x FROM partners WHERE name = :name COLLATE NOCASE', { name: d.name })) {
      throw new ConflictError(`Kontrahent „${d.name}” już istnieje.`);
    }
    if (d.nip && !/^[0-9-]{10,15}$/.test(d.nip)) {
      throw new ValidationError('NIP może zawierać wyłącznie cyfry i myślniki (10–15 znaków).');
    }
    const id = uuid();
    db.run(
      `INSERT INTO partners(id, code, name, kind, nip, address, email, phone, notes, is_active)
            VALUES (:id, :code, :name, :kind, :nip, :address, :email, :phone, :notes, :isActive)`,
      {
        id,
        code: d.code || uniqueCode('partners', d.name, 'K'),
        name: d.name,
        kind: d.kind,
        nip: d.nip ?? null,
        address: d.address ?? null,
        email: d.email ?? null,
        phone: d.phone ?? null,
        notes: d.notes ?? null,
        isActive: d.isActive ?? true,
      },
    );
    return partners.get(id);
  },

  update(id, input) {
    partners.get(id);
    const d = validate(input, PARTNER_SCHEMA, { partial: true });
    applyPatch('partners', id, {
      code: d.code, name: d.name, kind: d.kind, nip: d.nip, address: d.address,
      email: d.email, phone: d.phone, notes: d.notes, is_active: d.isActive,
    });
    return partners.get(id);
  },

  ensure(name, kind = 'OBA') {
    if (!name) return null;
    return partners.findByName(name) || partners.create({ name, kind });
  },
};

const mapPartner = (r) => ({
  id: r.id, code: r.code, name: r.name, kind: r.kind, nip: r.nip,
  address: r.address, email: r.email, phone: r.phone, notes: r.notes,
  isActive: !!r.is_active,
});

/* ------------------------------ Pojazdy ------------------------------- */

const VEHICLE_SCHEMA = {
  plate: { type: 'string', required: true, max: 20, upper: true, label: 'Numer rejestracyjny' },
  carrierId: { type: 'string', max: 40, label: 'Przewoźnik (kartoteka)' },
  carrierName: { type: 'string', max: 160, label: 'Przewoźnik / kierowca' },
  description: { type: 'string', max: 200, label: 'Opis' },
  isActive: { type: 'bool', label: 'Aktywny' },
};

export const vehicles = {
  list({ includeInactive = false } = {}) {
    return db.all(
      `SELECT v.*, p.name AS carrier_partner_name
         FROM vehicles v LEFT JOIN partners p ON p.id = v.carrier_id
        WHERE 1=1 ${includeInactive ? '' : 'AND v.is_active = 1'}
        ORDER BY v.plate`,
    ).map(mapVehicle);
  },

  get(id) {
    const row = db.get(
      `SELECT v.*, p.name AS carrier_partner_name
         FROM vehicles v LEFT JOIN partners p ON p.id = v.carrier_id WHERE v.id = :id`, { id },
    );
    if (!row) throw new NotFoundError('Nie znaleziono pojazdu.');
    return mapVehicle(row);
  },

  create(input) {
    const d = validate(input, VEHICLE_SCHEMA);
    if (db.get('SELECT 1 AS x FROM vehicles WHERE plate = :plate', { plate: d.plate })) {
      throw new ConflictError(`Pojazd ${d.plate} jest już w kartotece.`);
    }
    const id = uuid();
    db.run(
      `INSERT INTO vehicles(id, plate, carrier_id, carrier_name, description, is_active)
            VALUES (:id, :plate, :carrierId, :carrierName, :description, :isActive)`,
      {
        id,
        plate: d.plate,
        carrierId: d.carrierId ?? null,
        carrierName: d.carrierName ?? null,
        description: d.description ?? null,
        isActive: d.isActive ?? true,
      },
    );
    return vehicles.get(id);
  },

  update(id, input) {
    vehicles.get(id);
    const d = validate(input, VEHICLE_SCHEMA, { partial: true });
    applyPatch('vehicles', id, {
      plate: d.plate, carrier_id: d.carrierId, carrier_name: d.carrierName,
      description: d.description, is_active: d.isActive,
    });
    return vehicles.get(id);
  },

  ensure(plate, carrierName) {
    if (!plate) return null;
    const norm = String(plate).toUpperCase().trim();
    const found = db.get('SELECT * FROM vehicles WHERE plate = :plate', { plate: norm });
    if (found) return mapVehicle(found);
    return vehicles.create({ plate: norm, carrierName });
  },
};

const mapVehicle = (r) => ({
  id: r.id, plate: r.plate, carrierId: r.carrier_id,
  carrierName: r.carrier_name || r.carrier_partner_name || null,
  description: r.description, isActive: !!r.is_active,
});

/* --------------------- Nadleśnictwa i leśnictwa ----------------------- */

export const forest = {
  listDistricts({ includeInactive = false } = {}) {
    return db.all(
      `SELECT * FROM forest_districts WHERE 1=1 ${activeFilter(includeInactive)} ORDER BY name`,
    ).map((r) => ({ id: r.id, name: r.name, region: r.region, isActive: !!r.is_active }));
  },

  listRanges({ districtId = '', includeInactive = false } = {}) {
    const params = {};
    let sql = `SELECT r.*, d.name AS district_name
                 FROM forest_ranges r JOIN forest_districts d ON d.id = r.district_id
                WHERE 1=1 ${includeInactive ? '' : 'AND r.is_active = 1'}`;
    if (districtId) { sql += ' AND r.district_id = :districtId'; params.districtId = districtId; }
    return db.all(`${sql} ORDER BY d.name, r.name`, params)
      .map((r) => ({ id: r.id, districtId: r.district_id, districtName: r.district_name, name: r.name, isActive: !!r.is_active }));
  },

  createDistrict(input) {
    const d = validate(input, {
      name: { type: 'string', required: true, max: 120, label: 'Nadleśnictwo' },
      region: { type: 'string', max: 120, label: 'RDLP' },
    });
    const existing = db.get('SELECT * FROM forest_districts WHERE name = :name COLLATE NOCASE', { name: d.name });
    if (existing) return { id: existing.id, name: existing.name, region: existing.region, isActive: !!existing.is_active };
    const id = uuid();
    db.run('INSERT INTO forest_districts(id, name, region) VALUES (:id, :name, :region)', {
      id, name: d.name, region: d.region ?? null,
    });
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
    db.run('INSERT INTO forest_ranges(id, district_id, name) VALUES (:id, :districtId, :name)', {
      id, districtId: d.districtId, name: d.name,
    });
    return { id, districtId: d.districtId, name: d.name, isActive: true };
  },

  /** Zapisuje nadleśnictwo/leśnictwo podane w dokumencie jako tekst. */
  ensure(districtName, rangeName) {
    if (!districtName) return;
    const district = forest.createDistrict({ name: districtName });
    if (rangeName) forest.createRange({ districtId: district.id, name: rangeName });
  },
};

/* ------------------------- Miejsca załadunku -------------------------- */

export const loadingPlaces = {
  list({ includeInactive = false } = {}) {
    return db.all(
      `SELECT * FROM loading_places WHERE 1=1 ${activeFilter(includeInactive)} ORDER BY name`,
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

/* ------------------------- Wspólne narzędzia -------------------------- */

/** Aktualizacja częściowa — pomija pola `undefined`, zawsze ustawia `updated_at`. */
function applyPatch(table, id, patch) {
  const fields = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!fields.length) return;
  const params = { id };
  const sets = fields.map(([col, value], i) => {
    params[`p${i}`] = value;
    return `${col} = :p${i}`;
  });
  db.run(`UPDATE ${table} SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = :id`, params);
}

/** Komplet kartotek dla ekranu wprowadzania dokumentu (jedno żądanie). */
export function catalogSnapshot() {
  return {
    warehouses: warehouses.list(),
    products: products.list(),
    partners: partners.list(),
    vehicles: vehicles.list(),
    forestDistricts: forest.listDistricts(),
    forestRanges: forest.listRanges(),
    loadingPlaces: loadingPlaces.list(),
  };
}
