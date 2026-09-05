/**
 * Formularz dokumentu magazynowego — wprowadzanie, edycja i łańcuch terenowy.
 *
 * Trzy tryby pracy:
 *   • nowy dokument             — `#/nowa`
 *   • edycja istniejącego       — `#/nowa?id=…` (tworzy wpis w rejestrze korekt)
 *   • kopia dokumentu           — `#/nowa?copy=…`
 *
 * Panel „operacje równoległe” dopisuje komplet dokumentów jednym zapisem:
 * PZ (zakup) → RW (zużycie) → PW (produkcja) → WZ (sprzedaż, opcjonalnie).
 */
import api from '../core/api.js';
import { esc, options, datalist, formValues, markFieldErrors, on, $ } from '../core/dom.js';
import { qty, qty2, moneyShort, today, fileSize } from '../core/format.js';
import { pageHead, loading, toast, toastError, alertBox, showLightbox } from '../core/ui.js';
import { ICONS } from '../components/icons.js';
import { loadCatalog, invalidateCatalog, store } from '../core/store.js';
import { navigate } from '../core/router.js';
import { UNIT_LABEL } from './_shared.js';

const TYPES = ['ZAKUP', 'SPRZEDAZ', 'PRODUKCJA', 'ZUZYCIE', 'MM', 'BO'];

/** Załączniki oczekujące na wysyłkę (dodane przed zapisem dokumentu). */
let pendingFiles = [];

export async function renderOperationForm(view, params = {}) {
  view.innerHTML = loading('Przygotowywanie formularza…');
  pendingFiles = [];

  const catalog = await loadCatalog();
  const settings = await api.get('/settings');
  const editId = params.id || '';
  const copyId = params.copy || '';

  let doc = null;
  if (editId || copyId) {
    const source = await api.get(`/operations/${editId || copyId}`);
    doc = source;
    if (copyId) {
      doc.id = null;
      doc.docNo = '';
      doc.operationDate = today();
    }
  }

  const d = defaults(doc, catalog, settings);
  const isEdit = Boolean(editId);

  view.innerHTML = pageHead(
    isEdit ? `Edycja dokumentu ${doc.docNo}` : 'Nowa operacja',
    isEdit ? 'Zmiana zostanie zapisana w rejestrze korekt' : 'Wpis do rejestru magazynowego',
    '<a class="btn btn-ghost" href="#/operacje">Anuluj</a>',
  )
  + (isEdit ? alertBox('info', 'Każda zmiana zapisze stan „przed” i „po” w rejestrze korekt wraz z podanym uzasadnieniem.') : '')
  + `<form id="opForm" novalidate>
      ${datalistsHtml(catalog)}

      <div class="card"><div class="card-b">

        <div class="fld wide" style="margin-bottom:16px">
          <label>Typ operacji</label>
          <div class="seg" id="segType">
            ${TYPES.map((t) => `<button type="button" data-t="${t}" class="${d.type === t ? 'on' : ''}">${esc(t)}</button>`).join('')}
          </div>
          <input type="hidden" name="type" id="fType" value="${esc(d.type)}">
          <div class="hint" id="typeHint"></div>
        </div>

        <div class="section-title">Dokument</div>
        <div class="form-grid">
          <div class="fld">
            <label for="operationDate">Data operacji *</label>
            <input type="date" id="operationDate" name="operationDate" value="${esc(d.operationDate)}" required>
          </div>
          <div class="fld">
            <label for="loadingDate">Data załadunku</label>
            <input type="date" id="loadingDate" name="loadingDate" value="${esc(d.loadingDate)}">
          </div>
          <div class="fld">
            <label for="certificate">Certyfikat</label>
            <select id="certificate" name="certificate">
              ${options(['KZR', 'SURE', 'BRAK'], d.certificate)}
            </select>
          </div>
          <div class="fld">
            <label for="grade">Rodzaj (A/B)</label>
            <input type="text" id="grade" name="grade" value="${esc(d.grade)}" maxlength="10" placeholder="np. B">
          </div>
        </div>

        <div class="section-title">Towar i ilość</div>
        <div class="form-grid">
          <div class="fld">
            <label for="productId">Produkt *</label>
            <select id="productId" name="productId" required>
              ${options(catalog.products, d.productId, { placeholder: '— wybierz produkt —' })}
            </select>
          </div>
          <div class="fld">
            <label for="quantity">Wolumen *</label>
            <input type="number" id="quantity" name="quantity" value="${esc(d.quantity)}"
                   step="0.001" min="0.001" required inputmode="decimal">
          </div>
          <div class="fld">
            <label for="unit">Jednostka *</label>
            <select id="unit" name="unit">${options(['M3', 'MP', 'TONA'], d.unit)}</select>
          </div>
          <div class="fld">
            <label for="tonneMode">Masa — sposób ustalenia</label>
            <select id="tonneMode" name="tonneMode">
              <option value="AUTO"${d.tonneMode === 'AUTO' ? ' selected' : ''}>Automatycznie (przelicznik)</option>
              <option value="RECZNIE"${d.tonneMode === 'RECZNIE' ? ' selected' : ''}>Ręcznie (waga rzeczywista)</option>
            </select>
          </div>
          <div class="fld" id="tonneManualBox" style="${d.tonneMode === 'RECZNIE' ? '' : 'display:none'}">
            <label for="tonneManual">Masa rzeczywista (t)</label>
            <input type="number" id="tonneManual" name="tonneManual" value="${esc(d.tonneManual)}" step="0.001" min="0" inputmode="decimal">
            <div class="hint">Waga z wagi samochodowej — nadrzędna wobec przeliczenia.</div>
          </div>
        </div>

        <div class="calc-strip" id="calcStrip"></div>

        <div class="section-title">Strony operacji</div>
        <div class="form-grid">
          <div class="fld" id="whFromBox">
            <label for="warehouseFrom">Magazyn źródłowy</label>
            <input type="text" id="warehouseFrom" name="warehouseFrom" list="dlWarehouses" value="${esc(d.warehouseFrom)}">
          </div>
          <div class="fld" id="whToBox">
            <label for="warehouseTo">Magazyn docelowy</label>
            <input type="text" id="warehouseTo" name="warehouseTo" list="dlWarehouses" value="${esc(d.warehouseTo)}">
          </div>
          <div class="fld">
            <label for="supplierName">Dostawca / źródło</label>
            <input type="text" id="supplierName" name="supplierName" list="dlPartners" value="${esc(d.supplierName)}"
                   placeholder="np. Nadleśnictwo Rudy Raciborskie">
          </div>
          <div class="fld">
            <label for="recipientName">Odbiorca / cel</label>
            <input type="text" id="recipientName" name="recipientName" list="dlPartners" value="${esc(d.recipientName)}"
                   placeholder="np. Elektrownia Rybnik">
          </div>
        </div>

        <div class="section-title">Pochodzenie surowca (KZR / SURE)</div>
        <div class="form-grid">
          <div class="fld">
            <label for="forestDistrict">Nadleśnictwo</label>
            <input type="text" id="forestDistrict" name="forestDistrict" list="dlDistricts" value="${esc(d.forestDistrict)}">
          </div>
          <div class="fld">
            <label for="forestRange">Leśnictwo</label>
            <input type="text" id="forestRange" name="forestRange" list="dlRanges" value="${esc(d.forestRange)}">
          </div>
          <div class="fld">
            <label for="haulageNoteNo">Nr kwitu wywozowego</label>
            <input type="text" id="haulageNoteNo" name="haulageNoteNo" value="${esc(d.haulageNoteNo)}">
          </div>
          <div class="fld">
            <label for="loadingPlace">Miejsce załadunku</label>
            <input type="text" id="loadingPlace" name="loadingPlace" list="dlPlaces" value="${esc(d.loadingPlace)}">
          </div>
          <div class="fld">
            <label for="originPlace">Miejsce pochodzenia</label>
            <input type="text" id="originPlace" name="originPlace" value="${esc(d.originPlace)}">
          </div>
          <div class="fld">
            <label for="isStored">Magazynowane</label>
            <select id="isStored" name="isStored">
              <option value="true"${d.isStored ? ' selected' : ''}>TAK — towar zostaje na placu</option>
              <option value="false"${d.isStored ? '' : ' selected'}>NIE — towar jedzie dalej</option>
            </select>
          </div>
        </div>

        <div class="section-title">Ceny i koszty</div>
        <div class="form-grid">
          <div class="fld">
            <label for="pricePurchase">Cena zakupu / produkcji (zł/jedn.)</label>
            <input type="number" id="pricePurchase" name="pricePurchase" value="${esc(d.pricePurchase)}" step="0.01" min="0" inputmode="decimal">
          </div>
          <div class="fld">
            <label for="priceSale">Cena sprzedaży (zł/jedn.)</label>
            <input type="number" id="priceSale" name="priceSale" value="${esc(d.priceSale)}" step="0.01" min="0" inputmode="decimal">
          </div>
          <div class="fld">
            <label for="chippingMode">Rąbanie</label>
            <input type="text" id="chippingMode" name="chippingMode" list="dlChipping" value="${esc(d.chippingMode)}" placeholder="własne / wynajęte">
          </div>
          <div class="fld">
            <label for="chippingPrice">Stawka rąbania (zł/jedn.)</label>
            <input type="number" id="chippingPrice" name="chippingPrice" value="${esc(d.chippingPrice)}" step="0.01" min="0" inputmode="decimal">
          </div>
        </div>

        <div class="section-title">Transport</div>
        <div class="form-grid">
          <div class="fld">
            <label for="carrierName">Firma transportowa / kierowca</label>
            <input type="text" id="carrierName" name="carrierName" list="dlCarriers" value="${esc(d.carrierName)}">
          </div>
          <div class="fld">
            <label for="vehiclePlate">Nr rejestracyjny</label>
            <input type="text" id="vehiclePlate" name="vehiclePlate" list="dlPlates" value="${esc(d.vehiclePlate)}"
                   style="text-transform:uppercase">
          </div>
          <div class="fld">
            <label for="distanceKm">Odległość (km)</label>
            <input type="number" id="distanceKm" name="distanceKm" value="${esc(d.distanceKm)}" step="1" min="0" inputmode="decimal">
          </div>
          <div class="fld">
            <label for="transportCost">Koszt transportu (zł)</label>
            <input type="number" id="transportCost" name="transportCost" value="${esc(d.transportCost)}" step="0.01" min="0" inputmode="decimal">
            <div class="hint" id="freightHint"></div>
          </div>
        </div>

        ${isEdit ? '' : chainPanelHtml(catalog, d)}

        <div class="section-title">Skany dokumentów</div>
        <div class="fld wide">
          <input type="file" id="scanInput" accept="image/*,application/pdf" multiple capture="environment"
                 style="display:none">
          <button type="button" class="btn" id="scanBtn">${ICONS.clip} Dodaj skan (aparat / plik)</button>
          <div class="hint">Zdjęcia są automatycznie zmniejszane do 1600 px i kompresowane przed wysyłką.</div>
          <div class="thumbs" id="pendingThumbs" style="margin-top:10px"></div>
        </div>

        <div class="section-title">Zatwierdzenie</div>
        <div class="form-grid">
          <div class="fld wide">
            <label for="signature">Podpis zatwierdzającego — imię i nazwisko *</label>
            <input type="text" id="signature" name="signature" value="${esc(d.signature)}" required>
          </div>
          <div class="fld wide">
            <label for="notes">Uwagi</label>
            <textarea id="notes" name="notes" rows="2">${esc(d.notes)}</textarea>
          </div>
          ${isEdit ? `<div class="fld wide">
            <label for="correctionReason">Uzasadnienie korekty *</label>
            <input type="text" id="correctionReason" name="correctionReason" required
                   placeholder="np. korekta po ponownym obmiarze pryzmy">
          </div>` : ''}
        </div>

        <div class="page-actions" style="margin-top:22px">
          <button type="submit" class="btn btn-primary" id="saveBtn">
            ${ICONS.check} ${isEdit ? 'Zapisz zmiany' : 'Zapisz operację'}
          </button>
          ${isEdit ? '' : '<button type="button" class="btn" id="saveNextBtn">Zapisz i dodaj kolejną</button>'}
          <a class="btn btn-ghost" href="#/operacje">Anuluj</a>
        </div>
      </div></div>
    </form>`;

  bindForm(view, { editId, catalog, settings });
}

/* ---------------------------- Wartości startowe ------------------------ */

function defaults(doc, catalog, settings) {
  const defaultWarehouse = catalog.warehouses.find((w) => w.isDefault)?.name ?? catalog.warehouses[0]?.name ?? '';
  if (doc) {
    return {
      type: doc.type,
      operationDate: doc.operationDate ?? today(),
      loadingDate: doc.loadingDate ?? '',
      certificate: doc.certificate ?? 'KZR',
      grade: doc.grade ?? '',
      productId: doc.productId ?? '',
      quantity: doc.quantity ?? '',
      unit: doc.unit ?? 'M3',
      tonneMode: doc.tonneMode ?? 'AUTO',
      tonneManual: doc.tonneManual ?? '',
      warehouseFrom: doc.warehouseFrom ?? '',
      warehouseTo: doc.warehouseTo ?? '',
      supplierName: doc.supplierName ?? '',
      recipientName: doc.recipientName ?? '',
      forestDistrict: doc.forestDistrict ?? '',
      forestRange: doc.forestRange ?? '',
      haulageNoteNo: doc.haulageNoteNo ?? '',
      loadingPlace: doc.loadingPlace ?? '',
      originPlace: doc.originPlace ?? '',
      isStored: doc.isStored ?? true,
      pricePurchase: doc.pricePurchase || '',
      priceSale: doc.priceSale || '',
      chippingMode: doc.chippingMode ?? '',
      chippingPrice: doc.chippingPrice || '',
      carrierName: doc.carrierName ?? '',
      vehiclePlate: doc.vehiclePlate ?? '',
      distanceKm: doc.distanceKm || '',
      transportCost: doc.transportCost || '',
      notes: doc.notes ?? '',
      signature: doc.signature ?? store.user?.fullName ?? '',
      factors: settings,
    };
  }
  const rawMaterial = catalog.products.find((p) => p.category === 'SUROWIEC');
  return {
    type: 'ZAKUP',
    operationDate: today(),
    loadingDate: today(),
    certificate: 'KZR',
    grade: 'B',
    productId: rawMaterial?.id ?? catalog.products[0]?.id ?? '',
    quantity: '',
    unit: rawMaterial?.defaultUnit ?? 'M3',
    tonneMode: 'AUTO',
    tonneManual: '',
    warehouseFrom: '',
    warehouseTo: defaultWarehouse,
    supplierName: '',
    recipientName: '',
    forestDistrict: '',
    forestRange: '',
    haulageNoteNo: '',
    loadingPlace: '',
    originPlace: '',
    isStored: true,
    pricePurchase: '',
    priceSale: '',
    chippingMode: '',
    chippingPrice: '',
    carrierName: '',
    vehiclePlate: '',
    distanceKm: '',
    transportCost: '',
    notes: '',
    signature: store.user?.fullName ?? '',
    factors: settings,
  };
}

function datalistsHtml(catalog) {
  return datalist('dlWarehouses', catalog.warehouses.map((w) => w.name))
    + datalist('dlPartners', catalog.partners.map((p) => p.name))
    + datalist('dlCarriers', catalog.partners.filter((p) => p.kind === 'PRZEWOZNIK').map((p) => p.name)
      .concat(catalog.vehicles.map((v) => v.carrierName).filter(Boolean)))
    + datalist('dlPlates', catalog.vehicles.map((v) => v.plate))
    + datalist('dlDistricts', catalog.forestDistricts.map((f) => f.name))
    + datalist('dlRanges', catalog.forestRanges.map((f) => f.name))
    + datalist('dlPlaces', catalog.loadingPlaces.map((p) => p.name))
    + datalist('dlChipping', ['własne', 'wynajęte']);
}

/** Panel łańcucha — widoczny tylko dla dokumentu typu ZAKUP. */
function chainPanelHtml(catalog, d) {
  const chips = catalog.products.filter((p) => p.category === 'ZREBKA');
  return `<div id="chainPanel" style="${d.type === 'ZAKUP' ? '' : 'display:none'}">
    <div class="section-title">Operacje równoległe — łańcuch terenowy</div>
    <div style="background:var(--surface-2);border:1px solid var(--line);border-radius:var(--radius-sm);padding:14px">
      <label class="check" style="margin-bottom:10px">
        <input type="checkbox" id="chkProduction" name="produceChips">
        <span><b>+ PRODUKCJA</b> — drewno rąbiemy w lesie, powstaje zrębka.
        System dopisze dokument RW (zużycie surowca) oraz PW (przyjęcie zrębka).</span>
      </label>
      <label class="check" style="margin-bottom:12px">
        <input type="checkbox" id="chkSale" name="sellDirectly" disabled>
        <span><b>+ SPRZEDAŻ</b> — zrębka jedzie prosto do odbiorcy, nie magazynujemy.
        System dopisze dokument WZ, a transport i kwit wywozowy przypisze do WZ.</span>
      </label>

      <div class="form-grid" id="chainFields" style="display:none">
        <div class="fld">
          <label for="chipProductId">Produkt wyjściowy</label>
          <select id="chipProductId" name="chipProductId">
            ${options(chips, chips.find((c) => /leśna/i.test(c.name))?.id ?? chips[0]?.id)}
          </select>
        </div>
        <div class="fld">
          <label for="chipQuantityMp">Wolumen zrębki (MP)</label>
          <input type="number" id="chipQuantityMp" name="chipQuantityMp" step="0.001" min="0" inputmode="decimal"
                 placeholder="puste = tyle, ile wychodzi z przelicznika">
        </div>
        <div class="fld" id="saleRecipientBox" style="display:none">
          <label for="saleRecipient">Odbiorca zrębki</label>
          <input type="text" id="saleRecipient" name="saleRecipient" list="dlPartners">
        </div>
        <div class="fld" id="salePriceBox" style="display:none">
          <label for="salePrice">Cena sprzedaży (zł/MP)</label>
          <input type="number" id="salePrice" name="salePrice" step="0.01" min="0" inputmode="decimal">
        </div>
      </div>
      <div class="hint" id="chainPreview" style="margin-top:10px;font-weight:600;color:var(--spruce-deep)"></div>
    </div>
  </div>`;
}

/* ------------------------------ Interakcje ----------------------------- */

function bindForm(view, { editId, catalog, settings }) {
  const form = $('#opForm', view);

  /* Przełącznik typu operacji steruje widocznością sekcji. */
  on(view, 'click', '#segType button', (el) => {
    view.querySelectorAll('#segType button').forEach((b) => b.classList.toggle('on', b === el));
    form.type.value = el.dataset.t;
    applyType(view, form);
    recalc(view, form, catalog, settings);
  });

  ['input', 'change'].forEach((evt) => form.addEventListener(evt, () => recalc(view, form, catalog, settings)));

  form.tonneMode.addEventListener('change', () => {
    $('#tonneManualBox', view).style.display = form.tonneMode.value === 'RECZNIE' ? '' : 'none';
  });

  /* Panel łańcucha */
  const chkProduction = $('#chkProduction', view);
  const chkSale = $('#chkSale', view);
  if (chkProduction) {
    chkProduction.addEventListener('change', () => {
      chkSale.disabled = !chkProduction.checked;
      if (!chkProduction.checked) chkSale.checked = false;
      $('#chainFields', view).style.display = chkProduction.checked ? '' : 'none';
      toggleSaleFields(view, chkSale.checked);
      recalc(view, form, catalog, settings);
    });
    chkSale.addEventListener('change', () => {
      toggleSaleFields(view, chkSale.checked);
      recalc(view, form, catalog, settings);
    });
  }

  /* Skany */
  const scanInput = $('#scanInput', view);
  $('#scanBtn', view).addEventListener('click', () => scanInput.click());
  scanInput.addEventListener('change', async () => {
    for (const file of scanInput.files) {
      try {
        pendingFiles.push(await prepareFile(file));
      } catch {
        toast(`Nie udało się przygotować pliku ${file.name}`, 'err');
      }
    }
    scanInput.value = '';
    drawPending(view);
  });
  on(view, 'click', '[data-rm-file]', (el) => {
    pendingFiles.splice(Number(el.dataset.rmFile), 1);
    drawPending(view);
  });
  on(view, 'click', '[data-preview-file]', (el) => {
    const file = pendingFiles[Number(el.dataset.previewFile)];
    if (file && !file.mimeType.includes('pdf')) showLightbox(file.dataUrl);
  });

  /* Zapis */
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    submit(view, form, { editId, again: false });
  });
  $('#saveNextBtn', view)?.addEventListener('click', () => submit(view, form, { editId, again: true }));

  applyType(view, form);
  recalc(view, form, catalog, settings);
}

/** Dostosowuje formularz do wybranego typu dokumentu. */
function applyType(view, form) {
  const type = form.type.value;
  const inbound = ['ZAKUP', 'PRODUKCJA', 'BO'].includes(type);
  const outbound = ['SPRZEDAZ', 'ZUZYCIE'].includes(type);
  const transfer = type === 'MM';

  $('#whFromBox', view).style.display = (outbound || transfer) ? '' : 'none';
  $('#whToBox', view).style.display = (inbound || transfer) ? '' : 'none';
  const chainPanel = $('#chainPanel', view);
  if (chainPanel) chainPanel.style.display = type === 'ZAKUP' ? '' : 'none';

  const hints = {
    ZAKUP: 'Przyjęcie zewnętrzne (PZ) — zakup surowca od dostawcy lub nadleśnictwa.',
    SPRZEDAZ: 'Wydanie zewnętrzne (WZ) — sprzedaż i wywóz do odbiorcy.',
    PRODUKCJA: 'Przyjęcie wewnętrzne (PW) — wyrób powstały z produkcji, np. zrębka po rąbaniu.',
    ZUZYCIE: 'Rozchód wewnętrzny (RW) — surowiec zużyty do produkcji.',
    MM: 'Przesunięcie międzymagazynowe (MM) — wymaga dwóch różnych magazynów.',
    BO: 'Bilans otwarcia (BO) — wprowadzenie stanu początkowego.',
  };
  $('#typeHint', view).textContent = hints[type] ?? '';
}

function toggleSaleFields(view, on_) {
  $('#saleRecipientBox', view).style.display = on_ ? '' : 'none';
  $('#salePriceBox', view).style.display = on_ ? '' : 'none';
}

/**
 * Podgląd przeliczeń liczony po stronie klienta.
 * Wartości wiążące zawsze wylicza serwer — tu chodzi o natychmiastową
 * informację zwrotną dla magazyniera wpisującego dane w terenie.
 */
function recalc(view, form, catalog, settings) {
  const product = catalog.products.find((p) => p.id === form.productId.value);
  const m3ToMp = product?.m3ToMp || settings['units.m3_to_mp'] || 4;
  const mpToTonne = product?.mpToTonne || settings['units.mp_to_tonne'] || 0.33;
  const tonneToGj = product?.tonneToGj || settings['units.tonne_to_gj'] || 8.5;

  const quantity = Number(form.quantity.value) || 0;
  const unit = form.unit.value;

  let m3;
  let mp;
  let tonne;
  if (unit === 'M3') { m3 = quantity; mp = quantity * m3ToMp; tonne = mp * mpToTonne; }
  else if (unit === 'MP') { mp = quantity; m3 = mp / m3ToMp; tonne = mp * mpToTonne; }
  else { tonne = quantity; mp = tonne / mpToTonne; m3 = mp / m3ToMp; }

  const manualTonne = form.tonneMode.value === 'RECZNIE' && Number(form.tonneManual?.value) > 0;
  if (manualTonne) tonne = Number(form.tonneManual.value);

  const purchase = quantity * (Number(form.pricePurchase.value) || 0);
  const sale = quantity * (Number(form.priceSale.value) || 0);
  const chipping = quantity * (Number(form.chippingPrice.value) || 0);

  $('#calcStrip', view).innerHTML = `
    <div class="ci"><div class="l">Metry przestrzenne</div><div class="v">${qty(mp)} <small>MP</small></div></div>
    <div class="ci"><div class="l">Objętość</div><div class="v">${qty(m3)} <small>m³</small></div></div>
    <div class="ci"><div class="l">Masa${manualTonne ? ' (rzeczywista)' : ''}</div><div class="v">${qty2(tonne)} <small>t</small></div></div>
    <div class="ci"><div class="l">Energia</div><div class="v">${qty2(tonne * tonneToGj)} <small>GJ</small></div></div>
    <div class="ci"><div class="l">Wartość zakupu</div><div class="v">${moneyShort(purchase)}</div></div>
    <div class="ci"><div class="l">Wartość sprzedaży</div><div class="v">${moneyShort(sale)}</div></div>
    <div class="ci"><div class="l">Koszt rąbania</div><div class="v">${moneyShort(chipping)}</div></div>`;

  const km = Number(form.distanceKm.value) || 0;
  const cost = Number(form.transportCost.value) || 0;
  $('#freightHint', view).textContent = km > 0 && cost > 0 ? `stawka: ${qty2(cost / km)} zł/km` : '';

  const preview = $('#chainPreview', view);
  if (preview) {
    const produce = $('#chkProduction', view)?.checked;
    const sell = $('#chkSale', view)?.checked;
    if (produce) {
      const chipMp = Number($('#chipQuantityMp', view)?.value) || mp;
      const chipName = catalog.products.find((p) => p.id === $('#chipProductId', view)?.value)?.name ?? 'zrębka';
      preview.textContent =
        `Zapiszę: PZ zakup ${qty(quantity)} ${UNIT_LABEL[unit]} → RW zużycie ${qty(mp)} MP → PW produkcja ${qty(chipMp)} MP („${chipName}”)`
        + (sell ? ' → WZ sprzedaż prosto do odbiorcy (bez magazynowania)' : ' → zrębka trafia na plac');
    } else {
      preview.textContent = '';
    }
  }
}

/* ---------------------------- Załączniki ------------------------------- */

/** Zmniejsza i kompresuje zdjęcie; PDF przekazuje bez zmian. */
function prepareFile(file) {
  return new Promise((resolve, reject) => {
    if (file.type === 'application/pdf') {
      const reader = new FileReader();
      reader.onload = () => resolve({
        filename: file.name, mimeType: file.type, dataUrl: reader.result, size: file.size,
      });
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1600;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      resolve({
        filename: file.name.replace(/\.[^.]+$/, '') + '.jpg',
        mimeType: 'image/jpeg',
        dataUrl,
        size: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75),
      });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Nieobsługiwany format obrazu')); };
    img.src = url;
  });
}

function drawPending(view) {
  $('#pendingThumbs', view).innerHTML = pendingFiles.map((f, i) => `
    <div class="thumb" data-preview-file="${i}" title="${esc(f.filename)} · ${fileSize(f.size)}">
      ${f.mimeType.includes('pdf') ? '<div class="pdf">PDF</div>' : `<img src="${esc(f.dataUrl)}" alt="">`}
      <button type="button" class="x" data-rm-file="${i}" aria-label="Usuń">×</button>
    </div>`).join('');
}

async function uploadPending(operationId) {
  let uploaded = 0;
  for (const file of pendingFiles) {
    try {
      await api.post(`/operations/${operationId}/attachments`, {
        filename: file.filename,
        mimeType: file.mimeType,
        dataBase64: file.dataUrl.split(',').pop(),
        kind: 'SKAN',
      });
      uploaded += 1;
    } catch (err) {
      toast(`Skan ${file.filename}: ${err.message}`, 'err');
    }
  }
  pendingFiles = [];
  return uploaded;
}

/* -------------------------------- Zapis -------------------------------- */

async function submit(view, form, { editId, again }) {
  const button = $('#saveBtn', view);
  button.disabled = true;
  const original = button.innerHTML;
  button.innerHTML = '<span class="spinner"></span> Zapisywanie…';

  const values = formValues(form);
  values.isStored = values.isStored === 'true' || values.isStored === true;
  const chainRequested = !editId && form.type.value === 'ZAKUP' && $('#chkProduction', view)?.checked;

  try {
    let result;
    let operationId;

    if (editId) {
      result = await api.patch(`/operations/${editId}`, values);
      operationId = editId;
      toast(`Zapisano zmiany${result.changes?.length ? ` (${result.changes.length} pól)` : ''}`);
    } else if (chainRequested) {
      result = await api.post('/operations/chain', {
        purchase: values,
        chain: {
          produceChips: true,
          sellDirectly: Boolean($('#chkSale', view)?.checked),
          chipProductId: $('#chipProductId', view)?.value || undefined,
          chipQuantityMp: Number($('#chipQuantityMp', view)?.value) || undefined,
          saleRecipient: $('#saleRecipient', view)?.value || undefined,
          salePrice: Number($('#salePrice', view)?.value) || undefined,
          saleUnit: 'MP',
        },
      });
      operationId = result.operations[0].id;
      toast(`Zapisano łańcuch ${result.chainRef}: ${result.operations.map((o) => o.docNo).join(', ')}`);
    } else {
      result = await api.post('/operations', values);
      operationId = result.operation.id;
      toast(`Zapisano dokument ${result.operation.docNo}`);
    }

    if (pendingFiles.length) {
      const n = await uploadPending(operationId);
      if (n) toast(`Zapisano ${n} skan(ów)`);
    }
    (result.warnings ?? []).forEach((w) => toast(w, 'err'));
    invalidateCatalog();

    if (again) renderOperationForm(view, {});
    else navigate(editId ? `/operacje/${editId}` : '/operacje');
  } catch (err) {
    if (err.isValidation) {
      markFieldErrors(form, err.details);
      toast('Formularz zawiera błędy — popraw zaznaczone pola', 'err');
    } else {
      toastError(err);
    }
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}
