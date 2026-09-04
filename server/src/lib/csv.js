/**
 * Generowanie i parsowanie CSV zgodnego z polskim Excelem.
 *
 * Konwencje: separator średnik, przecinek dziesiętny, BOM UTF-8 (bez BOM Excel
 * traktuje plik jako Windows-1250 i psuje polskie znaki).
 */

const SEP = ';';
const BOM = '﻿';

/** Ucieczka pojedynczej komórki. Chroni też przed wstrzyknięciem formuły. */
function cell(value) {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'number'
    ? String(value).replace('.', ',')
    : String(value);
  // Komórka zaczynająca się od =,+,-,@ byłaby w Excelu wykonana jako formuła.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (s.includes(SEP) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Buduje dokument CSV.
 * @param {Array<{key:string,label:string,format?:(v:any,row:object)=>any}>} columns
 * @param {object[]} rows
 */
export function toCsv(columns, rows) {
  const head = columns.map((c) => cell(c.label)).join(SEP);
  const body = rows.map((row) => columns
    .map((c) => cell(c.format ? c.format(row[c.key], row) : row[c.key]))
    .join(SEP));
  return BOM + [head, ...body].join('\r\n') + '\r\n';
}

/**
 * Parsuje CSV (średnik lub przecinek jako separator, cudzysłowy zgodnie z RFC 4180).
 * @returns {{headers:string[], rows:object[]}}
 */
export function parseCsv(text) {
  const input = text.replace(/^﻿/, '');
  const firstLine = input.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === sep) { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return { headers: [], rows: [] };

  const headers = rows[0].map((h) => h.trim());
  const data = rows.slice(1)
    .filter((r) => r.some((v) => String(v).trim() !== ''))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { headers, rows: data };
}

/** Liczba z formatu polskiego („1 234,56” → 1234.56). */
export function parseNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(String(value).replace(/\s/g, '').replace(/ /g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
