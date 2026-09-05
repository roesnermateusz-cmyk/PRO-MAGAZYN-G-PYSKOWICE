/**
 * Pamięć podręczna odpowiedzi w procesie serwera.
 *
 * PO CO
 * Raporty i stany magazynowe są wielokrotnie droższe w liczeniu niż w podaniu.
 * Pulpit odświeżany co kilka sekund przez pięć osób to pięć identycznych
 * przeliczeń tej samej minuty. Ten moduł liczy raz i podaje pozostałym.
 *
 * ZASADA NADRZĘDNA: POPRAWNOŚĆ PRZED TRAFIENIAMI
 * System magazynowy nie może pokazać nieaktualnego stanu — ani przez sekundę.
 * Dlatego wpis nie wygasa po czasie, tylko po **zdarzeniu**: zapis dokumentu
 * podbija generację dotkniętych tagów, a wpis oznaczony którymkolwiek z nich
 * przestaje być ważny natychmiast. Czas życia (TTL) jest wyłącznie
 * zabezpieczeniem na wypadek tagu, o którym ktoś zapomniał — nie mechanizmem
 * podstawowym.
 *
 * TRZY WARSTWY OCHRONY PRZED NIEAKTUALNOŚCIĄ
 *  1. Generacje tagów — zapis unieważnia dokładnie to, co dotknął.
 *  2. TTL — górna granica życia wpisu, gdyby tag został pominięty.
 *  3. `PRAGMA data_version` — wykrywa zapis wykonany przez INNE połączenie
 *     (przywrócenie kopii zapasowej, skrypt, drugi proces) i czyści całość.
 *     Bez tego pamięć podręczna przeżyłaby restore i podawała dane sprzed niego.
 *
 * CZEGO TU NIE MA
 * Nie ma współdzielenia między procesami. Przy jednym procesie Node (obecne
 * wdrożenie) to nie jest ograniczenie. Przejście na kilka procesów wymaga
 * podmiany tej implementacji na wspólny magazyn (Redis) — interfejs
 * (`get/set/wrap/bump`) jest tak dobrany, żeby zmiana nie sięgnęła serwisów.
 * Szczegóły w docs/SCALING.md.
 */
import logger from './logger.js';

/** Domyślny czas życia wpisu — zabezpieczenie, nie mechanizm główny. */
const DEFAULT_TTL_MS = 120_000;

/**
 * Górna granica liczby wpisów. Wartości to gotowe obiekty raportów
 * (kilkadziesiąt kB), więc limit trzyma zużycie pamięci w ryzach niezależnie
 * od tego, ile kombinacji filtrów przewinie się przez system.
 */
const DEFAULT_MAX_ENTRIES = 500;

/**
 * @typedef {object} CacheEntry
 * @property {any} value zapamiętana wartość
 * @property {number} expiresAt znacznik czasu wygaśnięcia
 * @property {Record<string, number>} tags generacje tagów z chwili zapisu
 */

export class Cache {
  /**
   * @param {object} [options]
   * @param {number} [options.ttlMs] domyślny czas życia wpisu
   * @param {number} [options.maxEntries] limit liczby wpisów
   * @param {() => number} [options.now] źródło czasu (podmieniane w testach)
   */
  constructor({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;

    /** @type {Map<string, CacheEntry>} kolejność wstawiania = kolejność wypierania */
    this.entries = new Map();
    /** @type {Map<string, number>} tag → numer generacji */
    this.generations = new Map();

    this.stats = { hits: 0, misses: 0, stale: 0, expired: 0, evicted: 0, flushes: 0, stores: 0 };
  }

  /** Bieżąca generacja tagu; nieznany tag zaczyna od zera. */
  generation(tag) {
    return this.generations.get(tag) ?? 0;
  }

  /**
   * Unieważnia wszystkie wpisy oznaczone podanymi tagami.
   * Koszt jest stały niezależnie od liczby wpisów — podbijamy licznik, nie
   * przeglądamy zawartości. Wpisy z nieaktualną generacją odpadają przy odczycie.
   *
   * @param {string[]|string} tags
   */
  bump(tags) {
    for (const tag of Array.isArray(tags) ? tags : [tags]) {
      this.generations.set(tag, this.generation(tag) + 1);
    }
  }

  /**
   * Odczyt. Zwraca `undefined`, gdy wpisu nie ma, wygasł albo któryś z jego
   * tagów zmienił generację od chwili zapisu.
   *
   * @param {string} key
   */
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) {
      this.stats.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      this.stats.expired += 1;
      this.stats.misses += 1;
      return undefined;
    }
    for (const [tag, generation] of Object.entries(entry.tags)) {
      if (this.generation(tag) !== generation) {
        this.entries.delete(key);
        this.stats.stale += 1;
        this.stats.misses += 1;
        return undefined;
      }
    }
    // Odświeżenie pozycji: ponowne wstawienie przesuwa wpis na koniec kolejki
    // wypierania, więc najczęściej czytane wpisy żyją najdłużej.
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.stats.hits += 1;
    return entry.value;
  }

  /**
   * Zapis wraz z tagami, po których wpis będzie unieważniany.
   *
   * @param {string} key
   * @param {any} value
   * @param {{tags?: string[], ttlMs?: number}} [options]
   */
  set(key, value, { tags = [], ttlMs = this.ttlMs } = {}) {
    const snapshot = {};
    for (const tag of tags) snapshot[tag] = this.generation(tag);

    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs, tags: snapshot });
    this.stats.stores += 1;

    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
      this.stats.evicted += 1;
    }
    return value;
  }

  /**
   * Odczyt z podliczeniem przy chybieniu — podstawowa forma użycia.
   *
   * Wartość liczona jest synchronicznie, więc nie ma tu wyścigu dwóch
   * równoległych przeliczeń („nawał”): pętla zdarzeń Node wykonuje `compute`
   * w całości, zanim obsłuży kolejne żądanie. Przy przejściu na obliczenia
   * asynchroniczne trzeba dołożyć rejestr trwających obliczeń.
   *
   * @param {string} key
   * @param {{tags?: string[], ttlMs?: number}} options
   * @param {() => any} compute
   */
  wrap(key, options, compute) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    return this.set(key, compute(), options);
  }

  /** Czyści zawartość, zachowując generacje tagów i statystyki. */
  flush(reason = 'ręcznie') {
    if (this.entries.size) logger.debug('Wyczyszczono pamięć podręczną', { reason, entries: this.entries.size });
    this.entries.clear();
    this.stats.flushes += 1;
  }

  /** Migawka do punktu metryk. */
  report() {
    const lookups = this.stats.hits + this.stats.misses;
    return {
      entries: this.entries.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
      tags: this.generations.size,
      hitRate: lookups ? Number((this.stats.hits / lookups).toFixed(4)) : null,
      ...this.stats,
    };
  }
}

/* ====================================================================== *
 *  Instancja aplikacyjna i słownik tagów
 * ====================================================================== */

/**
 * Tagi opisują OBSZARY DANYCH, nie punkty API. Dzięki temu serwis zapisujący
 * dokument nie musi wiedzieć, które raporty go czytają — podbija „stan
 * magazynowy” i „miesiąc 2026-09”, a każdy wpis dotknięty którymkolwiek
 * z nich znika sam.
 */
export const TAG = Object.freeze({
  /** Ruchy magazynowe: stany, kartoteka, raporty ilościowe. */
  STOCK: 'stock',
  /** Rejestr dokumentów: listy, wyszukiwanie, obroty. */
  DOCUMENTS: 'documents',
  /** Dowolna kartoteka — dla odczytów zależnych od wszystkich słowników. */
  CATALOG: 'catalog',
  /** Ustawienia systemowe (przeliczniki, reguły). */
  SETTINGS: 'settings',
  /** Okresy rozliczeniowe i migawki zamknięcia. */
  PERIODS: 'periods',
  /** Konta i uprawnienia. */
  USERS: 'users',
  /**
   * Zapis dotykający miesiąca WCZEŚNIEJSZEGO niż bieżący.
   *
   * Raport zamkniętego miesiąca jest z definicji niezmienny — do zamkniętego
   * okresu nie da się nic dopisać. Nie do końca jednak: bilans otwarcia takiego
   * raportu zależy od wszystkiego, co zdarzyło się przed nim, a kierownik może
   * zaksięgować dokument wstecz w miesiącu, który nigdy nie został zamknięty
   * (bo nie było w nim dokumentów). Wtedy raport sprzed lat naprawdę się zmienia.
   * Ten tag łapie dokładnie ten przypadek: rzadki, ale realny.
   */
  HISTORY: 'history',

  /** Tag miesiąca — zawęża unieważnienie do dotkniętego okresu. */
  month: (value) => `month:${value ?? '?'}`,
  /** Tag magazynu — raport jednego magazynu nie odpada przez zapis w innym. */
  warehouse: (value) => (value ? `warehouse:${value}` : 'warehouse:*'),
  /**
   * Tag pojedynczej kartoteki (`products`, `partners`, `warehouses`, …).
   *
   * Raport miesięczny pokazuje nazwy produktów, więc zależy od kartoteki
   * produktów — ale nie od kartoteki kontrahentów. Bez tego rozróżnienia
   * dopisanie nowego dostawcy przy okazji przyjęcia towaru unieważniałoby
   * raporty za wszystkie zamknięte lata.
   */
  catalog: (table) => `catalog:${table}`,
});

export const cache = new Cache();

/**
 * Buduje stabilny klucz z nazwy odczytu i jego parametrów.
 * Kolejność pól w obiekcie nie może wpływać na klucz, bo te same filtry
 * przysłane w innej kolejności to wciąż ten sam odczyt.
 *
 * UWAGA: klucz nie zawiera użytkownika — i nie może. Buforujemy wyłącznie
 * odczyty, których wynik nie zależy od tego, kto pyta. Gdyby kiedyś powstał
 * raport zawężany uprawnieniami, musi dostać własny klucz z rolą albo zostać
 * poza pamięcią podręczną. Inaczej pierwsza odpowiedź wyciekłaby wszystkim.
 *
 * @param {string} name nazwa odczytu (np. 'reports.monthly')
 * @param {object} params parametry po walidacji
 */
export function keyFor(name, params = {}) {
  const clean = {};
  for (const field of Object.keys(params).sort()) {
    if (params[field] !== undefined && params[field] !== null) clean[field] = params[field];
  }
  return `${name}|${JSON.stringify(clean)}`;
}

/**
 * Unieważnienie po zapisie dokumentu.
 * Wołane PO zatwierdzeniu transakcji — unieważnienie przed zatwierdzeniem
 * pozwoliłoby odczytowi wpuścić z powrotem dane, których zapis jeszcze nie
 * utrwalił. Nadmiarowe unieważnienie jest bezpieczne, przedwczesne nie jest.
 *
 * @param {{month?: string, months?: string[], warehouseIds?: (string|null)[]}} scope
 */
export function invalidateDocument({ month, months = [], warehouseIds = [] } = {}) {
  const tags = [TAG.STOCK, TAG.DOCUMENTS];
  const touched = [month, ...months].filter(Boolean);
  const thisMonth = new Date().toISOString().slice(0, 7);

  for (const m of touched) {
    tags.push(TAG.month(m));
    // Zapis wstecz może zmienić bilans otwarcia raportów za miesiące późniejsze,
    // także tych już zamkniętych. Zapis w miesiącu bieżącym — nie może.
    if (m < thisMonth) tags.push(TAG.HISTORY);
  }
  for (const w of warehouseIds) if (w) tags.push(TAG.warehouse(w));
  // Raporty bez filtra magazynu muszą odpaść przy zapisie w dowolnym magazynie.
  tags.push(TAG.warehouse(null));
  cache.bump(tags);
}

export default cache;
