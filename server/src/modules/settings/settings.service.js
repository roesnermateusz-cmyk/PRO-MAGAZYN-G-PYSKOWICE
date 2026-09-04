/**
 * Ustawienia systemowe — para klucz/wartość (JSON) z pamięcią podręczną.
 *
 * Ustawienia zmieniają zachowanie przyszłych zapisów; nie modyfikują
 * dokumentów już zaksięgowanych (te mają zapisane własne przeliczniki).
 */
import db from '../../db/index.js';
import { validate } from '../../lib/validate.js';
import { cache as responseCache, TAG } from '../../lib/cache.js';
import { DEFAULT_FACTORS } from '../../domain/units.js';

const DEFAULTS = Object.freeze({
  'units.m3_to_mp': DEFAULT_FACTORS.m3ToMp,
  'units.mp_to_tonne': DEFAULT_FACTORS.mpToTonne,
  'units.tonne_to_gj': DEFAULT_FACTORS.tonneToGj,
  'rules.allow_negative_stock': true,
  'rules.require_signature': true,
  'rules.backdate_days': 90,
});

let cache = null;

/** Unieważnia pamięć podręczną (wywoływane po każdym zapisie i w testach). */
export function invalidateSettingsCache() {
  cache = null;
  responseCache.bump([TAG.SETTINGS, TAG.STOCK, TAG.DOCUMENTS]);
}

/** Zwraca komplet ustawień (wartości domyślne uzupełniają braki). */
export function getAllSettings() {
  if (cache) return cache;
  const rows = db.all('SELECT key, value FROM settings');
  const out = { ...DEFAULTS };
  for (const row of rows) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value;
    }
  }
  cache = Object.freeze(out);
  return cache;
}

export function getSetting(key) {
  return getAllSettings()[key];
}

/** Globalne przeliczniki w formie używanej przez silnik jednostek. */
export function getUnitFactors() {
  const s = getAllSettings();
  return {
    m3ToMp: Number(s['units.m3_to_mp']) || DEFAULT_FACTORS.m3ToMp,
    mpToTonne: Number(s['units.mp_to_tonne']) || DEFAULT_FACTORS.mpToTonne,
    tonneToGj: Number(s['units.tonne_to_gj']) || DEFAULT_FACTORS.tonneToGj,
  };
}

// Każda reguła jest `required`, ale zapis jest częściowy (`partial`): klucz
// pominięty w żądaniu zostaje bez zmian, a klucz przysłany pusty to błąd
// formularza. Ustawienie nie ma stanu „puste” — wyczyszczony przelicznik
// wywróciłby przeliczenia wszystkich przyszłych dokumentów.
const SCHEMA = {
  'units.m3_to_mp': { type: 'number', required: true, min: 0.001, max: 100, label: 'Przelicznik m³ → MP' },
  'units.mp_to_tonne': { type: 'number', required: true, min: 0.001, max: 100, label: 'Przelicznik MP → tona' },
  'units.tonne_to_gj': { type: 'number', required: true, min: 0.001, max: 100, label: 'Przelicznik tona → GJ' },
  'rules.allow_negative_stock': { type: 'bool', required: true, label: 'Zezwalaj na stany ujemne' },
  'rules.require_signature': { type: 'bool', required: true, label: 'Wymagaj podpisu zatwierdzającego' },
  'rules.backdate_days': { type: 'int', required: true, min: 0, max: 3650, label: 'Dozwolone wstecz (dni)' },
};

/**
 * Zapisuje ustawienia. Akceptuje częściowy zestaw kluczy.
 * @param {object} input mapa klucz → wartość
 * @param {string} userId autor zmiany
 */
export function updateSettings(input, userId) {
  const clean = validate(input, SCHEMA, { partial: true });
  db.tx(() => {
    for (const [key, value] of Object.entries(clean)) {
      db.run(
        `INSERT INTO settings(key, value, updated_at, updated_by)
              VALUES (:key, :value, datetime('now'), :userId)
         ON CONFLICT(key) DO UPDATE
            SET value = :value, updated_at = datetime('now'), updated_by = :userId`,
        { key, value: JSON.stringify(value), userId },
      );
    }
  });
  invalidateSettingsCache();
  return getAllSettings();
}

export { DEFAULTS as SETTINGS_DEFAULTS, SCHEMA as SETTINGS_SCHEMA };
