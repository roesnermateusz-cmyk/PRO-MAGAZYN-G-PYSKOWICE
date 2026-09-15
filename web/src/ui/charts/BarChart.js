/**
 * Poziomy wykres słupkowy — porównanie wielkości między kategoriami.
 *
 * Kategorie są nominalne (nazwy produktów nie mają porządku), więc wszystkie
 * słupki noszą TEN SAM kolor. Malowanie ich rampą „im większy, tym ciemniejszy”
 * wygląda efektownie i jest błędem: zużywa kanał tożsamości na powtórzenie
 * tego, co już mówi długość słupka.
 *
 * UKŁAD WIERSZA
 * Nazwa stoi NAD słupkiem, nie obok niego. Nazwy produktów w obrocie biomasą
 * bywają długie („Zrębka Produkcyjna Inwestycyjna”), a kolumna etykiet o stałej
 * szerokości przycinała je do nierozróżnialnych ogonków — dwa różne produkty
 * wyglądały wtedy identycznie. Nad słupkiem nazwa ma całą szerokość karty.
 */
import { esc } from '../../core/dom.js';
import { createChart, compact, fitLabel } from './chart-core.js';
import { linear, barPath } from './scale.js';

const ROW = 46;
const BAR = 14;

export function createBarChart(spec) {
  const {
    title, subtitle = '', caption = '', note = '',
    rows = [], unit = '', color = 'var(--viz-s1)', alertColor = 'var(--viz-critical)',
    format = (v) => compact(v, unit), tipFormat = format,
    valueLabel = 'Ilość', headerActions = '',
  } = spec;

  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));

  const layout = () => ({
    height: Math.max(96, rows.length * ROW + 10),
    margin: { top: 6, right: 2, bottom: 6, left: 2 },
  });

  const render = (box) => {
    const x = linear([0, max], [box.x, box.x + box.w]);

    const shapes = rows.map((r, i) => {
      const top = box.y + i * ROW;
      const value = format(r.value);
      // Nazwa dostaje wszystko, czego nie zajmuje wartość po prawej.
      const nameWidth = box.w - value.length * 6.9 - 14;
      const barTop = top + 20;
      const w = Math.max(2, x(Math.abs(r.value)) - box.x);
      const fill = r.alert ? alertColor : color;
      return `<g data-viz-mark="${i}" class="viz-bar">
        <text class="viz-rowlabel" x="${box.x}" y="${(top + 13).toFixed(1)}">${esc(fitLabel(r.label, nameWidth, 6.9))}</text>
        <text class="viz-barlabel" x="${(box.x + box.w).toFixed(1)}" y="${(top + 13).toFixed(1)}"
              text-anchor="end">${esc(value)}</text>
        <rect class="viz-track" x="${box.x}" y="${barTop}" width="${box.w}" height="${BAR}" rx="4"/>
        <path d="${barPath(box.x, barTop, w, BAR, 4, 'right')}" style="fill:${esc(fill)}"/>
      </g>`;
    }).join('');

    const hits = rows.map((_, i) => ({
      x: box.x, w: box.w, y: box.y + i * ROW, h: ROW - 6, tipY: box.y + i * ROW,
    }));

    return { svg: shapes, hits };
  };

  const tooltip = (i) => (rows[i] ? {
    title: rows[i].label,
    rows: [
      { label: valueLabel, value: tipFormat(rows[i].value), color: rows[i].alert ? alertColor : color, shape: 'rect' },
      ...(rows[i].detail ? [{ label: rows[i].detailLabel ?? 'Szczegóły', value: rows[i].detail }] : []),
    ],
  } : null);

  const table = () => ({
    columns: [
      { key: 'nazwa', label: 'Pozycja' },
      { key: 'wartosc', label: `${valueLabel}${unit ? ` [${unit}]` : ''}`, align: 'num' },
      { key: 'detal', label: 'Szczegóły' },
    ],
    rows: rows.map((r) => ({ nazwa: r.label, wartosc: tipFormat(r.value), detal: r.detail ?? '—' })),
  });

  return createChart({
    title, subtitle, caption: caption || title, note, headerActions,
    legend: [], layout, render, tooltip, table, hitMode: 'mark',
    isEmpty: !rows.length,
    empty: { title: 'Magazyn jest pusty', hint: 'Zaksięguj pierwszy dokument przyjęcia.' },
  });
}
