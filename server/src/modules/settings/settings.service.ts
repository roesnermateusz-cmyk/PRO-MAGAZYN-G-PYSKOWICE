import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { nowIso } from '../../core/time.js';
import { writeAudit, diffFields, type AuditActor } from '../../core/audit.js';
import { badRequest } from '../../core/errors.js';
import type { ConversionRates } from '../../core/units.js';

export const companySchema = z.object({
  name: z.string().min(1).max(200),
  taxId: z.string().max(40).default(''),
  address: z.string().max(200).default(''),
  postalCode: z.string().max(20).default(''),
  city: z.string().max(100).default(''),
  phone: z.string().max(50).default(''),
  email: z.string().max(120).default(''),
  bankAccount: z.string().max(60).default(''),
});

export const conversionSchema = z.object({
  /** Ile m3 przypada na 1 MP (domyślnie 0.25, tj. 1 m3 = 4 MP). */
  m3PerMp: z.number().positive().max(1000),
  /** Ile ton przypada na 1 MP (domyślnie 0.33). */
  tPerMp: z.number().positive().max(1000),
});

export const ratesSchema = z.object({
  /** Domyslna stawka transportu w PLN za kilometr. */
  transportPlnPerKm: z.number().min(0).max(100000),
  /** Domyślny tryb rąbania. */
  chippingDefaultMode: z.enum(['OWN', 'EXTERNAL']),
  /** Domyślny koszt rąbania w PLN za jednostke wyrobu (MP). */
  chippingPlnPerUnit: z.number().min(0).max(100000),
});

export const stockPolicySchema = z.object({
  /** Globalna zgoda na stan ujemny. Wymaga dodatkowo uprawnienia stock.allow_negative. */
  allowNegative: z.boolean(),
  /** Prog ostrzegawczy niskiego stanu w jednostce bazowej. */
  lowStockThreshold: z.number().min(0).max(1_000_000),
});

export const DEFAULT_SETTINGS = {
  company: {
    name: 'ResInvest Commodities',
    taxId: '',
    address: '',
    postalCode: '',
    city: 'Pyskowice',
    phone: '',
    email: '',
    bankAccount: '',
  },
  conversion: { m3PerMp: 0.25, tPerMp: 0.33 },
  rates: { transportPlnPerKm: 5, chippingDefaultMode: 'OWN' as const, chippingPlnPerUnit: 10 },
  stockPolicy: { allowNegative: false, lowStockThreshold: 10 },
};

export type SettingsKey = keyof typeof DEFAULT_SETTINGS;

const SCHEMAS: Record<SettingsKey, z.ZodTypeAny> = {
  company: companySchema,
  conversion: conversionSchema,
  rates: ratesSchema,
  stockPolicy: stockPolicySchema,
};

export type AppSettings = {
  company: z.infer<typeof companySchema>;
  conversion: z.infer<typeof conversionSchema>;
  rates: z.infer<typeof ratesSchema>;
  stockPolicy: z.infer<typeof stockPolicySchema>;
};

export function getSetting<K extends SettingsKey>(db: Db, key: K): AppSettings[K] {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as
    | { value_json: string }
    | undefined;
  if (!row) return structuredClone(DEFAULT_SETTINGS[key]) as AppSettings[K];
  try {
    const parsed = SCHEMAS[key].safeParse(JSON.parse(row.value_json));
    if (!parsed.success) return structuredClone(DEFAULT_SETTINGS[key]) as AppSettings[K];
    return parsed.data as AppSettings[K];
  } catch {
    return structuredClone(DEFAULT_SETTINGS[key]) as AppSettings[K];
  }
}

export function getAllSettings(db: Db): AppSettings {
  return {
    company: getSetting(db, 'company'),
    conversion: getSetting(db, 'conversion'),
    rates: getSetting(db, 'rates'),
    stockPolicy: getSetting(db, 'stockPolicy'),
  };
}

export function getConversionRates(db: Db): ConversionRates {
  return getSetting(db, 'conversion');
}

export function setSetting<K extends SettingsKey>(
  db: Db,
  key: K,
  value: unknown,
  actor: AuditActor,
): AppSettings[K] {
  const schema = SCHEMAS[key];
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw badRequest(`Nieprawidłowe ustawienia dla klucza "${key}".`, parsed.error.flatten());
  }
  const before = getSetting(db, key) as Record<string, unknown>;
  db.prepare(
    `INSERT INTO settings (key, value_json, updated_at, updated_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json,
                                     updated_at = excluded.updated_at,
                                     updated_by = excluded.updated_by`,
  ).run(key, JSON.stringify(parsed.data), nowIso(), actor.id);

  writeAudit(db, {
    actor,
    action: 'UPDATE',
    module: 'settings',
    entityType: 'setting',
    entityId: key,
    entityLabel: key,
    changes: diffFields(before, parsed.data as Record<string, unknown>),
  });

  return parsed.data as AppSettings[K];
}

/** Zapis wszystkich ustawien początkowych (używane przez seed). */
export function ensureDefaultSettings(db: Db): void {
  const stmt = db.prepare(
    `INSERT INTO settings (key, value_json, updated_at, updated_by)
     VALUES (?, ?, ?, NULL)
     ON CONFLICT (key) DO NOTHING`,
  );
  for (const key of Object.keys(DEFAULT_SETTINGS) as SettingsKey[]) {
    stmt.run(key, JSON.stringify(DEFAULT_SETTINGS[key]), nowIso());
  }
}
