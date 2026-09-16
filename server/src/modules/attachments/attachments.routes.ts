import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { getDb } from '../../db/index.js';
import { env } from '../../config/env.js';
import { requireCtx } from '../../core/context.js';
import { asyncHandler } from '../../middleware/async.js';
import { requirePermission } from '../../middleware/auth.js';
import { parseIdParam } from '../../middleware/validate.js';
import { badRequest, invalidState, notFound } from '../../core/errors.js';
import { nowIso } from '../../core/time.js';
import { writeAudit } from '../../core/audit.js';
import { sha256Hex } from '../../core/password.js';
import { getDocument, loadDocumentRow } from '../documents/documents.service.js';

export const attachmentsRouter = Router();

/** Skany dokumentów: obrazy i PDF. Lista jest zamknieta swiadomie. */
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(badRequest(`Nieobsługiwany typ pliku: ${file.mimetype}. Dozwolone: JPG, PNG, WEBP, HEIC, PDF.`));
      return;
    }
    cb(null, true);
  },
});

attachmentsRouter.post(
  '/documents/:id/attachments',
  requirePermission('attachments.manage'),
  upload.single('file'),
  asyncHandler((req, res) => {
    const { user, actor } = requireCtx(req);
    const documentId = parseIdParam(req);
    const file = req.file;
    if (!file) throw badRequest('Brak pliku w zadaniu (pole "file").');

    const db = getDb();
    const doc = loadDocumentRow(db, documentId);
    if (doc.status === 'CANCELLED') {
      throw invalidState('Nie można dodawać załączników do dokumentu anulowanego.');
    }
    // Weryfikacja dostępu do dokumentu (rzuca przy braku uprawnień).
    getDocument(db, user, documentId);

    const id = crypto.randomUUID();
    const extension = EXTENSION_BY_MIME[file.mimetype] ?? '.bin';
    const relativeDir = path.join(String(doc.doc_year), doc.doc_type);
    const absoluteDir = path.join(env.attachmentsDir, relativeDir);
    fs.mkdirSync(absoluteDir, { recursive: true });

    const fileName = path.join(relativeDir, `${id}${extension}`);
    const absolutePath = path.join(env.attachmentsDir, fileName);
    fs.writeFileSync(absolutePath, file.buffer, { mode: 0o640 });

    try {
      db.transaction(() => {
        db.prepare(
          `INSERT INTO attachments (id, document_id, file_name, original_name, mime_type, size_bytes, sha256, uploaded_at, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          documentId,
          fileName,
          sanitizeName(file.originalname),
          file.mimetype,
          file.size,
          sha256Hex(file.buffer),
          nowIso(),
          user.id,
        );
        writeAudit(db, {
          actor,
          action: 'CREATE',
          module: 'attachments',
          entityType: 'attachment',
          entityId: id,
          entityLabel: `${doc.doc_number}: ${sanitizeName(file.originalname)}`,
          warehouseId: doc.warehouse_id ?? doc.warehouse_from_id,
          changes: [{ field: 'sizeBytes', before: null, after: file.size }],
        });
      }).immediate();
    } catch (err) {
      // Zapis metadanych nie powiodl się - usuwamy osierocony plik.
      fs.rmSync(absolutePath, { force: true });
      throw err;
    }

    res.status(201).json(getDocument(db, user, documentId).attachments);
  }),
);

attachmentsRouter.get(
  '/attachments/:attachmentId',
  asyncHandler((req, res) => {
    const { user } = requireCtx(req);
    const attachmentId = String(req.params.attachmentId ?? '');
    const db = getDb();

    const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(attachmentId) as
      | { id: string; document_id: number; file_name: string; original_name: string; mime_type: string }
      | undefined;
    if (!row) throw notFound('Nie znaleziono załącznika.');

    // Kontrola dostępu przez dokument nadrzedny.
    getDocument(db, user, row.document_id);

    const absolutePath = path.resolve(env.attachmentsDir, row.file_name);
    // Ochrona przed wyjsciem poza katalog załączników.
    if (!absolutePath.startsWith(path.resolve(env.attachmentsDir) + path.sep)) {
      throw notFound('Nie znaleziono załącznika.');
    }
    if (!fs.existsSync(absolutePath)) throw notFound('Plik załącznika nie istnieje na dysku.');

    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.original_name)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(absolutePath).pipe(res);
  }),
);

attachmentsRouter.delete(
  '/attachments/:attachmentId',
  requirePermission('attachments.manage'),
  asyncHandler((req, res) => {
    const { user, actor } = requireCtx(req);
    const attachmentId = String(req.params.attachmentId ?? '');
    const db = getDb();

    const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(attachmentId) as
      | { id: string; document_id: number; file_name: string; original_name: string }
      | undefined;
    if (!row) throw notFound('Nie znaleziono załącznika.');

    const doc = loadDocumentRow(db, row.document_id);
    getDocument(db, user, row.document_id);
    if (doc.status === 'POSTED' && !user.permissions.has('admin.settings')) {
      throw invalidState('Załącznik dokumentu zatwierdzonego może usunąć wyłącznie administrator.');
    }

    db.transaction(() => {
      db.prepare('DELETE FROM attachments WHERE id = ?').run(attachmentId);
      writeAudit(db, {
        actor,
        action: 'DELETE',
        module: 'attachments',
        entityType: 'attachment',
        entityId: attachmentId,
        entityLabel: `${doc.doc_number}: ${row.original_name}`,
        warehouseId: doc.warehouse_id ?? doc.warehouse_from_id,
      });
    }).immediate();

    // Plik usuwamy po udanym commicie metadanych.
    const absolutePath = path.resolve(env.attachmentsDir, row.file_name);
    if (absolutePath.startsWith(path.resolve(env.attachmentsDir) + path.sep)) {
      fs.rmSync(absolutePath, { force: true });
    }

    res.status(204).end();
  }),
);

function sanitizeName(name: string): string {
  return name.replace(/[\r\n"\\]/g, '_').slice(0, 200);
}
