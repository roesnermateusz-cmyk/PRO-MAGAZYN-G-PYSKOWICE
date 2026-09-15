/**
 * Ekran startowy wersji jednoplikowej — wybór operatora.
 *
 * Zastępuje `web/src/views/login.js`. Nie jest to logowanie i nie udaje
 * logowania: plik otwiera się podwójnym kliknięciem, a dane leżą w magazynie
 * przeglądarki tego samego komputera. Formularz z hasłem chroniłby je przed
 * nikim, a użytkownik zakładałby ochronę, której nie dostaje.
 *
 * Wybór operatora ma jednak sens praktyczny: decyduje, kto figuruje jako autor
 * dokumentu w rejestrze i dzienniku audytu, a rola przycina interfejs do tego,
 * co danej osobie wolno. Wybór jest zapamiętywany, więc kolejne otwarcie
 * wchodzi prosto do aplikacji.
 */
import { esc, $ } from '../../../web/src/core/dom.js';
import { store, loadMeta } from '../../../web/src/core/store.js';
import { toast } from '../../../web/src/core/ui.js';
import { iconRef, iconSprite } from '../../../web/src/components/icons.js';
import {
  listOperators, selectOperator, loadDemoData, bootState, ensureReady,
} from '../api-local.js';

const ROLE_LABEL = {
  ADMIN: 'pełne uprawnienia',
  KIEROWNIK: 'praca operacyjna, zamykanie okresów, storno',
  MAGAZYNIER: 'wprowadzanie i edycja własnych dokumentów',
  KSIEGOWY: 'odczyt, raporty, eksporty',
  AUDYTOR: 'wyłącznie odczyt',
};

export async function renderLogin(root, onSuccess) {
  root.innerHTML = `<div class="login-wrap"><div class="login-box">
    <div class="brand"><div class="logo">ResInvest <em>Commodities</em></div>
      <div class="sub">ERP · Magazyn biomasy</div></div>
    <div class="login-card"><div class="loading">${esc(bootState.message)}</div></div>
  </div></div>`;

  try {
    await ensureReady();
  } catch (err) {
    root.innerHTML = `<div class="login-wrap"><div class="login-box">
      <div class="login-card"><div class="alert danger"><div>
        <b>Nie udało się uruchomić bazy danych.</b><br>${esc(err.message)}<br><br>
        Sprawdź, czy przeglądarka jest aktualna i czy nie działa w trybie prywatnym —
        w trybie prywatnym magazyn danych bywa wyłączony.
      </div></div>
      <button class="btn btn-block" onclick="location.reload()">Spróbuj ponownie</button>
      </div></div></div>`;
    return;
  }

  const meta = await loadMeta().catch(() => null);
  const operators = await listOperators();

  root.innerHTML = `${iconSprite()}<div class="login-wrap"><div class="login-box">
    <div class="brand">
      <div class="logo">ResInvest <em>Commodities</em></div>
      <div class="sub">ERP · Magazyn biomasy · wersja jednoplikowa</div>
    </div>

    <div class="login-card">
      <h2 style="font-size:15px;margin-bottom:4px">Kto pracuje?</h2>
      <p class="sub" style="margin-bottom:14px">
        Wybór decyduje o autorze dokumentów i o zakresie uprawnień.
      </p>
      <div class="op-list">
        ${operators.map((o) => `
          <button type="button" class="op-pick" data-operator="${esc(o.id)}">
            <span class="op-name">${esc(o.fullName)}</span>
            <span class="op-role"><span class="tag ${esc(o.role)}">${esc(o.role)}</span>
              ${esc(ROLE_LABEL[o.role] ?? '')}</span>
          </button>`).join('')}
      </div>

      ${bootState.demoOffered ? `
        <div class="alert info" style="margin-top:16px">${iconRef('info')}<div>
          <b>Baza jest pusta.</b> Możesz dopisać dane demonstracyjne — sześćdziesiąt dni
          pracy placu: zakupy surowca, produkcja zrębki, sprzedaż i transport.
          Można je później usunąć, czyszcząc rejestr.
          <div style="margin-top:10px">
            <button class="btn btn-sm" data-demo>Wczytaj dane demonstracyjne</button>
          </div>
        </div></div>` : ''}

      <div class="alert warning" style="margin-top:16px">${iconRef('warn')}<div>
        <b>Dane są zapisywane w tej przeglądarce, na tym komputerze.</b>
        Nie w pliku HTML — skopiowanie pliku na pendrive nie skopiuje dokumentów.
        Rób kopie zapasowe: Ustawienia → Kopie zapasowe → Pobierz kopię.
      </div></div>
    </div>

    <div class="login-foot">
      ${esc(meta?.company?.name ?? 'ResInvest Commodities PL')}<br>
      ${esc(meta?.company?.address ?? '')}<br>
      System magazynowy · wersja ${esc(meta?.version ?? '1.0.0')} · jednoplikowa
    </div>
  </div></div>`;

  root.querySelectorAll('[data-operator]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const session = await selectOperator(button.dataset.operator);
        store.user = session.user;
        store.catalog = null;
        toast(`Witaj, ${session.user.fullName.split(' ')[0]}`);
        onSuccess();
      } catch (err) {
        toast(err.message, 'err');
        button.disabled = false;
      }
    });
  });

  const demo = $('[data-demo]');
  demo?.addEventListener('click', async () => {
    demo.disabled = true;
    demo.innerHTML = '<span class="spinner"></span> Generowanie…';
    try {
      const result = await loadDemoData();
      toast(`Dopisano ${result.documents} dokumentów w ${result.chains} łańcuchach`);
      renderLogin(root, onSuccess);
    } catch (err) {
      toast(err.message, 'err');
      demo.disabled = false;
      demo.textContent = 'Wczytaj dane demonstracyjne';
    }
  });
}

/**
 * Wersja jednoplikowa nie ma haseł, więc nie ma też ekranu ich zmiany.
 * Funkcja istnieje, bo powłoka aplikacji ją importuje; gdyby kiedykolwiek
 * została wywołana, mówi wprost, dlaczego nie ma czego zmieniać.
 */
export function renderPasswordChange(root, onDone) {
  root.innerHTML = `<div class="login-wrap"><div class="login-box">
    <div class="login-card">
      <div class="alert info"><div>
        <b>Ta wersja nie używa haseł.</b><br>
        Plik otwiera się bez logowania, a dane chroni kopia zapasowa
        i szyfrowanie dysku komputera.
      </div></div>
      <button class="btn btn-primary btn-block" data-back>Wróć do aplikacji</button>
    </div>
  </div></div>`;
  root.querySelector('[data-back]')?.addEventListener('click', () => onDone?.());
}
