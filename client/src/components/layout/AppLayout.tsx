import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useTheme } from '../../state/ThemeContext';
import { LOCALES, useI18n, type TranslationKey } from '../../i18n';
import { Button } from '../ui';

interface NavEntry {
  to: string;
  labelKey: TranslationKey;
  icon: string;
  permissions?: string[];
}

interface NavGroup {
  labelKey: TranslationKey;
  entries: NavEntry[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'nav.overview',
    entries: [{ to: '/', labelKey: 'nav.dashboard', icon: '◧', permissions: ['stock.view'] }],
  },
  {
    labelKey: 'nav.operations',
    entries: [
      { to: '/operations/PZ', labelKey: 'nav.receipts', icon: '↓', permissions: ['pz.view'] },
      { to: '/operations/WZ', labelKey: 'nav.issues', icon: '↑', permissions: ['wz.view'] },
      { to: '/operations/MM', labelKey: 'nav.transfers', icon: '⇄', permissions: ['mm.view'] },
      { to: '/operations/PROD', labelKey: 'nav.production', icon: '⚙', permissions: ['prod.view'] },
      { to: '/operations/TR', labelKey: 'nav.transport', icon: '⛟', permissions: ['tr.view'] },
      { to: '/operations/SD', labelKey: 'nav.directSale', icon: '⇉', permissions: ['sd.view'] },
    ],
  },
  {
    labelKey: 'nav.data',
    entries: [
      { to: '/stock', labelKey: 'nav.stock', icon: '▦', permissions: ['stock.view'] },
      { to: '/movements', labelKey: 'nav.movements', icon: '≡', permissions: ['stock.view'] },
      { to: '/documents', labelKey: 'nav.documents', icon: '🗎' },
      { to: '/reports', labelKey: 'nav.reports', icon: '▤', permissions: ['reports.view'] },
      { to: '/audit', labelKey: 'nav.audit', icon: '🕘', permissions: ['audit.view'] },
    ],
  },
  {
    labelKey: 'nav.administration',
    entries: [
      { to: '/admin/users', labelKey: 'nav.users', icon: '👤', permissions: ['admin.users'] },
      { to: '/admin/warehouses', labelKey: 'nav.warehouses', icon: '🏬', permissions: ['admin.warehouses'] },
      { to: '/admin/products', labelKey: 'nav.products', icon: '📦', permissions: ['admin.products'] },
      { to: '/admin/partners', labelKey: 'nav.partners', icon: '🤝', permissions: ['admin.partners'] },
      { to: '/admin/settings', labelKey: 'nav.settings', icon: '⚙', permissions: ['admin.settings'] },
    ],
  },
];

export function AppLayout() {
  const { t, locale, setLocale } = useI18n();
  const { user, warehouse, warehouses, selectWarehouse, logout, canAny } = useAuth();
  const { preference, resolved, setPreference } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState<null | 'user' | 'warehouse'>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Nawigacja na telefonie zamyka panel boczny po zmianie widoku.
  useEffect(() => {
    setSidebarOpen(false);
    setMenuOpen(null);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(null);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    entries: group.entries.filter((entry) => !entry.permissions || canAny(...entry.permissions)),
  })).filter((group) => group.entries.length > 0);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t('nav.skipToContent')}
      </a>

      {sidebarOpen ? <div className="sidebar-scrim no-print" onClick={() => setSidebarOpen(false)} /> : null}

      <aside className={`app-sidebar no-print ${sidebarOpen ? 'open' : ''}`} aria-label={t('nav.menu')}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            RI
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="brand-name">{t('app.name')}</div>
            <div className="brand-sub">{t('app.company')}</div>
          </div>
        </div>

        <nav className="nav">
          {visibleGroups.map((group) => (
            <div key={group.labelKey}>
              <div className="nav-group-label">{t(group.labelKey)}</div>
              {group.entries.map((entry) => (
                <NavLink
                  key={entry.to}
                  to={entry.to}
                  end={entry.to === '/'}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  <span className="nav-icon" aria-hidden="true">
                    {entry.icon}
                  </span>
                  <span>{t(entry.labelKey)}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <header className="app-header no-print">
        <Button
          className="hamburger"
          variant="ghost"
          onClick={() => setSidebarOpen((open) => !open)}
          aria-label={t('nav.menu')}
          aria-expanded={sidebarOpen}
        >
          ☰
        </Button>

        <div className="menu-anchor" ref={menuOpen ? menuRef : undefined}>
          <button
            type="button"
            className="warehouse-pill"
            onClick={() => setMenuOpen(menuOpen === 'warehouse' ? null : 'warehouse')}
            aria-haspopup="menu"
            aria-expanded={menuOpen === 'warehouse'}
          >
            <span aria-hidden="true">🏬</span>
            <span>{warehouse ? warehouse.name : t('warehouse.all')}</span>
            <span aria-hidden="true">▾</span>
          </button>

          {menuOpen === 'warehouse' ? (
            <div className="menu" role="menu">
              <div className="menu-label">{t('warehouse.current')}</div>
              <button
                type="button"
                role="menuitem"
                className={`menu-item ${warehouse === null ? 'selected' : ''}`}
                onClick={() => {
                  void selectWarehouse(null);
                  setMenuOpen(null);
                }}
              >
                {t('warehouse.all')}
              </button>
              {warehouses.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className={`menu-item ${warehouse?.id === item.id ? 'selected' : ''}`}
                  onClick={() => {
                    void selectWarehouse(item.id);
                    setMenuOpen(null);
                  }}
                >
                  <span className="mono text-xs">{item.code}</span>
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="toolbar-spacer" />

        <Button
          variant="ghost"
          onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}
          aria-label={`${t('settings.theme')}: ${t(`settings.theme.${preference}` as const)}`}
          title={t('settings.theme')}
        >
          {resolved === 'dark' ? '☾' : '☀'}
        </Button>

        <div className="menu-anchor" ref={menuOpen === 'user' ? menuRef : undefined}>
          <Button
            variant="ghost"
            onClick={() => setMenuOpen(menuOpen === 'user' ? null : 'user')}
            aria-haspopup="menu"
            aria-expanded={menuOpen === 'user'}
          >
            <span aria-hidden="true">👤</span>
            <span className="nowrap">{user?.fullName}</span>
            <span aria-hidden="true">▾</span>
          </Button>

          {menuOpen === 'user' ? (
            <div className="menu" role="menu">
              <div className="menu-label">
                {user?.login} · {user?.roleName}
              </div>
              <button type="button" role="menuitem" className="menu-item" onClick={() => navigate('/profile')}>
                {t('auth.profile')}
              </button>
              <div className="menu-sep" />
              <div className="menu-label">{t('settings.language')}</div>
              {LOCALES.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  role="menuitem"
                  className={`menu-item ${locale === item.code ? 'selected' : ''}`}
                  onClick={() => setLocale(item.code)}
                >
                  {item.label}
                </button>
              ))}
              <div className="menu-sep" />
              <div className="menu-label">{t('settings.theme')}</div>
              {(['light', 'dark', 'system'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="menuitem"
                  className={`menu-item ${preference === value ? 'selected' : ''}`}
                  onClick={() => setPreference(value)}
                >
                  {t(`settings.theme.${value}` as const)}
                </button>
              ))}
              <div className="menu-sep" />
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  void logout();
                }}
              >
                {t('action.logout')}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <main className="app-main" id="main-content">
        <Outlet />
      </main>
    </div>
  );
}
