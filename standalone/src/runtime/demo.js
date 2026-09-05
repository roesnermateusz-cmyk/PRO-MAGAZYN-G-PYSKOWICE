/**
 * Dane demonstracyjne wersji jednoplikowej.
 *
 * Korzysta z tego samego generatora, co `npm run seed` — modułu
 * `server/src/seed/demo-seed.js` — i z tego samego pliku wejściowego
 * `server/seed/demo-data.json`, wklejonego do pakietu przez generator.
 * Dzięki temu wersja jednoplikowa pokazuje dokładnie ten sam komplet
 * dokumentów, co wersja sieciowa po zasianiu bazy: ta sama historia,
 * te same kwoty, ten sam stan magazynu.
 */
import db from '../../../server/src/db/index.js';
import { seedDatabase } from '../../../server/src/seed/demo-seed.js';
import { DEMO } from 'virtual:demo-data';
import logger from './logger.js';

/** Czy w bazie jest cokolwiek zaksięgowanego — decyduje o propozycji dopisania danych. */
export const hasAnyDocument = () => Number(db.value('SELECT COUNT(*) FROM operations') ?? 0) > 0;

/**
 * Dopisuje dane demonstracyjne w imieniu pierwszego administratora.
 * @returns {{chains:number, documents:number, warnings:string[]}}
 */
export function installDemoData() {
  const admin = db.get(
    "SELECT id, email, full_name, role FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1",
  );
  if (!admin) throw new Error('Brak konta administratora — baza nie została zainicjowana.');

  const ctx = {
    user: { id: admin.id, email: admin.email, fullName: admin.full_name, role: admin.role },
    ip: 'lokalnie',
    userAgent: 'dane-demonstracyjne',
  };

  const result = seedDatabase(DEMO, { ctx, log: (msg) => logger.info(msg) });
  if (result.warnings.length) {
    logger.warn('Część dokumentów demonstracyjnych pominięto', { liczba: result.warnings.length });
  }
  return result;
}
