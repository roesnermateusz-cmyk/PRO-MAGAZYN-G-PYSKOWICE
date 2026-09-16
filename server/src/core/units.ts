/**
 * Przeliczniki jednostek biomasy.
 *
 * Relacje bazowe (konfigurowalne w ustawieniach):
 *   1 m3 drewna = 4 MP zrębki      -> m3PerMp = 0.25
 *   1 MP zrębki = 0.33 t           -> tPerMp  = 0.33
 *
 * Ilość stanu magazynowego zawsze prowadzona jest w jednostce bazowej produktu.
 * Wartości m3/MP/t służą do prezentacji i mogą zostac nadpisane ręcznie
 * (wartość rzeczywista) bez wpływu na stan magazynowy.
 */

export type BaseUnit = 'M3' | 'MP' | 'T' | 'SZT';

export const BASE_UNITS: readonly BaseUnit[] = ['M3', 'MP', 'T', 'SZT'] as const;

export interface ConversionRates {
  /** Ile metrow sześciennych (m3) przypada na 1 MP. Domyślnie 0.25. */
  m3PerMp: number;
  /** Ile ton (t) przypada na 1 MP. Domyślnie 0.33. */
  tPerMp: number;
}

export const DEFAULT_RATES: ConversionRates = { m3PerMp: 0.25, tPerMp: 0.33 };

/** Zaokraglenie ilości do 4 miejsc po przecinku - wspolne dla calego systemu. */
export function roundQty(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export function assertPositiveQty(value: number, label = 'Ilość'): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} musi być liczba dodatnia.`);
  }
  return roundQty(value);
}

export interface QuantitySet {
  m3: number;
  mp: number;
  t: number;
}

/**
 * Wylicza komplet ilości (m3 / MP / t) na podstawie ilości w jednostce bazowej.
 * Dla jednostki SZT przeliczniki objętościowe nie maja sensu i zwracane są zera.
 */
export function deriveQuantities(
  qtyBase: number,
  baseUnit: BaseUnit,
  rates: ConversionRates = DEFAULT_RATES,
): QuantitySet {
  const { m3PerMp, tPerMp } = normalizeRates(rates);
  const qty = roundQty(qtyBase);

  switch (baseUnit) {
    case 'M3': {
      const mp = qty / m3PerMp;
      return { m3: roundQty(qty), mp: roundQty(mp), t: roundQty(mp * tPerMp) };
    }
    case 'MP': {
      return { m3: roundQty(qty * m3PerMp), mp: roundQty(qty), t: roundQty(qty * tPerMp) };
    }
    case 'T': {
      const mp = qty / tPerMp;
      return { m3: roundQty(mp * m3PerMp), mp: roundQty(mp), t: roundQty(qty) };
    }
    case 'SZT':
    default:
      return { m3: 0, mp: 0, t: 0 };
  }
}

/** Konwersja ilości pomiedzy dowolnymi jednostkami objetosciowymi/masowymi. */
export function convert(
  qty: number,
  from: BaseUnit,
  to: BaseUnit,
  rates: ConversionRates = DEFAULT_RATES,
): number {
  if (from === to) return roundQty(qty);
  if (from === 'SZT' || to === 'SZT') {
    throw new Error('Jednostka SZT nie podlega przeliczeniom objętościowym.');
  }
  const derived = deriveQuantities(qty, from, rates);
  switch (to) {
    case 'M3':
      return derived.m3;
    case 'MP':
      return derived.mp;
    case 'T':
      return derived.t;
    default:
      throw new Error(`Nieobslugiwana jednostka docelowa: ${to}`);
  }
}

export function normalizeRates(rates: Partial<ConversionRates> | null | undefined): ConversionRates {
  const m3PerMp = Number(rates?.m3PerMp);
  const tPerMp = Number(rates?.tPerMp);
  return {
    m3PerMp: Number.isFinite(m3PerMp) && m3PerMp > 0 ? m3PerMp : DEFAULT_RATES.m3PerMp,
    tPerMp: Number.isFinite(tPerMp) && tPerMp > 0 ? tPerMp : DEFAULT_RATES.tPerMp,
  };
}
