/**
 * Historia zmian — pełny dziennik audytu w formie do czytania i do wydruku.
 *
 * Rejestr korekt (`views/corrections.js`) pokazuje zmiany DOKUMENTÓW. Tutaj
 * jest wszystko pozostałe: kartoteki, konta, uprawnienia do magazynów,
 * ustawienia, okresy księgowe, logowania, eksporty i kopie zapasowe — oraz
 * dokumenty także, bo kontrola pyta „kto i kiedy”, nie dzieląc zdarzeń na
 * kategorie techniczne.
 *
 * Wpis odpowiada na cztery pytania naraz: KTO, KIEDY, CO i JAK BYŁO PRZEDTEM.
 * Etykiety pól przychodzą gotowe z serwera (`domain/field-labels.js`), więc
 * ten widok nie utrzymuje własnego słownika nazw pól — inaczej dodanie pola
 * do kartoteki wymagałoby pamiętania o dwóch miejscach naraz.
 */
import api from '../core/api.js';
import { esc, on } from '../core/dom.js';
import { dateTime } from '../core/format.js';
import { pageHead, empty, loading, pager, printHeader, toastError } from '../core/ui.js';
import { ICONS } from '../components/icons.js';
import { navigate } from '../core/router.js';

const state = {
  q: '', userEmail: '', action: '', entity: '', entityId: '',
  from: '', to: '', limit: 50, offset: 0,
};

/** Filtry z serwera — pobierane raz, bo zmieniają się rzadko. */
let filtry = null;

/**
 * Nazwy encji po polsku.
 *
 * To słownictwo interfejsu, nie prawda domenowa — dlatego mieszka tutaj,
 * a nie w schematach walidacji (tam siedzą etykiety POLA, i te przychodzą
 * z serwera). Encja nieznana pokazuje własną nazwę techniczną: lepiej
 * surowo niż wcale.
 */
const ENCJE = {
  operations: 'Dokument magazynowy',
  stock_moves: 'Ruch magazynowy',
  products: 'Kartoteka produktów',
  partners: 'Kartoteka kontrahentów',
  warehouses: 'Magazyny',
  vehicles: 'Kartoteka pojazdów',
  forest_districts: 'Nadleśnictwa',
  forest_ranges: 'Leśnictwa',
  loading_places: 'Miejsca załadunku',
  users: 'Konta użytkowników',
  user_warehouses: 'Dostęp do magazynów',
  settings: 'Ustawienia systemu',
  periods: 'Okresy księgowe',
  attachments: 'Załączniki',
  corrections: 'Korekty dokumentów',
  database: 'Baza danych',
  reports: 'Raporty',
};

const AKCJE = {
  CREATE: 'Utworzenie',
  CREATE_CHAIN: 'Łańcuch operacji',
  UPDATE: 'Zmiana',
  DEACTIVATE: 'Wyłączenie',
  ACTIVATE: 'Przywrócenie',
  CANCEL: 'Storno',
  DELETE: 'Usunięcie',
  UPLOAD: 'Dodanie pliku',
  LOGIN: 'Logowanie',
  LOGOUT: 'Wylogowanie',
  LOGIN_FAILED: 'Nieudane logowanie',
  CHANGE_PASSWORD: 'Zmiana hasła',
  CLOSE_PERIOD: 'Zamknięcie okresu',
  REOPEN_PERIOD: 'Otwarcie okresu',
  BACKUP: 'Kopia zapasowa',
  EXPORT: 'Eksport danych',
  EXPORT_CSV: 'Eksport CSV',
  IMPORT: 'Import danych',
};

/** Akcje, które na liście mają wyglądać na ostrzeżenie, a nie na rutynę. */
const NIEPOKOJACE = /FAILED|CANCEL|DELETE|DEACTIVATE|REOPEN|IMPORT/;

const nazwaEncji = (e) => ENCJE[e] ?? e ?? '—';
const nazwaAkcji = (a) => AKCJE[a] ?? a;

export async function renderHistory(view, params = {}) {
  // Wejście z innego widoku: „pokaż historię TEGO dokumentu”.
  if (params.entity) state.entity = params.entity;
  if (params.id) state.entityId = params.id;
  view.innerHTML = loading('Wczytywanie historii zmian…');
  await refresh(view);
}

async function refresh(view) {
  let dane;
  try {
    if (!filtry) filtry = await api.get('/audit/filters');
    dane = await api.get('/audit', state);
  } catch (err) {
    toastError(err);
    view.innerHTML = pageHead('Historia zmian', 'Dziennik audytu')
      + `<div class="card"><div class="card-b">${empty('Nie udało się wczytać historii', err.message)}</div></div>`;
    return;
  }

  const zawezone = state.entityId || state.entity || state.userEmail || state.action
    || state.from || state.to || state.q;

  view.innerHTML = pageHead(
    'Historia zmian',
    'Kto, kiedy i co zmienił — wraz z wartością przed i po',
    `<button class="btn" data-act="print">${ICONS.print} Drukuj</button>`,
  )
  + printHeader({
    title: 'Historia zmian',
    scope: opisZakresu(),
    note: `Pozycji w zestawieniu: ${dane.items.length} z ${dane.total}`,
  })
  + `<div class="toolbar">
      <input type="search" id="hq" placeholder="Szukaj w treści zmiany, koncie, identyfikatorze…" value="${esc(state.q)}">
      <select id="hUser"><option value="">Każdy użytkownik</option>
        ${wybor(filtry.users, state.userEmail)}</select>
      <select id="hAction"><option value="">Każde zdarzenie</option>
        ${wybor(filtry.actions, state.action, nazwaAkcji)}</select>
      <select id="hEntity"><option value="">Każdy obszar</option>
        ${wybor(filtry.entities, state.entity, nazwaEncji)}</select>
      <label class="fld-inline">od <input type="date" id="hFrom" value="${esc(state.from)}"></label>
      <label class="fld-inline">do <input type="date" id="hTo" value="${esc(state.to)}"></label>
      ${zawezone ? '<button class="btn btn-sm" data-act="clear">Wyczyść filtry</button>' : ''}
      <span class="count-pill">${dane.total} zdarzeń</span>
    </div>`

  + (dane.items.length
    ? `<div class="card"><div class="card-b flush"><div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th>Kiedy</th><th>Kto</th><th>Zdarzenie</th><th>Czego dotyczy</th>
          <th>Co się zmieniło</th><th>Adres IP</th>
        </tr></thead>
        <tbody>${dane.items.map(wiersz).join('')}</tbody>
      </table></div></div></div>${pager({ total: dane.total, limit: state.limit, offset: state.offset })}`
    : `<div class="card"><div class="card-b">${empty('Brak zdarzeń dla tych filtrów',
        zawezone ? 'Poluzuj filtry albo wyczyść je w całości.'
          : 'Dziennik zapełni się przy pierwszej operacji w systemie.')}</div></div>`);

  on(view, 'click', '[data-page]', (el) => {
    state.offset = Math.max(0, state.offset + (el.dataset.page === 'next' ? state.limit : -state.limit));
    refresh(view);
  });
  on(view, 'click', '[data-act="print"]', () => window.print());
  on(view, 'click', '[data-act="clear"]', () => {
    Object.assign(state, { q: '', userEmail: '', action: '', entity: '', entityId: '', from: '', to: '', offset: 0 });
    refresh(view);
  });
  // Przejście do dokumentu, którego dotyczy wpis — kontrola zwykle chce
  // zobaczyć nie samą zmianę, tylko dokument w całości.
  on(view, 'click', '[data-doc]', (el) => navigate(`/operacje/${el.dataset.doc}`));

  for (const [id, pole] of [['hq', 'q'], ['hUser', 'userEmail'], ['hAction', 'action'],
    ['hEntity', 'entity'], ['hFrom', 'from'], ['hTo', 'to']]) {
    const el = view.querySelector(`#${id}`);
    const zmien = (e) => {
      state[pole] = e.target.value.trim();
      state.offset = 0;
      refresh(view);
    };
    el.addEventListener('change', zmien);
    if (el.type === 'search') el.addEventListener('search', zmien);
  }
}

const wybor = (lista, wybrane, etykieta = (v) => v) => lista
  .map((v) => `<option value="${esc(v)}"${v === wybrane ? ' selected' : ''}>${esc(etykieta(v))}</option>`)
  .join('');

/** Zakres wypisany słowami — trafia na wydruk, więc musi być zrozumiały sam. */
function opisZakresu() {
  const czesci = [];
  if (state.from || state.to) {
    czesci.push(`okres: ${state.from || 'początek'} – ${state.to || 'dziś'}`);
  } else {
    czesci.push('okres: cała historia');
  }
  if (state.userEmail) czesci.push(`użytkownik: ${state.userEmail}`);
  if (state.action) czesci.push(`zdarzenie: ${nazwaAkcji(state.action)}`);
  if (state.entity) czesci.push(`obszar: ${nazwaEncji(state.entity)}`);
  if (state.entityId) czesci.push(`obiekt: ${state.entityId}`);
  if (state.q) czesci.push(`szukane: „${state.q}”`);
  return czesci.join(' · ');
}

function wiersz(w) {
  const dokument = w.entity === 'operations' && w.entityId;
  return `<tr>
    <td style="white-space:nowrap;font-size:11.5px">${dateTime(w.timestamp)}</td>
    <td style="font-size:12px">${esc(w.user || 'system')}</td>
    <td><span class="tag ${NIEPOKOJACE.test(w.action) ? 'CANCELLED' : 'OPEN'}">${esc(nazwaAkcji(w.action))}</span></td>
    <td style="font-size:12px">
      ${esc(nazwaEncji(w.entity))}
      ${dokument
        ? `<br><button class="btn-link" data-doc="${esc(w.entityId)}">${esc(w.detail?.docNo || 'otwórz dokument')}</button>`
        : opisObiektu(w)}
    </td>
    <td>${opisZmian(w)}</td>
    <td style="font-family:var(--font-mono);font-size:10.5px;color:var(--ink-3)">${esc(w.ip || '—')}</td>
  </tr>`;
}

/** Nazwa własna obiektu, jeśli wpis ją niesie — czytelniejsza niż klucz. */
function opisObiektu(w) {
  const nazwa = w.detail?.pozycja ?? w.detail?.konto ?? w.detail?.magazyn ?? w.detail?.user;
  return nazwa ? `<br><span style="color:var(--ink-2)">${esc(nazwa)}</span>` : '';
}

/**
 * Kolumna „co się zmieniło”.
 *
 * Zdarzenia bez porównania stanów (logowanie, eksport, zamknięcie okresu)
 * niosą własne pola — pokazujemy je wprost, zamiast zostawiać pustą komórkę
 * albo wklejać surowy JSON, jak robił to poprzedni widok.
 */
function opisZmian(w) {
  if (w.changes.length) {
    return `<div class="zmiany">${w.changes.map((z) => `<div class="zmiana">
      <span class="z-pole">${esc(z.label)}</span>
      <span class="z-przed">${esc(wartosc(z.before))}</span>
      <span class="z-strzalka">→</span>
      <span class="z-po">${esc(wartosc(z.after))}</span>
    </div>`).join('')}</div>`;
  }
  if (w.detail) {
    return `<span style="font-size:11px;color:var(--ink-2)">${esc(
      Object.entries(w.detail).map(([k, v]) => `${k}: ${wartosc(v)}`).join(' · '),
    )}</span>`;
  }
  return '<span style="color:var(--ink-3)">—</span>';
}

/** Wartość pola w formie do czytania: pusto, lista, prawda/fałsz albo tekst. */
function wartosc(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'tak' : 'nie';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
