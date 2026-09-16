import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './state/AuthContext';
import { useI18n } from './i18n';
import { AppLayout } from './components/layout/AppLayout';
import { LoadingState, Alert } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { WarehouseSelectPage } from './pages/WarehouseSelectPage';
import { DashboardPage } from './pages/DashboardPage';
import { DocumentListPage } from './pages/DocumentListPage';
import { DocumentFormPage } from './pages/DocumentFormPage';
import { DocumentDetailPage } from './pages/DocumentDetailPage';
import { StockPage } from './pages/StockPage';
import { MovementsPage } from './pages/MovementsPage';
import { ReportsPage } from './pages/ReportsPage';
import { AuditPage } from './pages/AuditPage';
import { ProfilePage } from './pages/ProfilePage';
import { UsersPage } from './pages/admin/UsersPage';
import { WarehousesPage } from './pages/admin/WarehousesPage';
import { ProductsPage } from './pages/admin/ProductsPage';
import { PartnersPage } from './pages/admin/PartnersPage';
import { SettingsPage } from './pages/admin/SettingsPage';

/** Strażniki tras. Właściwa kontrola uprawnień odbywa się po stronie serwera. */
function RequirePermission({ permission, children }: { permission: string; children: JSX.Element }) {
  const { can } = useAuth();
  const { t } = useI18n();
  if (!can(permission)) return <Alert tone="danger">{t('error.FORBIDDEN')}</Alert>;
  return children;
}

export function App() {
  const { status, user, warehouseId, warehouses } = useAuth();

  if (status === 'loading') {
    return (
      <div className="auth-screen">
        <LoadingState />
      </div>
    );
  }

  if (status === 'anonymous' || !user) return <LoginPage />;
  if (user.mustChangePassword) return <ChangePasswordPage />;

  // Użytkownik z wieloma magazynami wybiera kontekst pracy przed wejściem
  // do aplikacji; posiadający jeden magazyn dostaje go automatycznie.
  if (warehouseId === null && warehouses.length > 1) return <WarehouseSelectPage />;
  if (warehouses.length === 0 && !user.isAdmin) return <WarehouseSelectPage />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route
          index
          element={
            <RequirePermission permission="stock.view">
              <DashboardPage />
            </RequirePermission>
          }
        />

        <Route path="operations/:docType" element={<DocumentListPage />} />
        <Route path="operations/:docType/new" element={<DocumentFormPage />} />
        <Route path="documents" element={<DocumentListPage />} />
        <Route path="documents/:id" element={<DocumentDetailPage />} />
        <Route path="documents/:id/edit" element={<DocumentFormPage />} />

        <Route
          path="stock"
          element={
            <RequirePermission permission="stock.view">
              <StockPage />
            </RequirePermission>
          }
        />
        <Route
          path="movements"
          element={
            <RequirePermission permission="stock.view">
              <MovementsPage />
            </RequirePermission>
          }
        />
        <Route
          path="reports"
          element={
            <RequirePermission permission="reports.view">
              <ReportsPage />
            </RequirePermission>
          }
        />
        <Route
          path="audit"
          element={
            <RequirePermission permission="audit.view">
              <AuditPage />
            </RequirePermission>
          }
        />

        <Route path="profile" element={<ProfilePage />} />

        <Route
          path="admin/users"
          element={
            <RequirePermission permission="admin.users">
              <UsersPage />
            </RequirePermission>
          }
        />
        <Route
          path="admin/warehouses"
          element={
            <RequirePermission permission="admin.warehouses">
              <WarehousesPage />
            </RequirePermission>
          }
        />
        <Route
          path="admin/products"
          element={
            <RequirePermission permission="admin.products">
              <ProductsPage />
            </RequirePermission>
          }
        />
        <Route
          path="admin/partners"
          element={
            <RequirePermission permission="admin.partners">
              <PartnersPage />
            </RequirePermission>
          }
        />
        <Route
          path="admin/settings"
          element={
            <RequirePermission permission="admin.settings">
              <SettingsPage />
            </RequirePermission>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
