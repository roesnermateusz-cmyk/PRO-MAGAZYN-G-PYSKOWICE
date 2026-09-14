/**
 * Kontekst pracy: aktywny magazyn.
 *
 * Firma ma kilka placów składowych. Praca „we wszystkich naraz” brzmi wygodnie,
 * ale w praktyce prowadzi do pomyłek: magazynier wpisuje dokument, nie patrzy na
 * pole magazynu, i towar ląduje na cudzym placu. Dlatego użytkownik wybiera
 * jeden plac i pracuje w nim, tak samo jak wybiera miesiąc na pulpicie.
 *
 * Kto ma dostęp do więcej niż jednego placu, może przełączyć się w każdej
 * chwili albo wybrać „wszystkie” — wtedy widzi obrót ze wszystkich swoich
 * magazynów naraz, co przydaje się kierownikowi i księgowości.
 *
 * Wybór jest zapamiętywany w przeglądarce, ale **nie jest uprawnieniem**:
 * serwer i tak sprawdza przy każdym żądaniu, czy użytkownik ma prawo do
 * wskazanego placu. Podmiana wartości w przeglądarce niczego nie otwiera.
 */
const KEY = 'resinvest.warehouse';

/**
 * Stan kontekstu mieszka w tym module, a nie w `core/store.js`, z jednego
 * powodu: klient API musi znać aktywny magazyn, a `store` zależy od klienta.
 * Trzymanie go tutaj rozcina zależność cykliczną i zostawia ten moduł liściem
 * grafu importów — bez importów własnych.
 */
const stan = { warehouses: [], warehouseId: null };

/**
 * Ścieżki API, które rozumieją filtr magazynu.
 *
 * Lista jest jawna, a nie „wszystko z wyjątkiem”. Dorzucenie parametru tam,
 * gdzie nie ma znaczenia, rozbija klucze pamięci podręcznej na serwerze —
 * ten sam raport liczyłby się osobno dla każdego placu bez powodu.
 */
const SCOPED = /^\/(operations|stock|reports\/(dashboard|monthly|production-day|transport|partners|certification))(\/|$|\?)/;

/** Klucz aktywnego magazynu albo `null` dla „wszystkie moje”. */
export const activeWarehouseId = () => stan.warehouseId ?? null;

/** Aktywny magazyn jako obiekt z listy dostępnych. */
export const activeWarehouse = () =>
  stan.warehouses.find((w) => w.id === stan.warehouseId) ?? null;

/** Magazyny, w których zalogowany może pracować. */
export const availableWarehouses = () => stan.warehouses;

/**
 * Wczytuje listę magazynów użytkownika i ustala aktywny.
 *
 * Zapamiętany wybór jest sprawdzany wobec bieżącej listy: po odebraniu dostępu
 * albo zamknięciu placu wskazanie przestaje być ważne i wraca do „wszystkie”.
 */
export async function loadWarehouses(api) {
  const { items } = await api.get('/warehouses/mine');
  stan.warehouses = items;

  const zapamietany = localStorage.getItem(KEY);
  const wazny = items.some((w) => w.id === zapamietany);
  stan.warehouseId = wazny ? zapamietany : null;

  // Jeden plac w zasięgu to nie jest wybór — ustawiamy go na sztywno,
  // żeby dokumenty miały właściwy magazyn bez pytania użytkownika o oczywistość.
  if (!stan.warehouseId && items.length === 1) stan.warehouseId = items[0].id;

  if (!wazny && zapamietany) localStorage.removeItem(KEY);
  return items;
}

/** Ustawia aktywny magazyn. `null` = wszystkie dostępne. */
export function setActiveWarehouse(id) {
  stan.warehouseId = id || null;
  if (stan.warehouseId) localStorage.setItem(KEY, stan.warehouseId);
  else localStorage.removeItem(KEY);
}

/** Czyści kontekst przy wylogowaniu — kolejny użytkownik zaczyna od swojego. */
export function clearWarehouseContext() {
  stan.warehouses = [];
  stan.warehouseId = null;
}

/**
 * Dokłada filtr magazynu do zapytania, jeśli ścieżka go rozumie.
 *
 * Jawny filtr z widoku ma pierwszeństwo: kartoteka magazynowa potrafi pokazać
 * konkretny plac niezależnie od kontekstu pracy.
 *
 * @param {string} path ścieżka względem `/api/v1`
 * @param {object|undefined} query
 */
export function applyWarehouse(path, query) {
  if (!stan.warehouseId || !SCOPED.test(path)) return query;
  // Liczy się WARTOŚĆ, nie sama obecność klucza: widoki trzymają komplet
  // filtrów z pustymi łańcuchami, więc `warehouseId: ''` znaczy „nie wybrano”,
  // a nie „wybrano nic”. Sprawdzanie `!== undefined` wyłączało tu kontekst
  // pracy na całym rejestrze dokumentów.
  if (query && query.warehouseId) return query;
  return { ...(query ?? {}), warehouseId: stan.warehouseId };
}
