/**
 * Generowanie CSV zgodnego z polskim Excelem.
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

