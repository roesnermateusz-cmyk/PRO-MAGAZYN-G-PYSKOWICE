/**
 * Wirtualny system plików — atrapa `node:fs` dla wersji jednoplikowej.
 *
 * PO CO TO ISTNIEJE
 * Serwis załączników zapisuje skany kwitów na dysk i trzyma w bazie samą
 * metadaną ze skrótem SHA-256. Ta decyzja jest słuszna i w przeglądarce też:
 * baza zostaje mała i szybka do skopiowania. Zamiast pisać ten serwis drugi
 * raz — z całą walidacją typu pliku, limitem rozmiaru, kontrolą okresu
 * i wpisem audytu — podstawiamy pod niego system plików oparty na IndexedDB.
 * Serwis nie wie, że nie ma dysku.
 *
 * SYNCHRONICZNOŚĆ, CZYLI DLACZEGO JEST TU BUFOR
 * `readFileSync` musi zwrócić bajty natychmiast, a IndexedDB jest
 * asynchroniczne. Rozwiązanie: adapter API (`api-local.js`) wie, że żądanie
 * dotyczy załącznika, i **przed** uruchomieniem trasy wciąga ten jeden plik do
 * bufora (`preload`). W buforze nigdy nie siedzi cała biblioteka skanów —
 * tylko plik właśnie czytany oraz pliki właśnie zapisane, do czasu zrzutu.
 *
 * Wykaz nazw plików jest wczytywany przy starcie w całości (same klucze, bez
 * treści), żeby `existsSync` odpowiadał bez pytania magazynu.
 */
import { readFile, writeFile, deleteFile, listKeys } from './storage.js';
import logger from './logger.js';

/** Prefiks kluczy w magazynie przeglądarki — oddziela pliki od bazy. */
const PREFIX = 'plik:';

/** Zawartość plików wczytanych lub właśnie zapisanych. */
const buffer = new Map();
/** Nazwy wszystkich znanych plików — wczytywane raz przy starcie. */
const index = new Set();

const key = (file) => PREFIX + String(file).replace(/^\/+/, '');

/** Wczytuje wykaz nazw plików. Wołane raz, przy starcie aplikacji. */
export async function mountFs() {
  index.clear();
  for (const k of await listKeys(PREFIX)) index.add(String(k).slice(PREFIX.length));
  logger.info('Wirtualny system plików zamontowany', { plikow: index.size });
}

/** Wciąga jeden plik do bufora, żeby `readFileSync` mógł go zwrócić. */
export async function preload(file) {
  const name = key(file).slice(PREFIX.length);
  if (buffer.has(name)) return true;
  const bytes = await readFile(key(file));
  if (!bytes) return false;
  buffer.set(name, bytes);
  return true;
}

/** Zwalnia bufor po odczycie — pamięć nie ma rosnąć z liczbą skanów. */
export function release(file) {
  buffer.delete(key(file).slice(PREFIX.length));
}

/* --------------------------- Interfejs `node:fs` ------------------------ */

export const mkdirSync = () => undefined;

export const existsSync = (file) => {
  const name = key(file).slice(PREFIX.length);
  return buffer.has(name) || index.has(name);
};

export function writeFileSync(file, data) {
  const name = key(file).slice(PREFIX.length);
  const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new TextEncoder().encode(String(data));
  buffer.set(name, bytes);
  index.add(name);
  writeFile(key(file), bytes)
    .then(() => buffer.delete(name))
    .catch((err) => logger.exception('Nie udało się zapisać pliku', err, { file: name }));
}

export function readFileSync(file) {
  const name = key(file).slice(PREFIX.length);
  const bytes = buffer.get(name);
  if (!bytes) {
    throw new Error(`Plik nie jest wczytany do bufora: ${name}. `
      + 'Adapter API musi wywołać preload() przed odczytem.');
  }
  return bytes;
}

export function unlinkSync(file) {
  const name = key(file).slice(PREFIX.length);
  buffer.delete(name);
  index.delete(name);
  deleteFile(key(file)).catch((err) => logger.exception('Nie udało się usunąć pliku', err, { file: name }));
}

export const readdirSync = (dir) => {
  const prefix = String(dir).replace(/^\/+/, '').replace(/\/*$/, '/');
  return [...index].filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length));
};

export const statSync = (file) => {
  const name = key(file).slice(PREFIX.length);
  if (!index.has(name) && !buffer.has(name)) throw new Error(`Nie ma pliku: ${name}`);
  return { size: buffer.get(name)?.length ?? 0, mtimeMs: 0, mtime: new Date(0), isDirectory: () => false, isFile: () => true };
};

export const createReadStream = () => {
  throw new Error('Strumienie plików nie są dostępne w wersji jednoplikowej.');
};

export const copyFileSync = () => {
  throw new Error('Kopiowanie plików obsługuje adapter API, nie system plików.');
};

export default {
  mkdirSync, existsSync, writeFileSync, readFileSync, unlinkSync,
  readdirSync, statSync, createReadStream, copyFileSync,
};
