import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import type { DocStatus } from '../../api/types';
import { useI18n } from '../../i18n';

/* -------------------------------------------------------------------------- */
/* Przyciski                                                                   */
/* -------------------------------------------------------------------------- */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'md' | 'sm';
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', loading = false, block = false, icon, children, className, disabled, ...rest },
  ref,
) {
  const classes = [
    'btn',
    variant === 'default' ? '' : variant,
    size === 'sm' ? 'sm' : '',
    block ? 'block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button ref={ref} type="button" className={classes} disabled={disabled || loading} aria-busy={loading} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
});

/* -------------------------------------------------------------------------- */
/* Pola formularza                                                             */
/* -------------------------------------------------------------------------- */

export interface FieldProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  span?: 1 | 2 | 'full';
  children: ReactNode;
}

export function Field({ label, htmlFor, required, hint, error, span = 1, children }: FieldProps) {
  const spanClass = span === 'full' ? 'span-full' : span === 2 ? 'span-2' : '';
  return (
    <div className={`field ${spanClass}`}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="field-required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  span?: 1 | 2 | 'full';
}

export function TextInput({ label, hint, error, span, required, className, ...rest }: TextInputProps) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} required={required} hint={hint} error={error} span={span}>
      <input
        id={id}
        className={`input ${className ?? ''}`}
        aria-invalid={error ? 'true' : undefined}
        required={required}
        {...rest}
      />
    </Field>
  );
}

export interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  hint?: string;
  error?: string;
  span?: 1 | 2 | 'full';
  suffix?: string;
}

/**
 * Pole liczbowe przechowujace wartość jako tekst - dzięki temu użytkownik może
 * wpisac przecinek dziesietny bez utraty znaków podczas pisania.
 */
export function NumberInput({
  label,
  value,
  onValueChange,
  hint,
  error,
  span,
  required,
  suffix,
  ...rest
}: NumberInputProps) {
  const id = useId();
  return (
    <Field
      label={suffix ? `${label} [${suffix}]` : label}
      htmlFor={id}
      required={required}
      hint={hint}
      error={error}
      span={span}
    >
      <input
        id={id}
        className="input num-input"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        aria-invalid={error ? 'true' : undefined}
        onChange={(event) => onValueChange(event.target.value)}
        {...rest}
      />
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectInputProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label: string;
  options: SelectOption[];
  placeholder?: string;
  hint?: string;
  error?: string;
  span?: 1 | 2 | 'full';
}

export function SelectInput({
  label,
  options,
  placeholder,
  hint,
  error,
  span,
  required,
  ...rest
}: SelectInputProps) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} required={required} hint={hint} error={error} span={span}>
      <select id={id} className="select" aria-invalid={error ? 'true' : undefined} required={required} {...rest}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
  span?: 1 | 2 | 'full';
}

export function TextArea({ label, hint, error, span = 'full', required, ...rest }: TextAreaProps) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} required={required} hint={hint} error={error} span={span}>
      <textarea id={id} className="textarea" aria-invalid={error ? 'true' : undefined} {...rest} />
    </Field>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="checkbox-row">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

export function RadioChips<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="radio-group" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <label key={option.value} className={`radio-chip ${value === option.value ? 'selected' : ''}`}>
            <input
              type="radio"
              name={label}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              style={{ margin: 0 }}
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Karty i sekcje                                                              */
/* -------------------------------------------------------------------------- */

export function Card({
  title,
  actions,
  children,
  footer,
  tight = false,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  tight?: boolean;
}) {
  return (
    <section className="card">
      {title || actions ? (
        <header className="card-header">
          {title ? <h2 className="card-title">{title}</h2> : <span />}
          {actions ? <div className="btn-group">{actions}</div> : null}
        </header>
      ) : null}
      <div className={`card-body ${tight ? 'tight' : ''}`}>{children}</div>
      {footer ? <footer className="card-footer">{footer}</footer> : null}
    </section>
  );
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="form-section" style={{ border: 'none', margin: 0, padding: 0 }}>
      <legend className="sr-only">{title}</legend>
      <div className="form-section-title" aria-hidden="true">
        {title}
      </div>
      <div className="form-grid">{children}</div>
    </fieldset>
  );
}

export function MetricCard({
  label,
  value,
  unit,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  tone?: 'default' | 'info' | 'warning' | 'danger';
}) {
  return (
    <div className={`metric ${tone === 'default' ? '' : tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">
        {value}
        {unit ? <span className="metric-unit">{unit}</span> : null}
      </div>
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </div>
  );
}

export function DescriptionList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="desc-grid" style={{ margin: 0 }}>
      {items.map((item, index) => (
        <div className="desc-item" key={`${item.label}-${index}`}>
          <dt className="desc-label">{item.label}</dt>
          <dd className="desc-value" style={{ margin: 0 }}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* -------------------------------------------------------------------------- */
/* Statusy i komunikaty                                                        */
/* -------------------------------------------------------------------------- */

export function Badge({
  tone = 'neutral',
  mark,
  children,
}: {
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  mark?: string;
  children: ReactNode;
}) {
  return (
    <span className={`badge ${tone}`} data-mark={mark ?? ''}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<DocStatus, 'neutral' | 'success' | 'danger'> = {
  DRAFT: 'neutral',
  POSTED: 'success',
  CANCELLED: 'danger',
};

/** Znacznik tekstowy obok koloru - status pozostaje czytelny bez rozróżnienia barw. */
const STATUS_MARK: Record<DocStatus, string> = {
  DRAFT: '○',
  POSTED: '●',
  CANCELLED: '✕',
};

export function StatusBadge({ status }: { status: DocStatus }) {
  const { t } = useI18n();
  return (
    <Badge tone={STATUS_TONE[status]} mark={STATUS_MARK[status]}>
      {t(`status.${status}` as const)}
    </Badge>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`alert ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className="alert-body">
        {title ? <div className="alert-title">{title}</div> : null}
        {children}
      </div>
    </div>
  );
}

export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" style={{ width: 22, height: 22, borderWidth: 3 }} aria-hidden="true" />
      <span>{label ?? t('state.loading')}</span>
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title?: string; hint?: string; action?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="state">
      <div className="state-icon" aria-hidden="true">
        ▤
      </div>
      <div className="state-title">{title ?? t('state.empty')}</div>
      <div className="text-sm">{hint ?? t('state.emptyHint')}</div>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="state" role="alert">
      <div className="state-icon" aria-hidden="true">
        ⚠
      </div>
      <div className="state-title">{t('state.error')}</div>
      {message ? <div className="text-sm">{message}</div> : null}
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          {t('action.retry')}
        </Button>
      ) : null}
    </div>
  );
}

export function SkeletonRows({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div style={{ padding: 'var(--space-4)' }} aria-hidden="true">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
          {Array.from({ length: columns }).map((__, colIndex) => (
            <div key={colIndex} className="skeleton" style={{ flex: colIndex === 0 ? 2 : 1 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Zakladki i stronicowanie                                                    */
/* -------------------------------------------------------------------------- */

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: T; label: string }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="btn-group" role="tablist" style={{ marginBottom: 'var(--space-4)' }}>
      {tabs.map((tab) => (
        <Button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          variant={active === tab.id ? 'primary' : 'default'}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="pagination no-print">
      <span>
        {from}-{to} {t('common.of')} {total} {t('common.rows')}
      </span>
      <div className="btn-group" style={{ alignItems: 'center' }}>
        {onPageSizeChange ? (
          <select
            className="select"
            style={{ width: 'auto', minHeight: 30 }}
            value={pageSize}
            aria-label={t('common.perPage')}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {[25, 50, 100, 200].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        ) : null}
        <Button size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          {t('action.previous')}
        </Button>
        <span className="text-sm nowrap">
          {t('common.page')} {page} / {pages}
        </span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          {t('action.next')}
        </Button>
      </div>
    </div>
  );
}
