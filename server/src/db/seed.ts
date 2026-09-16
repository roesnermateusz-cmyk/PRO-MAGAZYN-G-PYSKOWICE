import type { Db } from './index.js';
import { nowIso, todayIsoDate } from '../core/time.js';
import { hashPassword } from '../core/password.js';
import { ALL_PERMISSIONS, PERMISSIONS, ROLE_DEFINITIONS, moduleOf } from '../core/permissions.js';
import { ensureDefaultSettings } from '../modules/settings/settings.service.js';
import { toAuthUser, findUserByLogin } from '../modules/auth/auth.service.js';
import { createDocument, postDocument } from '../modules/documents/documents.service.js';
import type { AuditActor } from '../core/audit.js';
import type { DocumentInput } from '../modules/documents/documents.types.js';
import { logger } from '../core/logger.js';

/**
 * Dane referencyjne wymagane do dzialania systemu (role, uprawnienia,
 * ustawienia, konto administratora). Operacja jest idempotentna.
 */
export function seedCore(db: Db, adminPassword: string): void {
  const stamp = nowIso();

  const upsertPermission = db.prepare(
    `INSERT INTO permissions (code, module, description) VALUES (?, ?, ?)
     ON CONFLICT (code) DO UPDATE SET module = excluded.module, description = excluded.description`,
  );
  for (const code of ALL_PERMISSIONS) {
    upsertPermission.run(code, moduleOf(code), PERMISSIONS[code]);
  }

  for (const role of ROLE_DEFINITIONS) {
    db.prepare(
      `INSERT INTO roles (code, name, description, is_system, created_at) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT (code) DO UPDATE SET name = excluded.name, description = excluded.description`,
    ).run(role.code, role.name, role.description, stamp);

    const roleId = (db.prepare('SELECT id FROM roles WHERE code = ?').get(role.code) as { id: number }).id;

    // Rola ADMIN zawsze otrzymuje pelny zestaw uprawnien, takze po dodaniu
    // nowych uprawnien w kolejnych wersjach systemu.
    if (role.code === 'ADMIN') {
      db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
    }
    const grant = db.prepare(
      'INSERT INTO role_permissions (role_id, permission_code) VALUES (?, ?) ON CONFLICT DO NOTHING',
    );
    for (const permission of role.permissions) grant.run(roleId, permission);
  }

  ensureDefaultSettings(db);

  const adminRoleId = (db.prepare("SELECT id FROM roles WHERE code = 'ADMIN'").get() as { id: number }).id;
  const existingAdmin = db.prepare("SELECT id FROM users WHERE login = 'admin'").get() as { id: number } | undefined;
  if (!existingAdmin) {
    db.prepare(
      `INSERT INTO users (login, full_name, email, password_hash, role_id, is_active,
                          must_change_password, locale, theme, created_at, updated_at)
       VALUES ('admin', 'Administrator systemu', NULL, ?, ?, 1, 1, 'pl', 'system', ?, ?)`,
    ).run(hashPassword(adminPassword), adminRoleId, stamp, stamp);
    logger.info('Utworzono konto administratora (login: admin).');
  }
}

interface DemoIds {
  warehouses: Record<string, number>;
  products: Record<string, number>;
  partners: Record<string, number>;
}

/** Slowniki i konta demonstracyjne. */
export function seedDictionaries(db: Db): DemoIds {
  const stamp = nowIso();

  const warehouses: Array<[string, string, string]> = [
    ['ZAB', 'RiC Zabrze', 'Zabrze'],
    ['BRA', 'RiC Braszewice', 'Braszewice'],
    ['ROK', 'RiC Rokitki', 'Rokitki'],
  ];
  const warehouseIds: Record<string, number> = {};
  for (const [code, name, city] of warehouses) {
    db.prepare(
      `INSERT INTO warehouses (code, name, address, postal_code, city, is_active, notes, created_at, updated_at)
       VALUES (?, ?, '', '', ?, 1, '', ?, ?)
       ON CONFLICT (code) DO UPDATE SET name = excluded.name`,
    ).run(code, name, city, stamp, stamp);
    warehouseIds[code] = (db.prepare('SELECT id FROM warehouses WHERE code = ?').get(code) as { id: number }).id;
  }

  const products: Array<[string, string, string, string, number | null, number | null]> = [
    ['DREWNO-OPAL', 'Drewno opalowe', 'RAW', 'M3', null, null],
    ['ZREBKA', 'Zrebka drzewna', 'FINISHED', 'MP', null, null],
    ['ZREBKA-SUCHA', 'Zrebka suszona', 'FINISHED', 'MP', 0.25, 0.28],
    ['PELLET', 'Pellet drzewny A1', 'GOODS', 'T', null, null],
    ['TROCINY', 'Trociny', 'GOODS', 'MP', null, null],
  ];
  const productIds: Record<string, number> = {};
  for (const [code, name, kind, unit, m3PerMp, tPerMp] of products) {
    db.prepare(
      `INSERT INTO products (code, name, kind, base_unit, m3_per_mp, t_per_mp, is_active, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, '', ?, ?)
       ON CONFLICT (code) DO UPDATE SET name = excluded.name`,
    ).run(code, name, kind, unit, m3PerMp, tPerMp, stamp, stamp);
    productIds[code] = (db.prepare('SELECT id FROM products WHERE code = ?').get(code) as { id: number }).id;
  }

  const partners: Array<{
    code: string;
    name: string;
    taxId: string;
    city: string;
    supplier: number;
    customer: number;
    carrier: number;
    forestry: number;
  }> = [
    { code: 'NADL-RUDY', name: 'Nadlesnictwo Rudy Raciborskie', taxId: '6391000000', city: 'Kuznia Raciborska', supplier: 1, customer: 0, carrier: 0, forestry: 1 },
    { code: 'NADL-BRYNEK', name: 'Nadlesnictwo Brynek', taxId: '6451000000', city: 'Tworog', supplier: 1, customer: 0, carrier: 0, forestry: 1 },
    { code: 'LASPOL', name: 'Laspol Sp. z o.o.', taxId: '6312000000', city: 'Gliwice', supplier: 1, customer: 1, carrier: 0, forestry: 0 },
    { code: 'EC-ZABRZE', name: 'Elektrocieplownia Zabrze S.A.', taxId: '6480000000', city: 'Zabrze', supplier: 0, customer: 1, carrier: 0, forestry: 0 },
    { code: 'EC-JAWORZNO', name: 'Elektrownia Jaworzno Sp. z o.o.', taxId: '6320000000', city: 'Jaworzno', supplier: 0, customer: 1, carrier: 0, forestry: 0 },
    { code: 'TRANS-KOWAL', name: 'Transport Kowalski', taxId: '6270000000', city: 'Pyskowice', supplier: 0, customer: 0, carrier: 1, forestry: 0 },
    { code: 'TRANS-LOG', name: 'LogTrans Silesia', taxId: '6310000000', city: 'Gliwice', supplier: 0, customer: 0, carrier: 1, forestry: 0 },
  ];
  const partnerIds: Record<string, number> = {};
  for (const p of partners) {
    db.prepare(
      `INSERT INTO partners (code, name, tax_id, address, postal_code, city, country, phone, email,
                             is_supplier, is_customer, is_carrier, is_forestry, is_active, notes, created_at, updated_at)
       VALUES (?, ?, ?, '', '', ?, 'PL', '', '', ?, ?, ?, ?, 1, '', ?, ?)
       ON CONFLICT (code) DO UPDATE SET name = excluded.name`,
    ).run(p.code, p.name, p.taxId, p.city, p.supplier, p.customer, p.carrier, p.forestry, stamp, stamp);
    partnerIds[p.code] = (db.prepare('SELECT id FROM partners WHERE code = ?').get(p.code) as { id: number }).id;
  }

  return { warehouses: warehouseIds, products: productIds, partners: partnerIds };
}

/** Konta demonstracyjne dla poszczegolnych rol. */
export function seedDemoUsers(db: Db, ids: DemoIds, password: string): void {
  const stamp = nowIso();
  const roleId = (code: string) =>
    (db.prepare('SELECT id FROM roles WHERE code = ?').get(code) as { id: number }).id;

  const users: Array<{ login: string; name: string; role: string; warehouses: string[] }> = [
    { login: 'manager', name: 'Anna Nowak (Manager)', role: 'MANAGER', warehouses: ['ZAB', 'BRA', 'ROK'] },
    { login: 'zabrze', name: 'Jan Kowalski (Zabrze)', role: 'WAREHOUSE', warehouses: ['ZAB'] },
    { login: 'braszewice', name: 'Piotr Wisniewski (Braszewice)', role: 'WAREHOUSE', warehouses: ['BRA'] },
    { login: 'rokitki', name: 'Marek Zielinski (Rokitki)', role: 'WAREHOUSE', warehouses: ['ROK'] },
    { login: 'podglad', name: 'Konto podgladu', role: 'VIEWER', warehouses: ['ZAB', 'BRA', 'ROK'] },
  ];

  for (const u of users) {
    const existing = db.prepare('SELECT id FROM users WHERE login = ?').get(u.login) as { id: number } | undefined;
    let userId: number;
    if (existing) {
      userId = existing.id;
    } else {
      const result = db
        .prepare(
          `INSERT INTO users (login, full_name, email, password_hash, role_id, is_active,
                              must_change_password, locale, theme, default_warehouse_id, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, 1, 0, 'pl', 'system', ?, ?, ?)`,
        )
        .run(
          u.login,
          u.name,
          hashPassword(password),
          roleId(u.role),
          ids.warehouses[u.warehouses[0] as string] ?? null,
          stamp,
          stamp,
        );
      userId = Number(result.lastInsertRowid);
    }

    const grant = db.prepare(
      'INSERT INTO user_warehouses (user_id, warehouse_id, granted_at, granted_by) VALUES (?, ?, ?, NULL) ON CONFLICT DO NOTHING',
    );
    for (const code of u.warehouses) grant.run(userId, ids.warehouses[code], stamp);
  }
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayIsoDate(d);
}

/**
 * Przykladowe operacje odwzorowujace pelny przeplyw biznesowy.
 * Dokumenty tworzone sa przez warstwe serwisowa, dzieki czemu stany, ruchy
 * magazynowe i audyt sa identyczne jak przy pracy rzeczywistej.
 */
export function seedDemoOperations(db: Db, ids: DemoIds): void {
  const already = db.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number };
  if (already.c > 0) {
    logger.info('Pominieto dane operacyjne - dokumenty juz istnieja.');
    return;
  }

  const adminRow = findUserByLogin(db, 'admin');
  if (!adminRow) throw new Error('Brak konta administratora - uruchom seedCore().');
  const admin = toAuthUser(db, adminRow);
  const actor: AuditActor = { id: admin.id, login: admin.login, fullName: admin.fullName, ip: 'seed', userAgent: 'seed' };

  const create = (input: DocumentInput) => {
    const doc = createDocument(db, admin, actor, input);
    return postDocument(db, admin, actor, doc.id, doc.version);
  };

  const base = {
    forestTicketNo: '',
    forestDistrict: '',
    forestSubdistrict: '',
    chippingCompany: '',
    productionPlace: '',
    vehiclePlate: '',
    driverName: '',
    loadPlace: '',
    unloadPlace: '',
    distanceKm: 0,
    externalNumber: '',
    notes: '',
  };

  // 1. Zakup drewna od nadlesnictwa -> przyjecie do magazynu Zabrze
  create({
    ...base,
    docType: 'PZ',
    docDate: daysAgo(21),
    warehouseId: ids.warehouses.ZAB as number,
    supplierId: ids.partners['NADL-RUDY'] as number,
    forestTicketNo: 'KW/2026/00841',
    forestDistrict: 'Nadlesnictwo Rudy Raciborskie',
    forestSubdistrict: 'Lesnictwo Sobieszowice',
    vehiclePlate: 'SK7H433',
    notes: 'Dostawa drewna opalowego S4.',
    lines: [
      { productId: ids.products['DREWNO-OPAL'] as number, role: 'STD', qtyBase: 240, qtyM3: null, qtyMp: null, qtyT: null, unitPrice: 165, costUnitPrice: 0, notes: '' },
    ],
  } as DocumentInput);

  create({
    ...base,
    docType: 'PZ',
    docDate: daysAgo(18),
    warehouseId: ids.warehouses.BRA as number,
    supplierId: ids.partners['NADL-BRYNEK'] as number,
    forestTicketNo: 'KW/2026/00912',
    forestDistrict: 'Nadlesnictwo Brynek',
    forestSubdistrict: 'Lesnictwo Tworog',
    vehiclePlate: 'SG54821',
    lines: [
      { productId: ids.products['DREWNO-OPAL'] as number, role: 'STD', qtyBase: 180, qtyM3: null, qtyMp: null, qtyT: null, unitPrice: 158, costUnitPrice: 0, notes: '' },
    ],
  } as DocumentInput);

  // 2. Produkcja zrebki - automatyczne zuzycie 100 m3 -> 400 MP
  create({
    ...base,
    docType: 'PROD',
    docDate: daysAgo(14),
    warehouseId: ids.warehouses.ZAB as number,
    chippingMode: 'OWN',
    chippingRate: 10,
    productionPlace: 'Plac skladowy Zabrze',
    notes: 'Rabanie wlasne - rebak mobilny.',
    lines: [
      { productId: ids.products['DREWNO-OPAL'] as number, role: 'INPUT', qtyBase: 100, qtyM3: null, qtyMp: null, qtyT: null, unitPrice: 0, costUnitPrice: 165, notes: 'Surowiec' },
      { productId: ids.products.ZREBKA as number, role: 'OUTPUT', qtyBase: 400, qtyM3: null, qtyMp: null, qtyT: null, unitPrice: 0, costUnitPrice: 0, notes: 'Wyrob' },
    ],
  } as DocumentInput);

  create({
    ...base,
    docType: 'PROD',
    docDate: daysAgo(9),
    warehouseId: ids.warehouses.BRA as number,
    chippingMode: 'EXTERNAL',
    chippingCompany: 'Uslugi Lesne Debowiec',
    chippingRate: 14.5,
    productionPlace: 'Plac skladowy Braszewice',
    lines: [
      { productId: ids.products['DREWNO-OPAL'] as number, role: 'INPUT', qtyBase: 60, qtyM3: null, qtyMp: null, qtyT: null, unitPrice: 0, costUnitPrice: 158, notes: '' },
      { productId: ids.products.ZREBKA as number, role: 'OUTPUT', qtyBase: 240, qtyM3: null, qtyMp: null, qtyT: null, unitPrice: 0, costUnitPrice: 0, notes: '' },
    ],
  } as DocumentInput);

  // 3. Przesuniecie miedzymagazynowe Zabrze -> Rokitki
  create({
    ...base,
    docType: 'MM',
    docDate: daysAgo(7),
    warehouseFromId: ids.warehouses.ZAB as number,
    warehouseToId: ids.warehouses.ROK as number,
    vehiclePlate: 'SK7H433',
    notes: 'Przesuniecie zrebki do magazynu docelowego.',
    lines: [
      { productId: ids.products.ZREBKA as number, role: 'STD', qtyBase: 150, qtyM3: null, qtyMp: null, qtyT: null, unitPrice: 0, costUnitPrice: 0, notes: '' },
    ],
  } as DocumentInput);

  // 4. Transport zewnetrzny (operacja kosztowa)
  create({
    ...base,
    docType: 'TR',
    docDate: daysAgo(6),
    warehouseFromId: ids.warehouses.ZAB as number,
    warehouseToId: ids.warehouses.ROK as number,
    carrierId: ids.partners['TRANS-KOWAL'] as number,
    vehiclePlate: 'SPY4021',
    driverName: 'Tomasz Lis',
    loadPlace: 'Zabrze, plac skladowy',
    unloadPlace: 'Rokitki, magazyn',
    distanceKm: 112,
    transportRate: 5,
    lines: [
      { productId: ids.products.ZREBKA as number, role: 'STD', qtyBase: 150, qtyM3: null, qtyMp: null, qtyT: null, unitPrice: 0, costUnitPrice: 0, notes: '' },
    ],
  } as DocumentInput);

  // 5. Sprzedaz z magazynu (WZ)
  create({
    ...base,
    docType: 'WZ',
    docDate: daysAgo(4),
    warehouseId: ids.warehouses.ZAB as number,
    customerId: ids.partners['EC-ZABRZE'] as number,
    vehiclePlate: 'SPY4021',
    notes: 'Dostawa zrebki do elektrocieplowni.',
    lines: [
      { productId: ids.products.ZREBKA as number, role: 'STD', qtyBase: 180, qtyM3: null, qtyMp: null, qtyT: null, unitPrice: 82, costUnitPrice: 0, notes: '' },
    ],
  } as DocumentInput);

  create({
    ...base,
    docType: 'WZ',
    docDate: daysAgo(2),
    warehouseId: ids.warehouses.ROK as number,
    customerId: ids.partners['EC-JAWORZNO'] as number,
    lines: [
      { productId: ids.products.ZREBKA as number, role: 'STD', qtyBase: 90, qtyM3: null, qtyMp: null, qtyT: null, unitPrice: 85, costUnitPrice: 0, notes: '' },
    ],
  } as DocumentInput);

  // 6. Sprzedaz bezposrednia: zakup -> sprzedaz bez przyjecia do magazynu
  create({
    ...base,
    docType: 'SD',
    docDate: daysAgo(1),
    supplierId: ids.partners.LASPOL as number,
    customerId: ids.partners['EC-JAWORZNO'] as number,
    vehiclePlate: 'SG11290',
    notes: 'Towar przewieziony bezposrednio od dostawcy do odbiorcy.',
    lines: [
      { productId: ids.products.PELLET as number, role: 'STD', qtyBase: 24, qtyM3: null, qtyMp: null, qtyT: null, unitPrice: 1180, costUnitPrice: 990, notes: '' },
    ],
  } as DocumentInput);

  logger.info('Utworzono przykladowe dokumenty operacyjne.');
}

export function seedAll(db: Db, options: { adminPassword: string; demoPassword: string; withDemo: boolean }): void {
  seedCore(db, options.adminPassword);
  if (!options.withDemo) return;
  const ids = seedDictionaries(db);
  seedDemoUsers(db, ids, options.demoPassword);
  seedDemoOperations(db, ids);
}
