import { useAuth } from '../state/AuthContext';
import { useI18n } from '../i18n';
import { Alert, Button } from '../components/ui';

/** Ekran wyboru magazynu roboczego po zalogowaniu. */
export function WarehouseSelectPage() {
  const { t } = useI18n();
  const { warehouses, selectWarehouse, user, logout } = useAuth();

  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ maxWidth: 620 }}>
        <div className="auth-header">
          <div className="auth-logo" aria-hidden="true">
            RI
          </div>
          <h1 style={{ fontSize: 'var(--text-lg)' }}>{t('warehouse.select')}</h1>
          <p className="muted text-sm" style={{ margin: 0 }}>
            {user?.fullName} &middot; {user?.roleName}
          </p>
        </div>

        {warehouses.length === 0 ? (
          <Alert tone="warning">{t('warehouse.none')}</Alert>
        ) : (
          <>
            <p className="muted text-sm">{t('warehouse.selectHint')}</p>
            <div className="choice-grid">
              {warehouses.map((warehouse) => (
                <button
                  key={warehouse.id}
                  type="button"
                  className="choice"
                  onClick={() => {
                    void selectWarehouse(warehouse.id);
                  }}
                >
                  <div className="choice-title">{warehouse.name}</div>
                  <div className="choice-sub">
                    <span className="mono">{warehouse.code}</span>
                    {warehouse.city ? ` · ${warehouse.city}` : ''}
                  </div>
                </button>
              ))}
              {warehouses.length > 1 ? (
                <button
                  type="button"
                  className="choice"
                  onClick={() => {
                    void selectWarehouse(null);
                  }}
                >
                  <div className="choice-title">{t('warehouse.all')}</div>
                  <div className="choice-sub">{t('dashboard.subtitle')}</div>
                </button>
              ) : null}
            </div>
          </>
        )}

        <div className="auth-footer">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void logout();
            }}
          >
            {t('action.logout')}
          </Button>
        </div>
      </div>
    </div>
  );
}
