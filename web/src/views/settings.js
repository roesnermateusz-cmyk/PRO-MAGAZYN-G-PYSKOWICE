/** Ustawienia: przeliczniki, reguły księgowania, kopie zapasowe i wymiana danych. */
import api from '../core/api.js';
import { esc, formValues } from '../core/dom.js';
import { dateTime, fileSize } from '../core/format.js';
import { pageHead, loading, empty, toast, toastError, confirmDialog, alertBox } from '../core/ui.js';
import { ICONS } from '../components/icons.js';
import { can, loadSettings, store, invalidateCatalog } from '../core/store.js';
import { downloadHandler } from './_shared.js';

export async function renderSettings(view) {
  view.innerHTML = loading('Wczytywanie ustawień…');
  const settings = await loadSettings(true);
  const backups = can('backup:export') ? (await api.get('/backup/list')).items : [];
  const editable = can('settings:write');

  view.innerHTML = pageHead('Ustawienia', 'Przeliczniki, reguły pracy i bezpieczeństwo danych')

  + `<div class="grid-2">
      <div class="card">
        <div class="card-h">
          <h2>Przeliczniki jednostek</h2>
          <span class="sub">wartości globalne</span>
        </div>
        <div class="card-b">
          ${alertBox('info', 'Przeliczniki dotyczą wyłącznie nowych dokumentów. Zaksięgowane dokumenty '
            + 'przechowują własne wartości, więc historia i raporty nie zmienią się po tej edycji.')}
          <form id="unitsForm"><div class="form-grid">
            <div class="fld">
              <label for="m3">1 m³ drewna = ile MP</label>
              <input type="number" id="m3" name="units.m3_to_mp" step="0.001" min="0.001"
                     value="${esc(settings['units.m3_to_mp'])}" ${editable ? '' : 'disabled'}>
            </div>
            <div class="fld">
              <label for="mp">1 MP = ile ton</label>
              <input type="number" id="mp" name="units.mp_to_tonne" step="0.001" min="0.001"
                     value="${esc(settings['units.mp_to_tonne'])}" ${editable ? '' : 'disabled'}>
            </div>
            <div class="fld">
              <label for="gj">1 tona = ile GJ</label>
              <input type="number" id="gj" name="units.tonne_to_gj" step="0.001" min="0.001"
                     value="${esc(settings['units.tonne_to_gj'])}" ${editable ? '' : 'disabled'}>
            </div>
          </div>
          <div class="hint" style="margin-top:8px">
            Łańcuch przeliczeń: m³ → MP → tony → GJ. Produkty mogą mieć własne przeliczniki
            (kartoteka produktów), które mają pierwszeństwo przed powyższymi.
          </div>
          ${editable ? '<button type="submit" class="btn btn-primary" style="margin-top:14px">Zapisz przeliczniki</button>' : ''}
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card-h"><h2>Reguły księgowania</h2></div>
        <div class="card-b">
          <form id="rulesForm"><div class="form-grid">
            <div class="fld wide"><label class="check">
              <input type="checkbox" name="rules.require_signature" ${settings['rules.require_signature'] ? 'checked' : ''} ${editable ? '' : 'disabled'}>
              <span><b>Wymagaj podpisu zatwierdzającego</b><br>
              <span class="hint">Dokument musi mieć imię i nazwisko osoby zatwierdzającej — wymóg audytu KZR/SURE.</span></span>
            </label></div>
            <div class="fld wide"><label class="check">
              <input type="checkbox" name="rules.allow_negative_stock" ${settings['rules.allow_negative_stock'] ? 'checked' : ''} ${editable ? '' : 'disabled'}>
              <span><b>Zezwalaj na stany ujemne</b><br>
              <span class="hint">Włączone: system ostrzega, ale pozwala wydać towar bez dokumentu przyjęcia.
              Wyłączone: taki zapis jest blokowany.</span></span>
            </label></div>
            <div class="fld wide">
              <label for="backdate">Dozwolone księgowanie wstecz (dni)</label>
              <input type="number" id="backdate" name="rules.backdate_days" min="0" max="3650" step="1"
                     value="${esc(settings['rules.backdate_days'])}" ${editable ? '' : 'disabled'}>
              <div class="hint">Ograniczenie dotyczy magazyniera i księgowego. Kierownik i administrator
              mogą księgować dokumenty z dowolną datą w otwartym okresie.</div>
            </div>
          </div>
          ${editable ? '<button type="submit" class="btn btn-primary" style="margin-top:14px">Zapisz reguły</button>' : ''}
          </form>
        </div>
      </div>
    </div>`

  + (can('backup:export') ? `
    <div class="card" style="margin-top:16px">
      <div class="card-h">
        <h2>Bezpieczeństwo danych</h2>
        <span class="sub">Kopie zapasowe, eksport i import</span>
      </div>
      <div class="card-b">
        ${alertBox('info', 'System wykonuje kopię pliku bazy automatycznie raz na dobę oraz zawsze przed importem danych. '
          + 'Kopie leżą w katalogu wskazanym w pliku konfiguracyjnym (BACKUP_DIR) — obejmij go firmowym backupem.')}
        <div class="page-actions" style="margin-bottom:16px">
          <button class="btn" data-act="backup">${ICONS.shield} Utwórz kopię teraz</button>
          <button class="btn" data-act="export">${ICONS.download} Eksport JSON (pełna kopia)</button>
          <button class="btn" data-act="export-csv">${ICONS.download} Eksport rejestru CSV</button>
          ${can('backup:import') ? `<button class="btn btn-danger" data-act="import">${ICONS.upload} Import z pliku JSON</button>` : ''}
          <input type="file" id="importFile" accept="application/json,.json" style="display:none">
        </div>

        <h3 style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin-bottom:8px">
          Ostatnie kopie zapasowe
        </h3>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Plik</th><th>Rozmiar</th><th>Utworzona</th></tr></thead>
          <tbody>${backups.slice(0, 12).map((b) => `<tr>
            <td style="font-family:var(--font-mono);font-size:12px">${esc(b.file)}</td>
            <td class="num">${fileSize(b.sizeBytes)}</td>
            <td>${dateTime(b.createdAt)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        ${backups.length ? '' : empty('Brak kopii', 'Pierwsza kopia powstanie automatycznie w ciągu doby.')}
      </div>
    </div>` : '')

  + `<div class="card" style="margin-top:16px">
      <div class="card-h"><h2>Moje konto</h2></div>
      <div class="card-b">
        <dl class="kv">
          <dt>Imię i nazwisko</dt><dd>${esc(store.user?.fullName ?? '')}</dd>
          <dt>E-mail</dt><dd>${esc(store.user?.email ?? '')}</dd>
          <dt>Rola</dt><dd>${esc(store.user?.role ?? '')}</dd>
          <dt>Wersja systemu</dt><dd>${esc(store.meta?.version ?? '')}</dd>
        </dl>
        <button class="btn" style="margin-top:14px" data-act="password">${ICONS.lock} Zmień hasło</button>
      </div>
    </div>`;

  bind(view);
}

function bind(view) {
  view.querySelector('#unitsForm')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await save(view, formValues(ev.target), 'Przeliczniki zapisane');
  });

  view.querySelector('#rulesForm')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await save(view, formValues(ev.target), 'Reguły zapisane');
  });

  view.querySelector('[data-act="backup"]')?.addEventListener('click', async () => {
    try {
      const res = await api.post('/backup/create', { label: 'reczna' });
      toast(`Kopia utworzona: ${res.file} (${fileSize(res.sizeBytes)})`);
      renderSettings(view);
    } catch (err) { toastError(err); }
  });

  view.querySelector('[data-act="export"]')?.addEventListener('click',
    downloadHandler('/backup/export.json', {}, 'kopia.json', 'Kopia JSON została pobrana'));

  view.querySelector('[data-act="export-csv"]')?.addEventListener('click',
    downloadHandler('/operations/export.csv', { status: 'ALL', limit: 500 },
      'rejestr.csv', 'Rejestr CSV został pobrany'));

  const fileInput = view.querySelector('#importFile');
  view.querySelector('[data-act="import"]')?.addEventListener('click', () => fileInput.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = '';

    const confirmed = await confirmDialog({
      title: 'Import danych z kopii',
      message: `Plik: ${file.name} (${fileSize(file.size)}). Dokumenty o istniejących numerach zostaną pominięte. `
        + 'Przed importem system automatycznie wykona kopię bieżącej bazy.',
      confirmLabel: 'Importuj (tryb scalania)',
      danger: true,
    });
    if (confirmed === null) return;

    try {
      const payload = JSON.parse(await file.text());
      const res = await api.post('/backup/import', { mode: 'merge', payload });
      invalidateCatalog();
      toast(`Zaimportowano ${res.operations} dokument(ów), pominięto ${res.skipped}`
        + (res.errors.length ? `, błędy: ${res.errors.length}` : ''));
      if (res.errors.length) {
        res.errors.slice(0, 3).forEach((e) => toast(`${e.docNo}: ${e.message}`, 'err'));
      }
    } catch (err) {
      toastError(err instanceof SyntaxError ? new Error('Plik nie jest poprawnym dokumentem JSON.') : err);
    }
  });

  view.querySelector('[data-act="password"]')?.addEventListener('click', () => {
    window.location.hash = '#/zmiana-hasla';
  });
}

async function save(view, values, message) {
  try {
    await api.put('/settings', values);
    await loadSettings(true);
    toast(message);
  } catch (err) {
    toastError(err);
  }
}
