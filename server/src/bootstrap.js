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

/**
 * Place składowe firmy — punkt wyjścia kartoteki magazynów.
 *
 * Pierwszy z listy jest magazynem domyślnym: tam trafiają dokumenty, w których
 * nie wskazano magazynu wprost. Nazwę pierwszego można nadpisać ustawieniem
 * `COMPANY_DEFAULT_WAREHOUSE` — reszta to stała kartoteka startowa, którą
 * administrator i tak może zmienić w interfejsie.
 *
 * Lista działa wyłącznie na PUSTEJ kartotece. Istniejącej instalacji nie
 * dotyka: nazwy placów to dane firmy, nie schemat.
 */
const BASE_WAREHOUSES = [
  ['MAG-ZABRZE', 'RiC Zabrze', 'ul. Gwarecka 16, 41-800 Zabrze'],
  ['MAG-BRASZEWICE', 'RiC Brąszewice', 'Brąszewice, powiat sieradzki'],
  ['MAG-ROKITKI', 'RiC Rokitki', 'Rokitki, gmina Chojnów'],
];

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
    /* Place składowe — bez magazynu domyślnego nie da się zaksięgować dokumentu. */
    if (!db.value('SELECT COUNT(*) FROM warehouses')) {
      BASE_WAREHOUSES.forEach(([code, name, address], index) => {
        db.run(
          `INSERT INTO warehouses(id, code, name, address, is_default)
                VALUES (:id, :code, :name, :address, :isDefault)`,
          {
            id: uuid(),
            code,
            name: index === 0 ? config.company.defaultWarehouse : name,
            address: index === 0 ? config.company.address : address,
            isDefault: index === 0 ? 1 : 0,
          },
        );
      });
      logger.info('Założono startową kartotekę magazynów', {
        count: BASE_WAREHOUSES.length,
        domyslny: config.company.defaultWarehouse,
      });
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
