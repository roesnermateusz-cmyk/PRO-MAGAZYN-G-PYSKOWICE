/**
 * Inicjalizacja instancji: migracje, dane niezbędne do pracy, konto startowe.
 *
 * Funkcja jest idempotentna — można ją wywołać przy każdym starcie aplikacji.
 */
import db, { openDatabase, runMigrations } from './db/index.js';
import config from './config/env.js';
import logger from './lib/logger.js';
import { uuid, hashPassword, shortId } from './lib/crypto.js';
import { invalidateSettingsCache } from './modules/settings/settings.service.js';

/** Produkty spotykane w obrocie biomasą leśną — punkt wyjścia kartoteki. */
const BASE_PRODUCTS = [
  ['DREWNO-OPALOWE-LAS', 'Drewno opałowe z lasu', 'SUROWIEC', 'M3'],
  ['DREWNO-PRZEM-INWEST', 'Drewno przemysłowe z wycinek inwest.', 'SUROWIEC', 'M3'],
  ['ZREBKA-TOWAR', 'Zrębka Towar', 'ZREBKA', 'MP'],
  ['ZREBKA-PROD-LESNA', 'Zrębka Produkcyjna Leśna', 'ZREBKA', 'MP'],
  ['ZREBKA-PROD-DRZEWNA', 'Zrębka Produkcyjna Drzewna', 'ZREBKA', 'MP'],
  ['ZREBKA-PROD-INWEST', 'Zrębka Produkcyjna Inwestycyjna', 'ZREBKA', 'MP'],
  ['TROCINY', 'Trociny', 'PRODUKT_UBOCZNY', 'MP'],
  ['ZRZYNA', 'Zrzyna', 'PRODUKT_UBOCZNY', 'MP'],
  ['POZOSTALOSC-TARTACZNA', 'Pozostałość tartaczna', 'PRODUKT_UBOCZNY', 'MP'],
  ['PKS', 'PKS', 'INNE', 'TONA'],
  ['LUPINY-NERKOWCA', 'Łupiny nerkowca', 'INNE', 'TONA'],
];

/**
 * Przygotowuje bazę do pracy.
 * @returns {{migrations:string[], bootstrapPassword:string|null}}
 */
export function bootstrap() {
  openDatabase();
  const migrations = config.db.autoMigrate ? runMigrations() : [];
  invalidateSettingsCache();

  let bootstrapPassword = null;

  db.tx(() => {
    /* Magazyn domyślny — bez niego nie da się zaksięgować żadnego dokumentu. */
    if (!db.value('SELECT COUNT(*) FROM warehouses')) {
      db.run(
        `INSERT INTO warehouses(id, code, name, address, is_default)
              VALUES (:id, 'MAG-GLOWNY', :name, :address, 1)`,
        { id: uuid(), name: config.company.defaultWarehouse, address: config.company.address },
      );
      logger.info('Utworzono magazyn domyślny', { name: config.company.defaultWarehouse });
    }

    /* Kartoteka produktów — startowy zestaw można później dowolnie zmienić. */
    if (!db.value('SELECT COUNT(*) FROM products')) {
      for (const [code, name, category, unit] of BASE_PRODUCTS) {
        db.run(
          `INSERT INTO products(id, code, name, category, default_unit)
                VALUES (:id, :code, :name, :category, :unit)`,
          { id: uuid(), code, name, category, unit },
        );
      }
      logger.info('Założono startową kartotekę produktów', { count: BASE_PRODUCTS.length });
    }

    /* Konto administratora — tylko gdy w bazie nie ma żadnego użytkownika. */
    if (!db.value('SELECT COUNT(*) FROM users')) {
      const password = config.bootstrap.password || `Res-${shortId(6)}-${new Date().getFullYear()}`;
      bootstrapPassword = config.bootstrap.password ? null : password;
      db.run(
        `INSERT INTO users(id, email, full_name, password_hash, role, must_change_password)
              VALUES (:id, :email, :name, :hash, 'ADMIN', 1)`,
        {
          id: uuid(),
          email: config.bootstrap.email,
          name: config.bootstrap.name,
          hash: hashPassword(password),
        },
      );
      logger.info('Utworzono konto administratora', { email: config.bootstrap.email });
    }
  });

  return { migrations, bootstrapPassword };
}

export default bootstrap;
