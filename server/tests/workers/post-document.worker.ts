/**
 * Proces roboczy uzywany w tescie wielodostepu.
 * Uruchamiany osobno dla kazdego "uzytkownika", laczy sie z ta sama baza
 * danych na dysku i probuje zatwierdzic wskazany dokument.
 *
 * Argumenty: <databaseFile> <documentId> <version> <login>
 */
import { getDb } from '../../src/db/index.js';
import { findUserByLogin, toAuthUser } from '../../src/modules/auth/auth.service.js';
import { postDocument } from '../../src/modules/documents/documents.service.js';
import { AppError } from '../../src/core/errors.js';

const [, , documentIdArg, versionArg, login] = process.argv;

function main(): void {
  const db = getDb();
  const row = findUserByLogin(db, String(login));
  if (!row) {
    process.stdout.write(JSON.stringify({ ok: false, code: 'NO_USER' }));
    return;
  }
  const user = toAuthUser(db, row);
  const actor = { id: user.id, login: user.login, fullName: user.fullName, ip: 'worker', userAgent: 'worker' };

  try {
    const doc = postDocument(db, user, actor, Number(documentIdArg), Number(versionArg));
    process.stdout.write(JSON.stringify({ ok: true, status: doc.status, docNumber: doc.docNumber }));
  } catch (err) {
    const code = err instanceof AppError ? err.code : 'UNKNOWN';
    process.stdout.write(JSON.stringify({ ok: false, code, message: (err as Error).message }));
  }
}

main();
