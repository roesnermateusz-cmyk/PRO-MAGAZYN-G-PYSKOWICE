import type { Db } from '../db/index.js';
import { nowIso } from './time.js';

export interface AuditActor {
  id: number | null;
  login: string;
  fullName: string;
  ip?: string;
  userAgent?: string;
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface AuditEntry {
  actor: AuditActor;
  action:
    | 'CREATE'
    | 'UPDATE'
    | 'DELETE'
    | 'POST'
    | 'CANCEL'
    | 'CORRECT'
    | 'LOGIN'
    | 'LOGIN_FAILED'
    | 'LOGOUT'
    | 'PERMISSION_CHANGE'
    | 'PASSWORD_CHANGE'
    | 'WAREHOUSE_SWITCH'
    | 'EXPORT'
    | 'IMPORT'
    | 'BACKUP';
  module: string;
  entityType: string;
  entityId: string | number;
  entityLabel?: string;
  warehouseId?: number | null;
  changes?: FieldChange[];
}

/**
 * Zapisuje wpis audytu. Wywolanie MUSI nastapic wewnątrz tej samej transakcji
 * co operacja biznesowa - dzięki temu rollback usuwa również ślad audytowy
 * operacji, która nie doszla do skutku.
 */
export function writeAudit(db: Db, entry: AuditEntry): void {
  db.prepare(
    `INSERT INTO audit_logs
       (occurred_at, user_id, user_login, user_name, action, module,
        entity_type, entity_id, entity_label, warehouse_id, changes_json, ip, user_agent)
     VALUES (@occurred_at, @user_id, @user_login, @user_name, @action, @module,
             @entity_type, @entity_id, @entity_label, @warehouse_id, @changes_json, @ip, @user_agent)`,
  ).run({
    occurred_at: nowIso(),
    user_id: entry.actor.id,
    user_login: entry.actor.login,
    user_name: entry.actor.fullName,
    action: entry.action,
    module: entry.module,
    entity_type: entry.entityType,
    entity_id: String(entry.entityId),
    entity_label: entry.entityLabel ?? '',
    warehouse_id: entry.warehouseId ?? null,
    changes_json: JSON.stringify(entry.changes ?? []),
    ip: entry.actor.ip ?? '',
    user_agent: entry.actor.userAgent ?? '',
  });
}

/** Porownuje dwa obiekty i zwraca liste zmienionych pol (przed / po). */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields?: Array<keyof T>,
): FieldChange[] {
  const keys = (fields ?? (Object.keys(after) as Array<keyof T>)) as Array<keyof T>;
  const changes: FieldChange[] = [];
  for (const key of keys) {
    if (!(key in after)) continue;
    const prev = before[key];
    const next = after[key];
    if (normalize(prev) === normalize(next)) continue;
    changes.push({ field: String(key), before: prev ?? null, after: next ?? null });
  }
  return changes;
}

function normalize(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(Math.round(value * 1e6) / 1e6);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}
