export function nowIso(): string {
  return new Date().toISOString();
}

/** Data biznesowa w formacie 'YYYY-MM-DD' wedlug czasu lokalnego serwera. */
export function todayIsoDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function yearOf(isoDate: string): number {
  return Number.parseInt(isoDate.slice(0, 4), 10);
}

/** Zakres dat dla miesiaca 'YYYY-MM' (obie granice wlacznie). */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}
