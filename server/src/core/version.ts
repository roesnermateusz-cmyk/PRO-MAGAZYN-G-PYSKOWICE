import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Numer wersji systemu - jedno źródło prawdy.
 *
 * Kolejność ustalania:
 *   1. zmienna APP_VERSION - ustawia ją powłoka Electrona z manifestu aplikacji,
 *      dzięki czemu wersja w oknie programu i w API zawsze się zgadzają,
 *   2. plik package.json obok zbudowanego serwera (uruchomienie samodzielne
 *      oraz tryb deweloperski),
 *   3. wartość zastępcza, jeżeli żadne z powyższych nie jest dostępne.
 *
 * Odczyt wykonujemy raz, przy starcie procesu.
 */
function readVersion(): string {
  const fromEnv = process.env.APP_VERSION?.trim();
  if (fromEnv) return fromEnv;

  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/core -> src -> server        (tryb deweloperski)
  // dist/core -> dist -> server      (build samodzielny)
  // server/core -> server            (ładunek instalatora)
  const candidates = [
    path.resolve(here, '..', '..', 'package.json'),
    path.resolve(here, '..', 'package.json'),
  ];

  for (const candidate of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { version?: unknown };
      if (typeof raw.version === 'string' && raw.version.length > 0) return raw.version;
    } catch {
      // Brak pliku lub niepoprawny JSON - próbujemy kolejnej lokalizacji.
    }
  }

  return '0.0.0-nieznana';
}

export const APP_VERSION = readVersion();
