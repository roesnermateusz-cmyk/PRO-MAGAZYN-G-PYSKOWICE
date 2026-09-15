/**
 * Funkcje kryptograficzne wersji jednoplikowej.
 *
 * Zastępuje `server/src/lib/crypto.js`, który stoi na `node:crypto`.
 *
 * CZEGO TU NIE MA I DLACZEGO
 * Wersja jednoplikowa **nie ma logowania**. Plik otwiera się podwójnym
 * kliknięciem, a dane leżą w magazynie przeglądarki tego samego komputera —
 * ekran logowania chroniłby je przed nikim, bo kto ma plik i profil
 * przeglądarki, ma i dane. Udawanie zabezpieczenia jest gorsze niż jego brak:
 * użytkownik zakłada wtedy ochronę, której nie dostaje.
 *
 * Konta w tej wersji są więc **listą operatorów**, nie kontami do logowania:
 * decydują, kto podpisuje dokument i jakie akcje pokazuje interfejs (rola).
 * Hasła nie są przechowywane — `hashPassword` zapisuje jawny znacznik,
 * a `verifyPassword` zawsze odmawia.
 *
 * Ochrona danych w tej wersji opiera się na czym innym: na kopii zapasowej
 * (eksport pliku bazy) i na szyfrowaniu dysku komputera.
 *
 * SHA-256 jest zaimplementowany na miejscu, bo `crypto.subtle` jest
 * asynchroniczne, a serwisy — na przykład liczenie sumy kontrolnej załącznika —
 * wołają skrót synchronicznie.
 */

/* ---------------------------- Identyfikatory --------------------------- */

export const uuid = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  // Zapasowo dla przeglądarek bez `randomUUID` przy otwarciu z pliku.
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = randomBytes(1)[0] % 16;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

function randomBytes(count) {
  const out = new Uint8Array(count);
  globalThis.crypto.getRandomValues(out);
  return out;
}

const base64url = (bytes) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const shortId = (bytes = 8) => base64url(randomBytes(bytes));

export const newRefreshToken = () => base64url(randomBytes(48));

/* ------------------------------- SHA-256 ------------------------------- */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

/** SHA-256 nad bajtami; wynik szesnastkowy. */
function sha256Bytes(bytes) {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const length = bytes.length;
  // Dopełnienie: bajt 0x80, zera, i 8 bajtów długości — wszystko w pełnych
  // blokach po 64 bajty. Wyrażenie musi używać `+ 8`, nie `+ 9`: przy długości
  // 55 bajtów komunikat mieści się w jednym bloku co do bajta, a nadmiarowy
  // blok zer daje inny skrót (wyłapane testem zgodności z node:crypto).
  const withPadding = new Uint8Array((((length + 8) >> 6) + 1) << 6);
  withPadding.set(bytes);
  withPadding[length] = 0x80;
  const bitLength = length * 8;
  const view = new DataView(withPadding.buffer);
  view.setUint32(withPadding.length - 4, bitLength >>> 0);
  view.setUint32(withPadding.length - 8, Math.floor(bitLength / 2 ** 32));

  const w = new Uint32Array(64);
  for (let offset = 0; offset < withPadding.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return [...h].map((x) => x.toString(16).padStart(8, '0')).join('');
}

export const sha256 = (value) => sha256Bytes(new TextEncoder().encode(String(value)));

export const sha256Buffer = (buf) => sha256Bytes(
  buf instanceof Uint8Array ? buf : new Uint8Array(buf),
);

/* -------------------------------- Hasła -------------------------------- */

/** Znacznik zapisywany zamiast skrótu hasła — patrz nagłówek modułu. */
const NO_LOGIN = 'brak-logowania$wersja-jednoplikowa';

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Hasło musi mieć co najmniej 8 znaków.');
  }
  return NO_LOGIN;
}

export function verifyPassword() {
  return false;
}

/** Ta sama polityka, co w wersji serwerowej — używana przy zakładaniu konta. */
export function passwordIssues(password) {
  const issues = [];
  if (typeof password !== 'string' || password.length < 10) issues.push('minimum 10 znaków');
  if (!/[a-ząćęłńóśźż]/.test(password || '')) issues.push('co najmniej jedna mała litera');
  if (!/[A-ZĄĆĘŁŃÓŚŹŻ]/.test(password || '')) issues.push('co najmniej jedna wielka litera');
  if (!/[0-9]/.test(password || '')) issues.push('co najmniej jedna cyfra');
  return issues;
}

/* -------------------------------- Tokeny ------------------------------- */

/**
 * Identyfikator bieżącego operatora. Ustawiany przy starcie i przy zmianie
 * operatora w interfejsie; `verifyToken` zwraca go zamiast rozpakowywać JWT.
 */
let localSubject = null;

export const setLocalSubject = (userId) => { localSubject = userId; };
export const getLocalSubject = () => localSubject;

export function signToken() {
  return 'lokalna-sesja';
}

/**
 * Wersja jednoplikowa nie weryfikuje podpisu — nie ma dwóch stron, między
 * którymi token miałby cokolwiek potwierdzać. Zwraca bieżącego operatora,
 * a resztę kontroli (czy konto istnieje, czy jest aktywne) wykonuje
 * niezmieniony `middleware/auth.js`.
 */
export function verifyToken() {
  return { sub: localSubject, sid: 'lokalna-sesja' };
}
