/**
 * Wspólny szkielet wykresu.
 *
 * DLACZEGO JEDEN SZKIELET
 * Każdy wykres w systemie potrzebuje dokładnie tego samego obudowania: karty
 * z tytułem, legendy, warstwy najechania kursorem, bliźniaczego widoku
 * tabelarycznego i przerysowania po zmianie szerokości okna. Gdyby każdy typ
 * wykresu robił to po swojemu, po trzech typach mielibyśmy trzy różne
 * zachowania podpowiedzi i trzy sposoby na zgubienie dostępności.
 *
 * PODZIAŁ ODPOWIEDZIALNOŚCI
 *  • ten moduł  — karta, legenda, tabela, kursor, klawiatura, przerysowanie,
 *  • moduł typu — wyłącznie geometria: „mając prostokąt W×H, narysuj dane”.
 *
 * DOSTĘPNOŚĆ (wymagana, nie opcjonalna)
 *  • każdy wykres ma bliźniaczy widok tabelaryczny przełączany przyciskiem —
 *    żadna wartość nie jest dostępna wyłącznie przez najechanie myszą,
 *  • obszar rysunku jest ogniskowalny, a strzałki przesuwają wskazanie;
 *    klawiatura pokazuje dokładnie to samo, co kursor,
 *  • etykiety serii trafiają do DOM przez `textContent` — nazwy produktów
 *    i kontrahentów pochodzą z bazy i nie są zaufanym HTML-em,
 *  • przy odświeżaniu danych rysunek zostaje na ekranie przygaszony:
 *    bez migotania szkieletem i bez skoku układu.
 */
import { esc } from '../../core/dom.js';
import { iconRef } from '../../components/icons.js';

/** Minimalny obszar trafienia kursorem — 24 px zgodnie z regułą znaczników. */
const MIN_HIT = 24;

let seq = 0;

/**
 * @typedef {object} ChartSpec
 * @property {string} title                nagłówek karty
 * @property {string} [subtitle]           podtytuł (zakres, jednostka)
 * @property {string} [caption]            opis dla czytnika ekranu
 * @property {string} [note]               przypis pod rysunkiem
 * @property {string} [headerActions]      dodatkowe przyciski w nagłówku (HTML)
 * @property {Array<{label:string,color:string,shape?:'line'|'rect'}>} [legend]
 * @property {(width:number)=>{height:number,margin:{top:number,right:number,bottom:number,left:number}}} layout
 * @property {(box:{x:number,y:number,w:number,h:number,width:number,height:number})=>{svg:string,hits:Array}} render
 * @property {'x'|'mark'|'none'} [hitMode]
 * @property {(index:number)=>{title:string,rows:Array<{label:string,value:string,color?:string,shape?:string}>}|null} [tooltip]
 * @property {()=>{columns:Array<{key:string,label:string,align?:string}>,rows:Array<object>}} [table]
 * @property {{title:string,hint?:string}} [empty]
 * @property {boolean} [isEmpty]
 */

/**
 * Tworzy wykres.
 * @param {ChartSpec} spec
 */
export function createChart(spec) {
  const {
    title, subtitle = '', caption = '', note = '', headerActions = '',
    legend = [], layout, render, hitMode = 'x', tooltip = null, table = null,
    empty = { title: 'Brak danych w tym zakresie', hint: 'Zmień miesiąc albo zakres filtra.' },
    isEmpty = false,
  } = spec;

  const uid = `viz${(seq += 1)}`;
  let root = null;
  let plot = null;
  let tip = null;
  let observer = null;
  let hits = [];
  let active = -1;
  let mode = 'chart';
  let width = 0;
  let listeners = [];

  /* ------------------------------- Szkielet ------------------------------ */

  function skeleton() {
    const legendHtml = legend.length >= 2 ? `<ul class="viz-legend">${legend.map((l) => `
      <li><span class="viz-key ${l.shape === 'rect' ? 'rect' : 'line'}" style="--k:${esc(l.color)}"></span>${esc(l.label)}</li>`).join('')}</ul>` : '';

    return `<figure class="viz-card" aria-busy="false">
      <figcaption class="viz-head">
        <div class="viz-titles">
          <h2 id="${uid}-t">${esc(title)}</h2>
          ${subtitle ? `<p class="viz-sub">${esc(subtitle)}</p>` : ''}
        </div>
        <div class="viz-tools">
          ${headerActions}
          ${table ? `<button type="button" class="icon-btn" data-viz-view="table"
                    aria-pressed="false" title="Pokaż jako tabelę" aria-label="Pokaż jako tabelę">
                    ${iconRef('list')}</button>` : ''}
        </div>
      </figcaption>
      ${legendHtml}
      <div class="viz-body">
        <div class="viz-plot" data-viz-plot tabindex="0" role="img"
             aria-labelledby="${uid}-t" aria-describedby="${uid}-d"></div>
        <p class="sr-only" id="${uid}-d">${esc(caption || title)}</p>
        <div class="viz-tip" data-viz-tip hidden role="status"></div>
      </div>
      <div class="viz-table" data-viz-table hidden></div>
      ${note ? `<p class="viz-note">${esc(note)}</p>` : ''}
    </figure>`;
  }

  /* ------------------------------ Rysowanie ------------------------------ */

  function paint() {
    if (!plot) return;
    const w = Math.max(240, Math.round(plot.clientWidth || width || 640));
    width = w;
    if (isEmpty) {
      plot.innerHTML = `<div class="empty"><b>${esc(empty.title)}</b>${esc(empty.hint ?? '')}</div>`;
      hits = [];
      return;
    }
    const { height, margin } = layout(w);
    const box = {
      x: margin.left,
      y: margin.top,
      w: Math.max(10, w - margin.left - margin.right),
      h: Math.max(10, height - margin.top - margin.bottom),
      width: w,
      height,
    };
    const out = render(box);
    hits = out.hits ?? [];
    plot.innerHTML = `<svg class="viz-svg" width="${w}" height="${height}"
        viewBox="0 0 ${w} ${height}" aria-hidden="true" focusable="false">
        ${out.svg}
        <g data-viz-cross hidden><line class="viz-cross" x1="0" y1="${box.y}" x2="0" y2="${box.y + box.h}"/></g>
      </svg>`;
  }

  /* ------------------------- Podpowiedź i wskazanie ---------------------- */

  /** Buduje treść podpowiedzi przez API DOM — nazwy z bazy nie są HTML-em. */
  function fillTip(payload) {
    tip.replaceChildren();
    const head = document.createElement('div');
    head.className = 'viz-tip-h';
    head.textContent = payload.title;
    tip.appendChild(head);
    for (const row of payload.rows) {
      const line = document.createElement('div');
      line.className = 'viz-tip-r';
      if (row.color) {
        const key = document.createElement('span');
        key.className = `viz-key ${row.shape === 'rect' ? 'rect' : 'line'}`;
        key.style.setProperty('--k', row.color);
        line.appendChild(key);
      }
      const value = document.createElement('b');
      value.textContent = row.value;
      const label = document.createElement('span');
      label.textContent = row.label;
      line.append(value, label);
      tip.appendChild(line);
    }
  }

  function place(index) {
    const hit = hits[index];
    if (!hit) return;
    const svg = plot.querySelector('svg');
    const scale = svg ? svg.getBoundingClientRect().width / (svg.viewBox.baseVal.width || 1) : 1;
    const cx = (hit.x + hit.w / 2) * scale;
    tip.hidden = false;
    tip.style.left = `${cx}px`;
    tip.style.top = `${(hit.tipY ?? hit.y ?? 0) * scale}px`;
    // Podpowiedź nie może wyjść poza kartę — przesuwamy ją, a nie przycinamy.
    const bounds = plot.getBoundingClientRect();
    const own = tip.getBoundingClientRect();
    const overflowRight = own.right - bounds.right + 8;
    const overflowLeft = bounds.left - own.left + 8;
    if (overflowRight > 0) tip.style.left = `${cx - overflowRight}px`;
    else if (overflowLeft > 0) tip.style.left = `${cx + overflowLeft}px`;
  }

  function highlight(index) {
    if (!plot || isEmpty) return;
    active = index;
    const cross = plot.querySelector('[data-viz-cross]');
    plot.querySelectorAll('[data-viz-mark]').forEach((el) => {
      el.classList.toggle('on', Number(el.dataset.vizMark) === index);
    });
    const payload = index >= 0 && tooltip ? tooltip(index) : null;
    if (!payload) {
      tip.hidden = true;
      if (cross) cross.hidden = true;
      return;
    }
    fillTip(payload);
    place(index);
    if (cross && hitMode === 'x') {
      const hit = hits[index];
      const line = cross.querySelector('line');
      const cx = hit.x + hit.w / 2;
      line.setAttribute('x1', cx);
      line.setAttribute('x2', cx);
      cross.hidden = false;
    }
  }

  const clear = () => {
    active = -1;
    tip.hidden = true;
    const cross = plot?.querySelector('[data-viz-cross]');
    if (cross) cross.hidden = true;
    plot?.querySelectorAll('[data-viz-mark].on').forEach((el) => el.classList.remove('on'));
  };

  /** Indeks pozycji pod kursorem — najbliższa w poziomie, nie trafienie w piksel. */
  function indexAt(ev) {
    if (!hits.length) return -1;
    const svg = plot.querySelector('svg');
    if (!svg) return -1;
    const rect = svg.getBoundingClientRect();
    const scale = (svg.viewBox.baseVal.width || 1) / (rect.width || 1);
    const px = (ev.clientX - rect.left) * scale;
    const py = (ev.clientY - rect.top) * scale;
    if (hitMode === 'mark') {
      let found = -1;
      hits.forEach((h, i) => {
        const pad = Math.max(0, (MIN_HIT - h.h) / 2);
        if (px >= h.x && px <= h.x + h.w && py >= h.y - pad && py <= h.y + h.h + pad) found = i;
      });
      return found;
    }
    let best = 0;
    let bestDist = Infinity;
    hits.forEach((h, i) => {
      const d = Math.abs(px - (h.x + h.w / 2));
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  /* -------------------------------- Tabela ------------------------------- */

  function paintTable() {
    if (!table) return;
    const host = root.querySelector('[data-viz-table]');
    const { columns, rows } = table();
    host.innerHTML = `<div class="tbl-wrap"><table class="tbl">
      <caption class="sr-only">${esc(caption || title)}</caption>
      <thead><tr>${columns.map((c) => `<th scope="col"${c.align === 'num' ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td${c.align === 'num' ? ' class="num"' : ''}>${esc(r[c.key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }

  function setMode(next) {
    mode = next;
    const btn = root.querySelector('[data-viz-view]');
    const body = root.querySelector('.viz-body');
    const host = root.querySelector('[data-viz-table]');
    const asTable = mode === 'table';
    body.hidden = asTable;
    host.hidden = !asTable;
    if (btn) {
      btn.setAttribute('aria-pressed', asTable ? 'true' : 'false');
      const label = asTable ? 'Pokaż jako wykres' : 'Pokaż jako tabelę';
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }
    if (asTable) { clear(); paintTable(); } else paint();
  }

  /* ------------------------------- Interfejs ----------------------------- */

  const api = {
    mount(container) {
      const holder = document.createElement('div');
      holder.className = 'viz-holder';
      holder.innerHTML = skeleton();
      container.appendChild(holder);
      root = holder.firstElementChild;
      plot = root.querySelector('[data-viz-plot]');
      tip = root.querySelector('[data-viz-tip]');

      if (hitMode !== 'none') {
        const move = (ev) => highlight(indexAt(ev));
        plot.addEventListener('pointermove', move);
        plot.addEventListener('pointerleave', clear);
        plot.addEventListener('blur', clear);
        plot.addEventListener('focus', () => highlight(active >= 0 ? active : hits.length - 1));
        const key = (ev) => {
          if (!hits.length) return;
          const step = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1 }[ev.key];
          if (step === undefined) {
            if (ev.key === 'Escape') { clear(); plot.blur(); }
            return;
          }
          ev.preventDefault();
          const base = active >= 0 ? active : hits.length - 1;
          highlight(Math.max(0, Math.min(hits.length - 1, base + step)));
        };
        plot.addEventListener('keydown', key);
        listeners.push(() => {
          plot.removeEventListener('pointermove', move);
          plot.removeEventListener('pointerleave', clear);
          plot.removeEventListener('keydown', key);
        });
      }

      const toggle = root.querySelector('[data-viz-view]');
      if (toggle) toggle.addEventListener('click', () => setMode(mode === 'table' ? 'chart' : 'table'));

      // Przerysowanie po zmianie szerokości — tekst osi ma zostać ostry,
      // więc rysujemy w rzeczywistych pikselach, a nie skalujemy viewBox.
      observer = new ResizeObserver(() => {
        if (mode === 'chart' && Math.abs(plot.clientWidth - width) > 4) paint();
      });
      observer.observe(plot);

      paint();
      return api;
    },

    /** Przygasza rysunek na czas wczytywania — bez skoku układu. */
    setBusy(busy) {
      root?.setAttribute('aria-busy', busy ? 'true' : 'false');
      return api;
    },

    /** Wymusza przerysowanie (np. po zmianie motywu). */
    redraw() {
      if (mode === 'chart') paint(); else paintTable();
      return api;
    },

    destroy() {
      listeners.forEach((off) => off());
      listeners = [];
      observer?.disconnect();
      observer = null;
      root?.parentElement?.remove();
      root = null;
      plot = null;
    },

    get element() { return root; },
  };

  return api;
}

/** Etykieta osi wartości — skrót tysięcy i milionów po polsku. */
export function compact(value, unit = '') {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const fmt = (v, d) => v.toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: d });
  if (abs >= 1e6) return `${fmt(n / 1e6, 1)} mln${unit ? ` ${unit}` : ''}`;
  if (abs >= 1e4) return `${fmt(n / 1e3, 0)} tys.${unit ? ` ${unit}` : ''}`;
  if (abs >= 1e3) return `${fmt(n / 1e3, 1)} tys.${unit ? ` ${unit}` : ''}`;
  return `${fmt(n, abs < 10 ? 1 : 0)}${unit ? ` ${unit}` : ''}`;
}

/**
 * Szerokość marginesu potrzebna na podziałkę osi wartości.
 *
 * Margines na sztywno jest źródłem najbrzydszej usterki wykresu: podpis
 * „2,5 tys.” przy stałych 54 px wychodzi poza rysunek i traci pierwszą cyfrę.
 * Mierzymy więc najdłuższy podpis i dokładamy miejsce na niego.
 */
export function axisWidth(values, format) {
  const longest = Math.max(1, ...values.map((v) => String(format(v)).length));
  return Math.ceil(longest * 6.7) + 14;
}

/**
 * Przycina etykietę do dostępnej szerokości.
 * Pełna nazwa zostaje w podpowiedzi i w widoku tabelarycznym, więc nic nie
 * ginie — obcięty tekst jest skrótem, nie utratą danych.
 */
export function fitLabel(text, px, charWidth = 6.6) {
  const max = Math.max(4, Math.floor(px / charWidth));
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Indeksy kategorii, które dostają podpis na osi.
 *
 * Ostatnia pozycja jest podpisana zawsze — to ona niesie „stan na dziś”.
 * Jeśli poprzedni podpis wypadłby zbyt blisko niej, znika ten wcześniejszy,
 * a nie ostatni: dwa podpisy stykające się bokami czyta się gorzej niż jeden.
 */
export function tickIndices(count, every) {
  if (count <= 0) return [];
  const out = [];
  for (let i = 0; i < count; i += Math.max(1, every)) out.push(i);
  const last = count - 1;
  if (out[out.length - 1] !== last) {
    if (last - out[out.length - 1] < Math.max(1, every)) out.pop();
    out.push(last);
  }
  return out;
}

/** Siatka pozioma + oś wartości. Wspólna dla wszystkich typów kolumnowych. */
export function valueAxis(tickList, y, box, format) {
  const grid = tickList.map((t) => {
    const py = y(t).toFixed(1);
    const zero = t === 0;
    return `<line class="viz-grid${zero ? ' zero' : ''}" x1="${box.x}" y1="${py}" x2="${box.x + box.w}" y2="${py}"/>`;
  }).join('');
  const labels = tickList.map((t) => `<text class="viz-tick" x="${box.x - 8}" y="${(y(t) + 4).toFixed(1)}"
      text-anchor="end">${esc(format(t))}</text>`).join('');
  return grid + labels;
}
