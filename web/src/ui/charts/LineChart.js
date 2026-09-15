/**
 * Wykres liniowy — przebieg wielkości w czasie.
 *
 * Forma wybrana zgodnie z zadaniem danych: „trend w czasie, serie trzeba od
 * siebie odróżnić” → linia + paleta kategorialna. Słupki grupowane odpadły:
 * dwanaście miesięcy razy trzy serie to trzydzieści sześć słupków, czyli
 * gęstwina, w której nie widać ani poziomu, ani kierunku.
 *
 * ZNACZNIKI (specyfikacja stała dla całego systemu)
 *  • linia 2 px, zaokrąglone złącza i końce,
 *  • znacznik końcowy o promieniu 4,5 px w obwódce 2 px w kolorze tła —
 *    dzięki niej punkt zostaje czytelny tam, gdzie linie się krzyżują,
 *  • przy jednej serii pod linią kładziemy mycie 10 % — przy kilku nie,
 *    bo nakładające się powierzchnie fałszują odczyt,
 *  • etykiety bezpośrednie tylko na końcach i tylko wtedy, gdy się nie zderzą.
 */
import { esc } from '../../core/dom.js';
import { createChart, compact, valueAxis, axisWidth, tickIndices } from './chart-core.js';
import { linear, band, ticks, linePath, areaPath } from './scale.js';

/** Minimalny prześwit między etykietami końcowymi (px). */
const LABEL_GAP = 15;

export function createLineChart(spec) {
  const {
    title, subtitle = '', caption = '', note = '',
    points = [], series = [], unit = '', height = 268,
    format = (v) => compact(v, unit), tipFormat = format,
    axisFormat = (v) => compact(v),
    headerActions = '',
  } = spec;

  const values = series.flatMap((s) => s.values);
  const axis = ticks(Math.min(0, ...values), Math.max(0, ...values), 4);

  // Prawy margines musi pomieścić najdłuższą etykietę końcową w całości.
  // Wartość liczona z danych, nie zgadywana: przy stałych 74 px podpis
  // „9,3 tys. MP” tracił ostatnią literę.
  const endLabelWidth = series.length
    ? Math.ceil(Math.max(...series.map((s) => String(format(s.values[s.values.length - 1])).length)) * 6.9) + 18
    : 18;

  const layout = (width) => ({
    height,
    // Prawy margines robi miejsce na etykiety końcowe; bez niego ostatnia
    // wartość albo wychodziłaby poza rysunek, albo byłaby przycięta.
    margin: {
      top: 14,
      right: width < 520 ? 18 : Math.max(48, endLabelWidth),
      bottom: 30,
      left: axisWidth(axis.ticks, axisFormat),
    },
  });

  const render = (box) => {
    const x = band(points.length, [box.x, box.x + box.w], 0);
    const y = linear([axis.min, axis.max], [box.y + box.h, box.y]);
    const single = series.length === 1;
    const compactMode = box.width < 520;

    const paths = series.map((s) => {
      const pts = s.values.map((v, i) => [x.center(i), y(v)]);
      const wash = single
        ? `<path class="viz-area" d="${areaPath(pts, y(Math.max(axis.min, 0)))}" style="fill:${esc(s.color)}"/>`
        : '';
      const last = pts[pts.length - 1];
      const dot = last
        ? `<circle class="viz-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4.5"
             style="fill:${esc(s.color)}"/>`
        : '';
      return wash
        + `<path class="viz-line" d="${linePath(pts)}" style="stroke:${esc(s.color)}"/>`
        + dot;
    }).join('');

    /* Etykiety końcowe. Kolidujące etykiety nie są rozsuwane — odrywają się
       wtedy od swoich linii i czyta się je jak szum. Zamiast tego znikają
       wszystkie, a rolę przejmuje legenda i podpowiedź. */
    let labels = '';
    if (!compactMode && series.length && points.length) {
      const ends = series
        .map((s) => ({ y: y(s.values[s.values.length - 1]), text: format(s.values[s.values.length - 1]) }))
        .sort((a, b) => a.y - b.y);
      const clash = ends.some((e, i) => i > 0 && e.y - ends[i - 1].y < LABEL_GAP);
      if (!clash) {
        labels = ends.map((e) => `<text class="viz-endlabel" x="${(box.x + box.w + 10).toFixed(1)}"
          y="${(e.y + 4).toFixed(1)}">${esc(e.text)}</text>`).join('');
      }
    }

    const every = Math.ceil(points.length / (compactMode ? 4 : 8));
    const xLabels = tickIndices(points.length, every).map((i) => `<text class="viz-tick"
        x="${x.center(i).toFixed(1)}" y="${(box.y + box.h + 20).toFixed(1)}"
        text-anchor="middle">${esc(points[i].short ?? points[i].label)}</text>`).join('');

    const hits = points.map((_, i) => ({
      x: x(i), w: x.step, y: box.y, h: box.h, tipY: box.y,
    }));

    return {
      svg: valueAxis(axis.ticks, y, box, axisFormat) + paths + labels + xLabels,
      hits,
    };
  };

  const tooltip = (i) => (points[i] ? {
    title: points[i].label,
    rows: series.map((s) => ({ label: s.label, value: tipFormat(s.values[i]), color: s.color, shape: 'line' })),
  } : null);

  const table = () => ({
    columns: [{ key: 'okres', label: 'Okres' },
      ...series.map((s) => ({ key: s.key, label: `${s.label}${unit ? ` [${unit}]` : ''}`, align: 'num' }))],
    rows: points.map((p, i) => Object.fromEntries([
      ['okres', p.label],
      ...series.map((s) => [s.key, tipFormat(s.values[i])]),
    ])),
  });

  return createChart({
    title, subtitle, caption: caption || title, note, headerActions,
    legend: series.length >= 2 ? series.map((s) => ({ label: s.label, color: s.color, shape: 'line' })) : [],
    layout, render, tooltip, table, hitMode: 'x',
    isEmpty: !points.length || !series.length,
  });
}
