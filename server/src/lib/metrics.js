/**
 * Liczniki pracy serwera — podstawa do oceny, czy system nadąża.
 *
 * PO CO
 * „Działa wolno” to nie jest zgłoszenie, z którym da się cokolwiek zrobić.
 * Te liczniki zamieniają je w zdanie sprawdzalne: która trasa, jak długo,
 * jak często i czy pamięć podręczna faktycznie pomaga. Bez nich każda decyzja
 * o dalszej optymalizacji byłaby zgadywaniem.
 *
 * CZEGO TU NIE MA
 * Nie ma pełnych histogramów ani eksportu do systemu monitoringu. Dla wdrożenia
 * on-premise u jednej firmy wystarczy licznik, suma i maksimum na trasę —
 * mediana i tak byłaby liczona z próbki zbyt małej, żeby coś znaczyła.
 * Przy przejściu na kilka procesów te liczniki zastąpi zewnętrzny zbieracz
 * (Prometheus), a kształt punktu `/admin/metrics` pozostanie ten sam.
 */

/** Ile tras pamiętamy. Wzorce tras są policzalne, ale limit chroni przed wyciekiem. */
const MAX_ROUTES = 200;

const routes = new Map();
const startedAt = Date.now();

let requests = 0;
let errors = 0;

/**
 * Zapisuje wynik obsłużonego żądania.
 *
 * Kluczem jest WZORZEC trasy (`/operations/:id`), nie konkretna ścieżka —
 * inaczej każdy identyfikator dokumentu założyłby własny licznik i statystyka
 * rozsypałaby się na tysiąc jednoelementowych próbek.
 *
 * @param {string} method metoda HTTP
 * @param {string} pattern wzorzec dopasowanej trasy
 * @param {number} status kod odpowiedzi
 * @param {number} ms czas obsługi w milisekundach
 */
export function recordRequest(method, pattern, status, ms) {
  requests += 1;
  if (status >= 500) errors += 1;

  const key = `${method} ${pattern}`;
  let entry = routes.get(key);
  if (!entry) {
    if (routes.size >= MAX_ROUTES) return;
    entry = { count: 0, totalMs: 0, maxMs: 0, errors: 0 };
    routes.set(key, entry);
  }
  entry.count += 1;
  entry.totalMs += ms;
  if (ms > entry.maxMs) entry.maxMs = ms;
  if (status >= 500) entry.errors += 1;
}

/**
 * Migawka liczników.
 * @param {{slowest?: number}} [options] ile najwolniejszych tras wypisać
 */
export function metricsReport({ slowest = 15 } = {}) {
  const list = [...routes.entries()].map(([route, e]) => ({
    route,
    count: e.count,
    avgMs: Number((e.totalMs / e.count).toFixed(2)),
    maxMs: Number(e.maxMs.toFixed(2)),
    errors: e.errors,
  }));

  return {
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    requests,
    errors,
    routes: list.sort((a, b) => b.avgMs - a.avgMs).slice(0, slowest),
  };
}

/** Zeruje liczniki (testy, ręczne rozpoczęcie pomiaru). */
export function resetMetrics() {
  routes.clear();
  requests = 0;
  errors = 0;
}
