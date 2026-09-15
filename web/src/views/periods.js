/** Okresy rozliczeniowe — zamykanie i otwieranie miesięcy obrachunkowych. */
import api from '../core/api.js';
import { esc, on } from '../core/dom.js';
import { qty, int, dateTime, monthLabel } from '../core/format.js';
import { pageHead, empty, loading, toast, toastError, confirmDialog, alertBox } from '../core/ui.js';
import { ICONS } from '../components/icons.js';
import { can } from '../core/store.js';

export async function renderPeriods(view) {
  view.innerHTML = loading('Wczytywanie okresów…');
  await refresh(view);
}

async function refresh(view) {
  const { items } = await api.get('/periods');
  const manage = can('periods:close');

  view.innerHTML = pageHead(
    'Okresy rozliczeniowe',
    'Zamknięcie miesiąca blokuje zapisy i utrwala stany magazynowe',
    `<button class="btn" data-act="print">${ICONS.print} Drukuj</button>`,
  )
  + alertBox('info',
    'Okresy zamyka się chronologicznie — od najstarszego. Zamknięcie utrwala migawkę stanów na koniec miesiąca, '
    + 'dzięki czemu raport miesięczny pozostaje odtwarzalny. Otwarcie zamkniętego okresu wymaga uprawnień kierownika '
    + 'i jest odnotowywane w dzienniku audytu.')
  + `<div class="card"><div class="card-b flush">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th>Miesiąc</th><th>Status</th><th class="num">Dokumenty</th><th class="num">Obrót [MP]</th>
          <th>Zamknięty</th><th>Uwagi</th><th></th>
        </tr></thead>
        <tbody>${items.map((p) => `<tr>
          <td><b>${esc(monthLabel(p.month))}</b><br><span style="font-family:var(--font-mono);font-size:11px;color:var(--ink-3)">${esc(p.month)}</span></td>
          <td><span class="tag ${p.status}">${p.status === 'CLOSED' ? 'zamknięty' : 'otwarty'}</span></td>
          <td class="num">${int(p.documents)}</td>
          <td class="num">${qty(p.qtyMp)}</td>
          <td style="font-size:12px">${p.closedAt ? `${dateTime(p.closedAt)}<br><span style="color:var(--ink-3)">${esc(p.closedBy || '')}</span>` : '—'}</td>
          <td style="font-size:12px;color:var(--ink-2)" class="ellip">${esc(p.note || '—')}</td>
          <td>${manage ? (p.status === 'CLOSED'
            ? `<button class="btn btn-sm" data-reopen="${esc(p.month)}">Otwórz</button>`
            : `<button class="btn btn-sm btn-primary" data-close="${esc(p.month)}">Zamknij</button>`) : ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${items.length ? '' : empty('Brak okresów', 'Okresy pojawią się po zaksięgowaniu pierwszych dokumentów.')}
    </div></div>`;

  view.querySelector('[data-act="print"]').addEventListener('click', () => window.print());

  on(view, 'click', '[data-close]', async (el) => {
    const month = el.dataset.close;
    const note = await confirmDialog({
      title: `Zamknięcie okresu ${monthLabel(month)}`,
      message: 'Po zamknięciu nie będzie można dopisywać ani korygować dokumentów z tego miesiąca. '
        + 'System zapisze migawkę stanów magazynowych na koniec okresu.',
      confirmLabel: 'Zamknij okres',
      reasonLabel: 'Uwagi do zamknięcia (opcjonalnie)',
    });
    if (note === null) return;
    try {
      const res = await api.post(`/periods/${month}/close`, { note });
      toast(`Okres ${month} zamknięty — utrwalono ${res.snapshotPositions} pozycji stanu`);
      refresh(view);
    } catch (err) { toastError(err); }
  });

  on(view, 'click', '[data-reopen]', async (el) => {
    const month = el.dataset.reopen;
    const reason = await confirmDialog({
      title: `Otwarcie okresu ${monthLabel(month)}`,
      message: 'Otwarcie zamkniętego okresu pozwoli ponownie edytować jego dokumenty. '
        + 'Zdarzenie zostanie zapisane w dzienniku audytu wraz z uzasadnieniem.',
      confirmLabel: 'Otwórz okres',
      danger: true,
      reasonLabel: 'Uzasadnienie (wymagane, min. 5 znaków)',
    });
    if (reason === null) return;
    try {
      await api.post(`/periods/${month}/reopen`, { reason });
      toast(`Okres ${month} otwarty`);
      refresh(view);
    } catch (err) { toastError(err); }
  });
}
