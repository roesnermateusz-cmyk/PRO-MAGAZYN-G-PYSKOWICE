/** Trasy rejestru operacji: /api/v1/operations/* */
import { Router } from '../../lib/http.js';
import { guard } from '../../middleware/auth.js';
import * as ops from './operations.service.js';
import { createChain } from './chain.service.js';
import * as attachments from '../attachments/attachments.service.js';
import { exportOperationsCsv } from '../backup/backup.service.js';
import { listCorrections } from '../corrections/corrections.service.js';

export function operationRoutes(prefix) {
  const r = new Router(`${prefix}/operations`);

  r.get('', ...guard('operations:read'), (ctx) => ops.listOperations(ctx.query));

  // Eksport CSV rejestru — respektuje te same filtry co lista.
  r.get('/export.csv', ...guard('operations:read'), (ctx) => ctx.sendFile({
    filename: `rejestr-operacji-${new Date().toISOString().slice(0, 10)}.csv`,
    mime: 'text/csv; charset=utf-8',
    body: exportOperationsCsv(ctx.query, ctx),
  }));

  r.post('', ...guard('operations:write'), (ctx) => {
    ctx.status(201);
    return ops.createOperation(ctx.body, ctx);
  });

  /** Łańcuch terenowy: zakup → zużycie → produkcja → (sprzedaż). */
  r.post('/chain', ...guard('operations:write'), (ctx) => {
    ctx.status(201);
    return createChain(ctx.body, ctx);
  });

  r.get('/:id', ...guard('operations:read'), (ctx) => ops.getOperation(ctx.params.id));
  r.patch('/:id', ...guard('operations:write'), (ctx) => ops.updateOperation(ctx.params.id, ctx.body, ctx));
  r.post('/:id/cancel', ...guard('operations:cancel'), (ctx) => ops.cancelOperation(ctx.params.id, ctx.body, ctx));

  r.get('/:id/corrections', ...guard('corrections:read'),
    (ctx) => listCorrections({ operationId: ctx.params.id }));

  /* --- Załączniki dokumentu --- */
  r.get('/:id/attachments', ...guard('attachments:read'),
    (ctx) => ({ items: attachments.listAttachments(ctx.params.id) }));

  r.post('/:id/attachments', ...guard('attachments:write'), (ctx) => {
    ctx.status(201);
    return attachments.addAttachment(ctx.params.id, ctx.body, ctx);
  });

  return r;
}
