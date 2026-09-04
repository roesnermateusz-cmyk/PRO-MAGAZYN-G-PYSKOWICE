/**
 * Załączniki dokumentów — skany kwitów wywozowych, zdjęcia z placu, faktury.
 *
 * Pliki trafiają na dysk (katalog `ATTACHMENTS_DIR`, układ `RRRR/MM/<uuid>.<ext>`),
 * a w bazie zostaje metadana wraz ze skrótem SHA-256. Baza pozostaje mała
 * i szybka do kopiowania, a pliki łatwo objąć backupem systemowym.
 *
 * Przesyłanie odbywa się w JSON (`dataBase64`), bo klient i tak kompresuje
 * zdjęcia przed wysyłką — dzięki temu serwer nie potrzebuje parsera multipart
 * ani żadnej zależności zewnętrznej.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import config from '../../config/env.js';
import db from '../../db/index.js';
import { uuid, sha256Buffer } from '../../lib/crypto.js';
import { validate } from '../../lib/validate.js';
import { NotFoundError, ValidationError, PayloadTooLargeError, ForbiddenError } from '../../lib/errors.js';
import { audit } from '../../middleware/audit.js';
import logger from '../../lib/logger.js';

const EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
};

const UPLOAD_SCHEMA = {
  filename: { type: 'string', required: true, max: 200, label: 'Nazwa pliku' },
  mimeType: { type: 'string', required: true, max: 100, label: 'Typ pliku' },
  dataBase64: { type: 'string', required: true, trim: false, label: 'Zawartość pliku' },
  kind: { type: 'enum', values: ['SKAN', 'KWIT', 'FAKTURA', 'INNE'], default: 'SKAN', label: 'Rodzaj' },
};

/** Zapisuje załącznik dokumentu. */
export function addAttachment(operationId, input, ctx) {
  const operation = db.get('SELECT id, doc_no, operation_date FROM operations WHERE id = :id', { id: operationId });
  if (!operation) throw new NotFoundError('Nie znaleziono dokumentu.');

  const d = validate(input, UPLOAD_SCHEMA);
  if (!config.attachments.allowedMime.includes(d.mimeType)) {
    throw new ValidationError(
      `Nieobsługiwany typ pliku: ${d.mimeType}. Dozwolone: ${config.attachments.allowedMime.join(', ')}.`,
    );
  }

  const payload = d.dataBase64.includes(',') ? d.dataBase64.split(',').pop() : d.dataBase64;
  let buffer;
  try {
    buffer = Buffer.from(payload, 'base64');
  } catch {
    throw new ValidationError('Zawartość pliku nie jest poprawnym ciągiem base64.');
  }
  if (!buffer.length) throw new ValidationError('Przesłany plik jest pusty.');
  if (buffer.length > config.attachments.maxBytes) {
    throw new PayloadTooLargeError(
      `Plik przekracza limit ${Math.round(config.attachments.maxBytes / 1024 / 1024)} MB.`,
    );
  }

  const [year, month] = (operation.operation_date || new Date().toISOString()).split('-');
  const relDir = path.join(year, month);
  const absDir = path.join(config.attachments.dir, relDir);
  mkdirSync(absDir, { recursive: true });

  const id = uuid();
  const ext = EXTENSIONS[d.mimeType] || path.extname(d.filename).slice(0, 8) || '.bin';
  const relPath = path.join(relDir, `${id}${ext}`);
  writeFileSync(path.join(config.attachments.dir, relPath), buffer);

  db.run(
    `INSERT INTO attachments(id, operation_id, filename, mime_type, size_bytes, sha256, storage_path, kind, uploaded_by)
          VALUES (:id, :operationId, :filename, :mimeType, :size, :sha256, :storagePath, :kind, :uploadedBy)`,
    {
      id,
      operationId,
      filename: d.filename.slice(0, 200),
      mimeType: d.mimeType,
      size: buffer.length,
      sha256: sha256Buffer(buffer),
      storagePath: relPath,
      kind: d.kind,
      uploadedBy: ctx.user.id,
    },
  );

  audit(ctx, 'UPLOAD', 'attachments', id, { operationId, docNo: operation.doc_no, size: buffer.length });
  return getAttachmentMeta(id);
}

export function listAttachments(operationId) {
  return db.all(
    `SELECT a.*, u.full_name AS uploaded_by_name
       FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
      WHERE a.operation_id = :id ORDER BY a.created_at`,
    { id: operationId },
  ).map(mapAttachment);
}

export function getAttachmentMeta(id) {
  const row = db.get(
    `SELECT a.*, u.full_name AS uploaded_by_name
       FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.id = :id`,
    { id },
  );
  if (!row) throw new NotFoundError('Nie znaleziono załącznika.');
  return mapAttachment(row);
}

/** Zwraca zawartość pliku wraz z metadaną (do pobrania lub podglądu). */
export function readAttachment(id) {
  const row = db.get('SELECT * FROM attachments WHERE id = :id', { id });
  if (!row) throw new NotFoundError('Nie znaleziono załącznika.');
  const file = path.join(config.attachments.dir, row.storage_path);
  if (!existsSync(file)) {
    logger.error('Brak pliku załącznika na dysku', { id, path: row.storage_path });
    throw new NotFoundError('Plik załącznika nie istnieje na dysku. Sprawdź kopię zapasową.');
  }
  return { meta: mapAttachment(row), buffer: readFileSync(file) };
}

/** Usuwa załącznik (rola z uprawnieniem `attachments:write`; magazynier — tylko własne). */
export function deleteAttachment(id, ctx) {
  const row = db.get('SELECT * FROM attachments WHERE id = :id', { id });
  if (!row) throw new NotFoundError('Nie znaleziono załącznika.');
  if (ctx.user.role === 'MAGAZYNIER' && row.uploaded_by !== ctx.user.id) {
    throw new ForbiddenError('Magazynier może usuwać wyłącznie własne załączniki.');
  }

  db.run('DELETE FROM attachments WHERE id = :id', { id });
  const file = path.join(config.attachments.dir, row.storage_path);
  try {
    if (existsSync(file)) unlinkSync(file);
  } catch (err) {
    logger.exception('Nie udało się usunąć pliku załącznika', err, { id });
  }
  audit(ctx, 'DELETE', 'attachments', id, { operationId: row.operation_id, filename: row.filename });
  return { ok: true };
}

const mapAttachment = (r) => ({
  id: r.id,
  operationId: r.operation_id,
  filename: r.filename,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes,
  sha256: r.sha256,
  kind: r.kind,
  uploadedBy: r.uploaded_by_name ?? r.uploaded_by,
  createdAt: r.created_at,
});

