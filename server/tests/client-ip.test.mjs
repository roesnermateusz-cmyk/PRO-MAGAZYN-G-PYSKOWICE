/**
 * Adres klienta zapisywany w dzienniku audytu (usterka A-1).
 *
 * `X-Forwarded-For` ustawia klient. Kiedy serwer wierzył mu bezwarunkowo,
 * o adresie w dzienniku decydował ten, kogo dziennik ma pilnować — wystarczył
 * jeden nagłówek, żeby własne działania podpisać cudzym adresem, a przy okazji
 * dać każdemu zmyślonemu adresowi własny licznik prób logowania.
 *
 * Testy pilnują obu stron przełącznika: domyślnie nagłówek jest ignorowany,
 * a przy `trustProxy` — i tylko wtedy — brany pod uwagę.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEnv, cleanupEnv } from './helpers.mjs';

prepareEnv('client-ip');

const { Router, createServer } = await import('../src/lib/http.js');

/** Serwer z jedną trasą odsyłającą adres, który rozpoznała warstwa HTTP. */
async function uruchom(opcje) {
  const router = new Router();
  router.get('/echo-ip', (ctx) => ({ ip: ctx.ip }));
  const server = createServer({ router, apiPrefix: '', ...opcje });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    /** Pyta o adres, podając w nagłówku wartość `podrobiony`. */
    async ip(podrobiony) {
      const res = await fetch(`http://127.0.0.1:${port}/echo-ip`, {
        headers: podrobiony ? { 'x-forwarded-for': podrobiony } : {},
      });
      return (await res.json()).ip;
    },
    close: () => server.close(),
  };
}

const lokalny = (ip) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

test.after(cleanupEnv);

test('domyślnie X-Forwarded-For nie ma wpływu na adres klienta', async () => {
  const s = await uruchom({});
  try {
    assert.ok(lokalny(await s.ip()), 'bez nagłówka ma być adres gniazda');
    assert.ok(
      lokalny(await s.ip('198.51.100.200')),
      'podrobiony nagłówek nie ma prawa podmienić adresu w dzienniku audytu',
    );
    // Lista adresów to typowa próba obejścia — pierwszy wpis pochodzi od klienta.
    assert.ok(lokalny(await s.ip('198.51.100.200, 10.0.0.1')));
  } finally {
    s.close();
  }
});

test('przy trustProxy adres bierze się z nagłówka — pierwszy wpis listy', async () => {
  const s = await uruchom({ trustProxy: true });
  try {
    assert.equal(await s.ip('198.51.100.200'), '198.51.100.200');
    assert.equal(await s.ip('198.51.100.200, 10.0.0.1'), '198.51.100.200');
    // Brak nagłówka za proxy — zostaje adres gniazda, nie pusty string.
    assert.ok(lokalny(await s.ip()));
  } finally {
    s.close();
  }
});

test('konfiguracja domyślnie nie ufa proxy', async () => {
  const { config } = await import('../src/config/env.js');
  assert.equal(config.http.trustProxy, false);
});
