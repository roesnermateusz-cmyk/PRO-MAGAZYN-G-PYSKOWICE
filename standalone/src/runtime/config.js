/**
 * Konfiguracja wersji jednoplikowej.
 *
 * Zastępuje `server/src/config/env.js`. Wersja serwerowa czyta `.env` i zmienne
 * środowiskowe; tutaj nie ma ani jednego, ani drugiego — plik uruchamia się
 * podwójnym kliknięciem, więc konfiguracja jest stała, a te nieliczne wartości,
 * które użytkownik może zmienić (nazwa firmy, adres, magazyn domyślny), siedzą
 * w bazie, w tabeli `settings`, i zmienia się je w widoku Ustawień.
 *
 * Kształt obiektu jest ten sam, co w wersji serwerowej — serwisy nie wiedzą,
 * w którym środowisku pracują.
 */

/** Ścieżki są wirtualne: wskazują wpisy w systemie plików w IndexedDB. */
const DB_FILE = '/dane/resinvest.db';

export const config = Object.freeze({
  rootDir: '/',
  env: 'standalone',
  isProduction: true,

  http: Object.freeze({
    port: 0,
    host: 'local',
    corsOrigins: Object.freeze([]),
    bodyLimitBytes: 16 * 1024 * 1024,
  }),

  auth: Object.freeze({
    // Wersja jednoplikowa nie wystawia tokenów sesji — patrz runtime/crypto.js.
    secret: 'standalone',
    generatedSecret: false,
    accessTtlMin: 0,
    refreshTtlDays: 0,
    maxFailed: 0,
    lockMinutes: 0,
  }),

  db: Object.freeze({
    file: DB_FILE,
    autoMigrate: true,
  }),

  attachments: Object.freeze({
    dir: '/dane/zalaczniki',
    maxBytes: 12 * 1024 * 1024,
    allowedMime: Object.freeze([
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
    ]),
  }),

  backup: Object.freeze({
    dir: '/dane/kopie',
    keep: 10,
  }),

  log: Object.freeze({ level: 'info', file: '' }),

  bootstrap: Object.freeze({
    email: 'operator@resinvest.local',
    name: 'Operator',
    // Brak logowania — konto startowe istnieje tylko po to, żeby dokumenty
    // miały autora, a role sterowały widocznością akcji w interfejsie.
    password: 'jednoplikowa-bez-logowania',
  }),

  company: Object.freeze({
    name: 'ResInvest Commodities PL',
    address: 'ul. Gwarecka 16, 41-800 Zabrze',
    nip: '',
    // Ta sama nazwa, co domyślna w `server/src/config/env.js`. Musi się zgadzać:
    // dane demonstracyjne rozpoznają magazyn startowy po nazwie i pomijają go.
    // Rozjazd kończył się próbą założenia drugiego magazynu z tym samym kodem
    // „MAG-GLOWNY” i naruszeniem unikalności.
    defaultWarehouse: 'Magazyn RiC Zabrze',
  }),

  webDir: '/',
});

export default config;
