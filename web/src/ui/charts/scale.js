/**
 * Skale i osie — matematyka wykresu odseparowana od rysowania.
 *
 * Wszystko tutaj jest czystą funkcją: te same argumenty dają ten sam wynik,
 * nic nie dotyka DOM. Dzięki temu geometrię wykresu da się sprawdzić bez
 * przeglądarki, a rysowanie sprowadza się do składania łańcuchów SVG.
 */

/** Skala liniowa: wartość dziedziny → współrzędna w pikselach. */
export function linear([d0, d1], [r0, r1]) {
  const span = d1 - d0 || 1;
  const scale = (v) => r0 + ((v - d0) / span) * (r1 - r0);
  scale.domain = [d0, d1];
  scale.range = [r0, r1];
  /** Odwrotność — potrzebna przy trafianiu kursorem w wartość. */
  scale.invert = (px) => d0 + ((px - r0) / (r1 - r0 || 1)) * span;
  return scale;
}

/**
 * Skala pasmowa dla kategorii (miesiące, produkty).
 * @param {number} count liczba kategorii
 * @param {[number,number]} range zakres w pikselach
 * @param {number} [padding] udział odstępu w szerokości pasma (0–0,9)
 */
export function band(count, [r0, r1], padding = 0.28) {
  const n = Math.max(1, count);
  const step = (r1 - r0) / n;
  const width = step * (1 - padding);
  const scale = (i) => r0 + i * step + (step - width) / 2;
  scale.step = step;
  scale.bandwidth = width;
  scale.center = (i) => scale(i) + width / 2;
  /** Indeks kategorii najbliższy podanej współrzędnej. */
  scale.nearest = (px) => Math.max(0, Math.min(n - 1, Math.floor((px - r0) / step)));
  return scale;
}

const STEPS = [1, 2, 2.5, 5, 10];

/** „Okrągły” krok osi nie mniejszy niż `raw`. */
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return (STEPS.find((s) => raw <= s * mag) ?? 10) * mag;
}

/**
 * Podziałka osi wartości: okrągłe liczby obejmujące cały zakres danych.
 * Zero zawsze trafia na podziałkę, jeśli mieści się w zakresie — bez tego
 * linia bazowa wykresu rozbieżnego nie pokrywałaby się z żadną kreską siatki.
 *
 * @returns {{ticks:number[], min:number, max:number}}
 */
export function ticks(min, max, count = 5) {
  let lo = Math.min(0, min);
  let hi = Math.max(0, max);
  if (lo === hi) hi = lo + 1;
  const step = niceStep((hi - lo) / Math.max(1, count));
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const out = [];
  // Mnożenie zamiast dodawania: sumowanie kroków zmiennoprzecinkowych
  // gubi zero (0,1 + 0,2 ≠ 0,3), a wtedy linia bazowa znika z siatki.
  const n = Math.round((hi - lo) / step);
  for (let i = 0; i <= n; i += 1) out.push(+(lo + i * step).toPrecision(12));
  return { ticks: out, min: lo, max: hi };
}

/**
 * Ścieżka słupka z zaokrąglonym końcem od strony danych.
 * Podstawa przy linii bazowej zostaje ostra — słupek ma wyrastać z osi,
 * a nie unosić się nad nią.
 *
 * @param {'up'|'down'|'right'|'left'} dir kierunek wzrostu
 */
export function barPath(x, y, w, h, r, dir) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  if (w <= 0 || h <= 0) return '';
  if (dir === 'up') {
    return `M${x} ${y + h} L${x} ${y + rr} Q${x} ${y} ${x + rr} ${y} `
      + `L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr} L${x + w} ${y + h} Z`;
  }
  if (dir === 'down') {
    return `M${x} ${y} L${x} ${y + h - rr} Q${x} ${y + h} ${x + rr} ${y + h} `
      + `L${x + w - rr} ${y + h} Q${x + w} ${y + h} ${x + w} ${y + h - rr} L${x + w} ${y} Z`;
  }
  if (dir === 'left') {
    const q = Math.max(0, Math.min(r, h / 2, w));
    return `M${x + w} ${y} L${x + q} ${y} Q${x} ${y} ${x} ${y + q} `
      + `L${x} ${y + h - q} Q${x} ${y + h} ${x + q} ${y + h} L${x + w} ${y + h} Z`;
  }
  const q = Math.max(0, Math.min(r, h / 2, w));
  return `M${x} ${y} L${x + w - q} ${y} Q${x + w} ${y} ${x + w} ${y + q} `
    + `L${x + w} ${y + h - q} Q${x + w} ${y + h} ${x + w - q} ${y + h} L${x} ${y + h} Z`;
}

/** Łamana przez punkty (bez wygładzania — wykres ma pokazywać dane, nie krzywe). */
export const linePath = (points) => points
  .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
  .join(' ');

/** Powierzchnia pod łamaną, domknięta do linii bazowej. */
export function areaPath(points, baseline) {
  if (!points.length) return '';
  const [x0] = points[0];
  const [xn] = points[points.length - 1];
  return `${linePath(points)} L${xn.toFixed(1)} ${baseline.toFixed(1)} L${x0.toFixed(1)} ${baseline.toFixed(1)} Z`;
}
