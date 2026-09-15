/**
 * Numeracja i klasyfikacja dokumentów magazynowych.
 *
 * Serie zgodne z praktyką polskiej gospodarki magazynowej:
 *   PZ — przyjęcie zewnętrzne (zakup surowca)
 *   WZ — wydanie zewnętrzne (sprzedaż)
 *   PW — przyjęcie wewnętrzne (produkt z produkcji, np. zrębka po rąbaniu)
 *   RW — rozchód wewnętrzny (zużycie surowca do produkcji)
 *   MM — przesunięcie międzymagazynowe
 *   BO — bilans otwarcia
 *
 * W poprzedniej wersji arkuszowej wszystkie ogniwa łańcucha „zakup → zużycie →
 * produkcja” dzieliły jeden numer PZ, przez co dokumenty były nierozróżnialne.
 * Tutaj każdy dokument ma własny numer, a powiązanie utrzymuje pole `chain_ref`.
 */

export const OPERATION_TYPES = Object.freeze(['ZAKUP', 'SPRZEDAZ', 'PRODUKCJA', 'ZUZYCIE', 'MM', 'BO']);

export const SERIES_BY_TYPE = Object.freeze({
  ZAKUP: 'PZ',
  SPRZEDAZ: 'WZ',
  PRODUKCJA: 'PW',
  ZUZYCIE: 'RW',
  MM: 'MM',
  BO: 'BO',
});

export const TYPE_LABELS = Object.freeze({
  ZAKUP: 'Zakup',
  SPRZEDAZ: 'Sprzedaż',
  PRODUKCJA: 'Produkcja',
  ZUZYCIE: 'Zużycie',
  MM: 'Przesunięcie MM',
  BO: 'Bilans otwarcia',
});

/** Kierunek wpływu typu dokumentu na stan magazynowy. */
export const TYPE_DIRECTION = Object.freeze({
  ZAKUP: 'IN',
  PRODUKCJA: 'IN',
  BO: 'IN',
  SPRZEDAZ: 'OUT',
  ZUZYCIE: 'OUT',
  MM: 'TRANSFER',
});

/** `PZ/2026/000123` — seria, rok, numer wyrównany do 6 znaków. */
export function formatDocNo(series, year, number) {
  return `${series}/${year}/${String(number).padStart(6, '0')}`;
}

/** Rozkłada numer dokumentu na części składowe; `null` gdy format jest obcy. */
export function parseDocNo(docNo) {
  const m = /^([A-Z]{2})\/(\d{4})\/(\d+)$/.exec(String(docNo || '').trim());
  if (!m) return null;
  return { series: m[1], year: Number(m[2]), number: Number(m[3]) };
}

/**
 * Rezerwuje kolejny numer w serii dla danego roku.
 * Operacja jest atomowa (UPSERT + RETURNING), więc równoległe zapisy nie
 * mogą otrzymać tego samego numeru.
 *
 * @param {import('../db/index.js').db} db
 * @param {string} series seria dokumentu
 * @param {number} year rok kalendarzowy daty operacji
 */
export function allocateDocNumber(db, series, year) {
  const row = db.get(
    `INSERT INTO document_counters(series, year, last_number)
          VALUES (:series, :year, 1)
     ON CONFLICT(series, year)
     DO UPDATE SET last_number = last_number + 1
       RETURNING last_number`,
    { series, year },
  );
  const number = row.last_number;
  return { series, year, number, docNo: formatDocNo(series, year, number) };
}

/**
 * Podnosi licznik serii tak, aby był co najmniej równy podanemu numerowi.
 * Używane przy imporcie danych historycznych, żeby kolejne dokumenty
 * nie kolidowały z zaimportowanymi.
 */
export function bumpDocCounter(db, series, year, number) {
  db.run(
    `INSERT INTO document_counters(series, year, last_number)
          VALUES (:series, :year, :number)
     ON CONFLICT(series, year)
     DO UPDATE SET last_number = MAX(last_number, :number)`,
    { series, year, number },
  );
}

/** Seria właściwa dla typu operacji. */
export function seriesForType(type) {
  const series = SERIES_BY_TYPE[type];
  if (!series) throw new Error(`Nieznany typ operacji: ${type}`);
  return series;
}
