/** Typy odpowiedzi API - odwzorowanie kontraktu serwera ResInvest ERP. */

export type DocType = 'PZ' | 'WZ' | 'MM' | 'PROD' | 'TR' | 'SD';
export type DocStatus = 'DRAFT' | 'POSTED' | 'CANCELLED';
export type BaseUnit = 'M3' | 'MP' | 'T' | 'SZT';
export type LineRole = 'STD' | 'INPUT' | 'OUTPUT';
export type ProductKind = 'RAW' | 'FINISHED' | 'GOODS' | 'SERVICE';
export type ChippingMode = 'OWN' | 'EXTERNAL';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface SessionUser {
  id: number;
  login: string;
  fullName: string;
  email: string;
  roleCode: string;
  roleName: string;
  locale: 'pl' | 'cs' | 'en';
  theme: 'light' | 'dark' | 'system';
  mustChangePassword: boolean;
  defaultWarehouseId: number | null;
  permissions: string[];
  isAdmin: boolean;
}

export interface WarehouseBrief {
  id: number;
  code: string;
  name: string;
  city: string;
}

export interface SessionResponse {
  user: SessionUser;
  warehouses: WarehouseBrief[];
}

export interface LoginResponse extends SessionResponse {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  address: string;
  postalCode: string;
  city: string;
  notes: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: number;
  code: string;
  name: string;
  kind: ProductKind;
  baseUnit: BaseUnit;
  m3PerMp: number | null;
  tPerMp: number | null;
  isActive: boolean;
  notes: string;
}

export interface Partner {
  id: number;
  code: string;
  name: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  isSupplier: boolean;
  isCustomer: boolean;
  isCarrier: boolean;
  isForestry: boolean;
  isActive: boolean;
  notes: string;
}

export interface DocumentLine {
  id: number;
  lineNo: number;
  role: LineRole;
  productId: number;
  productCode: string;
  productName: string;
  baseUnit: BaseUnit;
  qtyBase: number;
  qtyM3: number;
  qtyMp: number;
  qtyT: number;
  qtyM3Manual: boolean;
  qtyMpManual: boolean;
  qtyTManual: boolean;
  unitPrice: number;
  value: number;
  costUnitPrice: number;
  costValue: number;
  notes: string;
}

export interface Attachment {
  id: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string;
}

export interface DocumentDetail {
  id: number;
  docType: DocType;
  docNumber: string;
  docDate: string;
  status: DocStatus;
  warehouseId: number | null;
  warehouseName: string | null;
  warehouseFromId: number | null;
  warehouseFromName: string | null;
  warehouseToId: number | null;
  warehouseToName: string | null;
  supplierId: number | null;
  supplierName: string | null;
  customerId: number | null;
  customerName: string | null;
  carrierId: number | null;
  carrierName: string | null;
  forestTicketNo: string;
  forestDistrict: string;
  forestSubdistrict: string;
  chippingMode: ChippingMode | null;
  chippingCompany: string;
  chippingRate: number;
  chippingCost: number;
  productionPlace: string;
  vehiclePlate: string;
  driverName: string;
  loadPlace: string;
  unloadPlace: string;
  distanceKm: number;
  transportRate: number;
  transportCost: number;
  totalValue: number;
  totalCost: number;
  parentDocumentId: number | null;
  correctionOfId: number | null;
  correctionOfNumber: string | null;
  correctedByNumber: string | null;
  cancelReason: string;
  externalNumber: string;
  notes: string;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  postedAt: string | null;
  postedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  lines: DocumentLine[];
  attachments: Attachment[];
  totals: { qtyM3: number; qtyMp: number; qtyT: number; inputQtyBase: number; outputQtyBase: number };
  derived: {
    costPerKm: number | null;
    costPerT: number | null;
    costPerMp: number | null;
    costPerM3: number | null;
  };
}

export interface DocumentListItem {
  id: number;
  docType: DocType;
  docNumber: string;
  docDate: string;
  status: DocStatus;
  warehouseName: string | null;
  warehouseFromName: string | null;
  warehouseToName: string | null;
  partnerName: string | null;
  totalValue: number;
  totalCost: number;
  qtyBase: number;
  qtyMp: number;
  qtyM3: number;
  qtyT: number;
  createdBy: string;
  createdAt: string;
  attachmentCount: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LinePayload {
  productId: number;
  role?: LineRole;
  qtyBase: number;
  qtyM3?: number | null;
  qtyMp?: number | null;
  qtyT?: number | null;
  unitPrice?: number;
  costUnitPrice?: number;
  notes?: string;
}

export interface DocumentPayload {
  docType: DocType;
  docDate: string;
  warehouseId?: number | null;
  warehouseFromId?: number | null;
  warehouseToId?: number | null;
  supplierId?: number | null;
  customerId?: number | null;
  carrierId?: number | null;
  forestTicketNo?: string;
  forestDistrict?: string;
  forestSubdistrict?: string;
  chippingMode?: ChippingMode | null;
  chippingCompany?: string;
  chippingRate?: number | null;
  productionPlace?: string;
  vehiclePlate?: string;
  driverName?: string;
  loadPlace?: string;
  unloadPlace?: string;
  distanceKm?: number;
  transportRate?: number | null;
  transportCost?: number | null;
  externalNumber?: string;
  notes?: string;
  parentDocumentId?: number | null;
  clientRequestId?: string | null;
  lines: LinePayload[];
}

export interface StockItem {
  warehouseId: number;
  warehouseCode: string;
  warehouseName: string;
  productId: number;
  productCode: string;
  productName: string;
  baseUnit: BaseUnit;
  qtyBase: number;
  qtyM3: number;
  qtyMp: number;
  qtyT: number;
  isLow: boolean;
  isNegative: boolean;
  updatedAt: string;
}

export interface StockMovement {
  id: number;
  docDate: string;
  direction: 'IN' | 'OUT';
  qtyBase: number;
  baseUnit: BaseUnit;
  reason: 'POSTING' | 'REVERSAL';
  createdAt: string;
  userName: string;
  warehouseName: string;
  productCode: string;
  productName: string;
  documentId: number;
  docNumber: string;
  docType: DocType;
  docStatus: DocStatus;
}

export interface DashboardData {
  stock: Array<{
    productId: number;
    productCode: string;
    productName: string;
    kind: ProductKind;
    baseUnit: BaseUnit;
    qtyBase: number;
    qtyM3: number;
    qtyMp: number;
    qtyT: number;
  }>;
  period: { month: string; from: string; to: string };
  operations: Array<{ docType: DocType; count: number; value: number; qty: number }>;
  recentDocuments: Array<{
    id: number;
    docType: DocType;
    docNumber: string;
    docDate: string;
    status: DocStatus;
    totalValue: number;
    createdBy: string;
    partnerName: string | null;
  }>;
  alerts: Array<{ level: 'info' | 'warning' | 'error'; code: string; message: string; count?: number }>;
}

export interface ReportSummary {
  period: { from: string; to: string; label: string };
  byType: Array<{ docType: DocType; documents: number; value: number; cost: number }>;
  byProduct: Array<{
    productId: number;
    productCode: string;
    productName: string;
    baseUnit: BaseUnit;
    docType: DocType;
    qtyBase: number;
    qtyM3: number;
    qtyMp: number;
    qtyT: number;
    value: number;
  }>;
  byMonth: Array<{ month: string; docType: DocType; documents: number; value: number }>;
}

export interface ProductionReport {
  period: { from: string; to: string; label: string };
  items: Array<{
    id: number;
    docNumber: string;
    docDate: string;
    warehouseName: string | null;
    productionPlace: string;
    chippingMode: ChippingMode | null;
    chippingCompany: string;
    chippingRate: number;
    chippingCost: number;
    inputQty: number;
    outputQty: number;
    outputT: number;
    yield: number | null;
    createdBy: string;
  }>;
  totals: { documents: number; inputQty: number; outputQty: number; chippingCost: number };
}

export interface TransportReport {
  period: { from: string; to: string; label: string };
  items: Array<{
    id: number;
    docNumber: string;
    docDate: string;
    carrierName: string | null;
    vehiclePlate: string;
    driverName: string;
    loadPlace: string;
    unloadPlace: string;
    distanceKm: number;
    rate: number;
    cost: number;
    qtyT: number;
    qtyMp: number;
    qtyM3: number;
    costPerKm: number | null;
    costPerT: number | null;
    costPerMp: number | null;
    costPerM3: number | null;
  }>;
  totals: { documents: number; distanceKm: number; cost: number };
}

export interface PartnerReport {
  period: { from: string; to: string; label: string };
  items: Array<{
    partnerId: number;
    partnerCode: string;
    partnerName: string;
    documents: number;
    purchaseValue: number;
    saleValue: number;
  }>;
}

export interface AuditChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface AuditEntry {
  id: number;
  occurredAt: string;
  userId: number | null;
  userLogin: string;
  userName: string;
  action: string;
  module: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  warehouseId: number | null;
  ip: string;
  changes: AuditChange[];
}

export interface AppUser {
  id: number;
  login: string;
  fullName: string;
  email: string;
  roleId: number;
  roleCode: string;
  roleName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  locale: 'pl' | 'cs' | 'en';
  defaultWarehouseId: number | null;
  warehouseIds: number[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Role {
  id: number;
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
}

export interface AppSettings {
  company: {
    name: string;
    taxId: string;
    address: string;
    postalCode: string;
    city: string;
    phone: string;
    email: string;
    bankAccount: string;
  };
  conversion: { m3PerMp: number; tPerMp: number };
  rates: { transportPlnPerKm: number; chippingDefaultMode: ChippingMode; chippingPlnPerUnit: number };
  stockPolicy: { allowNegative: boolean; lowStockThreshold: number };
}

export interface BackupInfo {
  fileName: string;
  createdAt: string;
  sizeBytes: number;
  kind: 'manual' | 'auto';
}
