/**
 * Trwały magazyn wersji jednoplikowej — IndexedDB.
 *
 * Trzymamy tu dwie rzeczy: plik bazy SQLite i bajty załączników. Wybór
 * IndexedDB, a nie `localStorage`, jest wymuszony rozmiarem: `localStorage`
 * przechowuje wyłącznie tekst i kończy się na kilku megabajtach, a plik bazy
 * z kilkoma tysiącami dokumentów i zdjęcia kwitów przekraczają to wielokrotnie.
 *
 * GDZIE TE DANE ŻYJĄ — rzecz, którą użytkownik musi wiedzieć
 * W profilu przeglądarki na tym jednym komputerze. Nie w pliku HTML: kopiowanie
 * pliku na pendrivie nie kopiuje danych. Czyszczenie danych przeglądania potrafi
 * je usunąć. Dlatego kopia zapasowa (Ustawienia → Kopie zapasowe) nie jest
 * ozdobą, tylko jedynym sposobem, żeby dane przetrwały komputer.
 */

const DB_NAME = 'resinvest-erp';
const STORE = 'pliki';
const VERSION = 1;

let handle = null;

/** Otwiera magazyn; jedno połączenie na cały czas życia strony. */
function open() {
  if (handle) return handle;
  handle = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const idb = request.result;
      if (!idb.objectStoreNames.contains(STORE)) idb.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(
      'Magazyn danych jest zajęty przez inną kartę z tą aplikacją. Zamknij pozostałe karty.',
    ));
  });
  return handle;
}

function transaction(mode, run) {
  return open().then((idb) => new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    try {
      result = run(store);
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Zapis do magazynu przeglądarki został przerwany.'));
  }));
}

/** @returns {Promise<Uint8Array|null>} */
export async function readFile(key) {
  const value = await transaction('readonly', (store) => store.get(key));
  if (!value) return null;
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export function writeFile(key, bytes) {
  // Kopia bajtów: `export()` z SQLite zwraca widok na pamięć modułu WebAssembly,
  // która może zostać nadpisana zanim IndexedDB dokończy zapis.
  const copy = new Uint8Array(bytes);
  return transaction('readwrite', (store) => store.put(copy, key));
}

export function deleteFile(key) {
  return transaction('readwrite', (store) => store.delete(key));
}

export async function listKeys(prefix = '') {
  const keys = await transaction('readonly', (store) => store.getAllKeys());
  return (keys ?? []).filter((k) => String(k).startsWith(prefix));
}

/** Ile miejsca zajmują dane i ile przeglądarka jeszcze daje. */
export async function usage() {
  if (!navigator.storage?.estimate) return null;
  const { usage: used, quota } = await navigator.storage.estimate();
  return { used, quota };
}

/**
 * Prosi przeglądarkę o trwałość magazynu.
 *
 * Bez tego dane aplikacji są „najlepszym staraniem”: przy braku miejsca na
 * dysku przeglądarka może je usunąć bez pytania. Z przyznaną trwałością nie
 * usunie ich sama — potrzebna jest decyzja użytkownika.
 */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted?.()) return true;
  return navigator.storage.persist();
}
