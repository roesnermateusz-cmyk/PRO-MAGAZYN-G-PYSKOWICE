import { beforeEach, describe, expect, it } from 'vitest';
import { actingUser, docBase, line, setupFixture, stockOf, type TestFixture } from './helpers.js';
import {
  cancelDocument,
  correctDocument,
  createDocument,
  deleteDraft,
  getDocument,
  listDocuments,
  postDocument,
  updateDocument,
} from '../src/modules/documents/documents.service.js';
import { verifyStockIntegrity } from '../src/modules/documents/stock.engine.js';
import { documentListQuerySchema, type DocumentInput } from '../src/modules/documents/documents.types.js';
import { AppError } from '../src/core/errors.js';
import { todayIsoDate } from '../src/core/time.js';

let fx: TestFixture;
const today = todayIsoDate();

beforeEach(() => {
  fx = setupFixture();
});

function admin() {
  return actingUser(fx.db, 'admin');
}

function makePz(qty: number, warehouseCode = 'ZAB', unitPrice = 165): DocumentInput {
  return {
    ...docBase(),
    docType: 'PZ',
    docDate: today,
    warehouseId: fx.warehouses[warehouseCode] as number,
    supplierId: fx.partners['NADL-RUDY'] as number,
    forestTicketNo: 'KW/2026/00001',
    forestDistrict: 'Nadlesnictwo Rudy Raciborskie',
    forestSubdistrict: 'Lesnictwo Sobieszowice',
    lines: [line(fx.products['DREWNO-OPAL'] as number, qty, { unitPrice })],
  };
}

function createAndPost(input: DocumentInput) {
  const { user, actor } = admin();
  const draft = createDocument(fx.db, user, actor, input);
  return postDocument(fx.db, user, actor, draft.id, draft.version);
}

describe('przyjecie PZ', () => {
  it('zwieksza stan magazynowy dopiero po zatwierdzeniu', () => {
    const { user, actor } = admin();
    const draft = createDocument(fx.db, user, actor, makePz(240));

    expect(draft.status).toBe('DRAFT');
    expect(stockOf(fx.db, fx.warehouses.ZAB as number, fx.products['DREWNO-OPAL'] as number)).toBe(0);

    const posted = postDocument(fx.db, user, actor, draft.id, draft.version);
    expect(posted.status).toBe('POSTED');
    expect(stockOf(fx.db, fx.warehouses.ZAB as number, fx.products['DREWNO-OPAL'] as number)).toBe(240);
  });

  it('zapisuje dane kwitu wywozowego z nadlesnictwa', () => {
    const doc = createAndPost(makePz(100));
    expect(doc.forestTicketNo).toBe('KW/2026/00001');
    expect(doc.forestDistrict).toBe('Nadlesnictwo Rudy Raciborskie');
    expect(doc.forestSubdistrict).toBe('Lesnictwo Sobieszowice');
  });

  it('wylicza wartosc dokumentu bez bledu zaokraglenia', () => {
    const doc = createAndPost(makePz(240, 'ZAB', 165.15));
    expect(doc.totalValue).toBe(39636);
  });

  it('nadaje kolejne numery w obrebie typu, roku i magazynu', () => {
    const first = createAndPost(makePz(10));
    const second = createAndPost(makePz(10));
    const other = createAndPost(makePz(10, 'BRA'));

    expect(first.docNumber).toMatch(/^PZ\/\d{4}\/ZAB\/0001$/);
    expect(second.docNumber).toMatch(/^PZ\/\d{4}\/ZAB\/0002$/);
    expect(other.docNumber).toMatch(/^PZ\/\d{4}\/BRA\/0001$/);
  });

  it('odrzuca dokument bez dostawcy', () => {
    const { user, actor } = admin();
    const input = { ...makePz(10), supplierId: null };
    expect(() => createDocument(fx.db, user, actor, input)).toThrowError(/dostawcy/i);
  });

  it('odrzuca kontrahenta bez roli dostawcy', () => {
    const { user, actor } = admin();
    const input = { ...makePz(10), supplierId: fx.partners['EC-ZABRZE'] as number };
    expect(() => createDocument(fx.db, user, actor, input)).toThrowError(/dostawcy/i);
  });
});

describe('wydanie WZ i kontrola stanu', () => {
  it('nie pozwala wydac wiecej niz jest na stanie', () => {
    createAndPost(makePz(50));
    const { user, actor } = admin();

    const wz = createDocument(fx.db, user, actor, {
      ...docBase(),
      docType: 'WZ',
      docDate: today,
      warehouseId: fx.warehouses.ZAB as number,
      customerId: fx.partners['EC-ZABRZE'] as number,
      lines: [line(fx.products['DREWNO-OPAL'] as number, 80, { unitPrice: 200 })],
    });

    let caught: AppError | null = null;
    try {
      postDocument(fx.db, user, actor, wz.id, wz.version);
    } catch (err) {
      caught = err as AppError;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect(caught?.code).toBe('INSUFFICIENT_STOCK');
    // Stan pozostaje nienaruszony - transakcja zostala wycofana.
    expect(stockOf(fx.db, fx.warehouses.ZAB as number, fx.products['DREWNO-OPAL'] as number)).toBe(50);
    expect(getDocument(fx.db, user, wz.id).status).toBe('DRAFT');
  });

  it('sumuje kilka pozycji tego samego produktu przy kontroli stanu', () => {
    createAndPost(makePz(100));
    const { user, actor } = admin();

    const wz = createDocument(fx.db, user, actor, {
      ...docBase(),
      docType: 'WZ',
      docDate: today,
      warehouseId: fx.warehouses.ZAB as number,
      customerId: fx.partners['EC-ZABRZE'] as number,
      lines: [
        line(fx.products['DREWNO-OPAL'] as number, 60),
        line(fx.products['DREWNO-OPAL'] as number, 60),
      ],
    });

    expect(() => postDocument(fx.db, user, actor, wz.id, wz.version)).toThrowError(/stan magazynowy/i);
  });
});

describe('produkcja i automatyczne zuzycie surowca', () => {
  it('zuzywa 100 m3 drewna i wytwarza 400 MP zrebki', () => {
    createAndPost(makePz(240));

    const prod = createAndPost({
      ...docBase(),
      docType: 'PROD',
      docDate: today,
      warehouseId: fx.warehouses.ZAB as number,
      chippingMode: 'OWN',
      chippingRate: null,
      productionPlace: 'Plac Zabrze',
      lines: [
        line(fx.products['DREWNO-OPAL'] as number, 100, { role: 'INPUT' }),
        line(fx.products.ZREBKA as number, 400, { role: 'OUTPUT' }),
      ],
    });

    expect(stockOf(fx.db, fx.warehouses.ZAB as number, fx.products['DREWNO-OPAL'] as number)).toBe(140);
    expect(stockOf(fx.db, fx.warehouses.ZAB as number, fx.products.ZREBKA as number)).toBe(400);

    // Domyslna stawka rabania wlasnego: 10 PLN za MP wyrobu.
    expect(prod.chippingMode).toBe('OWN');
    expect(prod.chippingRate).toBe(10);
    expect(prod.chippingCost).toBe(4000);

    // Powiazanie zuzycia z produkcja - obie pozycje naleza do jednego dokumentu.
    const input = prod.lines.find((l) => l.role === 'INPUT');
    const output = prod.lines.find((l) => l.role === 'OUTPUT');
    expect(input?.qtyM3).toBe(100);
    expect(output?.qtyMp).toBe(400);
    expect(output?.qtyT).toBe(132);
  });

  it('wymaga nazwy firmy przy rabaniu zewnetrznym', () => {
    const { user, actor } = admin();
    expect(() =>
      createDocument(fx.db, user, actor, {
        ...docBase(),
        docType: 'PROD',
        docDate: today,
        warehouseId: fx.warehouses.ZAB as number,
        chippingMode: 'EXTERNAL',
        chippingCompany: '',
        lines: [
          line(fx.products['DREWNO-OPAL'] as number, 10, { role: 'INPUT' }),
          line(fx.products.ZREBKA as number, 40, { role: 'OUTPUT' }),
        ],
      }),
    ).toThrowError(/nazwa firmy/i);
  });

  it('blokuje produkcje przekraczajaca zapas surowca', () => {
    createAndPost(makePz(50));
    const { user, actor } = admin();
    const prod = createDocument(fx.db, user, actor, {
      ...docBase(),
      docType: 'PROD',
      docDate: today,
      warehouseId: fx.warehouses.ZAB as number,
      lines: [
        line(fx.products['DREWNO-OPAL'] as number, 80, { role: 'INPUT' }),
        line(fx.products.ZREBKA as number, 320, { role: 'OUTPUT' }),
      ],
    });

    expect(() => postDocument(fx.db, user, actor, prod.id, prod.version)).toThrowError(/stan magazynowy/i);
    expect(stockOf(fx.db, fx.warehouses.ZAB as number, fx.products.ZREBKA as number)).toBe(0);
  });

  it('wymaga pozycji wejsciowej i wyjsciowej', () => {
    const { user, actor } = admin();
    expect(() =>
      createDocument(fx.db, user, actor, {
        ...docBase(),
        docType: 'PROD',
        docDate: today,
        warehouseId: fx.warehouses.ZAB as number,
        lines: [line(fx.products.ZREBKA as number, 40, { role: 'OUTPUT' })],
      }),
    ).toThrowError(/surowca/i);
  });
});

describe('przesuniecie miedzymagazynowe MM', () => {
  it('przenosi ilosc atomowo miedzy magazynami', () => {
    createAndPost(makePz(200));
    createAndPost({
      ...docBase(),
      docType: 'MM',
      docDate: today,
      warehouseFromId: fx.warehouses.ZAB as number,
      warehouseToId: fx.warehouses.ROK as number,
      lines: [line(fx.products['DREWNO-OPAL'] as number, 75)],
    });

    expect(stockOf(fx.db, fx.warehouses.ZAB as number, fx.products['DREWNO-OPAL'] as number)).toBe(125);
    expect(stockOf(fx.db, fx.warehouses.ROK as number, fx.products['DREWNO-OPAL'] as number)).toBe(75);
  });

  it('nie zostawia stanu czesciowego przy braku towaru', () => {
    createAndPost(makePz(10));
    const { user, actor } = admin();
    const mm = createDocument(fx.db, user, actor, {
      ...docBase(),
      docType: 'MM',
      docDate: today,
      warehouseFromId: fx.warehouses.ZAB as number,
      warehouseToId: fx.warehouses.ROK as number,
      lines: [line(fx.products['DREWNO-OPAL'] as number, 50)],
    });

    expect(() => postDocument(fx.db, user, actor, mm.id, mm.version)).toThrowError(/stan magazynowy/i);
    expect(stockOf(fx.db, fx.warehouses.ZAB as number, fx.products['DREWNO-OPAL'] as number)).toBe(10);
    expect(stockOf(fx.db, fx.warehouses.ROK as number, fx.products['DREWNO-OPAL'] as number)).toBe(0);
  });

  it('odrzuca przesuniecie do tego samego magazynu', () => {
    const { user, actor } = admin();
    expect(() =>
      createDocument(fx.db, user, actor, {
        ...docBase(),
        docType: 'MM',
        docDate: today,
        warehouseFromId: fx.warehouses.ZAB as number,
        warehouseToId: fx.warehouses.ZAB as number,
        lines: [line(fx.products['DREWNO-OPAL'] as number, 5)],
      }),
    ).toThrowError(/rozne/i);
  });
});

describe('transport', () => {
  it('wylicza koszt z odleglosci i stawki oraz wskazniki pochodne', () => {
    const doc = createAndPost({
      ...docBase(),
      docType: 'TR',
      docDate: today,
      carrierId: fx.partners['TRANS-KOWAL'] as number,
      vehiclePlate: 'spy4021',
      distanceKm: 112,
      transportRate: null,
      lines: [line(fx.products.ZREBKA as number, 150)],
    });

    // Stawka domyslna z ustawien: 5 PLN/km.
    expect(doc.transportRate).toBe(5);
    expect(doc.transportCost).toBe(560);
    expect(doc.derived.costPerKm).toBe(5);
    // 150 MP = 49.5 t -> 560 / 49.5
    expect(doc.derived.costPerT).toBe(11.31);
    expect(doc.derived.costPerMp).toBe(3.73);
    expect(doc.vehiclePlate).toBe('SPY4021');
  });

  it('pozwala nadpisac koszt calkowity recznie', () => {
    const doc = createAndPost({
      ...docBase(),
      docType: 'TR',
      docDate: today,
      carrierId: fx.partners['TRANS-LOG'] as number,
      distanceKm: 100,
      transportCost: 1234.56,
      lines: [line(fx.products.ZREBKA as number, 10)],
    });
    expect(doc.transportCost).toBe(1234.56);
  });

  it('nie zmienia stanow magazynowych', () => {
    createAndPost(makePz(100));
    createAndPost({
      ...docBase(),
      docType: 'TR',
      docDate: today,
      carrierId: fx.partners['TRANS-KOWAL'] as number,
      distanceKm: 50,
      lines: [line(fx.products['DREWNO-OPAL'] as number, 100)],
    });
    expect(stockOf(fx.db, fx.warehouses.ZAB as number, fx.products['DREWNO-OPAL'] as number)).toBe(100);
  });
});

describe('sprzedaz bezposrednia', () => {
  it('rejestruje zakup i sprzedaz bez tworzenia stanu magazynowego', () => {
    const doc = createAndPost({
      ...docBase(),
      docType: 'SD',
      docDate: today,
      supplierId: fx.partners.LASPOL as number,
      customerId: fx.partners['EC-JAWORZNO'] as number,
      lines: [line(fx.products.PELLET as number, 24, { unitPrice: 1180, costUnitPrice: 990 })],
    });

    expect(doc.totalValue).toBe(28320);
    expect(doc.totalCost).toBe(23760);
    expect(stockOf(fx.db, fx.warehouses.ZAB as number, fx.products.PELLET as number)).toBe(0);
    const movements = fx.db.prepare('SELECT COUNT(*) AS c FROM stock_movements WHERE document_id = ?').get(doc.id) as {
      c: number;
    };
    expect(movements.c).toBe(0);
  });
});

describe('recznie wprowadzone wartosci rzeczywiste', () => {
  it('nie zmieniaja stanu w jednostce bazowej', () => {
    const doc = createAndPost({
      ...docBase(),
      docType: 'PZ',
      docDate: today,
      warehouseId: fx.warehouses.ZAB as number,
      supplierId: fx.partners['NADL-RUDY'] as number,
      lines: [line(fx.products['DREWNO-OPAL'] as number, 100, { qtyT: 145.5 })],
    });

    const first = doc.lines[0];
    expect(first?.qtyT).toBe(145.5);
    expect(first?.qtyTManual).toBe(true);
    // Wartosci wyliczane automatycznie pozostaja bez zmian.
    expect(first?.qtyMp).toBe(400);
    expect(first?.qtyM3Manual).toBe(false);
    expect(stockOf(fx.db, fx.warehouses.ZAB as number, fx.products['DREWNO-OPAL'] as number)).toBe(100);
  });
});

describe('cykl zycia dokumentu', () => {
  it('blokuje edycje dokumentu zatwierdzonego', () => {
    const posted = createAndPost(makePz(100));
    const { user, actor } = admin();
    expect(() =>
      updateDocument(fx.db, user, actor, posted.id, {
        ...makePz(120),
        version: posted.version,
      } as never),
    ).toThrowError(/nie moze byc edytowany/i);
  });

  it('wykrywa rownolegla edycje przez kontrole wersji', () => {
    const { user, actor } = admin();
    const draft = createDocument(fx.db, user, actor, makePz(100));
    updateDocument(fx.db, user, actor, draft.id, { ...makePz(110), version: draft.version } as never);

    let caught: AppError | null = null;
    try {
      updateDocument(fx.db, user, actor, draft.id, { ...makePz(120), version: draft.version } as never);
    } catch (err) {
      caught = err as AppError;
    }
    expect(caught?.code).toBe('VERSION_CONFLICT');
  });

  it('odrzuca ponowne zatwierdzenie tego samego dokumentu', () => {
    const posted = createAndPost(makePz(100));
    const { user, actor } = admin();
    expect(() => postDocument(fx.db, user, actor, posted.id, posted.version)).toThrowError(/juz zatwierdzony/i);
    expect(stockOf(fx.db, fx.warehouses.ZAB as number, fx.products['DREWNO-OPAL'] as number)).toBe(100);
  });

  it('traktuje powtorzone zadanie z tym samym kluczem jako duplikat', () => {
    const { user, actor } = admin();
    const input = { ...makePz(100), clientRequestId: 'formularz-abc-123456' };
    const first = createDocument(fx.db, user, actor, input);
    const second = createDocument(fx.db, user, actor, input);
    expect(second.id).toBe(first.id);
    expect((fx.db.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number }).c).toBe(1);
  });

  it('anuluje zatwierdzony dokument i cofa ruchy magazynowe', () => {
    const posted = createAndPost(makePz(240));
    const { user, actor } = admin();
    const cancelled = cancelDocument(fx.db, user, actor, posted.id, 'Bledna ilosc na kwicie', posted.version);

    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelReason).toBe('Bledna ilosc na kwicie');
    expect(stockOf(fx.db, fx.warehouses.ZAB as number, fx.products['DREWNO-OPAL'] as number)).toBe(0);

    const movements = fx.db
      .prepare('SELECT reason, direction FROM stock_movements WHERE document_id = ? ORDER BY id')
      .all(posted.id) as Array<{ reason: string; direction: string }>;
    expect(movements).toEqual([
      { reason: 'POSTING', direction: 'IN' },
      { reason: 'REVERSAL', direction: 'OUT' },
    ]);
  });

  it('nie pozwala anulowac przyjecia, gdy towar zostal juz wydany', () => {
    const pz = createAndPost(makePz(100));
    createAndPost({
      ...docBase(),
      docType: 'WZ',
      docDate: today,
      warehouseId: fx.warehouses.ZAB as number,
      customerId: fx.partners['EC-ZABRZE'] as number,
      lines: [line(fx.products['DREWNO-OPAL'] as number, 80)],
    });

    const { user, actor } = admin();
    expect(() => cancelDocument(fx.db, user, actor, pz.id, 'Pomylka', pz.version)).toThrowError(/stan magazynowy/i);
    expect(stockOf(fx.db, fx.warehouses.ZAB as number, fx.products['DREWNO-OPAL'] as number)).toBe(20);
  });

  it('tworzy korekte: anuluje oryginal i wystawia nowy dokument roboczy', () => {
    const posted = createAndPost(makePz(240));
    const { user, actor } = admin();
    const correction = correctDocument(fx.db, user, actor, posted.id, 'Blad ilosci', posted.version);

    expect(correction.status).toBe('DRAFT');
    expect(correction.correctionOfNumber).toBe(posted.docNumber);
    expect(correction.lines).toHaveLength(1);
    expect(getDocument(fx.db, user, posted.id).status).toBe('CANCELLED');
    expect(stockOf(fx.db, fx.warehouses.ZAB as number, fx.products['DREWNO-OPAL'] as number)).toBe(0);

    const fixed = updateDocument(fx.db, user, actor, correction.id, {
      ...makePz(200),
      version: correction.version,
    } as never);
    postDocument(fx.db, user, actor, fixed.id, fixed.version);
    expect(stockOf(fx.db, fx.warehouses.ZAB as number, fx.products['DREWNO-OPAL'] as number)).toBe(200);
  });

  it('usuwa wylacznie dokument roboczy', () => {
    const { user, actor } = admin();
    const draft = createDocument(fx.db, user, actor, makePz(10));
    deleteDraft(fx.db, user, actor, draft.id);
    expect((fx.db.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number }).c).toBe(0);

    const posted = createAndPost(makePz(10));
    expect(() => deleteDraft(fx.db, user, actor, posted.id)).toThrowError(/dokument roboczy/i);
  });
});

describe('pelny przeplyw biznesowy', () => {
  it('zakup -> PZ -> produkcja -> MM -> WZ zachowuje spojnosc ksiegi', () => {
    createAndPost(makePz(240));
    createAndPost({
      ...docBase(),
      docType: 'PROD',
      docDate: today,
      warehouseId: fx.warehouses.ZAB as number,
      chippingMode: 'OWN',
      lines: [
        line(fx.products['DREWNO-OPAL'] as number, 100, { role: 'INPUT' }),
        line(fx.products.ZREBKA as number, 400, { role: 'OUTPUT' }),
      ],
    });
    createAndPost({
      ...docBase(),
      docType: 'MM',
      docDate: today,
      warehouseFromId: fx.warehouses.ZAB as number,
      warehouseToId: fx.warehouses.ROK as number,
      lines: [line(fx.products.ZREBKA as number, 150)],
    });
    createAndPost({
      ...docBase(),
      docType: 'WZ',
      docDate: today,
      warehouseId: fx.warehouses.ROK as number,
      customerId: fx.partners['EC-JAWORZNO'] as number,
      lines: [line(fx.products.ZREBKA as number, 90, { unitPrice: 85 })],
    });

    expect(stockOf(fx.db, fx.warehouses.ZAB as number, fx.products['DREWNO-OPAL'] as number)).toBe(140);
    expect(stockOf(fx.db, fx.warehouses.ZAB as number, fx.products.ZREBKA as number)).toBe(250);
    expect(stockOf(fx.db, fx.warehouses.ROK as number, fx.products.ZREBKA as number)).toBe(60);
    expect(verifyStockIntegrity(fx.db)).toEqual([]);
  });
});

describe('lista dokumentow', () => {
  it('filtruje po typie, dacie i tekscie oraz stronicuje', () => {
    createAndPost(makePz(10));
    createAndPost(makePz(20, 'BRA'));
    const { user } = admin();

    const all = listDocuments(fx.db, user, documentListQuerySchema.parse({}));
    expect(all.total).toBe(2);

    const filtered = listDocuments(fx.db, user, documentListQuerySchema.parse({ docType: 'PZ', pageSize: '1' }));
    expect(filtered.total).toBe(2);
    expect(filtered.items).toHaveLength(1);

    const searched = listDocuments(fx.db, user, documentListQuerySchema.parse({ search: 'KW/2026' }));
    expect(searched.total).toBe(2);

    const byDate = listDocuments(
      fx.db,
      user,
      documentListQuerySchema.parse({ dateFrom: '1990-01-01', dateTo: '1990-12-31' }),
    );
    expect(byDate.total).toBe(0);
  });
});
