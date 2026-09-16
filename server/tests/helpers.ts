import { getDb, type Db } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedCore, seedDictionaries, seedDemoUsers } from '../src/db/seed.js';
import { findUserByLogin, toAuthUser } from '../src/modules/auth/auth.service.js';
import type { AuthUser } from '../src/core/context.js';
import type { AuditActor } from '../src/core/audit.js';
import type { DocumentInput } from '../src/modules/documents/documents.types.js';

export const ADMIN_PASSWORD = 'Admin#2026';
export const DEMO_PASSWORD = 'Demo#2026';

export interface TestFixture {
  db: Db;
  warehouses: Record<string, number>;
  products: Record<string, number>;
  partners: Record<string, number>;
}

/** Czysta baza ze slownikami i kontami, bez dokumentow operacyjnych. */
export function setupFixture(): TestFixture {
  const db = getDb();
  wipe(db);
  runMigrations(db);
  seedCore(db, ADMIN_PASSWORD);
  const ids = seedDictionaries(db);
  seedDemoUsers(db, ids, DEMO_PASSWORD);
  return { db, ...ids };
}

function wipe(db: Db): void {
  db.pragma('foreign_keys = OFF');
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  // Wyzwalacze chroniace audyt i ruchy trzeba zdjac, aby wyczyscic baze.
  const triggers = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
    .all() as Array<{ name: string }>;
  for (const t of triggers) db.exec(`DROP TRIGGER IF EXISTS "${t.name}"`);
  for (const t of tables) db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
  db.pragma('foreign_keys = ON');
}

export function actingUser(db: Db, login: string): { user: AuthUser; actor: AuditActor } {
  const row = findUserByLogin(db, login);
  if (!row) throw new Error(`Brak uzytkownika testowego: ${login}`);
  const user = toAuthUser(db, row);
  return {
    user,
    actor: { id: user.id, login: user.login, fullName: user.fullName, ip: '127.0.0.1', userAgent: 'vitest' },
  };
}

/** Bazowy szkielet dokumentu - testy nadpisuja tylko istotne pola. */
export function docBase(): Omit<DocumentInput, 'docType' | 'docDate' | 'lines'> {
  return {
    warehouseId: null,
    warehouseFromId: null,
    warehouseToId: null,
    supplierId: null,
    customerId: null,
    carrierId: null,
    forestTicketNo: '',
    forestDistrict: '',
    forestSubdistrict: '',
    chippingMode: null,
    chippingCompany: '',
    chippingRate: null,
    productionPlace: '',
    vehiclePlate: '',
    driverName: '',
    loadPlace: '',
    unloadPlace: '',
    distanceKm: 0,
    transportRate: null,
    transportCost: null,
    externalNumber: '',
    notes: '',
    parentDocumentId: null,
    clientRequestId: null,
  };
}

export function line(productId: number, qtyBase: number, extra: Partial<DocumentInput['lines'][number]> = {}) {
  return {
    productId,
    role: 'STD' as const,
    qtyBase,
    qtyM3: null,
    qtyMp: null,
    qtyT: null,
    unitPrice: 0,
    costUnitPrice: 0,
    notes: '',
    ...extra,
  };
}

export function stockOf(db: Db, warehouseId: number, productId: number): number {
  const row = db
    .prepare('SELECT qty_base FROM stock WHERE warehouse_id = ? AND product_id = ?')
    .get(warehouseId, productId) as { qty_base: number } | undefined;
  return row ? row.qty_base : 0;
}
