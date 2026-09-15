/**
 * Proces potomny księgujący dokumenty do wskazanej bazy.
 *
 * Używany przez `concurrency-processes.test.mjs`. Nie jest testem — nazwa pliku
 * celowo nie pasuje do wzorca `*.test.mjs`, żeby `npm test` go nie uruchamiał.
 *
 *   node post-documents.mjs <plik-bazy> <ile-dokumentów> <etykieta>
 */
const [plikBazy, ile, etykieta] = process.argv.slice(2);

process.env.NODE_ENV = 'test';
process.env.DB_FILE = plikBazy;
process.env.LOG_LEVEL = 'error';
process.env.LOG_FILE = '';
process.env.AUTH_SECRET = 'test-secret-klucz-do-testow-minimum-32-znaki';
process.env.PORT = '0';

const { default: db } = await import('../../src/db/index.js');
const { createOperation } = await import('../../src/modules/operations/operations.service.js');

const admin = db.get("SELECT id, email, full_name FROM users WHERE role = 'ADMIN' LIMIT 1");
const ctx = {
  user: { id: admin.id, email: admin.email, fullName: admin.full_name, role: 'ADMIN' },
  ip: '127.0.0.1',
  userAgent: `proces-${etykieta}`,
};

const dzis = new Date().toISOString().slice(0, 10);
const numery = [];

for (let i = 0; i < Number(ile); i += 1) {
  const { operation } = createOperation({
    type: 'ZAKUP',
    operationDate: dzis,
    productName: 'Drewno opałowe z lasu',
    quantity: 1,
    unit: 'MP',
    supplierName: `Dostawca ${etykieta}`,
    pricePurchase: 90,
    signature: 'Jan Testowy',
  }, ctx);
  numery.push(operation.docNo);
}

// Wynik idzie przez stdout — proces nadrzędny zbiera numery i szuka duplikatów.
process.stdout.write(JSON.stringify({ etykieta, numery }));
