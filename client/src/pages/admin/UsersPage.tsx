import { useState } from 'react';
import { api } from '../../api/client';
import type { AppUser, Role, Warehouse } from '../../api/types';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useI18n } from '../../i18n';
import { useApiData, useApiErrorMessage } from '../../hooks/useApiData';
import { formatDateTime } from '../../lib/format';
import { Alert, Badge, Button, Card, Checkbox, SelectInput, Tabs, TextInput } from '../../components/ui';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Modal } from '../../components/ui/Modal';

interface RolesResponse {
  items: Role[];
  catalog: Array<{ code: string; description: string }>;
}

interface UserFormState {
  id: number | null;
  login: string;
  fullName: string;
  email: string;
  roleId: string;
  isActive: boolean;
  locale: 'pl' | 'cs' | 'en';
  warehouseIds: number[];
  defaultWarehouseId: string;
  password: string;
  mustChangePassword: boolean;
}

const EMPTY_USER: UserFormState = {
  id: null,
  login: '',
  fullName: '',
  email: '',
  roleId: '',
  isActive: true,
  locale: 'pl',
  warehouseIds: [],
  defaultWarehouseId: '',
  password: '',
  mustChangePassword: true,
};

export function UsersPage() {
  const { t } = useI18n();
  const { user: currentUser } = useAuth();
  const toast = useToast();
  const toMessage = useApiErrorMessage();

  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [form, setForm] = useState<UserFormState | null>(null);
  const [resetFor, setResetFor] = useState<AppUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const users = useApiData<{ items: AppUser[] }>((signal) => api.get('/users', undefined, signal), []);
  const roles = useApiData<RolesResponse>((signal) => api.get('/users/roles', undefined, signal), []);
  const warehouses = useApiData<{ items: Warehouse[] }>(
    (signal) => api.get('/warehouses', { all: true }, signal),
    [],
  );

  const roleOptions = (roles.data?.items ?? []).map((role) => ({ value: String(role.id), label: role.name }));
  const warehouseList = warehouses.data?.items ?? [];

  async function saveUser() {
    if (!form) return;
    if (form.login.trim().length < 3 || form.fullName.trim().length < 3 || !form.roleId) {
      setFormError(t('msg.requiredField'));
      return;
    }
    if (form.id === null && form.password.length < 10) {
      setFormError(t('auth.passwordRules'));
      return;
    }
    setBusy(true);
    setFormError(null);

    const base = {
      login: form.login.trim(),
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      roleId: Number(form.roleId),
      isActive: form.isActive,
      locale: form.locale,
      warehouseIds: form.warehouseIds,
      defaultWarehouseId: form.defaultWarehouseId ? Number(form.defaultWarehouseId) : null,
      mustChangePassword: form.mustChangePassword,
    };

    try {
      if (form.id === null) await api.post('/users', { ...base, password: form.password });
      else await api.put(`/users/${form.id}`, base);
      toast.success(form.id === null ? t('msg.created') : t('msg.saved'));
      setForm(null);
      users.reload();
    } catch (err) {
      setFormError(toMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitReset() {
    if (!resetFor) return;
    if (resetPassword.length < 10) {
      setFormError(t('auth.passwordRules'));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await api.post(`/users/${resetFor.id}/reset-password`, {
        password: resetPassword,
        mustChangePassword: true,
      });
      toast.success(t('msg.saved'), resetFor.login);
      setResetFor(null);
      setResetPassword('');
    } catch (err) {
      setFormError(toMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveRolePermissions(role: Role, permissions: string[]) {
    setBusy(true);
    try {
      await api.put(`/users/roles/${role.id}/permissions`, { permissions });
      toast.success(t('msg.saved'), role.name);
      roles.reload();
    } catch (err) {
      toast.error(t('action.save'), toMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const userColumns: Array<Column<AppUser>> = [
    {
      key: 'login',
      header: t('auth.login'),
      render: (row) => (
        <>
          <div className="mono strong">{row.login}</div>
          <div className="text-xs muted">{row.fullName}</div>
        </>
      ),
    },
    { key: 'role', header: t('users.role'), render: (row) => row.roleName },
    {
      key: 'warehouses',
      header: t('users.warehouses'),
      secondary: true,
      render: (row) =>
        row.roleCode === 'ADMIN'
          ? t('common.all')
          : warehouseList
              .filter((w) => row.warehouseIds.includes(w.id))
              .map((w) => w.code)
              .join(', ') || t('common.none'),
    },
    {
      key: 'status',
      header: t('doc.status'),
      render: (row) =>
        row.isActive ? (
          <Badge tone="success" mark="●">
            {t('users.active')}
          </Badge>
        ) : (
          <Badge tone="danger" mark="✕">
            {t('users.inactive')}
          </Badge>
        ),
    },
    {
      key: 'lastLogin',
      header: t('users.lastLogin'),
      secondary: true,
      render: (row) => (row.lastLoginAt ? formatDateTime(row.lastLoginAt, 'pl-PL') : t('users.neverLoggedIn')),
    },
    {
      key: 'actions',
      header: '',
      isActions: true,
      render: (row) => (
        <div className="btn-group">
          <Button
            size="sm"
            onClick={() =>
              setForm({
                id: row.id,
                login: row.login,
                fullName: row.fullName,
                email: row.email,
                roleId: String(row.roleId),
                isActive: row.isActive,
                locale: row.locale,
                warehouseIds: row.warehouseIds,
                defaultWarehouseId: row.defaultWarehouseId ? String(row.defaultWarehouseId) : '',
                password: '',
                mustChangePassword: row.mustChangePassword,
              })
            }
          >
            {t('action.edit')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setResetFor(row)}>
            {t('action.resetPassword')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('users.title')}</h1>
          <p className="page-subtitle">{t('users.rolesAndPermissions')}</p>
        </div>
        <div className="page-actions">
          <Button onClick={() => (tab === 'users' ? users.reload() : roles.reload())}>{t('action.refresh')}</Button>
          {tab === 'users' ? (
            <Button
              variant="primary"
              onClick={() => setForm({ ...EMPTY_USER, roleId: roleOptions[0]?.value ?? '' })}
            >
              + {t('action.create')}
            </Button>
          ) : null}
        </div>
      </div>

      <Tabs<'users' | 'roles'>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'users', label: t('users.title') },
          { id: 'roles', label: t('users.rolesAndPermissions') },
        ]}
      />

      {tab === 'users' ? (
        <Card tight>
          <DataTable
            columns={userColumns}
            rows={users.data?.items ?? []}
            rowKey={(row) => row.id}
            loading={users.loading && !users.data}
            error={users.error}
            onRetry={users.reload}
          />
        </Card>
      ) : (
        <>
          {(roles.data?.items ?? []).map((role) => (
            <RolePermissionsCard
              key={role.id}
              role={role}
              catalog={roles.data?.catalog ?? []}
              busy={busy}
              onSave={(permissions) => void saveRolePermissions(role, permissions)}
            />
          ))}
        </>
      )}

      <Modal
        open={form !== null}
        title={form?.id === null ? t('action.create') : t('action.edit')}
        onClose={() => setForm(null)}
        busy={busy}
        wide
        footer={
          <>
            <Button onClick={() => setForm(null)} disabled={busy}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={saveUser}>
              {t('action.save')}
            </Button>
          </>
        }
      >
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        {form ? (
          <div className="form-grid">
            <TextInput
              label={t('auth.login')}
              required
              value={form.login}
              maxLength={40}
              onChange={(event) => setForm({ ...form, login: event.target.value })}
            />
            <TextInput
              label={t('users.fullName')}
              required
              value={form.fullName}
              maxLength={120}
              onChange={(event) => setForm({ ...form, fullName: event.target.value })}
            />
            <TextInput
              label={t('users.email')}
              type="email"
              value={form.email}
              maxLength={120}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
            <SelectInput
              label={t('users.role')}
              required
              value={form.roleId}
              options={roleOptions}
              onChange={(event) => setForm({ ...form, roleId: event.target.value })}
            />
            <SelectInput
              label={t('settings.language')}
              value={form.locale}
              options={[
                { value: 'pl', label: 'Polski' },
                { value: 'cs', label: 'Cestina' },
                { value: 'en', label: 'English' },
              ]}
              onChange={(event) => setForm({ ...form, locale: event.target.value as 'pl' | 'cs' | 'en' })}
            />
            {form.id === null ? (
              <TextInput
                label={t('users.newPassword')}
                type="password"
                required
                value={form.password}
                hint={t('auth.passwordRules')}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
            ) : null}
            <div className="field span-full">
              <span className="field-label">{t('users.warehouses')}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
                {warehouseList.map((warehouse) => (
                  <Checkbox
                    key={warehouse.id}
                    label={`${warehouse.code} · ${warehouse.name}`}
                    checked={form.warehouseIds.includes(warehouse.id)}
                    onChange={(checked) =>
                      setForm({
                        ...form,
                        warehouseIds: checked
                          ? [...form.warehouseIds, warehouse.id]
                          : form.warehouseIds.filter((id) => id !== warehouse.id),
                        defaultWarehouseId:
                          !checked && form.defaultWarehouseId === String(warehouse.id)
                            ? ''
                            : form.defaultWarehouseId,
                      })
                    }
                  />
                ))}
              </div>
            </div>
            <SelectInput
              label={t('users.defaultWarehouse')}
              value={form.defaultWarehouseId}
              placeholder={t('common.none')}
              options={warehouseList
                .filter((w) => form.warehouseIds.includes(w.id))
                .map((w) => ({ value: String(w.id), label: w.name }))}
              onChange={(event) => setForm({ ...form, defaultWarehouseId: event.target.value })}
            />
            <div className="field">
              <Checkbox
                label={t('users.active')}
                checked={form.isActive}
                disabled={form.id === currentUser?.id}
                onChange={(checked) => setForm({ ...form, isActive: checked })}
              />
              <Checkbox
                label={t('users.mustChangePassword')}
                checked={form.mustChangePassword}
                onChange={(checked) => setForm({ ...form, mustChangePassword: checked })}
              />
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={resetFor !== null}
        title={`${t('action.resetPassword')} · ${resetFor?.login ?? ''}`}
        onClose={() => setResetFor(null)}
        busy={busy}
        footer={
          <>
            <Button onClick={() => setResetFor(null)} disabled={busy}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={submitReset}>
              {t('action.save')}
            </Button>
          </>
        }
      >
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <TextInput
          label={t('users.newPassword')}
          type="password"
          required
          value={resetPassword}
          hint={t('auth.passwordRules')}
          onChange={(event) => setResetPassword(event.target.value)}
        />
      </Modal>
    </>
  );
}

function RolePermissionsCard({
  role,
  catalog,
  busy,
  onSave,
}: {
  role: Role;
  catalog: Array<{ code: string; description: string }>;
  busy: boolean;
  onSave: (permissions: string[]) => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string[]>(role.permissions);
  const locked = role.code === 'ADMIN';

  const groups = catalog.reduce<Record<string, Array<{ code: string; description: string }>>>((acc, item) => {
    const module = item.code.split('.')[0] ?? 'other';
    (acc[module] ??= []).push(item);
    return acc;
  }, {});

  return (
    <Card
      title={`${role.name} (${role.code})`}
      actions={
        locked ? (
          <span className="text-sm muted">{t('users.adminRoleLocked')}</span>
        ) : (
          <Button size="sm" variant="primary" loading={busy} onClick={() => onSave(selected)}>
            {t('action.save')}
          </Button>
        )
      }
    >
      <p className="muted text-sm">{role.description}</p>
      <div className="form-grid">
        {Object.entries(groups).map(([module, items]) => (
          <div key={module} className="field">
            <span className="field-label uppercase text-xs">{module}</span>
            {items.map((item) => (
              <Checkbox
                key={item.code}
                label={item.code}
                disabled={locked}
                checked={locked ? true : selected.includes(item.code)}
                onChange={(checked) =>
                  setSelected((prev) => (checked ? [...prev, item.code] : prev.filter((c) => c !== item.code)))
                }
              />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}
