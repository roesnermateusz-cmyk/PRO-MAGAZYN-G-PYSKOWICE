/**
 * Silnik przeliczeń jednostek biomasy.
 *
 * Łańcuch przeliczeń jest jednokierunkowy i spójny:
 *
 *      m³ (drewno lite)  --×m3_to_mp-->  MP (metry przestrzenne)
 *      MP                --×mp_to_tonne--> tony
 *      tony              --×tonne_to_gj--> GJ (energia)
 *
 * Każdy krok można nadpisać wartością rzeczywistą z dokumentu (waga z wagi
 * samochodowej, obmiar pryzmy). Nadpisanie dotyczy wyłącznie tej operacji.
 *
 * WAŻNE: przeliczniki użyte przy księgowaniu są zapisywane w dokumencie
 * (`factor_*`). Zmiana przeliczników w ustawieniach nigdy nie zmienia historii.
 *
 * Moduł jest czysty — bez dostępu do bazy i bez efektów ubocznych.
 */

export const UNITS = Object.freeze(['M3', 'MP', 'TONA']);
export const MODES = Object.freeze(['AUTO', 'RECZNIE']);

export const DEFAULT_FACTORS = Object.freeze({
  m3ToMp: 4,
  mpToTonne: 0.33,
  tonneToGj: 8.5,
});

/** Zaokrąglenie ilości — 3 miejsca po przecinku (litry / kilogramy). */
export const roundQty = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
/** Zaokrąglenie kwot — 2 miejsca po przecinku (grosze). */
export const roundMoney = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Wyznacza przeliczniki dla operacji: wartości produktu mają pierwszeństwo
 * przed globalnymi z tabeli `settings`.
 *
 * @param {{m3_to_mp?:number|null, mp_to_tonne?:number|null, tonne_to_gj?:number|null}} product
 * @param {{m3ToMp:number, mpToTonne:number, tonneToGj:number}} globals
 */
export function resolveFactors(product, globals = DEFAULT_FACTORS) {
  const pick = (own, fallback, dflt) => {
    const v = Number(own);
    if (Number.isFinite(v) && v > 0) return v;
    const g = Number(fallback);
    return Number.isFinite(g) && g > 0 ? g : dflt;
  };
  return {
    m3ToMp: pick(product?.m3_to_mp, globals.m3ToMp, DEFAULT_FACTORS.m3ToMp),
    mpToTonne: pick(product?.mp_to_tonne, globals.mpToTonne, DEFAULT_FACTORS.mpToTonne),
    tonneToGj: pick(product?.tonne_to_gj, globals.tonneToGj, DEFAULT_FACTORS.tonneToGj),
  };
}

/**
 * Przelicza ilość dokumentu na wszystkie jednostki.
 *
 * @param {object} input
 * @param {number} input.quantity ilość wprowadzona przez użytkownika
 * @param {'M3'|'MP'|'TONA'} input.unit jednostka wprowadzenia
 * @param {object} input.factors przeliczniki z `resolveFactors`
 * @param {'AUTO'|'RECZNIE'} [input.m3Mode] tryb dla m³
 * @param {number} [input.m3Manual] rzeczywiste m³
 * @param {'AUTO'|'RECZNIE'} [input.mpMode] tryb dla MP
 * @param {number} [input.mpManual] rzeczywiste MP
 * @param {'AUTO'|'RECZNIE'} [input.tonneMode] tryb dla ton
 * @param {number} [input.tonneManual] rzeczywista masa
 * @returns {{qtyM3:number, qtyMp:number, qtyTonne:number, energyGj:number,
 *            m3Manual:boolean, mpManual:boolean, tonneManual:boolean}}
 */
export function computeQuantities(input) {
  const { quantity, unit, factors } = input;
  const { m3ToMp, mpToTonne, tonneToGj } = factors;
  const qty = Number(quantity) || 0;

  let qtyM3;
  let qtyMp;
  let qtyTonne;

  // Krok 1 — rozwinięcie wprowadzonej jednostki na cały łańcuch.
  switch (unit) {
    case 'M3':
      qtyM3 = qty;
      qtyMp = qty * m3ToMp;
      qtyTonne = qtyMp * mpToTonne;
      break;
    case 'MP':
      qtyMp = qty;
      qtyM3 = m3ToMp ? qty / m3ToMp : 0;
      qtyTonne = qty * mpToTonne;
      break;
    case 'TONA':
      qtyTonne = qty;
      qtyMp = mpToTonne ? qty / mpToTonne : 0;
      qtyM3 = m3ToMp ? qtyMp / m3ToMp : 0;
      break;
    default:
      throw new Error(`Nieznana jednostka: ${unit}`);
  }

  // Krok 2 — nadpisania wartościami rzeczywistymi.
  // Nadpisanie MP przelicza w dół łańcucha (tony), o ile tony nie są też ręczne.
  const usedMp = input.mpMode === 'RECZNIE' && Number(input.mpManual) > 0 && unit !== 'MP';
  if (usedMp) {
    qtyMp = Number(input.mpManual);
    qtyTonne = qtyMp * mpToTonne;
    if (unit !== 'M3') qtyM3 = m3ToMp ? qtyMp / m3ToMp : 0;
  }

  const usedM3 = input.m3Mode === 'RECZNIE' && Number(input.m3Manual) > 0 && unit !== 'M3';
  if (usedM3) qtyM3 = Number(input.m3Manual);

  // Waga rzeczywista jest nadrzędna wobec każdego przeliczenia masy.
  const usedTonne = input.tonneMode === 'RECZNIE' && Number(input.tonneManual) > 0 && unit !== 'TONA';
  if (usedTonne) qtyTonne = Number(input.tonneManual);

  return {
    qtyM3: roundQty(qtyM3),
    qtyMp: roundQty(qtyMp),
    qtyTonne: roundQty(qtyTonne),
    energyGj: roundQty(qtyTonne * tonneToGj),
    m3Manual: usedM3,
    mpManual: usedMp,
    tonneManual: usedTonne,
  };
}

/**
 * Wylicza wartości pieniężne dokumentu.
 * Ceny są zawsze podawane za jednostkę wprowadzenia (`unit`) — tak jak w umowach.
 */
export function computeValues({ quantity, pricePurchase = 0, priceSale = 0, chippingPrice = 0 }) {
  const qty = Number(quantity) || 0;
  return {
    valuePurchase: roundMoney(qty * (Number(pricePurchase) || 0)),
    valueSale: roundMoney(qty * (Number(priceSale) || 0)),
    chippingCost: roundMoney(qty * (Number(chippingPrice) || 0)),
  };
}

