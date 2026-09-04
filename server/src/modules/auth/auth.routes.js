/** Trasy uwierzytelniania: /api/v1/auth/* */
import { Router } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import * as auth from './auth.service.js';

export function authRoutes(prefix) {
  const r = new Router(`${prefix}/auth`);

  const loginLimit = rateLimit({ name: 'login', max: 10, windowMs: 5 * 60_000 });

  r.post('/login', loginLimit, (ctx) => auth.login(ctx.body, ctx));
  r.post('/refresh', rateLimit({ name: 'refresh', max: 60, windowMs: 60_000 }), (ctx) => auth.refresh(ctx.body, ctx));
  r.post('/logout', requireAuth, (ctx) => auth.logout(ctx.body, ctx));
  r.get('/me', requireAuth, (ctx) => auth.me(ctx));
  r.post('/change-password', requireAuth, (ctx) => auth.changePassword(ctx.body, ctx));

  return r;
}
