/** Formatowanie liczb, kwot i dat w konwencji polskiej. */

const nf = (min, max) => new Intl.NumberFormat('pl-PL', {
  minimumFractionDigits: min, maximumFractionDigits: max,
});

const fmtQty = nf(0, 3);
const fmtQty2 = nf(0, 2);
const fmtMoney = nf(2, 2);
const fmtInt = nf(0, 0);

/** Ilość — do 3 miejsc po przecinku, bez zer końcowych. */
export const qty = (n) => fmtQty.format(Number.isFinite(+n) ? +n : 0);
/** Ilość — do 2 miejsc (tabele przeglądowe). */
export const qty2 = (n) => fmtQty2.format(Number.isFinite(+n) ? +n : 0);
/** Liczba całkowita. */
export const int = (n) => fmtInt.format(Number.isFinite(+n) ? +n : 0);
/** Kwota w złotych. */
export const money = (n) => `${fmtMoney.format(Number.isFinite(+n) ? +n : 0)} zł`;
/** Kwota bez groszy — do kafli i podsumowań. */
export const moneyShort = (n) => `${fmtInt.format(Math.round(Number.isFinite(+n) ? +n : 0))} zł`;

/** Data RRRR-MM-DD → DD.MM.RRRR. */
export const date = (value) => (value ? String(value).slice(0, 10).split('-').reverse().join('.') : '—');

/** Znacznik czasu → DD.MM.RRRR, GG:MM. */
export function dateTime(value) {
  if (!value) return '—';
  const iso = String(value).includes('T') ? value : String(value).replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const MONTHS = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
];

/** RRRR-MM → „Wrzesień 2026”. */
export function monthLabel(month) {
  if (!month) return '—';
  const [y, m] = String(month).split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

/** Dzisiejsza data w formacie RRRR-MM-DD (czas lokalny). */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const currentMonth = () => today().slice(0, 7);

/** Pierwszy dzień miesiąca. */
export const firstOfMonth = (month = currentMonth()) => `${month}-01`;

/** Ostatni dzień miesiąca. */
export function lastOfMonth(month = currentMonth()) {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

/** Rozmiar pliku w czytelnej postaci. */
export function fileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Inicjały użytkownika do awatara. */
export function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

/** Etykieta serii dokumentu na podstawie numeru (`PZ/2026/000001` → `PZ`). */
export const docSeries = (docNo) => String(docNo || '').split('/')[0] || '';
