/**
 * Nagłówek `Content-Disposition` przy pobieraniu plików (usterka C-4).
 *
 * Nazwa pliku szła przez `encodeURIComponent`, więc „Kwit produkcji.csv”
 * lądował na dysku jako `Kwit%20produkcji.csv`. Teraz idzie w dwóch
 * wariantach (RFC 6266): zubożonym do ASCII i pełnym UTF-8.
 *
 * Nazwa bierze się m.in. z pliku wgranego przez użytkownika, więc testy
 * pilnują też, żeby nie dało się nią rozciąć nagłówka ani wyjść z katalogu.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEnv, cleanupEnv } from './helpers.mjs';

prepareEnv('send-file');

const { Router, createServer } = await import('../src/lib/http.js');

const router = new Router();
router.get('/plik', (ctx) => {
  ctx.sendFile({
    filename: ctx.query.n ?? 'raport.csv',
    mime: 'text/csv; charset=utf-8',
    body: 'a;b\n1;2\n',
  });
});

const server = createServer({ router, apiPrefix: '' });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

test.after(() => {
  server.close();
  cleanupEnv();
});

/** Zwraca nagłówek `Content-Disposition` dla podanej nazwy pliku. */
async function naglowek(nazwa) {
  const res = await fetch(`http://127.0.0.1:${port}/plik?n=${encodeURIComponent(nazwa)}`);
  await res.arrayBuffer();
  return res.headers.get('content-disposition');
}

test('polska nazwa pliku jedzie w wariancie UTF-8 i czytelnym ASCII', async () => {
  const h = await naglowek('Kwit produkcji — wrzesień.csv');

  // RFC 5987: to z tego wariantu przeglądarka odtworzy polskie znaki.
  assert.match(h, /filename\*=UTF-8''/);
  assert.equal(
    decodeURIComponent(h.match(/filename\*=UTF-8''(\S+)$/)[1]),
    'Kwit produkcji — wrzesień.csv',
  );

  // Wariant zapasowy ma być czytelny, a nie ciągiem procentów.
  const ascii = h.match(/filename="([^"]*)"/)[1];
  assert.equal(ascii, 'Kwit produkcji - wrzesien.csv');
  assert.doesNotMatch(ascii, /%[0-9A-F]{2}/i, 'wariant ASCII nie może być procentowany');
});

test('wszystkie polskie znaki diakrytyczne mają odpowiednik ASCII', async () => {
  const h = await naglowek('ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ.pdf');
  assert.equal(h.match(/filename="([^"]*)"/)[1], 'acelnoszz ACELNOSZZ.pdf');
});

test('typografia z nazw raportów schodzi do czytelnego ASCII', async () => {
  const h = await naglowek('Raport „wrzesień” — zestawienie… (I–III).csv');
  assert.equal(
    h.match(/filename="([^"]*)"/)[1],
    "Raport 'wrzesien' - zestawienie... (I-III).csv",
  );
});

test('nazwa nie rozcina nagłówka ani nie wychodzi z katalogu', async () => {
  for (const zla of [
    'zwykly"; x="1.csv',
    'a\r\nX-Wstrzykniety: tak.csv',
    '../../etc/passwd',
    // Cudzysłów drukarski: transliteracja zamieniała go na zwykły `"`,
    // czyli wstrzykiwała cudzysłów do parametru stojącego w cudzysłowie.
    '„nazwa”; x="1.csv',
  ]) {
    const h = await naglowek(zla);
    // Dokładnie dwa parametry i żadnego znaku łamiącego nagłówek.
    assert.doesNotMatch(h, /[\r\n]/);
    assert.equal(h.match(/filename="/g).length, 1, `nadmiarowy parametr dla: ${zla}`);
    assert.doesNotMatch(h.match(/filename="([^"]*)"/)[1], /[/\\]/);
  }
});

test('nagłówek zachowuje sposób podania pliku', async () => {
  assert.match(await naglowek('a.csv'), /^attachment; /);
});
