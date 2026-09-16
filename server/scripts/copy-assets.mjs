import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pliki .sql nie są obsługiwane przez tsc - kopiujemy je do katalogu dist,
// aby migracje dzialaly również w buildzie produkcyjnym.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src', 'db', 'migrations');
const target = path.join(root, 'dist', 'db', 'migrations');

fs.mkdirSync(target, { recursive: true });
let copied = 0;
for (const file of fs.readdirSync(source)) {
  if (!file.endsWith('.sql')) continue;
  fs.copyFileSync(path.join(source, file), path.join(target, file));
  copied += 1;
}
console.log(`Skopiowano ${copied} plikow migracji do dist/db/migrations`);
