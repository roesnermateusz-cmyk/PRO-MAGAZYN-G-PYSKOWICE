/**
 * Wykres kolumnowy rozbieżny — wartość powyżej i poniżej linii bazowej.
 *
 * Zadanie danych to biegunowość („czy miesiąc wyszedł na plus”), więc kolor
 * niesie znak: chłodny biegun dla dodatnich, ciepły dla ujemnych, a między
 * nimi neutralna linia zera. Zieleń i czerwień — mimo że w księgowości
 * najbardziej oczywiste — zostały odrzucone po pomiarze: przy deuteranopii
 * dzieli je ΔE 2,3 w OKLab, czyli dla części odbiorców to jeden kolor.
 * Znak niosą więc trzy niezależne kanały: kierunek słupka, barwa oraz
 * podpisana wartość.
 */
import { esc } from '../../core/dom.js';
import { createChart, compact, valueAxis, axisWidth, tickIndices } from './chart-core.js';
import { linear, band, ticks, barPath } from './scale.js';

/** Górna granica grubości słupka — reszta pasma zostaje powietrzem. */
const MAX_BAR = 24;
/** Prześwit w kolorze tła między sąsiednimi słupkami. */
const GAP = 2;

export function createColumnChart(spec) {
  const {
    title, subtitle = '', caption = '', note = '',
    points = [], values = [], unit = '', height = 240,
    positiveColor = 'var(--viz-pos)', negativeColor = 'var(--viz-neg)',
    positiveLabel = 'Wynik dodatni', negativeLabel = 'Wynik ujemny',
    format = (v) => compact(v, unit), tipFormat = format,
    axisFormat = (v) => compact(v),
    valueLabel = 'Wartość', headerActions = '',
  } = spec;

  const axis = ticks(Math.min(0, ...values), Math.max(0, ...values), 4);

  const layout = (width) => ({
    height,
    margin: { top: 20, right: 12, bottom: 34, left: axisWidth(axis.ticks, axisFormat) },
  });

  const render = (box) => {
    const x = band(points.length, [box.x, box.x + box.w], 0.34);
    const y = linear([axis.min, axis.max], [box.y + box.h, box.y]);
    const zero = y(0);
    const w = Math.min(MAX_BAR, Math.max(4, x.bandwidth - GAP));

    // Etykieta tylko przy skrajnej wartości i przy ostatnim okresie —
    // liczba nad każdym słupkiem to szum, którego nikt nie czyta.
    const extreme = values.reduce((best, v, i) => (Math.abs(v) > Math.abs(values[best]) ? i : best), 0);
    // Poniżej ~46 px na pozycję dwie sąsiednie etykiety zachodzą na siebie;
    // wtedy wartości niesie wyłącznie podpowiedź i widok tabelaryczny.
    const marked = new Set(x.step >= 46 ? [extreme, values.length - 1] : []);

    const bars = values.map((v, i) => {
      const cx = x.center(i) - w / 2;
      const up = v >= 0;
      const top = up ? y(v) : zero;
      const h = Math.abs(y(v) - zero);
      const color = up ? positiveColor : negativeColor;
      const body = h < 0.5
        ? `<rect x="${cx.toFixed(1)}" y="${(zero - 1).toFixed(1)}" width="${w.toFixed(1)}" height="2" style="fill:${esc(color)}"/>`
        : `<path d="${barPath(cx, top, w, h, 4, up ? 'up' : 'down')}" style="fill:${esc(color)}"/>`;
      const label = marked.has(i)
        ? `<text class="viz-barlabel" x="${x.center(i).toFixed(1)}"
             y="${(up ? top - 7 : top + h + 15).toFixed(1)}" text-anchor="middle">${esc(format(v))}</text>`
        : '';
      return `<g data-viz-mark="${i}" class="viz-bar">${body}${label}</g>`;
    }).join('');

    const every = Math.ceil(points.length / (box.width < 520 ? 4 : 8));
    const xLabels = tickIndices(points.length, every).map((i) => `<text class="viz-tick"
        x="${x.center(i).toFixed(1)}" y="${(box.y + box.h + 20).toFixed(1)}"
        text-anchor="middle">${esc(points[i].short ?? points[i].label)}</text>`).join('');

    const hits = values.map((v, i) => {
      const up = v >= 0;
      const top = up ? y(v) : zero;
      const h = Math.max(2, Math.abs(y(v) - zero));
      return { x: x(i), w: x.step, y: top, h, tipY: up ? top : zero };
    });

    return { svg: valueAxis(axis.ticks, y, box, axisFormat) + bars + xLabels, hits };
  };

  const tooltip = (i) => (points[i] ? {
    title: points[i].label,
    rows: [{
      label: valueLabel,
      value: tipFormat(values[i]),
      color: values[i] >= 0 ? positiveColor : negativeColor,
      shape: 'rect',
    }],
  } : null);

  const table = () => ({
    columns: [{ key: 'okres', label: 'Okres' }, { key: 'wartosc', label: `${valueLabel}${unit ? ` [${unit}]` : ''}`, align: 'num' }],
    rows: points.map((p, i) => ({ okres: p.label, wartosc: tipFormat(values[i]) })),
  });

  return createChart({
    title, subtitle, caption: caption || title, note, headerActions,
    legend: [
      { label: positiveLabel, color: positiveColor, shape: 'rect' },
      { label: negativeLabel, color: negativeColor, shape: 'rect' },
    ],
    layout, render, tooltip, table, hitMode: 'mark',
    isEmpty: !points.length,
  });
}
