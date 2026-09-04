/** Zarządzanie kontami użytkowników i podgląd dziennika audytu. */
import api from '../core/api.js';
import { esc, on, options, formValues, markFieldErrors } from '../core/dom.js';
import { dateTime } from '../core/format.js';
import {
  pageHead, empty, loading, openModal, closeModal, toast, toastError, alertBox,
} from '../core/ui.js';
import { ICONS } from '../components/icons.js';
import { can, store } from '../core/store.js';

const ROLE_HINTS = {
  ADMIN: 'Pełna kontrola: użytkownicy, ustawienia, import danych.',
  KIEROWNIK: 'Praca operacyjna, storno dokumentów, zamykanie okresów.',
  MAGAZYNIER: 'Wprowadzanie i korygowanie własnych dokumentów.',
  KSIEGOWY: 'Odczyt, raporty i eksporty — bez wprowadzania dokumentów.',
  AUDYTOR: 'Wyłącznie odczyt — kontrola i certyfikacja.',
};

const state = { tab: 'konta' };

export async function renderUsers(view) {
  view.innerHTML = loading('Wczytywanie kont…');
  await refresh(view);
}

async function refresh(view) {
  const manage = can('users:write');
  const head = pageHead('Użytkownicy', 'Konta, role i dziennik audytu',
    manage ? `<button class="btn btn-primary" data-act="add">${ICONS.plus} Nowe konto</button>` : '')
    + `<div class="chips">
        <button data-tab="konta" class="${state.tab === 'konta' ? 'on' : ''}">Konta</button>
        <button data-tab="audyt" class="${state.tab === 'audyt' ? 'on' : ''}">Dziennik audytu</button>
      </div>`;

  view.innerHTML = head + loading();
  view.innerHTML = head + (state.tab === 'konta' ? await accountsTab(manage) : await auditTab());

  on(view, 'click', '[data-tab]', (el) => { state.tab = el.dataset.tab; refresh(view); });
  view.querySelector('[data-act="add"]')?.addEventListener('click', () => openUserForm(view, null));
  on(view, 'click', '[data-edit-user]', (el) => openUserForm(view, JSON.parse(el.dataset.user)));
}

async function accountsTab(manage) {
  const { items } = await api.get('/users');
  return alertBox('info', 'Konta nie są usuwane — dezaktywacja zachowuje powiązania z dokumentami i audytem. '
    + 'Zmiana hasła lub dezaktywacja natychmiast zamyka wszystkie sesje użytkownika.')
    + `<div class="card"><div class="card-b flush">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Użytkownik</th><th>E-mail</th><th>Rola</th><th>Ostatnie logowanie</th><th>Status</th><th></th></tr></thead>
        <tbody>${items.map((u) => `<tr${u.isActive ? '' : ' style="opacity:.55"'}>
          <td><b>${esc(u.fullName)}</b>${u.id === store.user?.id ? ' <span class="tag OPEN">to Ty</span>' : ''}
            ${u.mustChangePassword ? '<br><span style="font-size:11px;color:var(--gold)">wymagana zmiana hasła</span>' : ''}</td>
          <td style="font-size:12.5px">${esc(u.email)}</td>
          <td><b>${esc(u.role)}</b><br><span style="font-size:11px;color:var(--ink-3)">${esc(ROLE_HINTS[u.role] ?? '')}</span></td>
          <td style="font-size:12px">${u.lastLoginAt ? dateTime(u.lastLoginAt) : '—'}</td>
          <td>${u.isActive ? '<span class="tag OPEN">aktywne</span>' : '<span class="tag CLOSED">zablokowane</span>'}</td>
          <td>${manage ? `<button class="icon-btn" data-edit-user="1" data-user='${esc(JSON.stringify(u))}' title="Edytuj">${ICONS.edit}</button>` : ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${items.length ? '' : empty('Brak kont')}
    </div></div>`;
}

async function auditTab() {
  const { items, total } = await api.get('/audit', { limit: 200 });
  return `<div class="card">
    <div class="card-h"><h2>Dziennik audytu</h2><span class="sub">${total} zdarzeń · pokazano ostatnie ${items.length}</span></div>
    <div class="card-b flush"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Czas</th><th>Użytkownik</th><th>Akcja</th><th>Obiekt</th><th>Adres IP</th><th>Szczegóły</th></tr></thead>
      <tbody>${items.map((a) => `<tr>
        <td style="white-space:nowrap;font-size:12px">${dateTime(a.timestamp)}</td>
        <td style="font-size:12px">${esc(a.user || 'system')}</td>
        <td><span class="tag ${/FAILED|CANCEL|DELETE/.test(a.action) ? 'CANCELLED' : 'OPEN'}">${esc(a.action)}</span></td>
        <td style="font-size:12px">${esc(a.entity)}</td>
        <td style="font-family:var(--font-mono);font-size:11px">${esc(a.ip || '—')}</td>
        <td class="ellip" style="font-size:11px;color:var(--ink-2)">${esc(a.detail ? JSON.stringify(a.detail) : '')}</td>
      </tr>`).join('')}</tbody>
    </table></div>${items.length ? '' : empty('Dziennik jest pusty')}</div>
  </div>`;
}

function openUserForm(view, user) {
  const isNew = !user;
  openModal({
    title: isNew ? 'Nowe konto użytkownika' : `Konto — ${user.fullName}`,
    body: `<form id="userForm"><div class="form-grid">
      <div class="fld wide"><label for="fullName">Imię i nazwisko *</label>
        <input type="text" id="fullName" name="fullName" value="${esc(user?.fullName ?? '')}" required></div>
      <div class="fld"><label for="email">E-mail *</label>
        <input type="email" id="email" name="email" value="${esc(user?.email ?? '')}" required></div>
      <div class="fld"><label for="phone">Telefon</label>
        <input type="text" id="phone" name="phone" value="${esc(user?.phone ?? '')}"></div>
      <div class="fld wide"><label for="role">Rola *</label>
        <select id="role" name="role">${options(Object.keys(ROLE_HINTS), user?.role ?? 'MAGAZYNIER')}</select>
        <div class="hint" id="roleHint"></div></div>
      <div class="fld wide"><label for="password">${isNew ? 'Hasło startowe *' : 'Nowe hasło (pozostaw puste, aby nie zmieniać)'}</label>
        <input type="text" id="password" name="password" ${isNew ? 'required' : ''} autocomplete="new-password"
               placeholder="min. 10 znaków, wielka i mała litera, cyfra">
        <div class="hint">Hasło przekaż użytkownikowi bezpiecznym kanałem — przy pierwszym logowaniu zostanie poproszony o jego zmianę.</div></div>
      <div class="fld"><label class="check">
        <input type="checkbox" name="isActive" ${user?.isActive === false ? '' : 'checked'}><span>Konto aktywne</span></label></div>
      <div class="fld"><label class="check">
        <input type="checkbox" name="mustChangePassword" ${isNew || user?.mustChangePassword ? 'checked' : ''}>
        <span>Wymuś zmianę hasła</span></label></div>
    </div></form>`,
    footer: `<button class="btn" data-modal-close>Anuluj</button>
             <button class="btn btn-primary" data-user-save>Zapisz</button>`,
    onMount(box) {
      const form = box.querySelector('#userForm');
      const hint = box.querySelector('#roleHint');
      const updateHint = () => { hint.textContent = ROLE_HINTS[form.role.value] ?? ''; };
      form.role.addEventListener('change', updateHint);
      updateHint();

      box.querySelector('[data-user-save]').onclick = async () => {
        const values = formValues(form);
        if (!values.password) delete values.password;
        try {
          if (isNew) await api.post('/users', values);
          else await api.patch(`/users/${user.id}`, values);
          toast(isNew ? 'Konto utworzone' : 'Zapisano zmiany');
          closeModal();
          refresh(view);
        } catch (err) {
          if (err.isValidation) markFieldErrors(form, err.details);
          else toastError(err);
        }
      };
    },
  });
}
