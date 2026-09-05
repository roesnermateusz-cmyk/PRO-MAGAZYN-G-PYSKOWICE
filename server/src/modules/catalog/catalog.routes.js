/** Trasy kartotek: /api/v1/{warehouses,products,partners,vehicles,forest,loading-places,catalog} */
import { Router } from '../../lib/http.js';
import { guard } from '../../middleware/auth.js';
import { audit } from '../../middleware/audit.js';
import {
  warehouses, products, partners, vehicles, forest, loadingPlaces, catalogSnapshot,
} from './catalog.service.js';

const asBool = (v) => v === 'true' || v === '1';

export function catalogRoutes(prefix) {
  const r = new Router(prefix);

  /* Komplet kartotek jednym żądaniem — używane przez formularz operacji. */
  r.get('/catalog', ...guard('catalog:read'), () => catalogSnapshot());

  /* --- Magazyny --- */
  r.get('/warehouses', ...guard('catalog:read'),
    (ctx) => ({ items: warehouses.list({ includeInactive: asBool(ctx.query.includeInactive) }) }));
  r.post('/warehouses', ...guard('catalog:write'), (ctx) => {
    const item = warehouses.create(ctx.body);
    audit(ctx, 'CREATE', 'warehouses', item.id, { name: item.name });
    ctx.status(201);
    return item;
  });
  r.patch('/warehouses/:id', ...guard('catalog:write'), (ctx) => {
    const item = warehouses.update(ctx.params.id, ctx.body);
    audit(ctx, 'UPDATE', 'warehouses', item.id);
    return item;
  });

  /* --- Produkty --- */
  r.get('/products', ...guard('catalog:read'), (ctx) => ({
    items: products.list({
      includeInactive: asBool(ctx.query.includeInactive),
      category: ctx.query.category || '',
    }),
  }));
  r.get('/products/:id', ...guard('catalog:read'), (ctx) => products.get(ctx.params.id));
  r.post('/products', ...guard('catalog:write'), (ctx) => {
    const item = products.create(ctx.body);
    audit(ctx, 'CREATE', 'products', item.id, { name: item.name });
    ctx.status(201);
    return item;
  });
  r.patch('/products/:id', ...guard('catalog:write'), (ctx) => {
    const item = products.update(ctx.params.id, ctx.body);
    audit(ctx, 'UPDATE', 'products', item.id);
    return item;
  });
  r.post('/products/:id/deactivate', ...guard('catalog:write'), (ctx) => {
    const item = products.deactivate(ctx.params.id);
    audit(ctx, 'DEACTIVATE', 'products', item.id);
    return item;
  });

  /* --- Kontrahenci --- */
  r.get('/partners', ...guard('catalog:read'), (ctx) => ({
    items: partners.search({
      includeInactive: asBool(ctx.query.includeInactive),
      kind: ctx.query.kind || '',
      q: ctx.query.q || '',
    }),
  }));
  r.get('/partners/:id', ...guard('catalog:read'), (ctx) => partners.get(ctx.params.id));
  r.post('/partners', ...guard('catalog:write'), (ctx) => {
    const item = partners.create(ctx.body);
    audit(ctx, 'CREATE', 'partners', item.id, { name: item.name });
    ctx.status(201);
    return item;
  });
  r.patch('/partners/:id', ...guard('catalog:write'), (ctx) => {
    const item = partners.update(ctx.params.id, ctx.body);
    audit(ctx, 'UPDATE', 'partners', item.id);
    return item;
  });

  /* --- Pojazdy --- */
  r.get('/vehicles', ...guard('catalog:read'),
    (ctx) => ({ items: vehicles.listWithCarrier({ includeInactive: asBool(ctx.query.includeInactive) }) }));
  r.post('/vehicles', ...guard('catalog:write'), (ctx) => {
    ctx.status(201);
    return vehicles.create(ctx.body);
  });
  r.patch('/vehicles/:id', ...guard('catalog:write'), (ctx) => vehicles.update(ctx.params.id, ctx.body));

  /* --- Nadleśnictwa i leśnictwa --- */
  r.get('/forest/districts', ...guard('catalog:read'), () => ({ items: forest.listDistricts() }));
  r.post('/forest/districts', ...guard('catalog:write'), (ctx) => {
    ctx.status(201);
    return forest.createDistrict(ctx.body);
  });
  r.get('/forest/ranges', ...guard('catalog:read'),
    (ctx) => ({ items: forest.listRanges({ districtId: ctx.query.districtId || '' }) }));
  r.post('/forest/ranges', ...guard('catalog:write'), (ctx) => {
    ctx.status(201);
    return forest.createRange(ctx.body);
  });

  /* --- Miejsca załadunku --- */
  r.get('/loading-places', ...guard('catalog:read'), () => ({ items: loadingPlaces.list() }));

  return r;
}
