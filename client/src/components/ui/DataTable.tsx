import type { ReactNode } from 'react';
import { EmptyState, ErrorState, SkeletonRows } from './index';

export interface Column<T> {
  /** Stabilny klucz kolumny (używany jako React key). */
  key: string;
  header: string;
  render: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Kolumna pomocnicza - ukrywana na malych ekranach w widoku kart. */
  secondary?: boolean;
  width?: string;
  isActions?: boolean;
}

export interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyHint?: string;
  footer?: ReactNode;
  /** Widok kart na telefonie - domyślnie włączony dla list operacyjnych. */
  cardsOnMobile?: boolean;
}

/**
 * Tabela danych z obsługa stanow ladowania, błędu i pustej listy.
 * Na malych ekranach (klasa `cards`) każdy wiersz renderuje się jako karta
 * z etykietami kolumn, zamiast wymuszac poziome przewijanie calej tabeli.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error = null,
  onRetry,
  onRowClick,
  emptyTitle,
  emptyHint,
  footer,
  cardsOnMobile = true,
}: DataTableProps<T>) {
  if (loading) return <SkeletonRows rows={6} columns={Math.min(columns.length, 6)} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (rows.length === 0) return <EmptyState title={emptyTitle} hint={emptyHint} />;

  return (
    <div className="table-wrap">
      <table className={`table ${cardsOnMobile ? 'cards' : ''}`}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={{ width: column.width, textAlign: column.align ?? 'left' }}
                className={column.isActions ? 'cell-actions' : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              className={onRowClick ? 'clickable' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              role={onRowClick ? 'button' : undefined}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  data-label={column.header}
                  style={{ textAlign: column.align ?? 'left' }}
                  className={[
                    column.isActions ? 'cell-actions' : '',
                    column.align === 'right' ? 'num' : '',
                    column.secondary ? 'text-sm muted' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {column.render(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  );
}
