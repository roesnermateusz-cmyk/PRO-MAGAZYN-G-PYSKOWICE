/**
 * Eksport rejestru dokumentów do CSV.
 *
 * Mieszkał wcześniej w module kopii zapasowych i ciągnął stamtąd
 * `listOperations`, przez co moduły `operations` i `backup` zależały od
 * siebie wzajemnie (`operations.routes → backup.service → operations.service`).
 * Eksport rejestru jest czynnością rejestru, nie kopii zapasowej — kopia
 * zapasowa zrzuca całą bazę, a to wysyła księgowej listę zgodną z filtrem,
 * który ma akurat ustawiony na ekranie.
 *
 * Kolumny są tu opisane raz i w kolejności, w jakiej mają wyjść w arkuszu.
 */
import { toCsv } from '../../lib/csv.js';
import { audit } from '../../middleware/audit.js';
import { listOperations } from './operations.service.js';

const CSV_COLUMNS = [
  { key: 'operationDate', label: 'Data operacji' },
  { key: 'docNo', label: 'Nr dokumentu' },
  { key: 'type', label: 'Typ' },
  { key: 'status', label: 'Status' },
  { key: 'productName', label: 'Produkt' },
  { key: 'grade', label: 'Rodzaj' },
  { key: 'quantity', label: 'Wolumen' },
  { key: 'unit', label: 'Jednostka' },
  { key: 'qtyM3', label: 'm3' },
  { key: 'qtyMp', label: 'MP' },
  { key: 'qtyTonne', label: 'Tony' },
  { key: 'energyGj', label: 'GJ' },
  { key: 'warehouseFrom', label: 'Magazyn źródłowy' },
  { key: 'warehouseTo', label: 'Magazyn docelowy' },
  { key: 'supplierName', label: 'Dostawca' },
  { key: 'recipientName', label: 'Odbiorca' },
  { key: 'forestDistrict', label: 'Nadleśnictwo' },
  { key: 'forestRange', label: 'Leśnictwo' },
  { key: 'haulageNoteNo', label: 'Nr kwitu wywozowego' },
  { key: 'loadingPlace', label: 'Miejsce załadunku' },
  { key: 'pricePurchase', label: 'Cena zakupu' },
  { key: 'valuePurchase', label: 'Wartość zakupu' },
  { key: 'priceSale', label: 'Cena sprzedaży' },
  { key: 'valueSale', label: 'Wartość sprzedaży' },
  { key: 'chippingMode', label: 'Rąbanie' },
  { key: 'chippingCost', label: 'Koszt rąbania' },
  { key: 'carrierName', label: 'Przewoźnik' },
  { key: 'vehiclePlate', label: 'Nr rejestracyjny' },
  { key: 'distanceKm', label: 'Km' },
  { key: 'transportCost', label: 'Koszt transportu' },
  { key: 'certificate', label: 'Certyfikat' },
  { key: 'isStored', label: 'Magazynowane', format: (v) => (v ? 'TAK' : 'NIE') },
  { key: 'chainRef', label: 'Łańcuch' },
  { key: 'signature', label: 'Podpis' },
  { key: 'notes', label: 'Uwagi' },
  { key: 'createdBy', label: 'Wprowadził' },
  { key: 'createdAt', label: 'Data wprowadzenia' },
];

const CSV_PAGE = 500;
const CSV_MAX_ROWS = 200_000;

/** Rejestr operacji w CSV, z uwzględnieniem filtrów z listy (stronicowanie do końca wyniku). */
export function exportOperationsCsv(query, ctx) {
  // Eksport widzi dokładnie to, co rejestr — łącznie z zakresem magazynów.
  const rows = [];
  // `withTotals: false` — suma i podsumowania liczone byłyby od nowa dla każdej
  // strony eksportu, a wynik i tak nie jest tu do niczego potrzebny.
  for (let offset = 0; rows.length < CSV_MAX_ROWS; offset += CSV_PAGE) {
    const page = listOperations({ ...query, limit: CSV_PAGE, offset },
      { withTotals: false, user: ctx?.user ?? null });
    rows.push(...page.items);
    if (page.items.length < CSV_PAGE) break;
  }
  if (ctx) audit(ctx, 'EXPORT_CSV', 'operations', null, { rows: rows.length });
  return toCsv(CSV_COLUMNS, rows);
}
