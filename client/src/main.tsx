import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { I18nProvider } from './i18n';
import { ThemeProvider } from './state/ThemeContext';
import { ToastProvider, ToastViewport } from './state/ToastContext';
import { AuthProvider } from './state/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Nie znaleziono elementu #root w dokumencie.');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
              <ToastViewport />
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
);
