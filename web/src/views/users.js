/**
 * Zarządzanie kontami: role, stan konta i przypisanie do magazynów.
 *
 * Historia zmian ma własny widok (`views/history.js`) — czytają ją także
 * audytor i księgowość, czyli role bez wglądu w kartotekę kont.
 */
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

export async function renderUsers(view) {
  view.innerHTML = loading('Wczytywanie kont…');
  await refresh(view);
}

async function refresh(view) {
  const manage = can('users:write');
  // Dziennik audytu miał tu kiedyś własną zakładkę, która wypisywała surowy
  // JSON w jednej komórce. Zastąpił ją pełny widok „Historia zmian”
  // z filtrami, porównaniem przed/po i wydrukiem — drugi, gorszy widok tych
  // samych danych tylko dzieliłby uwagę i rozjeżdżał się z tamtym.
  const head = pageHead('Użytkownicy', 'Konta i role',
    manage ? `<button class="btn btn-primary" data-act="add">${ICONS.plus} Nowe konto</button>` : '');

  view.innerHTML = head + loading();
  view.innerHTML = head + await accountsTab(manage);

  view.querySelector('[data-act="add"]')?.addEventListener('click', () => openUserForm(view, null));
  on(view, 'click', '[data-wh-user]', (el) => openWarehouseForm(view, el.dataset.whUser, el.dataset.name));
  on(view, 'click', '[data-edit-user]', (el) => openUserForm(view, JSON.parse(el.dataset.user)));
}

async function accountsTab(manage) {
  const [{ items }, { items: magazyny }] = await Promise.all([
    api.get('/users'),
    api.get('/warehouses'),
  ]);
  // Przypisania czytamy jednym przebiegiem po kontach, a nie przy każdym
  // otwarciu okna — lista kont w firmie jest krótka, a widok ma od razu
  // pokazywać, kto gdzie pracuje.
  const przypisania = Object.fromEntries(await Promise.all(items.map(async (u) => {
    const { warehouseIds } = await api.get(`/users/${u.id}/warehouses`);
    return [u.id, warehouseIds];
  })));
  return alertBox('info', 'Konta nie są usuwane — dezaktywacja zachowuje powiązania z dokumentami i audytem. '
    + 'Zmiana hasła lub dezaktywacja natychmiast zamyka wszystkie sesje użytkownika.')
    + `<div class="card"><div class="card-b flush">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Użytkownik</th><th>E-mail</th><th>Rola</th><th>Magazyny</th><th>Ostatnie logowanie</th><th>Status</th><th></th></tr></thead>
        <tbody>${items.map((u) => `<tr${u.isActive ? '' : ' style="opacity:.55"'}>
          <td><b>${esc(u.fullName)}</b>${u.id === store.user?.id ? ' <span class="tag OPEN">to Ty</span>' : ''}
            ${u.mustChangePassword ? '<br><span style="font-size:11px;color:var(--gold)">wymagana zmiana hasła</span>' : ''}</td>
          <td style="font-size:12.5px">${esc(u.email)}</td>
          <td><b>${esc(u.role)}</b><br><span style="font-size:11px;color:var(--ink-3)">${esc(ROLE_HINTS[u.role] ?? '')}</span></td>
          <td style="font-size:12px">${warehouseSummary(u, przypisania[u.id] ?? [], magazyny)}</td>
          <td style="font-size:12px">${u.lastLoginAt ? dateTime(u.lastLoginAt) : '—'}</td>
          <td>${u.isActive ? '<span class="tag OPEN">aktywne</span>' : '<span class="tag CLOSED">zablokowane</span>'}</td>
          <td>${manage ? `<button class="icon-btn" data-edit-user="1" data-user='${esc(JSON.stringify(u))}' title="Edytuj konto">${ICONS.edit}</button>
            <button class="icon-btn" data-wh-user="${esc(u.id)}" data-name="${esc(u.fullName)}"
                    title="Przypisz magazyny">${ICONS.warehouse}</button>` : ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${items.length ? '' : empty('Brak kont')}
    </div></div>`;
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


/* ----------------------- Przypisanie magazynów -------------------------- */

/**
 * Podsumowanie dostępu w wierszu konta.
 *
 * Administrator ma dostęp do wszystkiego z samej roli — pokazywanie przy nim
 * listy magazynów sugerowałoby ograniczenie, którego nie ma.
 */
function warehouseSummary(user, ids, magazyny) {
  if (user.role === 'ADMIN') return '<span style="color:var(--ink-3)">wszystkie (rola)</span>';
  if (!ids.length) return '<span style="color:var(--ink-3)">wszystkie</span>';
  const nazwy = ids
    .map((id) => magazyny.find((w) => w.id === id)?.name)
    .filter(Boolean);
  return esc(nazwy.join(', ')) || '<span style="color:var(--ink-3)">wszystkie</span>';
}

/** Okno przypisania magazynów do konta. */
async function openWarehouseForm(view, userId, fullName) {
  const [{ items: magazyny }, { warehouseIds }] = await Promise.all([
    api.get('/warehouses'),
    api.get(`/users/${userId}/warehouses`),
  ]);

  openModal({
    title: `Magazyny konta: ${fullName}`,
    body: `<form id="whForm">
      <p class="sub" style="margin-bottom:12px">
        Brak zaznaczeń oznacza dostęp do <b>wszystkich</b> magazynów. Zaznaczenie choćby
        jednego placu zamyka dostęp do pozostałych — także do rejestru dokumentów,
        stanów i raportów z tamtych magazynów.
      </p>
      <div class="form-grid">
        ${magazyny.map((w) => `<div class="fld wide"><label class="check">
          <input type="checkbox" name="wh" value="${esc(w.id)}" ${warehouseIds.includes(w.id) ? 'checked' : ''}>
          <span>${esc(w.name)}${w.isDefault ? ' · domyślny' : ''}</span></label></div>`).join('')}
      </div>
    </form>`,
    footer: `<button class="btn" data-modal-close>Anuluj</button>
             <button class="btn btn-primary" id="whSave">Zapisz przypisanie</button>`,
    onMount(box) {
      box.querySelector('#whSave').onclick = async () => {
        const zaznaczone = [...box.querySelectorAll('input[name="wh"]:checked')].map((i) => i.value);
        try {
          const wynik = await api.put(`/users/${userId}/warehouses`, { warehouseIds: zaznaczone });
          closeModal();
          toast(wynik.unrestricted
            ? 'Konto ma dostęp do wszystkich magazynów'
            : `Przypisano magazyny: ${wynik.warehouseIds.length}`);
          refresh(view);
        } catch (err) {
          toastError(err);
        }
      };
    },
  });
}
