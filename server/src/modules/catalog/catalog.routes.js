/** Trasy kartotek: /api/v1/{warehouses,products,partners,vehicles,forest,loading-places,catalog} */
import { Router } from '../../lib/http.js';
import { guard, requireAuth } from '../../middleware/auth.js';
// Wpisy do dziennika audytu robi warstwa serwisowa — trasa tylko podaje jej
// kontekst żądania. Inaczej każda nowa kartoteka wymagałaby pamiętania o tym
// w dwóch miejscach naraz, a pojazdy i nadleśnictwa wypadły właśnie tak.
import {
  warehousesForUser, deactivateWarehouse, activateWarehouse,
} from './warehouse-access.service.js';
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

  /** Place, w których zalogowany może pracować — źródło przełącznika magazynu. */
  r.get('/warehouses/mine', requireAuth, (ctx) => ({ items: warehousesForUser(ctx.user) }));
  r.post('/warehouses', ...guard('catalog:write'), (ctx) => {
    ctx.status(201);
    return warehouses.create(ctx.body, ctx);
  });
  r.patch('/warehouses/:id', ...guard('catalog:write'),
    (ctx) => warehouses.update(ctx.params.id, ctx.body, ctx));
  r.post('/warehouses/:id/deactivate', ...guard('catalog:write'),
    (ctx) => deactivateWarehouse(ctx.params.id, ctx));
  r.post('/warehouses/:id/activate', ...guard('catalog:write'),
    (ctx) => activateWarehouse(ctx.params.id, ctx));

  /* --- Produkty --- */
  r.get('/products', ...guard('catalog:read'), (ctx) => ({
    items: products.list({
      includeInactive: asBool(ctx.query.includeInactive),
      category: ctx.query.category || '',
    }),
  }));
  r.get('/products/:id', ...guard('catalog:read'), (ctx) => products.get(ctx.params.id));
  r.post('/products', ...guard('catalog:write'), (ctx) => {
    ctx.status(201);
    return products.create(ctx.body, ctx);
  });
  r.patch('/products/:id', ...guard('catalog:write'),
    (ctx) => products.update(ctx.params.id, ctx.body, ctx));
  r.post('/products/:id/deactivate', ...guard('catalog:write'),
    (ctx) => products.deactivate(ctx.params.id, ctx));

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
    ctx.status(201);
    return partners.create(ctx.body, ctx);
  });
  r.patch('/partners/:id', ...guard('catalog:write'),
    (ctx) => partners.update(ctx.params.id, ctx.body, ctx));

  /* --- Pojazdy --- */
  r.get('/vehicles', ...guard('catalog:read'),
    (ctx) => ({ items: vehicles.listWithCarrier({ includeInactive: asBool(ctx.query.includeInactive) }) }));
  r.post('/vehicles', ...guard('catalog:write'), (ctx) => {
    ctx.status(201);
    return vehicles.create(ctx.body, ctx);
  });
  r.patch('/vehicles/:id', ...guard('catalog:write'),
    (ctx) => vehicles.update(ctx.params.id, ctx.body, ctx));

  /* --- Nadleśnictwa i leśnictwa --- */
  r.get('/forest/districts', ...guard('catalog:read'), () => ({ items: forest.listDistricts() }));
  r.post('/forest/districts', ...guard('catalog:write'), (ctx) => {
    ctx.status(201);
    return forest.createDistrict(ctx.body, ctx);
  });
  r.get('/forest/ranges', ...guard('catalog:read'),
    (ctx) => ({ items: forest.listRanges({ districtId: ctx.query.districtId || '' }) }));
  r.post('/forest/ranges', ...guard('catalog:write'), (ctx) => {
    ctx.status(201);
    return forest.createRange(ctx.body, ctx);
  });

  /* --- Miejsca załadunku --- */
  r.get('/loading-places', ...guard('catalog:read'), () => ({ items: loadingPlaces.list() }));

  return r;
}
