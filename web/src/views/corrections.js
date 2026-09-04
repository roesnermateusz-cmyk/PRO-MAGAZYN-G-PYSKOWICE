/** Rejestr korekt — historia zmian dokumentów wraz z możliwością przywrócenia. */
import api from '../core/api.js';
import { esc, on } from '../core/dom.js';
import { dateTime } from '../core/format.js';
import {
  pageHead, kpi, empty, loading, docStamp, typeTag, pager,
  toast, toastError, confirmDialog, alertBox,
} from '../core/ui.js';
import { ICONS } from '../components/icons.js';
import { can } from '../core/store.js';
import { navigate } from '../core/router.js';

const state = { q: '', operationId: '', limit: 50, offset: 0 };

export async function renderCorrections(view, params = {}) {
  if (params.op) state.operationId = params.op;
  view.innerHTML = loading('Wczytywanie rejestru korekt…');
  await refresh(view);
}

async function refresh(view) {
  const data = await api.get('/corrections', state);

  view.innerHTML = pageHead(
    'Rejestr korekt',
    'Historia zmian dokumentów — stan przed i po każdej edycji',
    `<button class="btn" data-act="print">${ICONS.print} Drukuj</button>`,
  )
  + `<div class="kpi-grid">
      ${kpi({ label: 'Wszystkie korekty', value: data.stats.total, icon: 'edit' })}
      ${kpi({ label: 'Poprawione dokumenty', value: data.stats.documents, icon: 'file' })}
      ${kpi({ label: 'Korekty dzisiaj', value: data.stats.today, icon: 'calendar', variant: 'accent' })}
    </div>

    ${state.operationId ? alertBox('info', 'Widok ograniczony do jednego dokumentu.'
      + ' Użyj przycisku „Pokaż wszystkie”, aby wrócić do pełnego rejestru.') : ''}

    <div class="toolbar">
      <input type="search" id="cq" placeholder="Szukaj: numer dokumentu, produkt, autor zmiany…" value="${esc(state.q)}">
      ${state.operationId ? '<button class="btn btn-sm" data-act="all">Pokaż wszystkie</button>' : ''}
      <span class="count-pill">${data.page.total} wpis(ów)</span>
    </div>`

  + (data.items.length
    ? data.items.map(entryHtml).join('') + pager(data.page)
    : `<div class="card"><div class="card-b">${empty('Brak zarejestrowanych korekt',
        'Każda zmiana zapisana w formularzu operacji pojawi się tutaj automatycznie.')}</div></div>`);

  on(view, 'click', '[data-page]', (el) => {
    state.offset = Math.max(0, state.offset + (el.dataset.page === 'next' ? state.limit : -state.limit));
    refresh(view);
  });
  view.querySelector('#cq').addEventListener('change', (e) => { state.q = e.target.value.trim(); state.offset = 0; refresh(view); });
  view.querySelector('#cq').addEventListener('search', (e) => { state.q = e.target.value.trim(); state.offset = 0; refresh(view); });
  view.querySelector('[data-act="all"]')?.addEventListener('click', () => { state.operationId = ''; refresh(view); });
  view.querySelector('[data-act="print"]').addEventListener('click', () => window.print());
  on(view, 'click', '[data-open]', (el) => navigate(`/operacje/${el.dataset.open}`));
  on(view, 'click', '[data-restore]', (el) => restore(el.dataset.restore, view));
}

function entryHtml(c) {
  return `<div class="card" style="margin-bottom:12px">
    <div class="card-h">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        ${typeTag(c.operationType)}${docStamp(c.docNo)}
        <span style="font-size:13px">${esc(c.productName || '')}</span>
        ${c.operationStatus === 'CANCELLED' ? '<span class="tag CANCELLED">ANULOWANY</span>' : ''}
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <span class="sub">${dateTime(c.changedAt)} · ${esc(c.changedBy)}</span>
        <button class="btn btn-sm" data-open="${esc(c.operationId)}">${ICONS.eye} Dokument</button>
        ${can('operations:write') ? `<button class="btn btn-sm" data-restore="${esc(c.id)}">${ICONS.refresh} Przywróć</button>` : ''}
      </div>
    </div>
    <div class="card-b">
      ${c.reason ? `<p style="font-size:12.5px;color:var(--ink-2);margin-bottom:10px"><b>Uzasadnienie:</b> ${esc(c.reason)}</p>` : ''}
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Pole</th><th>Przed zmianą</th><th>Po zmianie</th></tr></thead>
        <tbody>${c.changes.map((ch) => `<tr>
          <td style="font-weight:600">${esc(ch.label)}</td>
          <td style="color:var(--neg)">${esc(ch.from)}</td>
          <td style="color:var(--pos)">${esc(ch.to)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
  </div>`;
}

async function restore(correctionId, view) {
  const confirmed = await confirmDialog({
    title: 'Przywrócenie stanu sprzed korekty',
    message: 'Dokument wróci do wartości sprzed tej zmiany. Operacja sama zostanie zapisana jako kolejna korekta — '
      + 'historia nie jest nadpisywana.',
    confirmLabel: 'Przywróć',
  });
  if (confirmed === null) return;
  try {
    await api.post(`/corrections/${correctionId}/restore`, {});
    toast('Przywrócono stan sprzed korekty');
    refresh(view);
  } catch (err) {
    toastError(err);
  }
}
