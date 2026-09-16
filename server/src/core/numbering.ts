import type { Db } from '../db/index.js';
import type { DocType } from './permissions.js';

/**
 * Numeracja dokumentow w formacie:  TYP/ROK/KOD_MAGAZYNU/KOLEJNY
 * np. PZ/2026/ZAB/0001
 *
 * Sekwencja rezerwowana jest atomowo w ramach biezacej transakcji zapisu
 * (UPDATE ... RETURNING), co wyklucza przydzielenie tego samego numeru
 * dwom rownoczesnym uzytkownikom.
 */
export function nextDocumentNumber(
  db: Db,
  docType: DocType,
  year: number,
  warehouseId: number | null,
  warehouseCode: string | null,
): { number: string; seq: number } {
  const scope = warehouseId ?? 0;

  db.prepare(
    `INSERT INTO doc_sequences (doc_type, doc_year, warehouse_id, last_seq)
     VALUES (?, ?, ?, 0)
     ON CONFLICT (doc_type, doc_year, warehouse_id) DO NOTHING`,
  ).run(docType, year, scope);

  const row = db
    .prepare(
      `UPDATE doc_sequences SET last_seq = last_seq + 1
        WHERE doc_type = ? AND doc_year = ? AND warehouse_id = ?
        RETURNING last_seq`,
    )
    .get(docType, year, scope) as { last_seq: number } | undefined;

  if (!row) throw new Error('Nie udalo sie zarezerwowac numeru dokumentu.');

  const seq = row.last_seq;
  const parts = [docType, String(year)];
  if (warehouseCode) parts.push(sanitizeCode(warehouseCode));
  parts.push(String(seq).padStart(4, '0'));
  return { number: parts.join('/'), seq };
}

function sanitizeCode(code: string): string {
  return code
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8);
}
