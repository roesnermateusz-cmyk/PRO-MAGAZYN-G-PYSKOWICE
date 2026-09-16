import type { Request } from 'express';
import type { Permission } from './permissions.js';
import type { AuditActor } from './audit.js';

export interface AuthUser {
  id: number;
  login: string;
  fullName: string;
  roleId: number;
  roleCode: string;
  roleName: string;
  permissions: Set<Permission>;
  warehouseIds: number[];
  isAdmin: boolean;
  locale: string;
  theme: string;
}

export interface RequestContext {
  user: AuthUser;
  /** Magazyn roboczy wybrany przez użytkownika (naglowek X-Warehouse-Id). */
  warehouseId: number | null;
  actor: AuditActor;
}

declare module 'express-serve-static-core' {
  interface Request {
    ctx?: RequestContext;
  }
}

export function requireCtx(req: Request): RequestContext {
  if (!req.ctx) {
    throw new Error('Kontekst żądania nie został zainicjowany (brak middleware autoryzacji).');
  }
  return req.ctx;
}

export function clientIp(req: Request): string {
  const header = req.headers['x-forwarded-for'];
  if (typeof header === 'string' && header.length > 0) return header.split(',')[0]!.trim();
  return req.ip ?? req.socket.remoteAddress ?? '';
}

export function userAgent(req: Request): string {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 300) : '';
}
