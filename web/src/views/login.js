/** Ekran logowania i wymuszonej zmiany hasła. */
import { esc, $ } from '../core/dom.js';
import { login, store, loadMeta } from '../core/store.js';
import { toast } from '../core/ui.js';
import api from '../core/api.js';
import { ICONS } from '../components/icons.js';

/**
 * Renderuje ekran logowania.
 * @param {HTMLElement} root kontener aplikacji
 * @param {() => void} onSuccess wywoływane po udanym zalogowaniu
 */
export async function renderLogin(root, onSuccess) {
  const meta = await loadMeta().catch(() => null);

  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-box">
        <div class="brand">
          <div class="logo">ResInvest <em>Commodities</em></div>
          <div class="sub">ERP · Magazyn biomasy</div>
        </div>
        <form class="login-card" id="loginForm" autocomplete="on">
          <div class="fld" style="margin-bottom:14px">
            <label for="email">Adres e-mail</label>
            <input type="email" id="email" name="email" autocomplete="username" required
                   placeholder="imie.nazwisko@firma.pl" autofocus>
          </div>
          <div class="fld" style="margin-bottom:18px">
            <label for="password">Hasło</label>
            <input type="password" id="password" name="password" autocomplete="current-password" required>
          </div>
          <button type="submit" class="btn btn-primary btn-block" id="submitBtn">${ICONS.lock} Zaloguj się</button>
          <div id="loginErr" class="err" style="margin-top:12px;text-align:center"></div>
        </form>
        <div class="login-foot">
          ${esc(meta?.company?.name ?? 'ResInvest Commodities PL')}<br>
          ${esc(meta?.company?.address ?? '')}<br>
          System magazynowy · wersja ${esc(meta?.version ?? '1.0.0')}
        </div>
      </div>
    </div>`;

  const form = $('#loginForm');
  const button = $('#submitBtn');
  const errorBox = $('#loginErr');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errorBox.textContent = '';
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> Logowanie…';
    try {
      const user = await login(form.email.value.trim(), form.password.value);
      toast(`Witaj, ${user.fullName.split(' ')[0]}`);
      onSuccess();
    } catch (err) {
      errorBox.textContent = err.message;
      form.password.value = '';
      form.password.focus();
    } finally {
      button.disabled = false;
      button.innerHTML = `${ICONS.lock} Zaloguj się`;
    }
  });
}

/**
 * Ekran wymuszonej zmiany hasła — pokazywany, gdy konto ma flagę
 * `mustChangePassword` (świeżo założone lub zresetowane przez administratora).
 */
export function renderPasswordChange(root, onDone) {
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-box">
        <div class="brand">
          <div class="logo">ResInvest <em>Commodities</em></div>
          <div class="sub">Zmiana hasła</div>
        </div>
        <form class="login-card" id="pwForm">
          <p style="font-size:13px;color:var(--ink-2);margin-bottom:16px">
            Konto <b>${esc(store.user?.email ?? '')}</b> wymaga ustawienia własnego hasła.
            Hasło musi mieć co najmniej 10 znaków, w tym wielką i małą literę oraz cyfrę.
          </p>
          <div class="fld" style="margin-bottom:12px">
            <label for="cur">Obecne hasło</label>
            <input type="password" id="cur" name="currentPassword" required autocomplete="current-password">
          </div>
          <div class="fld" style="margin-bottom:12px">
            <label for="np">Nowe hasło</label>
            <input type="password" id="np" name="newPassword" required autocomplete="new-password" minlength="10">
          </div>
          <div class="fld" style="margin-bottom:18px">
            <label for="np2">Powtórz nowe hasło</label>
            <input type="password" id="np2" required autocomplete="new-password">
          </div>
          <button type="submit" class="btn btn-primary btn-block">Zapisz nowe hasło</button>
          <div id="pwErr" class="err" style="margin-top:12px;text-align:center"></div>
        </form>
      </div>
    </div>`;

  const form = $('#pwForm');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const errorBox = $('#pwErr');
    errorBox.textContent = '';
    if (form.newPassword.value !== $('#np2').value) {
      errorBox.textContent = 'Powtórzone hasło nie jest identyczne.';
      return;
    }
    try {
      await api.post('/auth/change-password', {
        currentPassword: form.currentPassword.value,
        newPassword: form.newPassword.value,
      });
      toast('Hasło zostało zmienione');
      onDone();
    } catch (err) {
      errorBox.textContent = err.message;
    }
  });
}
