/**
 * Figury liczbowe — kiedy formą jest liczba, a nie wykres.
 *
 * Pojedyncza bieżąca wartość to kafel, nie wykres słupkowy o jednym słupku.
 * Jedna liczba, którą pulpit prowadzi, to liczba wiodąca — dokładnie jedna
 * na ekran. Reszta wskaźników stoi w rzędzie kafli pod nią.
 *
 * TYPOGRAFIA LICZB
 * Duże liczby stojące samotnie (liczba wiodąca, wartość kafla) używają cyfr
 * proporcjonalnych. `tabular-nums` daje każdej cyfrze szerokość zera, przez co
 * „121” w rozmiarze nagłówka wygląda na rozstrzelone; równa szerokość jest
 * potrzebna wyłącznie tam, gdzie liczby stoją jedna pod drugą — w tabelach
 * i na podziałce osi.
 */
import { esc } from '../../core/dom.js';
import { iconRef } from '../../components/icons.js';
import { linear, band, linePath, areaPath } from './scale.js';

/**
 * Iskierka — dwunastopunktowy przebieg w tle kafla.
 * Ostatni punkt dostaje znacznik w kolorze akcentu; reszta linii jest wyciszona,
 * bo kafel opowiada o wartości bieżącej, a przebieg jest tylko kontekstem.
 */
export function sparkline(values, { width = 132, height = 34, accent = 'var(--viz-s1)' } = {}) {
  const data = (values ?? []).map((v) => (Number.isFinite(+v) ? +v : 0));
  if (data.length < 2) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const pad = 4;
  const y = linear([min === max ? min - 1 : min, max], [height - pad, pad]);
  const x = band(data.length, [1, width - 1], 0);
  const pts = data.map((v, i) => [x.center(i), y(v)]);
  const last = pts[pts.length - 1];
  return `<svg class="viz-spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
      aria-hidden="true" focusable="false">
    <path class="viz-spark-area" d="${areaPath(pts, height)}" style="fill:${esc(accent)}"/>
    <path class="viz-spark-line" d="${linePath(pts)}"/>
    <circle class="viz-spark-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5"
            style="fill:${esc(accent)}"/>
  </svg>`;
}

/**
 * Znacznik zmiany. Kolor mówi, czy zmiana jest dobra, a nie w którą stronę
 * poszła strzałka — spadek kosztu transportu jest dobrą wiadomością.
 * Kolor statusu nigdy nie występuje sam: towarzyszy mu strzałka i podpis okresu.
 */
export function delta({ value, text, upIsGood = true, since = '' }) {
  if (value === null || value === undefined || !Number.isFinite(+value)) return '';
  const n = +value;
  const flat = Math.abs(n) < 0.0005;
  const good = flat ? null : (n > 0) === upIsGood;
  const tone = flat ? 'flat' : (good ? 'good' : 'bad');
  const arrow = flat ? '→' : (n > 0 ? '↑' : '↓');
  return `<span class="viz-delta ${tone}">
    <span aria-hidden="true">${arrow}</span>${esc(text)}${since ? `<i>${esc(since)}</i>` : ''}</span>`;
}

/**
 * Kafel wskaźnika: etykieta · wartość · zmiana · przebieg.
 * @param {{label:string,value:string,unit?:string,delta?:string,spark?:string,icon?:string,tone?:string,href?:string}} spec
 */
export function statTile({ label, value, unit = '', delta: deltaHtml = '', spark = '', icon = '', tone = '', href = '' }) {
  const inner = `
    <span class="st-top">
      <span class="st-label">${esc(label)}</span>
      ${icon ? `<span class="st-icon">${iconRef(icon)}</span>` : ''}
    </span>
    <span class="st-value">${esc(value)}${unit ? `<small>${esc(unit)}</small>` : ''}</span>
    <span class="st-foot">${deltaHtml}${spark}</span>`;
  return href
    ? `<a class="stat-tile ${esc(tone)}" href="${esc(href)}">${inner}</a>`
    : `<div class="stat-tile ${esc(tone)}">${inner}</div>`;
}

/**
 * Liczba wiodąca — dokładnie jedna na widok.
 * @param {{eyebrow:string,value:string,unit?:string,delta?:string,spark?:string,foot?:string}} spec
 */
export function heroFigure({ eyebrow, value, unit = '', delta: deltaHtml = '', spark = '', foot = '' }) {
  return `<div class="viz-hero">
    <p class="hero-eyebrow">${esc(eyebrow)}</p>
    <p class="hero-value">${esc(value)}${unit ? `<small>${esc(unit)}</small>` : ''}</p>
    <p class="hero-delta">${deltaHtml}</p>
    ${spark ? `<div class="hero-spark">${spark}</div>` : ''}
    ${foot ? `<p class="hero-foot">${foot}</p>` : ''}
  </div>`;
}
