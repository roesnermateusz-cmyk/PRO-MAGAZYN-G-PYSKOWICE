/**
 * Łańcuch operacji terenowych — jedno zdarzenie w lesie, komplet dokumentów.
 *
 * Realny przebieg: kupujemy drewno przy drodze leśnej, rębak przerabia je na
 * miejscu, a zrębka jedzie albo na plac, albo prosto do elektrowni. Magazynier
 * wypełnia jeden formularz, a system księguje spójny komplet dokumentów:
 *
 *   PZ — przyjęcie surowca (zakup od nadleśnictwa)
 *   RW — rozchód surowca do produkcji (zużycie)
 *   PW — przyjęcie wyrobu (zrębka po rąbaniu)
 *   WZ — wydanie do odbiorcy (opcjonalnie, gdy zrębka jedzie prosto z lasu)
 *
 * Wszystkie dokumenty łączy `chain_ref` (numer PZ), więc łańcuch da się
 * odtworzyć, wydrukować i anulować jako całość.
 *
 * Zasady kosztów (żeby nie liczyć ich podwójnie):
 *  • cena zakupu surowca — wyłącznie na PZ,
 *  • koszt rąbania — wyłącznie na PW,
 *  • transport i kwit wywozowy — na tym dokumencie, który opisuje faktyczny
 *    wywóz zrębki: PW (wywóz na plac) albo WZ (wywóz do odbiorcy).
 */
import db from '../../db/index.js';
import { validate } from '../../lib/validate.js';
import { ValidationError } from '../../lib/errors.js';
import { createOperation, getOperation } from './operations.service.js';
import { products } from '../catalog/catalog.service.js';
import { resolveFactors, computeQuantities } from '../../domain/units.js';
import { getUnitFactors } from '../settings/settings.service.js';
import { audit } from '../../middleware/audit.js';

const CHAIN_SCHEMA = {
  produceChips: { type: 'bool', default: true, label: 'Produkcja zrębki' },
  sellDirectly: { type: 'bool', default: false, label: 'Sprzedaż prosto z lasu' },
  chipProductName: { type: 'string', max: 120, default: 'Zrębka Produkcyjna Leśna', label: 'Produkt wyjściowy' },
  chipProductId: { type: 'string', max: 40, label: 'Produkt wyjściowy (kartoteka)' },
  chipQuantityMp: { type: 'number', min: 0, max: 1_000_000, label: 'Wolumen zrębki (MP)' },
  saleRecipient: { type: 'string', max: 160, label: 'Odbiorca' },
  salePrice: { type: 'number', min: 0, max: 1_000_000, label: 'Cena sprzedaży' },
  saleUnit: { type: 'enum', values: ['M3', 'MP', 'TONA'], default: 'MP', label: 'Jednostka sprzedaży' },
};

/**
 * Księguje cały łańcuch w jednej transakcji.
 *
 * @param {object} input `{ purchase: {...}, chain: {...} }`
 * @param {object} ctx kontekst żądania
 * @returns {{chainRef:string, operations:object[], warnings:string[]}}
 */
export function createChain(input, ctx) {
  const chain = validate(input.chain ?? {}, CHAIN_SCHEMA);
  const purchaseInput = { ...(input.purchase ?? {}), type: 'ZAKUP' };

  if (!chain.produceChips) {
    const { operation, warnings } = createOperation(purchaseInput, ctx);
    return { chainRef: operation.docNo, operations: [operation], warnings };
  }
  if (chain.sellDirectly && (!chain.saleRecipient || !(chain.salePrice > 0))) {
    throw new ValidationError('Sprzedaż prosto z lasu wymaga odbiorcy i ceny większej od zera.', [
      { field: 'saleRecipient', message: 'Podaj odbiorcę zrębki.' },
      { field: 'salePrice', message: 'Podaj cenę sprzedaży.' },
    ]);
  }

  return db.tx(() => {
    const warnings = [];

    /* --- 1. PZ — zakup surowca ------------------------------------- */
    // Surowiec nie zostaje na placu: wchodzi i od razu schodzi dokumentem RW.
    const purchase = createOperation(
      { ...purchaseInput, isStored: false, priceSale: 0, chippingPrice: 0, haulageNoteNo: '', carrierName: '', vehiclePlate: '', distanceKm: 0, transportCost: 0 },
      ctx,
    );
    warnings.push(...purchase.warnings);
    const chainRef = purchase.operation.docNo;
    const p = purchase.operation;
    db.run('UPDATE operations SET chain_ref = :ref WHERE id = :id', { ref: chainRef, id: p.id });

    /** Pola wspólne dla wszystkich ogniw (pochodzenie, las, strony, podpis). */
    const common = {
      operationDate: p.operationDate,
      loadingDate: p.loadingDate,
      certificate: p.certificate,
      forestDistrict: p.forestDistrict,
      forestRange: p.forestRange,
      loadingPlace: p.loadingPlace,
      originPlace: p.originPlace,
      supplierName: p.supplierName,
      grade: p.grade,
      signature: p.signature,
      chainRef,
      parentId: p.id,
    };

    /* --- 2. RW — zużycie surowca na produkcję ----------------------- */
    const consumption = createOperation({
      ...common,
      type: 'ZUZYCIE',
      productId: p.productId,
      quantity: p.quantity,
      unit: p.unit,
      m3Mode: p.m3Mode, m3Manual: p.m3Manual,
      mpMode: p.mpMode, mpManual: p.mpManual,
      tonneMode: p.tonneMode, tonneManual: p.tonneManual,
      warehouseFrom: p.warehouseTo,
      isStored: false,
      notes: `Zużycie surowca do produkcji zrębki (łańcuch ${chainRef}).`,
    }, ctx);
    warnings.push(...consumption.warnings);

    /* --- 3. PW — produkcja zrębki ----------------------------------- */
    const chipProduct = chain.chipProductId
      ? products.get(chain.chipProductId)
      : products.ensure(chain.chipProductName, 'ZREBKA');

    // Domyślny uzysk: cały wolumen surowca przeliczony na MP przelicznikiem produktu wyjściowego.
    const chipQuantity = chain.chipQuantityMp > 0 ? chain.chipQuantityMp : p.qtyMp;
    if (!(chipQuantity > 0)) {
      throw new ValidationError('Wolumen wyprodukowanej zrębki musi być większy od zera.');
    }

    const production = createOperation({
      ...common,
      type: 'PRODUKCJA',
      productId: chipProduct.id,
      quantity: chipQuantity,
      unit: 'MP',
      warehouseTo: p.warehouseTo,
      chippingMode: input.purchase?.chippingMode ?? null,
      chippingPrice: input.purchase?.chippingPrice ?? 0,
      isStored: !chain.sellDirectly,
      // Wywóz na plac — kwit i transport zostają przy produkcji.
      haulageNoteNo: chain.sellDirectly ? '' : (input.purchase?.haulageNoteNo ?? ''),
      carrierName: chain.sellDirectly ? '' : (input.purchase?.carrierName ?? ''),
      vehiclePlate: chain.sellDirectly ? '' : (input.purchase?.vehiclePlate ?? ''),
      distanceKm: chain.sellDirectly ? 0 : (input.purchase?.distanceKm ?? 0),
      transportCost: chain.sellDirectly ? 0 : (input.purchase?.transportCost ?? 0),
      notes: chain.sellDirectly
        ? `Produkcja zrębki w lesie — wywóz prosto do odbiorcy (łańcuch ${chainRef}).`
        : `Produkcja zrębki w lesie — wywóz na plac (łańcuch ${chainRef}).`,
    }, ctx);
    warnings.push(...production.warnings);

    const operations = [
      getOperation(p.id),
      consumption.operation,
      production.operation,
    ];

    /* --- 4. WZ — sprzedaż prosto z lasu (opcjonalnie) --------------- */
    if (chain.sellDirectly) {
      const saleQuantity = convertMpTo(chipQuantity, chain.saleUnit, chipProduct);
      const sale = createOperation({
        ...common,
        type: 'SPRZEDAZ',
        productId: chipProduct.id,
        quantity: saleQuantity,
        unit: chain.saleUnit,
        warehouseFrom: p.warehouseTo,
        recipientName: chain.saleRecipient,
        priceSale: chain.salePrice,
        isStored: false,
        haulageNoteNo: input.purchase?.haulageNoteNo ?? '',
        carrierName: input.purchase?.carrierName ?? '',
        vehiclePlate: input.purchase?.vehiclePlate ?? '',
        distanceKm: input.purchase?.distanceKm ?? 0,
        transportCost: input.purchase?.transportCost ?? 0,
        notes: `Sprzedaż zrębki prosto z lasu do odbiorcy (łańcuch ${chainRef}).`,
      }, ctx);
      warnings.push(...sale.warnings);
      operations.push(sale.operation);
    }

    audit(ctx, 'CREATE_CHAIN', 'operations', p.id, {
      chainRef, documents: operations.map((o) => o.docNo),
    });

    return { chainRef, operations, warnings: [...new Set(warnings)] };
  });
}

/** Przelicza wolumen MP na jednostkę sprzedaży przy użyciu przeliczników produktu. */
function convertMpTo(qtyMp, unit, product) {
  if (unit === 'MP') return qtyMp;
  const factors = resolveFactors(products.getRaw(product.id), getUnitFactors());
  const q = computeQuantities({ quantity: qtyMp, unit: 'MP', factors });
  return unit === 'TONA' ? q.qtyTonne : q.qtyM3;
}
