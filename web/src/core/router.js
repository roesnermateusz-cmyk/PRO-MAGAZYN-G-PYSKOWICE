/**
 * Router oparty na fragmencie adresu (`#/operacje/123?tab=x`).
 *
 * Wybór hash-routingu jest celowy: aplikację można otworzyć wprost z pliku,
 * z podkatalogu albo zza dowolnego proxy, bez konfiguracji przepisywania URL.
 */

const routes = new Map();
let notFound = null;
let beforeEach = null;

/**
 * Rejestruje widok.
 * @param {string} id identyfikator trasy (`operacje`)
 * @param {(view:HTMLElement, params:object) => Promise<void>|void} handler
 */
export function route(id, handler) {
  routes.set(id, handler);
}

export function setNotFound(handler) { notFound = handler; }

/** Hook wywoływany przed każdą nawigacją; zwrócenie `false` przerywa ją. */
export function setGuard(fn) { beforeEach = fn; }

/** Rozkłada `#/operacje/123?tab=x` na `{ id, params }`. */
export function parseHash(hash = window.location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(queryPart || ''));
  if (segments[1]) params.id = decodeURIComponent(segments[1]);
  return { id: segments[0] || 'pulpit', params };
}

/** Przechodzi pod wskazaną ścieżkę (`/operacje/123`). */
export function navigate(path) {
  const target = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (window.location.hash === target) resolve();
  else window.location.hash = target;
}

/** Wymusza ponowne wyrenderowanie bieżącego widoku. */
export const reload = () => resolve();

async function resolve() {
  const { id, params } = parseHash();

  if (beforeEach && (await beforeEach(id, params)) === false) return;

  const view = document.getElementById('view');
  if (!view) return;

  const handler = routes.get(id) ?? notFound;
  if (!handler) return;

  try {
    await handler(view, params);
    window.scrollTo(0, 0);
  } catch (err) {
    // Błąd widoku nie może wywrócić całej aplikacji — pokazujemy go w miejscu widoku.
    view.innerHTML = `<div class="card"><div class="card-b">
      <div class="alert danger">
        <div>
          <b>Nie udało się otworzyć widoku.</b><br>
          ${escapeHtml(err?.message || String(err))}
        </div>
      </div>
      <button class="btn" onclick="location.reload()">Odśwież stronę</button>
    </div></div>`;
    console.error('Błąd widoku', err);
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

let listening = false;

/**
 * Uruchamia router (nasłuch zmian adresu + pierwsze rozwiązanie trasy).
 * Wywołanie jest idempotentne — aplikacja startuje ponownie po zalogowaniu
 * i po zmianie hasła, a nasłuch może być podpięty tylko raz.
 */
export function startRouter() {
  if (!listening) {
    window.addEventListener('hashchange', resolve);
    listening = true;
  }
  resolve();
}
