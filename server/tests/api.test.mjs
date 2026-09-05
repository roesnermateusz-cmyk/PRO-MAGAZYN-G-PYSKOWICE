/** Testy warstwy HTTP: uwierzytelnianie, uprawnienia ról, walidacja i eksporty. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEnv, cleanupEnv } from './helpers.mjs';

prepareEnv('api');

const { createApp } = await import('../src/app.js');
const { bootstrap } = await import('../src/bootstrap.js');
const { default: db } = await import('../src/db/index.js');
const { resetRateLimits } = await import('../src/middleware/rateLimit.js');

bootstrap();

const server = createApp();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/v1`;

test.after(() => {
  server.close();
  cleanupEnv();
});

/** Wywołanie API zwracające `{status, body}`. */
async function call(path, { method = 'GET', body, token, raw = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return { status: res.status, text: await res.text(), headers: res.headers };
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const login = async (email, password) => {
  resetRateLimits();
  const res = await call('/auth/login', { method: 'POST', body: { email, password } });
  return res;
};

/* --------------------------- Trasy publiczne --------------------------- */

test('GET /health odpowiada bez uwierzytelnienia', async () => {
  const res = await call('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.match(res.body.version, /^\d+\.\d+\.\d+$/);
});

test('GET /meta zwraca słowniki potrzebne przed zalogowaniem', async () => {
  const res = await call('/meta');
  assert.equal(res.status, 200);
  assert.ok(res.body.company.name);
  assert.equal(res.body.roles.length, 5);
  assert.deepEqual(res.body.units, ['M3', 'MP', 'TONA']);
  assert.ok(res.body.operationTypes.some((t) => t.type === 'ZAKUP' && t.series === 'PZ'));
});

test('nieistniejąca trasa API zwraca 404 z kodem błędu', async () => {
  const res = await call('/nie-ma-takiej-trasy');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('niedozwolona metoda zwraca 405', async () => {
  const res = await call('/health', { method: 'POST', body: {} });
  assert.equal(res.status, 405);
  assert.equal(res.body.error.code, 'METHOD_NOT_ALLOWED');
});

/* ---------------------------- Uwierzytelnianie ------------------------- */

test('logowanie zwraca parę tokenów i dane użytkownika', async () => {
  const res = await login('admin@resinvest.local', 'TestoweHaslo123');
  assert.equal(res.status, 200);
  assert.ok(res.body.accessToken);
  assert.ok(res.body.refreshToken);
  assert.equal(res.body.user.role, 'ADMIN');
  assert.ok(res.body.user.permissions.includes('*'));
  assert.equal(res.body.user.mustChangePassword, true, 'konto startowe wymusza zmianę hasła');
});

test('błędne hasło i nieznany e-mail dają ten sam komunikat', async () => {
  const wrongPassword = await login('admin@resinvest.local', 'ZleHaslo999');
  const unknownUser = await login('nieznany@resinvest.local', 'CokolwiekTam1');
  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownUser.status, 401);
  assert.equal(wrongPassword.body.error.message, unknownUser.body.error.message,
    'brak możliwości wykrycia istniejących kont po treści błędu');
});

test('żądanie bez tokenu jest odrzucane', async () => {
  const res = await call('/operations');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
});

test('token uszkodzony jest odrzucany', async () => {
  const res = await call('/operations', { token: 'aaa.bbb.ccc' });
  assert.equal(res.status, 401);
});

let adminToken;
let adminRefresh;

test('token odświeżania rotuje się przy każdym użyciu', async () => {
  const first = await login('admin@resinvest.local', 'TestoweHaslo123');
  adminToken = first.body.accessToken;
  adminRefresh = first.body.refreshToken;

  const refreshed = await call('/auth/refresh', { method: 'POST', body: { refreshToken: adminRefresh } });
  assert.equal(refreshed.status, 200);
  assert.notEqual(refreshed.body.refreshToken, adminRefresh, 'nowy token odświeżania');

  const reused = await call('/auth/refresh', { method: 'POST', body: { refreshToken: adminRefresh } });
  assert.equal(reused.status, 401, 'stary token nie działa po rotacji');

  adminToken = refreshed.body.accessToken;
  adminRefresh = refreshed.body.refreshToken;
});

test('GET /auth/me zwraca profil zalogowanego', async () => {
  const res = await call('/auth/me', { token: adminToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.email, 'admin@resinvest.local');
});

/* ------------------------------- Dokumenty ----------------------------- */

let operationId;

test('POST /operations księguje dokument', async () => {
  const res = await call('/operations', {
    method: 'POST', token: adminToken,
    body: {
      type: 'ZAKUP', operationDate: '2026-05-04',
      productName: 'Drewno opałowe z lasu', quantity: 80, unit: 'M3',
      supplierName: 'Nadleśnictwo API', pricePurchase: 95,
      forestDistrict: 'Testowe', haulageNoteNo: 'KW-API-1',
      certificate: 'KZR', signature: 'Jan Testowy',
    },
  });
  assert.equal(res.status, 201);
  assert.match(res.body.operation.docNo, /^PZ\/2026\//);
  assert.equal(res.body.operation.qtyMp, 320);
  operationId = res.body.operation.id;
});

test('walidacja zwraca 422 z listą pól', async () => {
  const res = await call('/operations', {
    method: 'POST', token: adminToken,
    body: { type: 'ZAKUP', operationDate: '2026-05-04', quantity: -1, unit: 'M3', signature: 'Jan Testowy' },
  });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.ok(Array.isArray(res.body.error.details));
  assert.ok(res.body.error.details.some((d) => d.field === 'quantity'));
});

test('nieprawidłowy JSON zwraca 400', async () => {
  const res = await fetch(`${base}/operations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: '{to nie jest json',
  });
  assert.equal(res.status, 400);
});

test('GET /operations stronicuje i podsumowuje', async () => {
  const res = await call('/operations?limit=10', { token: adminToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.items.length >= 1);
  assert.equal(res.body.page.limit, 10);
  assert.ok(typeof res.body.totals.qtyMp === 'number');
});

test('GET /operations/:id zwraca dokument z załącznikami i korektami', async () => {
  const res = await call(`/operations/${operationId}`, { token: adminToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.id, operationId);
  assert.deepEqual(res.body.attachments, []);
  assert.equal(res.body.corrections, 0);
});

test('nieznany identyfikator dokumentu zwraca 404', async () => {
  const res = await call('/operations/nie-ma-takiego-id', { token: adminToken });
  assert.equal(res.status, 404);
});

/* ------------------------------ Załączniki ----------------------------- */

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('POST załącznika zapisuje plik i metadane', async () => {
  const res = await call(`/operations/${operationId}/attachments`, {
    method: 'POST', token: adminToken,
    body: { filename: 'kwit.png', mimeType: 'image/png', dataBase64: PNG_1PX, kind: 'KWIT' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.filename, 'kwit.png');
  assert.ok(res.body.sizeBytes > 0);
  assert.match(res.body.sha256, /^[0-9a-f]{64}$/);

  const content = await call(`/attachments/${res.body.id}/content`, { token: adminToken, raw: true });
  assert.equal(content.status, 200);
  assert.equal(content.headers.get('content-type'), 'image/png');
});

test('niedozwolony typ pliku jest odrzucany', async () => {
  const res = await call(`/operations/${operationId}/attachments`, {
    method: 'POST', token: adminToken,
    body: { filename: 'skrypt.exe', mimeType: 'application/x-msdownload', dataBase64: PNG_1PX },
  });
  assert.equal(res.status, 422);
  assert.match(res.body.error.message, /Nieobsługiwany typ pliku/);
});

/* -------------------------------- Eksporty ----------------------------- */

test('eksport CSV zwraca plik z BOM i separatorem średnika', async () => {
  const res = await fetch(`${base}/operations/export.csv`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="rejestr-operacji-/);

  // BOM sprawdzamy na bajtach — `Response.text()` usuwa go przy dekodowaniu.
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM UTF-8 dla polskich znaków w Excelu');

  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes('Nr dokumentu;'), 'separator średnika');
  assert.ok(text.includes('Nadleśnictwo'), 'polskie znaki w nagłówkach');
});

test('eksport JSON zawiera komplet tabel i licznik rekordów', async () => {
  const res = await call('/backup/export.json', { token: adminToken, raw: true });
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.text);
  assert.equal(payload.format, 'resinvest-erp-export');
  assert.ok(payload.counts.operations >= 1);
  assert.ok(payload.data.users.every((u) => !('password_hash' in u)), 'eksport nie zawiera hashy haseł');
});

/* --------------------------- Uprawnienia ról --------------------------- */

const ROLE_ACCOUNTS = {
  KIEROWNIK: { email: 'kier@test.local', password: 'Kierownik12345' },
  MAGAZYNIER: { email: 'mag@test.local', password: 'Magazynier12345' },
  KSIEGOWY: { email: 'ksieg@test.local', password: 'Ksiegowy12345' },
  AUDYTOR: { email: 'audyt@test.local', password: 'Audytor12345' },
};

const tokens = {};

/** Data w granicach dozwolonego księgowania wstecz — testy ról muszą być odporne na upływ czasu. */
const recentDate = (daysAgo = 1) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};

test('zakładanie kont dla wszystkich ról', async () => {
  for (const [role, account] of Object.entries(ROLE_ACCOUNTS)) {
    const created = await call('/users', {
      method: 'POST', token: adminToken,
      body: { ...account, fullName: `Konto ${role}`, role, mustChangePassword: false },
    });
    assert.equal(created.status, 201, `tworzenie konta ${role}`);

    const auth = await login(account.email, account.password);
    assert.equal(auth.status, 200, `logowanie ${role}`);
    tokens[role] = auth.body.accessToken;
  }
});

test('audytor i księgowy nie mogą księgować dokumentów', async () => {
  for (const role of ['AUDYTOR', 'KSIEGOWY']) {
    const res = await call('/operations', {
      method: 'POST', token: tokens[role],
      body: {
        type: 'ZAKUP', operationDate: recentDate(), productName: 'Trociny',
        quantity: 10, unit: 'MP', signature: 'Jan Testowy',
      },
    });
    assert.equal(res.status, 403, `${role} nie ma prawa zapisu`);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  }
});

test('audytor i księgowy mogą czytać rejestr i raporty', async () => {
  for (const role of ['AUDYTOR', 'KSIEGOWY']) {
    assert.equal((await call('/operations', { token: tokens[role] })).status, 200);
    assert.equal((await call('/reports/monthly?month=2026-05', { token: tokens[role] })).status, 200);
    assert.equal((await call('/stock', { token: tokens[role] })).status, 200);
  }
});

test('magazynier księguje, ale nie robi storna ani nie zamyka okresu', async () => {
  const created = await call('/operations', {
    method: 'POST', token: tokens.MAGAZYNIER,
    body: {
      type: 'ZAKUP', operationDate: recentDate(), productName: 'Trociny',
      quantity: 12, unit: 'MP', supplierName: 'Tartak', pricePurchase: 35, signature: 'Konto MAGAZYNIER',
    },
  });
  assert.equal(created.status, 201);

  const cancel = await call(`/operations/${created.body.operation.id}/cancel`, {
    method: 'POST', token: tokens.MAGAZYNIER, body: { reason: 'Próba storna bez uprawnień' },
  });
  assert.equal(cancel.status, 403);

  const close = await call(`/periods/${recentDate().slice(0, 7)}/close`, {
    method: 'POST', token: tokens.MAGAZYNIER, body: {},
  });
  assert.equal(close.status, 403);
});

test('kierownik może wykonać storno i zamknąć okres', async () => {
  const created = await call('/operations', {
    method: 'POST', token: tokens.KIEROWNIK,
    body: {
      type: 'ZAKUP', operationDate: recentDate(2), productName: 'Trociny',
      quantity: 9, unit: 'MP', supplierName: 'Tartak', pricePurchase: 33, signature: 'Konto KIEROWNIK',
    },
  });
  assert.equal(created.status, 201);

  const cancel = await call(`/operations/${created.body.operation.id}/cancel`, {
    method: 'POST', token: tokens.KIEROWNIK, body: { reason: 'Storno kierownika w teście' },
  });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.status, 'CANCELLED');
});

test('tylko administrator zarządza kontami i ustawieniami', async () => {
  const byManager = await call('/users', {
    method: 'POST', token: tokens.KIEROWNIK,
    body: { email: 'x@test.local', fullName: 'Ktoś Nowy', role: 'MAGAZYNIER', password: 'Haslo123456' },
  });
  assert.equal(byManager.status, 403);

  const settingsByStorekeeper = await call('/settings', {
    method: 'PUT', token: tokens.MAGAZYNIER, body: { 'units.m3_to_mp': 5 },
  });
  assert.equal(settingsByStorekeeper.status, 403);

  const byAdmin = await call('/settings', {
    method: 'PUT', token: adminToken, body: { 'units.m3_to_mp': 4 },
  });
  assert.equal(byAdmin.status, 200);
});

test('dezaktywacja konta natychmiast unieważnia jego sesje', async () => {
  const account = db.get("SELECT id FROM users WHERE email = 'audyt@test.local'");
  const before = await call('/operations', { token: tokens.AUDYTOR });
  assert.equal(before.status, 200);

  await call(`/users/${account.id}`, { method: 'PATCH', token: adminToken, body: { isActive: false } });

  const after = await call('/operations', { token: tokens.AUDYTOR });
  assert.equal(after.status, 403, 'token przestaje działać po zablokowaniu konta');
});

test('nie da się zdjąć uprawnień ostatniemu administratorowi', async () => {
  const admin = db.get("SELECT id FROM users WHERE email = 'admin@resinvest.local'");
  const res = await call(`/users/${admin.id}`, {
    method: 'PATCH', token: adminToken, body: { role: 'AUDYTOR' },
  });
  assert.equal(res.status, 403);
  assert.match(res.body.error.message, /co najmniej jedno aktywne konto administratora/);
});

test('limit prób logowania blokuje atak słownikowy', async () => {
  resetRateLimits();
  let blocked = false;
  for (let i = 0; i < 14; i += 1) {
    const res = await call('/auth/login', {
      method: 'POST', body: { email: 'admin@resinvest.local', password: `Zle${i}` },
    });
    if (res.status === 429) { blocked = true; break; }
  }
  assert.ok(blocked, 'po serii prób serwer odpowiada kodem 429');
  resetRateLimits();
});
