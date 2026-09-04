/**
 * Rejestr pól dokumentu magazynowego — jedno źródło prawdy.
 *
 * PROBLEM, KTÓRY TO ROZWIĄZUJE
 * Wcześniej opis jednego pola był rozsypany po pięciu równoległych strukturach:
 * schemacie walidacji, mapie etykiet, liście kolumn INSERT-a, mapowaniu na API
 * i mapowaniu odwrotnym. Dodanie kolumny wymagało do dziesięciu spójnych zmian
 * w jednym pliku — i cicho psuło się przy pominięciu którejkolwiek.
 *
 * Tutaj pole opisane jest raz, a wszystkie te struktury są z tego opisu
 * wyprowadzane. Dodanie pola = jeden wpis poniżej + kolumna w migracji.
 *
 * ZNACZENIE WŁAŚCIWOŚCI
 *   api      nazwa w API i w formularzu (camelCase)
 *   col      kolumna w bazie (snake_case)
 *   label    etykieta w rejestrze korekt — czytana przez kontrolera
 *   rule     reguła walidacji; brak = pole wyliczane, nie przyjmowane z wejścia
 *   fallback wartość, gdy nie ma jej ani w żądaniu, ani w dokumencie edytowanym
 *   derived  wyliczane przez silnik (ilości, wartości, przeliczniki) —
 *            nie jest przenoszone z wejścia i nie wraca w `toInput`
 *   toApi    konwersja wartości z bazy na postać API (np. 0/1 → boolean)
 *   internal nie pojawia się w odpowiedzi API (klucze obce kontrahentów)
 */
import { OPERATION_TYPES } from './documents.js';
import { UNITS, MODES } from './units.js';

/** @typedef {{api:string, col:string, label:string, rule?:object, fallback?:any,
 *             derived?:boolean, toApi?:(v:any)=>any, internal?:boolean}} OperationField */

/** @type {OperationField[]} */
export const OPERATION_FIELDS = [
  /* --- Klasyfikacja --- */
  { api: 'type', col: 'type', label: 'Typ operacji',
    rule: { type: 'enum', values: OPERATION_TYPES, required: true } },

  /* --- Daty --- */
  { api: 'operationDate', col: 'operation_date', label: 'Data operacji',
    rule: { type: 'date', required: true } },
  { api: 'loadingDate', col: 'loading_date', label: 'Data załadunku',
    rule: { type: 'date' }, fallback: null },

  /* --- Towar --- */
  { api: 'productId', col: 'product_id', label: 'Produkt',
    rule: { type: 'string', max: 40, label: 'Produkt (kartoteka)' } },
  { api: 'productName', col: 'product_name', label: 'Produkt',
    rule: { type: 'string', max: 120 } },
  { api: 'grade', col: 'grade', label: 'Rodzaj',
    rule: { type: 'string', max: 10, upper: true, label: 'Rodzaj (A/B)' }, fallback: null },

  /* --- Ilości: wejście użytkownika --- */
  { api: 'quantity', col: 'quantity', label: 'Wolumen',
    rule: { type: 'number', required: true, min: 0.001, max: 1_000_000 } },
  { api: 'unit', col: 'unit', label: 'Jednostka',
    rule: { type: 'enum', values: UNITS, required: true } },

  /* --- Ilości: tryby nadpisania wartościami rzeczywistymi --- */
  { api: 'm3Mode', col: 'm3_mode', label: 'Sposób ustalenia m³',
    rule: { type: 'enum', values: MODES, default: 'AUTO', label: 'Tryb m³' }, fallback: 'AUTO' },
  { api: 'm3Manual', col: 'm3_manual', label: 'Rzeczywiste m³',
    rule: { type: 'number', min: 0, max: 1_000_000 }, fallback: null },
  { api: 'mpMode', col: 'mp_mode', label: 'Sposób ustalenia MP',
    rule: { type: 'enum', values: MODES, default: 'AUTO', label: 'Tryb MP' }, fallback: 'AUTO' },
  { api: 'mpManual', col: 'mp_manual', label: 'Rzeczywiste MP',
    rule: { type: 'number', min: 0, max: 1_000_000 }, fallback: null },
  { api: 'tonneMode', col: 'tonne_mode', label: 'Sposób ustalenia ton',
    rule: { type: 'enum', values: MODES, default: 'AUTO', label: 'Tryb ton' }, fallback: 'AUTO' },
  { api: 'tonneManual', col: 'tonne_manual', label: 'Masa rzeczywista',
    rule: { type: 'number', min: 0, max: 1_000_000 }, fallback: null },

  /* --- Ilości: wynik przeliczenia (wyliczane przez silnik jednostek) --- */
  { api: 'qtyM3', col: 'qty_m3', label: 'Ilość m³', derived: true },
  { api: 'qtyMp', col: 'qty_mp', label: 'Ilość MP', derived: true },
  { api: 'qtyTonne', col: 'qty_tonne', label: 'Masa (t)', derived: true },
  { api: 'energyGj', col: 'energy_gj', label: 'Energia (GJ)', derived: true },

  /* --- Przeliczniki użyte przy księgowaniu (gwarancja niezmienności historii) --- */
  { api: 'factorM3Mp', col: 'factor_m3_mp', label: 'Przelicznik m³ → MP', derived: true, internal: true },
  { api: 'factorMpTonne', col: 'factor_mp_tonne', label: 'Przelicznik MP → tona', derived: true, internal: true },
  { api: 'factorTonneGj', col: 'factor_tonne_gj', label: 'Przelicznik tona → GJ', derived: true, internal: true },

  /* --- Strony operacji --- */
  { api: 'warehouseFromId', col: 'warehouse_from_id', label: 'Magazyn źródłowy',
    rule: { type: 'string', max: 40 } },
  { api: 'warehouseToId', col: 'warehouse_to_id', label: 'Magazyn docelowy',
    rule: { type: 'string', max: 40 } },
  { api: 'partnerFromId', col: 'partner_from_id', label: 'Dostawca (kartoteka)',
    derived: true, internal: true },
  { api: 'partnerToId', col: 'partner_to_id', label: 'Odbiorca (kartoteka)',
    derived: true, internal: true },
  { api: 'supplierName', col: 'supplier_name', label: 'Dostawca / źródło',
    rule: { type: 'string', max: 160 }, fallback: null },
  { api: 'recipientName', col: 'recipient_name', label: 'Odbiorca / cel',
    rule: { type: 'string', max: 160 }, fallback: null },

  /* --- Pochodzenie surowca (KZR / SURE) --- */
  { api: 'loadingPlace', col: 'loading_place', label: 'Miejsce załadunku',
    rule: { type: 'string', max: 160 }, fallback: null },
  { api: 'originPlace', col: 'origin_place', label: 'Miejsce pochodzenia',
    rule: { type: 'string', max: 160 }, fallback: null },
  { api: 'forestDistrict', col: 'forest_district', label: 'Nadleśnictwo',
    rule: { type: 'string', max: 120 }, fallback: null },
  { api: 'forestRange', col: 'forest_range', label: 'Leśnictwo',
    rule: { type: 'string', max: 120 }, fallback: null },
  { api: 'haulageNoteNo', col: 'haulage_note_no', label: 'Nr kwitu wywozowego',
    rule: { type: 'string', max: 60 }, fallback: null },

  /* --- Wartości --- */
  { api: 'pricePurchase', col: 'price_purchase', label: 'Cena zakupu / produkcji',
    rule: { type: 'number', min: 0, max: 1_000_000, default: 0 }, fallback: 0, money: true },
  { api: 'priceSale', col: 'price_sale', label: 'Cena sprzedaży',
    rule: { type: 'number', min: 0, max: 1_000_000, default: 0 }, fallback: 0, money: true },
  { api: 'valuePurchase', col: 'value_purchase', label: 'Wartość zakupu', derived: true },
  { api: 'valueSale', col: 'value_sale', label: 'Wartość sprzedaży', derived: true },
  { api: 'chippingMode', col: 'chipping_mode', label: 'Rąbanie',
    rule: { type: 'string', max: 40 }, fallback: null },
  { api: 'chippingPrice', col: 'chipping_price', label: 'Stawka rąbania',
    rule: { type: 'number', min: 0, max: 1_000_000, default: 0 }, fallback: 0, money: true },
  { api: 'chippingCost', col: 'chipping_cost', label: 'Koszt rąbania', derived: true },

  /* --- Transport --- */
  { api: 'carrierName', col: 'carrier_name', label: 'Firma transportowa',
    rule: { type: 'string', max: 160, label: 'Firma transportowa / kierowca' }, fallback: null },
  { api: 'vehiclePlate', col: 'vehicle_plate', label: 'Nr rejestracyjny',
    rule: { type: 'string', max: 20, upper: true }, fallback: null },
  { api: 'distanceKm', col: 'distance_km', label: 'Odległość (km)',
    rule: { type: 'number', min: 0, max: 100_000, default: 0 }, fallback: 0 },
  { api: 'transportCost', col: 'transport_cost', label: 'Koszt transportu',
    rule: { type: 'number', min: 0, max: 10_000_000, default: 0 }, fallback: 0, money: true },

  /* --- Zgodność --- */
  { api: 'certificate', col: 'certificate', label: 'Certyfikat',
    rule: { type: 'string', max: 20, upper: true, default: 'BRAK' }, fallback: 'BRAK' },
  { api: 'isStored', col: 'is_stored', label: 'Magazynowane',
    rule: { type: 'bool', default: true }, fallback: true, toApi: (v) => !!v },

  /* --- Powiązania i opis --- */
  { api: 'chainRef', col: 'chain_ref', label: 'Powiązanie łańcucha',
    rule: { type: 'string', max: 40 }, fallback: null },
  { api: 'parentId', col: 'parent_id', label: 'Dokument nadrzędny',
    rule: { type: 'string', max: 40 }, fallback: null },
  { api: 'notes', col: 'notes', label: 'Uwagi',
    rule: { type: 'string', max: 2000 }, fallback: null },
  { api: 'signature', col: 'signature', label: 'Podpis zatwierdzającego',
    rule: { type: 'string', max: 120, label: 'Podpis zatwierdzającego' } },
];

/**
 * Pola przyjmowane z wejścia, które nie są kolumnami — wygodne aliasy dla
 * klienta. Magazyn wskazuje się nazwą (tak wypełnia się formularz w terenie),
 * a serwis zamienia ją na klucz kartoteki.
 */
export const INPUT_ALIASES = Object.freeze({
  warehouseFrom: { type: 'string', max: 120, label: 'Magazyn źródłowy' },
  warehouseTo: { type: 'string', max: 120, label: 'Magazyn docelowy' },
});

/* ------------------- Struktury wyprowadzone z rejestru ------------------- */

/** Schemat walidacji żądania — pola z rejestru plus aliasy wejściowe. */
export const OPERATION_SCHEMA = Object.freeze({
  ...Object.fromEntries(
    OPERATION_FIELDS
      .filter((f) => f.rule)
      .map((f) => [f.api, { label: f.label, ...f.rule }]),
  ),
  ...INPUT_ALIASES,
});

/** Etykiety kolumn dla rejestru korekt (kolumna bazy → nazwa czytelna). */
export const FIELD_LABELS = Object.freeze(Object.fromEntries(
  OPERATION_FIELDS.map((f) => [f.col, f.label]),
));

/** Kolumny zapisywane przy tworzeniu dokumentu (bez metryki i numeru). */
export const CONTENT_COLUMNS = Object.freeze(OPERATION_FIELDS.map((f) => f.col));

/** Kolumny nadawane przez system przy księgowaniu. */
export const DOCUMENT_COLUMNS = Object.freeze(['id', 'doc_no', 'doc_series', 'doc_year', 'doc_number']);

/** Pola przenoszone z dokumentu do formularza (odtworzenie stanu z korekty). */
const INPUT_FIELDS = OPERATION_FIELDS.filter((f) => f.rule && !f.derived);

/** Pola kwotowe — zaokrąglane do groszy przed zapisem. */
export const MONEY_FIELDS = Object.freeze(OPERATION_FIELDS.filter((f) => f.money).map((f) => f.api));

/** Indeks rejestru po nazwie API — dla kodu składającego wiersz zapisu. */
export const FIELD_BY_API = Object.freeze(Object.fromEntries(OPERATION_FIELDS.map((f) => [f.api, f])));

const BY_API = new Map(OPERATION_FIELDS.map((f) => [f.api, f]));

/* ----------------------------- Mapowania ------------------------------- */

/**
 * Wiersz bazy → obiekt API.
 * Pola techniczne (klucze obce kartotek, przeliczniki) nie wychodzą pojedynczo —
 * przeliczniki wracają zgrupowane w `factors`, tak jak dotąd.
 *
 * @param {object} row wiersz `operations`, opcjonalnie z aliasami złączeń
 */
export function rowToApi(row) {
  const out = {
    id: row.id,
    docNo: row.doc_no,
    docSeries: row.doc_series,
    status: row.status,
    operationMonth: row.operation_month,
  };

  for (const f of OPERATION_FIELDS) {
    if (f.internal) continue;
    out[f.api] = f.toApi ? f.toApi(row[f.col]) : row[f.col];
  }

  // Wartości złożone i pochodzące ze złączeń.
  out.factors = {
    m3ToMp: row.factor_m3_mp,
    mpToTonne: row.factor_mp_tonne,
    tonneToGj: row.factor_tonne_gj,
  };
  out.warehouseFrom = row.warehouse_from_name ?? null;
  out.warehouseTo = row.warehouse_to_name ?? null;

  // Metryka dokumentu.
  out.revision = row.revision;
  out.createdAt = row.created_at;
  out.createdBy = row.created_by_name ?? row.created_by;
  out.updatedAt = row.updated_at;
  out.cancelledAt = row.cancelled_at;
  out.cancelReason = row.cancel_reason;

  return out;
}

/**
 * Wiersz bazy → dane wejściowe formularza.
 * Używane przy przywracaniu stanu sprzed korekty, dlatego musi obejmować
 * wszystko, co użytkownik mógł zmienić — łącznie z magazynami (po kluczach,
 * bez zbędnego rozwiązywania nazw).
 */
export function rowToInput(row) {
  const out = {};
  for (const f of INPUT_FIELDS) {
    out[f.api] = f.toApi ? f.toApi(row[f.col]) : row[f.col];
  }
  return out;
}

/**
 * Wartość pola przy zapisie: żądanie → dokument edytowany → wartość domyślna.
 * Zastępuje trzydzieści powtórzeń wzorca `d.x ?? existing?.x_y ?? default`.
 *
 * @param {object} input dane po walidacji
 * @param {object|null} existing edytowany dokument (wiersz bazy) lub `null`
 * @param {string} api nazwa pola w API
 */
export function carry(input, existing, api) {
  const f = BY_API.get(api);
  if (!f) throw new Error(`Nieznane pole dokumentu: ${api}`);
  if (input[api] !== undefined) return input[api];
  if (existing && existing[f.col] !== undefined && existing[f.col] !== null) {
    return f.toApi ? f.toApi(existing[f.col]) : existing[f.col];
  }
  return f.fallback;
}
