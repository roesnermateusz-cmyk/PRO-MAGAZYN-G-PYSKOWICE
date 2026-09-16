import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { requireCtx } from '../../core/context.js';
import { asyncHandler } from '../../middleware/async.js';
import { parseBody, parseIdParam, parseQuery } from '../../middleware/validate.js';
import {
  cancelSchema,
  correctSchema,
  documentInputSchema,
  documentListQuerySchema,
  documentUpdateSchema,
} from './documents.types.js';
import {
  cancelDocument,
  correctDocument,
  createDocument,
  deleteDraft,
  getDocument,
  listDocuments,
  postDocument,
  updateDocument,
} from './documents.service.js';

export const documentsRouter = Router();

documentsRouter.get(
  '/',
  asyncHandler((req, res) => {
    const { user } = requireCtx(req);
    const query = parseQuery(req, documentListQuerySchema);
    res.json(listDocuments(getDb(), user, query));
  }),
);

documentsRouter.get(
  '/:id',
  asyncHandler((req, res) => {
    const { user } = requireCtx(req);
    res.json(getDocument(getDb(), user, parseIdParam(req)));
  }),
);

documentsRouter.post(
  '/',
  asyncHandler((req, res) => {
    const { user, actor } = requireCtx(req);
    const input = parseBody(req, documentInputSchema);
    res.status(201).json(createDocument(getDb(), user, actor, input));
  }),
);

documentsRouter.put(
  '/:id',
  asyncHandler((req, res) => {
    const { user, actor } = requireCtx(req);
    const input = parseBody(req, documentUpdateSchema);
    res.json(updateDocument(getDb(), user, actor, parseIdParam(req), input));
  }),
);

documentsRouter.post(
  '/:id/post',
  asyncHandler((req, res) => {
    const { user, actor } = requireCtx(req);
    const { version } = parseBody(req, z.object({ version: z.number().int().positive() }));
    res.json(postDocument(getDb(), user, actor, parseIdParam(req), version));
  }),
);

documentsRouter.post(
  '/:id/cancel',
  asyncHandler((req, res) => {
    const { user, actor } = requireCtx(req);
    const { reason, version } = parseBody(req, cancelSchema);
    res.json(cancelDocument(getDb(), user, actor, parseIdParam(req), reason, version));
  }),
);

documentsRouter.post(
  '/:id/correct',
  asyncHandler((req, res) => {
    const { user, actor } = requireCtx(req);
    const { reason, version } = parseBody(req, correctSchema);
    res.status(201).json(correctDocument(getDb(), user, actor, parseIdParam(req), reason, version));
  }),
);

documentsRouter.delete(
  '/:id',
  asyncHandler((req, res) => {
    const { user, actor } = requireCtx(req);
    deleteDraft(getDb(), user, actor, parseIdParam(req));
    res.status(204).end();
  }),
);
