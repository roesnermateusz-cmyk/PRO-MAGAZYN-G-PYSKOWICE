import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import type { Db } from '../db/index.js';
import { logger } from './logger.js';

export interface BackupInfo {
  fileName: string;
  createdAt: string;
  sizeBytes: number;
  kind: 'manual' | 'auto';
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Kopia zapasowa wykonywana natywnym mechanizmem SQLite (VACUUM INTO),
 * ktory tworzy spojny obraz bazy bez przerywania pracy uzytkownikow.
 */
export async function createBackup(db: Db, kind: 'manual' | 'auto'): Promise<BackupInfo> {
  fs.mkdirSync(env.backupDir, { recursive: true });
  const fileName = `resinvest-${kind}-${timestamp()}.sqlite`;
  const target = path.join(env.backupDir, fileName);

  // VACUUM INTO nie nadpisuje istniejacych plikow - nazwa zawiera znacznik czasu.
  db.prepare('VACUUM INTO ?').run(target);

  const stat = fs.statSync(target);
  pruneOldBackups();

  logger.info(`Utworzono kopie zapasowa: ${fileName} (${stat.size} B)`);
  return {
    fileName,
    createdAt: new Date(stat.mtimeMs).toISOString(),
    sizeBytes: stat.size,
    kind,
  };
}

export function listBackups(): BackupInfo[] {
  if (!fs.existsSync(env.backupDir)) return [];
  return fs
    .readdirSync(env.backupDir)
    .filter((f) => f.endsWith('.sqlite'))
    .map((fileName) => {
      const stat = fs.statSync(path.join(env.backupDir, fileName));
      return {
        fileName,
        createdAt: new Date(stat.mtimeMs).toISOString(),
        sizeBytes: stat.size,
        kind: fileName.includes('-manual-') ? ('manual' as const) : ('auto' as const),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function pruneOldBackups(): void {
  const backups = listBackups();
  if (backups.length <= env.backupKeep) return;
  for (const stale of backups.slice(env.backupKeep)) {
    fs.rmSync(path.join(env.backupDir, stale.fileName), { force: true });
    logger.info(`Usunieto przeterminowana kopie zapasowa: ${stale.fileName}`);
  }
}

/** Uruchamia cykliczne kopie zapasowe. Zwraca funkcje zatrzymujaca harmonogram. */
export function startBackupSchedule(db: Db): () => void {
  if (!env.backupEnabled) return () => undefined;

  const intervalMs = Math.max(1, env.backupIntervalHours) * 3_600_000;
  const timer = setInterval(() => {
    createBackup(db, 'auto').catch((err) => logger.error('Kopia zapasowa nie powiodla sie', err));
  }, intervalMs);
  timer.unref?.();

  logger.info(`Harmonogram kopii zapasowych: co ${env.backupIntervalHours} h, przechowywane ${env.backupKeep} plikow.`);
  return () => clearInterval(timer);
}
