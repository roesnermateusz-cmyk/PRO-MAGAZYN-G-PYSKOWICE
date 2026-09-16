import type { BaseUnit } from '../api/types';

/** Etykiety jednostek - wspolne dla wszystkich jezykow (oznaczenia branzowe). */
export const UNIT_LABEL: Record<BaseUnit, string> = {
  M3: 'm3',
  MP: 'MP',
  T: 't',
  SZT: 'szt.',
};

export function formatNumber(value: number | null | undefined, locale: string, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Ilości prezentujemy bez zbednych zer koncowych, do 3 miejsc. */
export function formatQty(value: number | null | undefined, locale: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(value);
}

export function formatQtyWithUnit(value: number | null | undefined, unit: BaseUnit, locale: string): string {
  return `${formatQty(value, locale)} ${UNIT_LABEL[unit]}`;
}

export function formatMoney(value: number | null | undefined, locale: string, currency = 'PLN'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '-';
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatBytes(bytes: number, locale: string): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, locale, 1)} kB`;
  return `${formatNumber(bytes / (1024 * 1024), locale, 1)} MB`;
}

/** Biezaca data lokalna w formacie wymaganym przez pole input[type=date]. */
export function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function currentMonthIso(): string {
  return todayIso().slice(0, 7);
}

/**
 * Parsuje liczbę wpisana przez użytkownika, akceptujac przecinek dziesietny
 * i spacje jako separator tysiecy (typowe dla polskiego ukladu klawiatury).
 */
export function parseDecimal(input: string): number | null {
  const normalized = input.replace(/\s/g, '').replace(',', '.');
  if (normalized === '') return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Unikalny identyfikator żądania - chroni przed podwojnym zapisem formularza. */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `req-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}
