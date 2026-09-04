/**
 * Punkt wejścia aplikacji klienckiej.
 *
 * Odpowiada za: odtworzenie sesji, wybór ekranu (logowanie / zmiana hasła /
 * aplikacja), montaż szkieletu i rejestrację tras.
 */
import { onUnauthorized } from './core/api.js';
import { store, loadMeta, restoreSession, logout, can } from './core/store.js';
import { route, setNotFound, setGuard, startRouter, navigate, parseHash } from './core/router.js';
import { renderLayout, setActiveNav, NAV } from './components/layout.js';
import { toast, empty, pageHead, closeModal } from './core/ui.js';

import { renderLogin, renderPasswordChange } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import { renderOperations } from './views/operations.js';
import { renderOperationForm } from './views/operation-form.js';
import { renderStock } from './views/stock.js';
import { renderProduction } from './views/production.js';
import { renderReports } from './views/reports.js';
import { renderCorrections } from './views/corrections.js';
import { renderCatalog } from './views/catalog.js';
import { renderPeriods } from './views/periods.js';
import { renderUsers } from './views/users.js';
import { renderSettings } from './views/settings.js';

const root = document.getElementById('root');

/* ------------------------------- Trasy -------------------------------- */

function registerRoutes() {
  route('pulpit', renderDashboard);
  route('operacje', renderOperations);
  route('nowa', renderOperationForm);
  route('magazyn', renderStock);
  route('produkcja', renderProduction);
  route('raporty', renderReports);
  route('korekty', renderCorrections);
  route('kartoteki', renderCatalog);
  route('okresy', renderPeriods);
  route('uzytkownicy', renderUsers);
  route('ustawienia', renderSettings);
  // Zmiana hasła zajmuje cały ekran (poza szkieletem), więc po zapisaniu
  // wracamy na ustawienia i odbudowujemy układ aplikacji.
  route('zmiana-hasla', () => renderPasswordChange(root, () => {
    window.location.hash = '#/ustawienia';
    startApp();
  }));

  setNotFound((view) => {
    view.innerHTML = pageHead('Nie znaleziono strony', 'Błędny adres')
      + `<div class="card"><div class="card-b">${empty(
        'Taka strona nie istnieje', 'Skorzystaj z menu po lewej stronie albo wróć na pulpit.')}
        <div style="text-align:center"><a class="btn btn-primary" href="#/pulpit">Wróć na pulpit</a></div>
      </div></div>`;
  });

  /* Strażnik: blokuje wejście na widok bez uprawnienia. */
  setGuard((id) => {
    closeModal();
    const nav = NAV.find((n) => n.id === id);
    if (nav?.perm && !can(nav.perm)) {
      toast('Twoja rola nie ma dostępu do tego widoku', 'err');
      navigate('/pulpit');
      return false;
    }
    setActiveNav(id);
    return true;
  });
}

/* ---------------------------- Cykl życia ------------------------------ */

/** Montuje pełną aplikację dla zalogowanego użytkownika. */
function startApp() {
  if (store.user?.mustChangePassword) {
    renderPasswordChange(root, () => {
      store.user.mustChangePassword = false;
      startApp();
    });
    return;
  }

  renderLayout(root);
  bindGlobalTools();

  // Pierwsza dostępna trasa jako cel domyślny (np. audytor bez pulpitu).
  const { id } = parseHash();
  const known = NAV.some((n) => n.id === id && (!n.perm || can(n.perm)));
  if (!known && !['zmiana-hasla'].includes(id)) {
    const first = NAV.find((n) => n.id && (!n.perm || can(n.perm)));
    window.location.hash = `#/${first?.id ?? 'pulpit'}`;
  }
  startRouter();
}

/** Ekran logowania. */
function showLogin() {
  renderLogin(root, () => startApp());
}

function bindGlobalTools() {
  root.querySelector('[data-tool="home"]')?.addEventListener('click', () => navigate('/pulpit'));
  root.querySelector('[data-tool="print"]')?.addEventListener('click', () => window.print());
  root.querySelector('[data-tool="logout"]')?.addEventListener('click', async () => {
    await logout();
    showLogin();
  });
  bindMoreSheet();
}

/**
 * Panel „Więcej” — pełna nawigacja na telefonie.
 * Zamyka się po wyborze pozycji, kliknięciu tła i klawiszem Escape.
 */
function bindMoreSheet() {
  const sheet = root.querySelector('#moresheet');
  const back = root.querySelector('#moreback');
  const button = root.querySelector('[data-tool="more"]');
  if (!sheet || !back || !button) return;

  const setOpen = (open) => {
    sheet.hidden = !open;
    back.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('sheet-open', open);
  };

  button.addEventListener('click', () => setOpen(sheet.hidden));
  back.addEventListener('click', () => setOpen(false));
  sheet.querySelector('[data-tool="more-close"]')?.addEventListener('click', () => setOpen(false));
  sheet.addEventListener('click', (e) => { if (e.target.closest('a[href]')) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
}

/* ------------------------------- Start -------------------------------- */

async function boot() {
  registerRoutes();

  // Utrata sesji w dowolnym momencie sprowadza użytkownika na ekran logowania.
  onUnauthorized(() => {
    store.user = null;
    showLogin();
  });

  try {
    await loadMeta();
  } catch {
    root.innerHTML = `<div class="login-wrap"><div class="login-box">
      <div class="login-card">
        <div class="alert danger"><div>
          <b>Brak połączenia z serwerem.</b><br>
          Sprawdź, czy usługa ResInvest ERP jest uruchomiona, a następnie odśwież stronę.
        </div></div>
        <button class="btn btn-block" onclick="location.reload()">Spróbuj ponownie</button>
      </div>
    </div></div>`;
    return;
  }

  const user = await restoreSession();
  if (user) startApp();
  else showLogin();
}

boot();
