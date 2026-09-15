/**
 * Wykres kaskadowy — droga od bilansu otwarcia do bilansu zamknięcia.
 *
 * To jedyna forma, która pokazuje jednocześnie stan i jego przyczynę: widać
 * nie tylko ile zostało na placu, ale co ten stan zbudowało i co go zjadło.
 * Sumy skrajne (BO, BZ) stoją na linii zera i noszą kolor neutralny — nie są
 * przyrostem, więc nie mogą wyglądać jak przyrost.
 *
 * Ostatni krok „korekty i przesunięcia” to reszta domykająca równanie.
 * Wykres kaskadowy, którego suma nie schodzi się z sumą końcową, jest
 * gorszy niż brak wykresu — pokazuje liczbę, której nie da się wyprowadzić.
 */
import { esc } from '../../core/dom.js';
import { createChart, compact, valueAxis, axisWidth, fitLabel } from './chart-core.js';
import { linear, band, ticks, barPath } from './scale.js';

const MAX_BAR = 40;
const GAP = 2;

export function createWaterfallChart(spec) {
  const {
    title, subtitle = '', caption = '', note = '',
    opening = 0, closing = 0, steps = [], unit = '', height = 268,
    openingLabel = 'Stan otwarcia', closingLabel = 'Stan zamknięcia',
    format = (v) => compact(v, unit), tipFormat = format,
    axisFormat = (v) => compact(v),
    headerActions = '',
  } = spec;

  /* Kolumny: suma otwarcia, kolejne przyrosty, suma zamknięcia. */
  const bars = [];
  let running = opening;
  bars.push({ label: openingLabel, short: 'BO', kind: 'total', from: 0, to: opening, delta: opening });
  for (const s of steps) {
    const from = running;
    running += s.delta;
    bars.push({
      label: s.label,
      short: s.short ?? s.label,
      kind: s.delta >= 0 ? 'up' : 'down',
      from,
      to: running,
      delta: s.delta,
    });
  }
  bars.push({ label: closingLabel, short: 'BZ', kind: 'total', from: 0, to: closing, delta: closing });

  const bounds = bars.flatMap((b) => [b.from, b.to]);
  const axis = ticks(Math.min(0, ...bounds), Math.max(0, ...bounds), 4);

  const COLOR = {
    total: 'var(--viz-total)',
    up: 'var(--viz-pos)',
    down: 'var(--viz-neg)',
  };

  const layout = (width) => ({
    height,
    margin: { top: 22, right: 12, bottom: width < 640 ? 46 : 34, left: axisWidth(axis.ticks, axisFormat) },
  });

  const render = (box) => {
    const x = band(bars.length, [box.x, box.x + box.w], 0.34);
    const y = linear([axis.min, axis.max], [box.y + box.h, box.y]);
    const w = Math.min(MAX_BAR, Math.max(6, x.bandwidth - GAP));
    const stack = box.width < 640;
    // Na wąskim ekranie podpisy wartości zaczęłyby na siebie nachodzić.
    // Zamiast je rozsuwać (co odrywa liczbę od słupka) po prostu ich nie ma —
    // niosą je podpowiedź i widok tabelaryczny, więc żadna wartość nie ginie.
    const showValues = x.step >= 66;
    const tight = x.step < 78;

    const shapes = bars.map((b, i) => {
      const cx = x.center(i) - w / 2;
      const top = Math.min(y(b.from), y(b.to));
      const h = Math.max(2, Math.abs(y(b.to) - y(b.from)));
      const dir = b.to >= b.from ? 'up' : 'down';
      const body = `<path d="${barPath(cx, top, w, h, 4, b.kind === 'total' ? 'up' : dir)}"
        style="fill:${COLOR[b.kind]}"/>`;
      // Łącznik prowadzący wzrok od szczytu jednego kroku do podstawy następnego.
      const next = bars[i + 1];
      const link = next && b.kind !== 'total' && next.kind !== 'total'
        ? `<line class="viz-link" x1="${(cx + w).toFixed(1)}" y1="${y(b.to).toFixed(1)}"
             x2="${(x.center(i + 1) - w / 2).toFixed(1)}" y2="${y(b.to).toFixed(1)}"/>`
        : '';
      const label = showValues
        ? `<text class="viz-barlabel" x="${x.center(i).toFixed(1)}"
             y="${(top - 7).toFixed(1)}" text-anchor="middle">${esc(b.kind === 'total' ? format(b.to) : format(b.delta))}</text>`
        : '';
      return `<g data-viz-mark="${i}" class="viz-bar">${link}${body}${label}</g>`;
    }).join('');

    const xLabels = bars.map((b, i) => {
      const dy = stack && i % 2 === 1 ? 34 : 20;
      return `<text class="viz-tick" x="${x.center(i).toFixed(1)}" y="${(box.y + box.h + dy).toFixed(1)}"
        text-anchor="middle">${esc(fitLabel(tight ? b.short : b.label, stack ? x.step * 1.85 : x.step - 4))}</text>`;
    }).join('');

    const hits = bars.map((b, i) => ({
      x: x(i), w: x.step,
      y: Math.min(y(b.from), y(b.to)),
      h: Math.max(2, Math.abs(y(b.to) - y(b.from))),
      tipY: Math.min(y(b.from), y(b.to)),
    }));

    return { svg: valueAxis(axis.ticks, y, box, axisFormat) + shapes + xLabels, hits };
  };

  const tooltip = (i) => (bars[i] ? {
    title: bars[i].label,
    rows: bars[i].kind === 'total'
      ? [{ label: 'Stan', value: tipFormat(bars[i].to), color: COLOR.total, shape: 'rect' }]
      : [
        { label: 'Zmiana', value: tipFormat(bars[i].delta), color: COLOR[bars[i].kind], shape: 'rect' },
        { label: 'Stan po kroku', value: tipFormat(bars[i].to) },
      ],
  } : null);

  const table = () => ({
    columns: [
      { key: 'krok', label: 'Krok' },
      { key: 'zmiana', label: `Zmiana${unit ? ` [${unit}]` : ''}`, align: 'num' },
      { key: 'stan', label: `Stan${unit ? ` [${unit}]` : ''}`, align: 'num' },
    ],
    rows: bars.map((b) => ({
      krok: b.label,
      zmiana: b.kind === 'total' ? '—' : tipFormat(b.delta),
      stan: tipFormat(b.to),
    })),
  });

  return createChart({
    title, subtitle, caption: caption || title, note, headerActions,
    legend: [
      { label: 'Stan', color: COLOR.total, shape: 'rect' },
      { label: 'Przychód', color: COLOR.up, shape: 'rect' },
      { label: 'Rozchód', color: COLOR.down, shape: 'rect' },
    ],
    layout, render, tooltip, table, hitMode: 'mark',
    isEmpty: !bars.length,
  });
}
