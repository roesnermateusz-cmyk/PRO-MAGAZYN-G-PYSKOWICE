import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { rateLimit } from '../src/middleware/rateLimit.js';
import { errorHandler } from '../src/middleware/error.js';

function appWithLimit(max: number) {
  const app = express();
  app.use(rateLimit({ windowMs: 60_000, max, keyPrefix: 'test', enforceInTests: true }));
  app.get('/probe', (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe('ograniczanie liczby zadan', () => {
  it('przepuszcza zadania do limitu i blokuje nadmiarowe', async () => {
    const app = appWithLimit(3);

    for (let i = 0; i < 3; i += 1) {
      expect((await request(app).get('/probe')).status).toBe(200);
    }

    const blocked = await request(app).get('/probe');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeTruthy();
  });

  it('kazdy limiter ma niezalezny licznik', async () => {
    const first = appWithLimit(1);
    const second = appWithLimit(1);
    expect((await request(first).get('/probe')).status).toBe(200);
    expect((await request(first).get('/probe')).status).toBe(429);
    expect((await request(second).get('/probe')).status).toBe(200);
  });
});
