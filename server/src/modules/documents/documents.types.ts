import { z } from 'zod';
import { isIsoDate } from '../../core/time.js';
import { DOC_TYPES, type DocType } from '../../core/permissions.js';
import type { BaseUnit } from '../../core/units.js';

export const docTypeSchema = z.enum(DOC_TYPES as [DocType, ...DocType[]]);
export const docStatusSchema = z.enum(['DRAFT', 'POSTED', 'CANCELLED']);
export type DocStatus = z.infer<typeof docStatusSchema>;

const isoDate = z
  .string()
  .refine(isIsoDate, { message: 'Data musi być w formacie YYYY-MM-DD i istniec w kalendarzu.' });

const money = z.number().min(0).max(1_000_000_000);
const quantity = z.number().positive().max(10_000_000);
const optionalQuantity = z.number().min(0).max(10_000_000).nullable().optional();

export const lineInputSchema = z.object({
  productId: z.number().int().positive(),
  role: z.enum(['STD', 'INPUT', 'OUTPUT']).default('STD'),
  qtyBase: quantity,
  /** Wartości rzeczywiste; null/undefined = wylicz automatycznie z przelicznikow. */
  qtyM3: optionalQuantity,
  qtyMp: optionalQuantity,
  qtyT: optionalQuantity,
  /** Cena jednostkowa w PLN za jednostke bazowa (zakup dla PZ, sprzedaż dla WZ/SD). */
  unitPrice: money.default(0),
  /** Cena kosztowa w PLN za jednostke bazowa (używana m.in. w sprzedaży bezpośredniej). */
  costUnitPrice: money.default(0),
  notes: z.string().max(500).default(''),
});

export type LineInput = z.infer<typeof lineInputSchema>;

export const documentInputSchema = z
  .object({
    docType: docTypeSchema,
    docDate: isoDate,
    warehouseId: z.number().int().positive().nullable().optional(),
    warehouseFromId: z.number().int().positive().nullable().optional(),
    warehouseToId: z.number().int().positive().nullable().optional(),
    supplierId: z.number().int().positive().nullable().optional(),
    customerId: z.number().int().positive().nullable().optional(),
    carrierId: z.number().int().positive().nullable().optional(),

    forestTicketNo: z.string().max(60).default(''),
    forestDistrict: z.string().max(120).default(''),
    forestSubdistrict: z.string().max(120).default(''),

    chippingMode: z.enum(['OWN', 'EXTERNAL']).nullable().optional(),
    chippingCompany: z.string().max(200).default(''),
    /** Stawka rąbania w PLN za jednostke wyrobu. Brak = stawka z ustawien. */
    chippingRate: money.nullable().optional(),
    productionPlace: z.string().max(200).default(''),

    vehiclePlate: z.string().max(30).default(''),
    driverName: z.string().max(120).default(''),
    loadPlace: z.string().max(200).default(''),
    unloadPlace: z.string().max(200).default(''),
    distanceKm: z.number().min(0).max(100_000).default(0),
    /** Stawka transportu w PLN za km. Brak = stawka z ustawien. */
    transportRate: money.nullable().optional(),
    /** Calkowity koszt transportu w PLN. Brak = wyliczany jako km * stawka. */
    transportCost: money.nullable().optional(),

    externalNumber: z.string().max(60).default(''),
    notes: z.string().max(2000).default(''),
    parentDocumentId: z.number().int().positive().nullable().optional(),
    clientRequestId: z.string().min(8).max(64).nullable().optional(),

    lines: z.array(lineInputSchema).min(1).max(200),
  })
  .strict();

export type DocumentInput = z.infer<typeof documentInputSchema>;

export const documentUpdateSchema = documentInputSchema
  .omit({ docType: true, clientRequestId: true })
  .extend({ version: z.number().int().positive() });

export type DocumentUpdate = z.infer<typeof documentUpdateSchema>;

export const documentListQuerySchema = z.object({
  docType: docTypeSchema.optional(),
  status: docStatusSchema.optional(),
  warehouseId: z.coerce.number().int().positive().optional(),
  partnerId: z.coerce.number().int().positive().optional(),
  productId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().refine(isIsoDate).optional(),
  dateTo: z.string().refine(isIsoDate).optional(),
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.enum(['docDate', 'docNumber', 'totalValue', 'createdAt']).default('docDate'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;

export const cancelSchema = z.object({
  reason: z.string().min(3).max(500),
  version: z.number().int().positive(),
});

export const correctSchema = z.object({
  reason: z.string().min(3).max(500),
  version: z.number().int().positive(),
});

// --- Modele odczytu -------------------------------------------------------

export interface DocumentLineRow {
  id: number;
  document_id: number;
  line_no: number;
  line_role: 'STD' | 'INPUT' | 'OUTPUT';
  product_id: number;
  base_unit: BaseUnit;
  qty_base: number;
  qty_m3: number;
  qty_mp: number;
  qty_t: number;
  qty_m3_manual: number;
  qty_mp_manual: number;
  qty_t_manual: number;
  unit_price_gr: number;
  value_gr: number;
  cost_unit_price_gr: number;
  cost_value_gr: number;
  notes: string;
}

export interface DocumentRow {
  id: number;
  doc_type: DocType;
  doc_number: string;
  doc_year: number;
  doc_seq: number;
  doc_date: string;
  status: DocStatus;
  warehouse_id: number | null;
  warehouse_from_id: number | null;
  warehouse_to_id: number | null;
  supplier_id: number | null;
  customer_id: number | null;
  carrier_id: number | null;
  forest_ticket_no: string;
  forest_district: string;
  forest_subdistrict: string;
  chipping_mode: 'OWN' | 'EXTERNAL' | null;
  chipping_company: string;
  chipping_rate_gr: number;
  chipping_cost_gr: number;
  production_place: string;
  vehicle_plate: string;
  driver_name: string;
  load_place: string;
  unload_place: string;
  distance_km: number;
  transport_rate_gr: number;
  transport_cost_gr: number;
  total_value_gr: number;
  total_cost_gr: number;
  client_request_id: string | null;
  parent_document_id: number | null;
  correction_of_id: number | null;
  cancel_reason: string;
  external_number: string;
  notes: string;
  version: number;
  created_at: string;
  created_by: number;
  updated_at: string;
  updated_by: number | null;
  posted_at: string | null;
  posted_by: number | null;
  cancelled_at: string | null;
  cancelled_by: number | null;
}

/** Typy dokumentów wpływające na stan magazynowy. */
export const STOCK_AFFECTING: ReadonlySet<DocType> = new Set<DocType>(['PZ', 'WZ', 'MM', 'PROD']);

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  PZ: 'Przyjęcie zewnętrzne',
  WZ: 'Wydanie zewnętrzne',
  MM: 'Przesunięcie międzymagazynowe',
  PROD: 'Produkcja',
  TR: 'Transport',
  SD: 'Sprzedaż bezpośrednia',
};
