#!/usr/bin/env node
/**
 * Kopia zapasowa z wiersza poleceń — do wpięcia w Harmonogram zadań Windows
 * albo w crona na serwerze Linux.
 *
 *   npm run backup                 — kopia pliku bazy (z rotacją)
 *   npm run backup -- --json       — dodatkowo pełny zrzut logiczny JSON
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { bootstrap } from '../src/bootstrap.js';
import { createBackup, exportJson, listBackups } from '../src/modules/backup/backup.service.js';
import config from '../src/config/env.js';
import { closeDatabase } from '../src/db/index.js';

bootstrap();

const result = createBackup(null, 'cli');
console.log(`Kopia bazy: ${path.join(config.backup.dir, result.file)} (${(result.sizeBytes / 1024 / 1024).toFixed(1)} MB)`);

if (process.argv.includes('--json')) {
  const payload = exportJson(null, { includeAudit: process.argv.includes('--audit') });
  const name = `resinvest-eksport-${new Date().toISOString().slice(0, 10)}.json`;
  const target = path.join(config.backup.dir, name);
  writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Zrzut logiczny: ${target}`);
  console.log(`Zawartość: ${Object.entries(payload.counts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
}

console.log(`\nPrzechowywane kopie (${listBackups().length}, limit ${config.backup.keep}):`);
for (const b of listBackups().slice(0, 5)) {
  console.log(`  ${b.createdAt.slice(0, 19).replace('T', ' ')}  ${b.file}`);
}

closeDatabase();
