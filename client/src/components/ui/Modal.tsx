import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './index';
import { useI18n } from '../../i18n';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Blokuje zamknięcie klawiszem Escape i klikiem w tlo (np. podczas zapisu). */
  busy?: boolean;
}

export function Modal({ open, title, onClose, children, footer, wide = false, busy = false }: ModalProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!open) return;
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onClose();
        return;
      }
      // Pulapka fokusu - Tab nie wychodzi poza okno modalne.
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null,
        );
        if (focusable.length === 0) return;
        const first = focusable[0] as HTMLElement;
        const last = focusable[focusable.length - 1] as HTMLElement;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    },
    [open, onClose, busy],
  );

  useEffect(() => {
    if (!open) return undefined;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    document.addEventListener('keydown', handleKeyDown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const timer = window.setTimeout(() => {
      const target = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    }, 20);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = overflow;
      window.clearTimeout(timer);
      previouslyFocused.current?.focus?.();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialogRef}
      >
        <header className="modal-header">
          <h2 className="card-title">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy} aria-label={t('action.close')}>
            &times;
          </Button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      busy={busy}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            {t('action.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel ?? t('action.confirm')}
          </Button>
        </>
      }
    >
      {message ? <p>{message}</p> : null}
      {children}
    </Modal>
  );
}
