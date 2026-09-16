/**
 * Kwoty przechowywane sa w bazie jako liczby calkowite groszy, co eliminuje
 * bledy zaokraglen typowe dla arytmetyki zmiennoprzecinkowej.
 * Na granicy API konwertujemy je na zlote (liczba dziesietna z 2 miejscami).
 */

export const GROSZ_PER_PLN = 100;

export function toGrosze(pln: number): number {
  if (!Number.isFinite(pln)) throw new Error('Kwota musi byc liczba skonczona.');
  return Math.round(pln * GROSZ_PER_PLN);
}

export function toPln(grosze: number): number {
  return Math.round(grosze) / GROSZ_PER_PLN;
}

/**
 * Wartosc pozycji = cena jednostkowa (grosze) * ilosc.
 * Zaokraglenie polowkowe w gore na poziomie grosza, jak w systemach ksiegowych.
 */
export function lineValueGr(unitPriceGr: number, qty: number): number {
  return Math.round(unitPriceGr * qty);
}
