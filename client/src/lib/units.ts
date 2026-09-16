import type { BaseUnit } from '../api/types';

export interface ConversionRates {
  m3PerMp: number;
  tPerMp: number;
}

export const DEFAULT_RATES: ConversionRates = { m3PerMp: 0.25, tPerMp: 0.33 };

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

/**
 * Podgląd przeliczen w formularzu. Logika jest lustrzanym odbiciem serwera
 * (server/src/core/units.ts) i służy wyłącznie do natychmiastowej informacji
 * zwrotnej - wartości zapisywane wylicza ponownie serwer.
 */
export function deriveQuantities(
  qtyBase: number,
  baseUnit: BaseUnit,
  rates: ConversionRates = DEFAULT_RATES,
): { m3: number; mp: number; t: number } {
  const m3PerMp = rates.m3PerMp > 0 ? rates.m3PerMp : DEFAULT_RATES.m3PerMp;
  const tPerMp = rates.tPerMp > 0 ? rates.tPerMp : DEFAULT_RATES.tPerMp;
  const qty = round(qtyBase);

  switch (baseUnit) {
    case 'M3': {
      const mp = qty / m3PerMp;
      return { m3: round(qty), mp: round(mp), t: round(mp * tPerMp) };
    }
    case 'MP':
      return { m3: round(qty * m3PerMp), mp: round(qty), t: round(qty * tPerMp) };
    case 'T': {
      const mp = qty / tPerMp;
      return { m3: round(mp * m3PerMp), mp: round(mp), t: round(qty) };
    }
    default:
      return { m3: 0, mp: 0, t: 0 };
  }
}

/** Przeliczniki obowiazujace dla produktu: indywidualne maja pierwszenstwo. */
export function ratesForProduct(
  product: { m3PerMp: number | null; tPerMp: number | null } | undefined,
  global: ConversionRates,
): ConversionRates {
  return {
    m3PerMp: product?.m3PerMp ?? global.m3PerMp,
    tPerMp: product?.tPerMp ?? global.tPerMp,
  };
}
