/**
 * Wyprowadzanie ruchów magazynowych z dokumentu.
 *
 * Model księgi: dokument (`operations`) opisuje zdarzenie gospodarcze,
 * a ruchy (`stock_moves`) opisują jego wpływ na stan. Stan magazynu jest
 * zawsze sumą ruchów — nigdy nie jest przechowywany jako pole aktualizowane
 * w miejscu. Dzięki temu:
 *   • storno dokumentu = usunięcie jego ruchów (spójność automatyczna),
 *   • stan na dowolny dzień = suma ruchów do tej daty,
 *   • rozjazd stanu jest niemożliwy z definicji.
 *
 * Uwaga do pola `is_stored` („magazynowane TAK/NIE”): jest to informacja
 * fizyczna (czy towar leżał na placu), a nie księgowa. Surowiec kupiony
 * i od razu przerobiony wchodzi na magazyn dokumentem PZ i schodzi z niego
 * dokumentem RW — bilans wychodzi na zero, ale oba zdarzenia są udokumentowane.
 */
import { TYPE_DIRECTION } from './documents.js';
import { roundQty } from './units.js';

/**
 * @typedef {object} StockMove
 * @property {string} warehouseId
 * @property {string} productId
 * @property {-1|1} direction
 * @property {number} qtyMp ilość ze znakiem kierunku
 * @property {number} qtyM3
 * @property {number} qtyTonne
 * @property {number} energyGj
 * @property {number} value
 */

/**
 * Zwraca listę ruchów magazynowych wynikających z dokumentu.
 *
 * @param {object} op dokument po normalizacji (pola w konwencji bazy)
 * @returns {StockMove[]}
 */
export function deriveMoves(op) {
  if (op.status === 'CANCELLED') return [];

  const direction = TYPE_DIRECTION[op.type];
  if (!direction) throw new Error(`Nieznany typ operacji: ${op.type}`);

  const base = {
    productId: op.product_id,
    qtyMp: roundQty(op.qty_mp),
    qtyM3: roundQty(op.qty_m3),
    qtyTonne: roundQty(op.qty_tonne),
    energyGj: roundQty(op.energy_gj),
  };

  const inMove = (warehouseId, value) => ({
    ...base, warehouseId, direction: 1, value: value || 0,
  });
  const outMove = (warehouseId, value) => ({
    ...base,
    warehouseId,
    direction: -1,
    qtyMp: -base.qtyMp,
    qtyM3: -base.qtyM3,
    qtyTonne: -base.qtyTonne,
    energyGj: -base.energyGj,
    value: -(value || 0),
  });

  switch (direction) {
    case 'IN':
      return [inMove(op.warehouse_to_id, op.value_purchase)];
    case 'OUT':
      return [outMove(op.warehouse_from_id, op.value_sale)];
    case 'TRANSFER':
      return [outMove(op.warehouse_from_id, 0), inMove(op.warehouse_to_id, 0)];
    default:
      return [];
  }
}

/**
 * Sprawdza, czy dokument ma wypełnione magazyny wymagane dla swojego typu.
 * @returns {string[]} lista komunikatów o brakach (pusta = poprawnie)
 */
export function validateWarehouses(op) {
  const problems = [];
  const direction = TYPE_DIRECTION[op.type];
  if (direction === 'IN' && !op.warehouse_to_id) {
    problems.push('Dokument przyjęcia wymaga wskazania magazynu docelowego.');
  }
  if (direction === 'OUT' && !op.warehouse_from_id) {
    problems.push('Dokument wydania wymaga wskazania magazynu źródłowego.');
  }
  if (direction === 'TRANSFER') {
    if (!op.warehouse_from_id || !op.warehouse_to_id) {
      problems.push('Przesunięcie MM wymaga magazynu źródłowego i docelowego.');
    } else if (op.warehouse_from_id === op.warehouse_to_id) {
      problems.push('Przesunięcie MM musi wskazywać dwa różne magazyny.');
    }
  }
  return problems;
}

