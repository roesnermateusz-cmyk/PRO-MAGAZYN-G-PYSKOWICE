import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { ADMIN_PASSWORD, DEMO_PASSWORD, setupFixture, type TestFixture } from './helpers.js';
import { todayIsoDate } from '../src/core/time.js';

let app: Express;
let fx: TestFixture;
const today = todayIsoDate();

beforeAll(() => {
  app = createApp();
});

beforeEach(() => {
  fx = setupFixture();
});

async function login(loginName: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ login: loginName, password });
  return res;
}

async function tokenFor(loginName: string, password: string): Promise<string> {
  const res = await login(loginName, password);
  expect(res.status).toBe(200);
  return res.body.accessToken as string;
}

describe('uwierzytelnianie', () => {
  it('loguje poprawnymi danymi i zwraca profil z uprawnieniami', async () => {
    const res = await login('admin', ADMIN_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.user.login).toBe('admin');
    expect(res.body.user.isAdmin).toBe(true);
    expect(res.body.user.mustChangePassword).toBe(true);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.warehouses.length).toBe(3);
    // Hasz hasla nie moze wyciec w odpowiedzi API.
    expect(JSON.stringify(res.body)).not.toContain('scrypt$');
  });

  it('odrzuca bledne haslo tym samym komunikatem co nieistniejacy login', async () => {
    const wrongPassword = await login('admin', 'Zle#Haslo123');
    const missingUser = await login('nie-ma-takiego', 'Zle#Haslo123');
    expect(wrongPassword.status).toBe(401);
    expect(missingUser.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(missingUser.body.error.message);
  });

  it('blokuje dostep bez tokenu', async () => {
    const res = await request(app).get('/api/documents');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('odrzuca sfalszowany token', async () => {
    const res = await request(app).get('/api/documents').set('Authorization', 'Bearer nieprawidlowy.token.abc');
    expect(res.status).toBe(401);
  });

  it('odswieza sesje i uniewaznia zuzyty token odswiezania', async () => {
    const first = await login('manager', DEMO_PASSWORD);
    const refreshToken = first.body.refreshToken as string;

    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTruthy();

    // Rotacja tokenow: poprzedni token nie dziala ponownie.
    const reuse = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(reuse.status).toBe(401);
  });

  it('zmienia wlasne haslo i uniewaznia dotychczasowe sesje', async () => {
    const session = await login('manager', DEMO_PASSWORD);
    const token = session.body.accessToken as string;

    const changed = await request(app)
      .post('/api/auth/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: DEMO_PASSWORD, newPassword: 'NoweHaslo#2027' });
    expect(changed.status).toBe(200);

    const oldRefresh = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: session.body.refreshToken });
    expect(oldRefresh.status).toBe(401);
    expect((await login('manager', 'NoweHaslo#2027')).status).toBe(200);
    expect((await login('manager', DEMO_PASSWORD)).status).toBe(401);
  });

  it('odrzuca zbyt slabe nowe haslo', async () => {
    const token = await tokenFor('manager', DEMO_PASSWORD);
    const res = await request(app)
      .post('/api/auth/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: DEMO_PASSWORD, newPassword: 'slabehaslo1' });
    expect(res.status).toBe(400);
  });
});

describe('autoryzacja i role', () => {
  it('konto podgladu nie moze tworzyc dokumentow', async () => {
    const token = await tokenFor('podglad', DEMO_PASSWORD);
    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        docType: 'PZ',
        docDate: today,
        warehouseId: fx.warehouses.ZAB,
        supplierId: fx.partners['NADL-RUDY'],
        lines: [{ productId: fx.products['DREWNO-OPAL'], qtyBase: 10 }],
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('magazynier nie ma dostepu do administracji uzytkownikami', async () => {
    const token = await tokenFor('zabrze', DEMO_PASSWORD);
    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${token}`)).status).toBe(403);
    expect((await request(app).get('/api/audit').set('Authorization', `Bearer ${token}`)).status).toBe(403);
  });

  it('magazynier nie moze wystawic dokumentu dla obcego magazynu', async () => {
    const token = await tokenFor('zabrze', DEMO_PASSWORD);
    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        docType: 'PZ',
        docDate: today,
        warehouseId: fx.warehouses.ROK,
        supplierId: fx.partners['NADL-RUDY'],
        lines: [{ productId: fx.products['DREWNO-OPAL'], qtyBase: 10 }],
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WAREHOUSE_FORBIDDEN');
  });

  it('naglowek X-Warehouse-Id spoza uprawnien jest odrzucany', async () => {
    const token = await tokenFor('zabrze', DEMO_PASSWORD);
    const res = await request(app)
      .get('/api/stock')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Warehouse-Id', String(fx.warehouses.ROK));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WAREHOUSE_FORBIDDEN');
  });

  it('magazynier nie widzi dokumentow spoza swoich magazynow', async () => {
    const adminToken = await tokenFor('admin', ADMIN_PASSWORD);
    const created = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        docType: 'PZ',
        docDate: today,
        warehouseId: fx.warehouses.ROK,
        supplierId: fx.partners['NADL-RUDY'],
        lines: [{ productId: fx.products['DREWNO-OPAL'], qtyBase: 10 }],
      });
    expect(created.status).toBe(201);

    const zabrzeToken = await tokenFor('zabrze', DEMO_PASSWORD);
    const list = await request(app).get('/api/documents').set('Authorization', `Bearer ${zabrzeToken}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(0);

    const direct = await request(app)
      .get(`/api/documents/${created.body.id}`)
      .set('Authorization', `Bearer ${zabrzeToken}`);
    expect(direct.status).toBe(403);
  });

  it('dezaktywacja konta natychmiast blokuje istniejacy token', async () => {
    const managerToken = await tokenFor('manager', DEMO_PASSWORD);
    expect((await request(app).get('/api/stock').set('Authorization', `Bearer ${managerToken}`)).status).toBe(200);

    fx.db.prepare("UPDATE users SET is_active = 0 WHERE login = 'manager'").run();

    const after = await request(app).get('/api/stock').set('Authorization', `Bearer ${managerToken}`);
    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe('ACCOUNT_INACTIVE');
  });
});

describe('walidacja danych wejsciowych', () => {
  it('odrzuca nieistniejaca date', async () => {
    const token = await tokenFor('admin', ADMIN_PASSWORD);
    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        docType: 'PZ',
        docDate: '2026-02-30',
        warehouseId: fx.warehouses.ZAB,
        supplierId: fx.partners['NADL-RUDY'],
        lines: [{ productId: fx.products['DREWNO-OPAL'], qtyBase: 10 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('odrzuca ilosc zerowa i ujemna', async () => {
    const token = await tokenFor('admin', ADMIN_PASSWORD);
    for (const qtyBase of [0, -5]) {
      const res = await request(app)
        .post('/api/documents')
        .set('Authorization', `Bearer ${token}`)
        .send({
          docType: 'PZ',
          docDate: today,
          warehouseId: fx.warehouses.ZAB,
          supplierId: fx.partners['NADL-RUDY'],
          lines: [{ productId: fx.products['DREWNO-OPAL'], qtyBase }],
        });
      expect(res.status).toBe(400);
    }
  });

  it('odrzuca dokument bez pozycji', async () => {
    const token = await tokenFor('admin', ADMIN_PASSWORD);
    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ docType: 'PZ', docDate: today, warehouseId: fx.warehouses.ZAB, supplierId: fx.partners['NADL-RUDY'], lines: [] });
    expect(res.status).toBe(400);
  });

  it('odrzuca nieznane pola w zadaniu', async () => {
    const token = await tokenFor('admin', ADMIN_PASSWORD);
    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        docType: 'PZ',
        docDate: today,
        warehouseId: fx.warehouses.ZAB,
        supplierId: fx.partners['NADL-RUDY'],
        status: 'POSTED',
        lines: [{ productId: fx.products['DREWNO-OPAL'], qtyBase: 10 }],
      });
    expect(res.status).toBe(400);
  });

  it('nie jest podatny na wstrzykniecie SQL w parametrze wyszukiwania', async () => {
    const token = await tokenFor('admin', ADMIN_PASSWORD);
    const res = await request(app)
      .get('/api/documents')
      .query({ search: "'; DROP TABLE documents; --" })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(fx.db.prepare("SELECT name FROM sqlite_master WHERE name = 'documents'").get()).toBeTruthy();
  });

  it('odrzuca nieprawidlowy identyfikator w sciezce', async () => {
    const token = await tokenFor('admin', ADMIN_PASSWORD);
    expect((await request(app).get('/api/documents/abc').set('Authorization', `Bearer ${token}`)).status).toBe(400);
    expect((await request(app).get('/api/documents/999999').set('Authorization', `Bearer ${token}`)).status).toBe(404);
  });
});

describe('pelny przeplyw przez API', () => {
  it('PZ -> stan -> produkcja -> WZ -> raport -> audyt', async () => {
    const token = await tokenFor('admin', ADMIN_PASSWORD);
    const auth = { Authorization: `Bearer ${token}` };

    const pz = await request(app).post('/api/documents').set(auth).send({
      docType: 'PZ',
      docDate: today,
      warehouseId: fx.warehouses.ZAB,
      supplierId: fx.partners['NADL-RUDY'],
      forestTicketNo: 'KW/2026/00500',
      forestDistrict: 'Nadlesnictwo Rudy Raciborskie',
      forestSubdistrict: 'Lesnictwo Sobieszowice',
      lines: [{ productId: fx.products['DREWNO-OPAL'], qtyBase: 240, unitPrice: 165 }],
    });
    expect(pz.status).toBe(201);
    expect(pz.body.status).toBe('DRAFT');

    const postedPz = await request(app)
      .post(`/api/documents/${pz.body.id}/post`)
      .set(auth)
      .send({ version: pz.body.version });
    expect(postedPz.status).toBe(200);
    expect(postedPz.body.status).toBe('POSTED');

    const stock = await request(app).get('/api/stock').query({ warehouseId: fx.warehouses.ZAB }).set(auth);
    expect(stock.status).toBe(200);
    const drewno = stock.body.items.find((i: any) => i.productCode === 'DREWNO-OPAL');
    expect(drewno.qtyBase).toBe(240);
    expect(drewno.qtyMp).toBe(960);

    const prod = await request(app).post('/api/documents').set(auth).send({
      docType: 'PROD',
      docDate: today,
      warehouseId: fx.warehouses.ZAB,
      chippingMode: 'EXTERNAL',
      chippingCompany: 'Uslugi Lesne Debowiec',
      chippingRate: 12,
      lines: [
        { productId: fx.products['DREWNO-OPAL'], role: 'INPUT', qtyBase: 100 },
        { productId: fx.products.ZREBKA, role: 'OUTPUT', qtyBase: 400 },
      ],
    });
    expect(prod.status).toBe(201);
    await request(app).post(`/api/documents/${prod.body.id}/post`).set(auth).send({ version: prod.body.version });

    const wz = await request(app).post('/api/documents').set(auth).send({
      docType: 'WZ',
      docDate: today,
      warehouseId: fx.warehouses.ZAB,
      customerId: fx.partners['EC-ZABRZE'],
      lines: [{ productId: fx.products.ZREBKA, qtyBase: 180, unitPrice: 82 }],
    });
    await request(app).post(`/api/documents/${wz.body.id}/post`).set(auth).send({ version: wz.body.version });

    const finalStock = await request(app).get('/api/stock').query({ warehouseId: fx.warehouses.ZAB }).set(auth);
    const zrebka = finalStock.body.items.find((i: any) => i.productCode === 'ZREBKA');
    expect(zrebka.qtyBase).toBe(220);

    const report = await request(app).get('/api/reports/summary').query({ mode: 'year' }).set(auth);
    expect(report.status).toBe(200);
    const wzRow = report.body.byType.find((r: any) => r.docType === 'WZ');
    expect(wzRow.value).toBe(14760);

    const production = await request(app).get('/api/reports/production').query({ mode: 'year' }).set(auth);
    expect(production.body.items[0].chippingCompany).toBe('Uslugi Lesne Debowiec');
    expect(production.body.items[0].chippingCost).toBe(4800);
    expect(production.body.items[0].yield).toBe(4);

    const audit = await request(app).get('/api/audit').query({ module: 'receipts' }).set(auth);
    expect(audit.status).toBe(200);
    const postEntry = audit.body.items.find((i: any) => i.action === 'POST');
    expect(postEntry.userName).toBe('Administrator systemu');
    expect(postEntry.entityLabel).toBe(postedPz.body.docNumber);
    expect(postEntry.changes.find((c: any) => c.field === 'status')).toEqual({
      field: 'status',
      before: 'DRAFT',
      after: 'POSTED',
    });

    const csv = await request(app).get('/api/reports/export').query({ kind: 'stock', mode: 'year' }).set(auth);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('ZREBKA');
  });
});

describe('zalaczniki - skany dokumentow', () => {
  it('dodaje, pobiera i usuwa skan dokumentu PZ', async () => {
    const token = await tokenFor('admin', ADMIN_PASSWORD);
    const auth = { Authorization: `Bearer ${token}` };

    const pz = await request(app).post('/api/documents').set(auth).send({
      docType: 'PZ',
      docDate: today,
      warehouseId: fx.warehouses.ZAB,
      supplierId: fx.partners['NADL-RUDY'],
      lines: [{ productId: fx.products['DREWNO-OPAL'], qtyBase: 10 }],
    });

    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const uploaded = await request(app)
      .post(`/api/documents/${pz.body.id}/attachments`)
      .set(auth)
      .attach('file', pngBytes, { filename: 'kwit.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body).toHaveLength(1);

    const attachmentId = uploaded.body[0].id as string;
    const download = await request(app).get(`/api/attachments/${attachmentId}`).set(auth);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('image/png');

    const removed = await request(app).delete(`/api/attachments/${attachmentId}`).set(auth);
    expect(removed.status).toBe(204);
    expect((await request(app).get(`/api/attachments/${attachmentId}`).set(auth)).status).toBe(404);
  });

  it('odrzuca niedozwolony typ pliku', async () => {
    const token = await tokenFor('admin', ADMIN_PASSWORD);
    const auth = { Authorization: `Bearer ${token}` };
    const pz = await request(app).post('/api/documents').set(auth).send({
      docType: 'PZ',
      docDate: today,
      warehouseId: fx.warehouses.ZAB,
      supplierId: fx.partners['NADL-RUDY'],
      lines: [{ productId: fx.products['DREWNO-OPAL'], qtyBase: 10 }],
    });

    const res = await request(app)
      .post(`/api/documents/${pz.body.id}/attachments`)
      .set(auth)
      .attach('file', Buffer.from('MZ'), { filename: 'wirus.exe', contentType: 'application/x-msdownload' });
    expect(res.status).toBe(400);
  });
});

describe('ustawienia i slowniki', () => {
  it('administrator zmienia przeliczniki, co wplywa na nowe dokumenty', async () => {
    const token = await tokenFor('admin', ADMIN_PASSWORD);
    const auth = { Authorization: `Bearer ${token}` };

    const updated = await request(app)
      .put('/api/settings')
      .set(auth)
      .send({ key: 'conversion', value: { m3PerMp: 0.2, tPerMp: 0.3 } });
    expect(updated.status).toBe(200);

    const pz = await request(app).post('/api/documents').set(auth).send({
      docType: 'PZ',
      docDate: today,
      warehouseId: fx.warehouses.ZAB,
      supplierId: fx.partners['NADL-RUDY'],
      lines: [{ productId: fx.products['DREWNO-OPAL'], qtyBase: 100 }],
    });
    // 100 m3 przy przeliczniku 0.2 daje 500 MP i 150 t.
    expect(pz.body.lines[0].qtyMp).toBe(500);
    expect(pz.body.lines[0].qtyT).toBe(150);
  });

  it('odrzuca nieprawidlowe wartosci przelicznikow', async () => {
    const token = await tokenFor('admin', ADMIN_PASSWORD);
    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'conversion', value: { m3PerMp: 0, tPerMp: -1 } });
    expect(res.status).toBe(400);
  });

  it('manager nie moze zmieniac ustawien systemu', async () => {
    const token = await tokenFor('manager', DEMO_PASSWORD);
    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'rates', value: { transportPlnPerKm: 9, chippingDefaultMode: 'OWN', chippingPlnPerUnit: 12 } });
    expect(res.status).toBe(403);
  });

  it('blokuje zmiane jednostki bazowej produktu z historia ruchow', async () => {
    const token = await tokenFor('admin', ADMIN_PASSWORD);
    const auth = { Authorization: `Bearer ${token}` };
    const pz = await request(app).post('/api/documents').set(auth).send({
      docType: 'PZ',
      docDate: today,
      warehouseId: fx.warehouses.ZAB,
      supplierId: fx.partners['NADL-RUDY'],
      lines: [{ productId: fx.products['DREWNO-OPAL'], qtyBase: 10 }],
    });
    await request(app).post(`/api/documents/${pz.body.id}/post`).set(auth).send({ version: pz.body.version });

    const res = await request(app)
      .put(`/api/products/${fx.products['DREWNO-OPAL']}`)
      .set(auth)
      .send({ code: 'DREWNO-OPAL', name: 'Drewno opalowe', kind: 'RAW', baseUnit: 'MP', isActive: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IN_USE');
  });

  it('nie pozwala utworzyc magazynu o istniejacym kodzie', async () => {
    const token = await tokenFor('admin', ADMIN_PASSWORD);
    const res = await request(app)
      .post('/api/warehouses')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'ZAB', name: 'Duplikat' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE');
  });
});

describe('historia zmian', () => {
  it('audytu nie mozna zmodyfikowac ani usunac', () => {
    fx.db
      .prepare(
        `INSERT INTO audit_logs (occurred_at, user_id, user_login, user_name, action, module,
                                 entity_type, entity_id, entity_label, changes_json)
         VALUES ('2026-01-01T00:00:00.000Z', NULL, 'test', 'Test', 'CREATE', 'test', 'test', '1', 'x', '[]')`,
      )
      .run();
    expect(() => fx.db.prepare("UPDATE audit_logs SET action = 'HACK'").run()).toThrowError(/append-only/);
    expect(() => fx.db.prepare('DELETE FROM audit_logs').run()).toThrowError(/append-only/);
  });

  it('ruchow magazynowych nie mozna zmodyfikowac ani usunac', async () => {
    const token = await tokenFor('admin', ADMIN_PASSWORD);
    const auth = { Authorization: `Bearer ${token}` };
    const pz = await request(app).post('/api/documents').set(auth).send({
      docType: 'PZ',
      docDate: today,
      warehouseId: fx.warehouses.ZAB,
      supplierId: fx.partners['NADL-RUDY'],
      lines: [{ productId: fx.products['DREWNO-OPAL'], qtyBase: 10 }],
    });
    await request(app).post(`/api/documents/${pz.body.id}/post`).set(auth).send({ version: pz.body.version });

    expect(() => fx.db.prepare('UPDATE stock_movements SET qty_base = 999').run()).toThrowError(/append-only/);
    expect(() => fx.db.prepare('DELETE FROM stock_movements').run()).toThrowError(/append-only/);
  });
});

describe('diagnostyka', () => {
  it('endpoint health nie wymaga uwierzytelnienia', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('nie ujawnia mapy API przed uwierzytelnieniem', async () => {
    // Nieznana sciezka bez tokenu konczy sie na warstwie autoryzacji (401),
    // dzieki czemu anonimowy klient nie rozpozna, ktore endpointy istnieja.
    const anonymous = await request(app).get('/api/nie-ma-takiej-sciezki');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('nieznana sciezka dla zalogowanego zwraca 404 w formacie bledu', async () => {
    const token = await tokenFor('admin', ADMIN_PASSWORD);
    const res = await request(app)
      .get('/api/nie-ma-takiej-sciezki')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
