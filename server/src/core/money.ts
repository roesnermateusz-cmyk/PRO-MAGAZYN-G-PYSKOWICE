/**
 * Kwoty przechowywane są w bazie jako liczby całkowite groszy, co eliminuje
 * błędy zaokraglen typowe dla arytmetyki zmiennoprzecinkowej.
 * Na granicy API konwertujemy je na zlote (liczba dziesietna z 2 miejscami).
 */

export const GROSZ_PER_PLN = 100;

export function toGrosze(pln: number): number {
  if (!Number.isFinite(pln)) throw new Error('Kwota musi być liczba skończona.');
  return Math.round(pln * GROSZ_PER_PLN);
}

export function toPln(grosze: number): number {
  return Math.round(grosze) / GROSZ_PER_PLN;
}

/**
 * Wartość pozycji = cena jednostkowa (grosze) * ilość.
 * Zaokraglenie polowkowe w gore na poziomie grosza, jak w systemach księgowych.
 */
export function lineValueGr(unitPriceGr: number, qty: number): number {
  return Math.round(unitPriceGr * qty);
}
