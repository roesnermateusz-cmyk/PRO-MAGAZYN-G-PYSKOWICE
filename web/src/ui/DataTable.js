/**
 * DataTable — lista danych opisana raz, wyświetlana dwoma sposobami.
 *
 * PROBLEM, KTÓRY TO ROZWIĄZUJE
 * Rejestr dokumentów miał dwa równoległe szablony jednego wiersza: `rowHtml`
 * dla tabeli na komputerze i `cardHtml` dla karty na telefonie. Oba były
 * budowane ZAWSZE, a arkusz stylów ukrywał ten niepasujący do szerokości
 * ekranu. Pomiar na pięćdziesięciu dokumentach: połowa zbudowanego drzewa DOM
 * była niewidoczna, a każda zmiana filtra przepisywała oba warianty naraz.
 * Do tego dwa szablony to dwa miejsca, w których trzeba pamiętać o zmianie
 * kolumny — i jedno, o którym się zapomni.
 *
 * ZASADA
 * Kolumna opisana jest raz. Komponent sprawdza szerokość ekranu i renderuje
 * WYŁĄCZNIE wariant potrzebny. Nie da się zbudować obu, bo nie ma dwóch
 * szablonów.
 *
 * AKTUALIZACJA CZĘŚCIOWA
 * `setRows()` podmienia zawartość `<tbody>` (albo listy kart) i nic poza tym.
 * Nagłówek tabeli, pasek narzędzi i filtry zostają nietknięte — dzięki temu
 * przy zmianie filtra nie ginie fokus, pozycja kursora w polu wyszukiwania
 * ani przewinięcie strony.
 *
 * DOSTĘPNOŚĆ
 *  • `<caption>` dla czytnika ekranu — mówi, czego dotyczy tabela,
 *  • `scope="col"` w nagłówkach wiąże komórki z opisem kolumny,
 *  • `aria-busy` na czas wczytywania,
 *  • komunikat pustej listy jako `role="status"` — czytnik ogłasza go sam,
 *  • każdy przycisk akcji ma `aria-label`, bo ikona nie jest tekstem,
 *  • karty na telefonie są listą (`role="list"`), a nie zbiorem `<div>`-ów.
 */
import { esc, on } from '../core/dom.js';
import { iconRef } from '../components/icons.js';

/** Punkt przełamania układu — ten sam, co w arkuszu stylów. */
const MOBILE = '(max-width: 860px)';

/**
 * @typedef {object} Column
 * @property {string} key            klucz pola (identyfikator kolumny)
 * @property {string} label          nagłówek kolumny
 * @property {(row:any)=>string} cell treść komórki (HTML — dane muszą być już bezpieczne)
 * @property {'num'|'left'} [align]  wyrównanie
 * @property {boolean} [nowrap]      zakaz łamania wiersza
 * @property {string} [cls]          dodatkowa klasa komórki
 * @property {'title'|'meta'|'body'|'foot'|false} [card]
 *           gdzie umieścić wartość na karcie mobilnej; `false` = pomiń
 * @property {string} [cardLabel]    etykieta przed wartością na karcie
 */

/**
 * @param {object} spec
 * @param {Column[]} spec.columns
 * @param {string} spec.caption            opis tabeli dla czytnika ekranu
 * @param {(row:any)=>string} [spec.rowKey]
 * @param {(row:any)=>string} [spec.rowClass]
 * @param {(row:any)=>Array} [spec.actions] przyciski wiersza
 * @param {{title:string,hint?:string}} [spec.empty]
 * @param {(rows:any[],extra:any)=>string} [spec.footer] wiersz podsumowania (HTML `<td>`)
 * @param {(act:string,row:any,ev:Event)=>void} [spec.onAction]
 * @param {(row:any)=>void} [spec.onRowActivate] kliknięcie w wiersz
 */
export function createDataTable(spec) {
  const {
    columns, caption, rowKey = (r) => r.id, rowClass = () => '',
    actions = null, empty = { title: 'Brak pozycji' }, footer = null,
    onAction = null, onRowActivate = null,
  } = spec;

  const media = window.matchMedia(MOBILE);
  let root = null;
  let rows = [];
  let extra = null;
  let detach = [];
  let mediaListener = null;

  /* --------------------------- Warianty wiersza -------------------------- */

  const actionButtons = (row) => (actions ? actions(row).filter(Boolean).map((a) => `
    <button type="button" class="icon-btn${a.danger ? ' danger' : ''}"
            data-dt-act="${esc(a.act)}" data-dt-row="${esc(rowKey(row))}"
            title="${esc(a.label)}" aria-label="${esc(a.label)}">${iconRef(a.icon)}</button>`).join('') : '');

  function tableRow(row) {
    const cells = columns.map((c) => {
      const cls = [c.align === 'num' ? 'num' : '', c.cls || ''].filter(Boolean).join(' ');
      const style = c.nowrap ? ' style="white-space:nowrap"' : '';
      return `<td${cls ? ` class="${cls}"` : ''}${style}>${c.cell(row)}</td>`;
    }).join('');
    const extraCls = rowClass(row);
    return `<tr${extraCls ? ` class="${esc(extraCls)}"` : ''} data-dt-row="${esc(rowKey(row))}">`
      + cells
      + (actions ? `<td class="dt-actions">${actionButtons(row)}</td>` : '')
      + '</tr>';
  }

  function card(row) {
    const slot = (name) => columns.filter((c) => c.card === name);

    /**
     * Puste pole nie zajmuje na karcie osobnego wiersza.
     *
     * W tabeli kreska „—” jest potrzebna: trzyma wyrównanie kolumn i mówi,
     * że wartości nie ma. Na karcie wiersz z samą kreską jest szumem —
     * dokument bez numeru rejestracyjnego ma po prostu tego nie pokazywać.
     */
    const part = (c) => {
      const value = c.cell(row);
      const bare = String(value).replace(/<[^>]*>/g, '').trim();
      if (!bare || bare === '—') return '';
      return c.cardLabel
        ? `<span class="dtc-pair"><i>${esc(c.cardLabel)}</i>${value}</span>`
        : `<span>${value}</span>`;
    };

    const title = slot('title').map(part).join('');
    const meta = slot('meta').map(part).join('');
    const body = slot('body').map(part).join('');
    const foot = slot('foot').map(part).join('');
    const extraCls = rowClass(row);

    return `<div class="dt-card${extraCls ? ` ${esc(extraCls)}` : ''}" role="listitem"
                 data-dt-row="${esc(rowKey(row))}">
      ${title || meta ? `<div class="dtc-head">${title}${meta ? `<span class="dtc-meta">${meta}</span>` : ''}</div>` : ''}
      ${body ? `<div class="dtc-body">${body}</div>` : ''}
      ${foot || actions ? `<div class="dtc-foot">${foot}${actions ? `<span class="dt-actions">${actionButtons(row)}</span>` : ''}</div>` : ''}
    </div>`;
  }

  /* ------------------------------ Renderowanie --------------------------- */

  /** Buduje szkielet raz; dalej podmieniana jest wyłącznie zawartość list. */
  function skeleton() {
    const head = columns.map((c) => {
      const cls = c.align === 'num' ? ' class="num"' : '';
      return `<th scope="col"${cls}>${esc(c.label)}</th>`;
    }).join('') + (actions ? '<th scope="col"><span class="sr-only">Akcje</span></th>' : '');

    return `<div class="dt-table"><div class="tbl-wrap"><table class="tbl">
        <caption class="sr-only">${esc(caption)}</caption>
        <thead><tr>${head}</tr></thead>
        <tbody data-dt-body></tbody>
        <tfoot data-dt-foot hidden></tfoot>
      </table></div></div>
      <div class="dt-cards" data-dt-cards role="list"></div>
      <div data-dt-empty hidden role="status"></div>`;
  }

  /**
   * Wypełnia TYLKO wariant pasujący do szerokości ekranu.
   * Drugi pojemnik zostaje pusty — nie ma z czego zbudować niewidocznego drzewa.
   */
  function paint() {
    const body = root.querySelector('[data-dt-body]');
    const cards = root.querySelector('[data-dt-cards]');
    const foot = root.querySelector('[data-dt-foot]');
    const none = root.querySelector('[data-dt-empty]');
    const mobile = media.matches;

    if (!rows.length) {
      body.innerHTML = '';
      cards.innerHTML = '';
      foot.hidden = true;
      none.hidden = false;
      none.innerHTML = `<div class="empty"><b>${esc(empty.title)}</b>${esc(empty.hint ?? '')}</div>`;
      return;
    }

    none.hidden = true;
    body.innerHTML = mobile ? '' : rows.map(tableRow).join('');
    cards.innerHTML = mobile ? rows.map(card).join('') : '';

    const summary = footer && !mobile ? footer(rows, extra) : '';
    foot.innerHTML = summary ? `<tr>${summary}</tr>` : '';
    foot.hidden = !summary;
  }

  /* -------------------------------- Interfejs ---------------------------- */

  const api = {
    /** Wstawia komponent do kontenera i podpina obsługę zdarzeń. */
    mount(container) {
      root = document.createElement('div');
      root.className = 'dt';
      root.setAttribute('aria-busy', 'false');
      root.innerHTML = skeleton();
      container.appendChild(root);

      if (onAction) {
        detach.push(on(root, 'click', '[data-dt-act]', (el, ev) => {
          ev.stopPropagation();
          const row = rows.find((r) => String(rowKey(r)) === el.dataset.dtRow);
          if (row) onAction(el.dataset.dtAct, row, ev);
        }));
      }
      if (onRowActivate) {
        detach.push(on(root, 'click', '[data-dt-row]', (el, ev) => {
          if (ev.target.closest('[data-dt-act]') || ev.target.closest('a')) return;
          const row = rows.find((r) => String(rowKey(r)) === el.dataset.dtRow);
          if (row) onRowActivate(row);
        }));
      }

      // Obrót telefonu albo zmiana rozmiaru okna przełącza wariant. Zdarzenie
      // jest rzadkie, więc przemalowanie w całości jest tu właściwą odpowiedzią.
      mediaListener = () => paint();
      media.addEventListener('change', mediaListener);

      paint();
      return api;
    },

    /**
     * Podmienia dane. Jedyna operacja wykonywana przy zmianie filtra —
     * reszta ekranu pozostaje nietknięta.
     */
    setRows(nextRows, nextExtra = null) {
      rows = Array.isArray(nextRows) ? nextRows : [];
      extra = nextExtra;
      if (root) paint();
      return api;
    },

    /** Sygnalizuje wczytywanie: przygasza listę i ogłasza stan czytnikowi. */
    setBusy(busy) {
      if (root) root.setAttribute('aria-busy', busy ? 'true' : 'false');
      return api;
    },

    /** Odpina zdarzenia i usuwa komponent — wołane przy zmianie widoku. */
    destroy() {
      detach.forEach((off) => off());
      detach = [];
      if (mediaListener) media.removeEventListener('change', mediaListener);
      root?.remove();
      root = null;
      rows = [];
    },

    get element() { return root; },
  };

  return api;
}
