/**
 * Stan zdrowia bazy — rozmiar, tempo przyrostu i kontrola niezmienników.
 *
 * Najważniejsza jest tu `balancesConsistent`. Model odczytu (`stock_balances`)
 * powiela informację, która żyje w `stock_moves`, a każde powielenie danych
 * może się rozjechać. Wyzwalacze mają temu zapobiegać, ale system magazynowy
 * nie może opierać poprawności stanów na wierze, że mechanizm działa.
 * Ten odczyt sprawdza to wprost, jednym zapytaniem, na żądanie administratora.
 *
 * Rozjazd oznacza usterkę infrastruktury (uszkodzony plik bazy, ręczna zmiana
 * z pominięciem wyzwalaczy), a nie błąd użytkownika — dlatego wynik trafia do
 * diagnostyki, a nie do interfejsu magazyniera.
 */
import db from './index.js';

/** Progi, powyżej których warto pomyśleć o kolejnym kroku skalowania. */
const THRESHOLDS = Object.freeze({
  moves: 500_000,
  sizeMb: 2_000,
});

/**
 * Sprawdza, czy saldo każdej pary (magazyn, produkt) zgadza się z sumą ruchów.
 *
 * Zapytanie porównuje obie strony pełnym złączeniem zewnętrznym (złożonym
 * z dwóch stron, bo SQLite nie ma FULL OUTER JOIN), więc wykrywa zarówno
 * saldo z błędną kwotą, jak i saldo bez ruchów oraz ruchy bez salda.
 *
 * @returns {{consistent: boolean, mismatches: object[]}}
 */
export function checkStockBalances({ limit = 10 } = {}) {
  const mismatches = db.all(
    `WITH sums AS (
       SELECT warehouse_id, product_id,
              ROUND(SUM(qty_mp), 3) AS qty_mp, COUNT(*) AS moves
         FROM stock_moves GROUP BY warehouse_id, product_id
     )
     SELECT COALESCE(b.warehouse_id, s.warehouse_id) AS warehouse_id,
            COALESCE(b.product_id,   s.product_id)   AS product_id,
            ROUND(COALESCE(b.qty_mp, 0), 3) AS balance_mp,
            COALESCE(s.qty_mp, 0)           AS moves_mp,
            COALESCE(b.moves, 0)            AS balance_count,
            COALESCE(s.moves, 0)            AS moves_count
       FROM stock_balances b
       LEFT JOIN sums s ON s.warehouse_id = b.warehouse_id AND s.product_id = b.product_id
      WHERE ABS(COALESCE(b.qty_mp, 0) - COALESCE(s.qty_mp, 0)) > 0.001
         OR COALESCE(b.moves, 0) <> COALESCE(s.moves, 0)
      UNION ALL
     SELECT s.warehouse_id, s.product_id, 0, s.qty_mp, 0, s.moves
       FROM sums s
       LEFT JOIN stock_balances b ON b.warehouse_id = s.warehouse_id AND b.product_id = s.product_id
      WHERE b.warehouse_id IS NULL
      LIMIT :limit`,
    { limit },
  );

  return {
    consistent: mismatches.length === 0,
    mismatches: mismatches.map((r) => ({
      warehouseId: r.warehouse_id,
      productId: r.product_id,
      balanceMp: r.balance_mp,
      movesMp: r.moves_mp,
      balanceCount: r.balance_count,
      movesCount: r.moves_count,
    })),
  };
}

/** Rozmiar bazy w megabajtach, liczony ze stron SQLite. */
function sizeMb() {
  const pages = db.value('PRAGMA page_count');
  const size = db.value('PRAGMA page_size');
  return Number(((pages * size) / 1024 / 1024).toFixed(1));
}

/**
 * Migawka dla punktu `/admin/metrics`.
 * Liczby są tanie: same agregaty po indeksach i dwa pragma.
 */
export function databaseReport() {
  const operations = db.value("SELECT COUNT(*) FROM operations WHERE status = 'POSTED'");
  const moves = db.value('SELECT COUNT(*) FROM stock_moves');
  const balances = db.value('SELECT COUNT(*) FROM stock_balances');
  const months = db.value('SELECT COUNT(DISTINCT operation_month) FROM operations');
  const balanceCheck = checkStockBalances({ limit: 5 });
  const mb = sizeMb();

  return {
    operations,
    moves,
    balances,
    months,
    sizeMb: mb,
    /**
     * Ile razy model odczytu skraca pracę przy odczycie stanu: zamiast sumować
     * `moves` wierszy, czytamy `balances`. Liczba wprost pokazuje, ile warstwa
     * daje przy obecnym rozmiarze bazy.
     */
    readModelSpeedup: balances ? Math.round(moves / balances) : null,
    balancesConsistent: balanceCheck.consistent,
    balanceMismatches: balanceCheck.mismatches,
    /** Sygnał, że zbliża się kolejny etap skalowania (patrz docs/SCALING.md). */
    nearingLimits: moves > THRESHOLDS.moves || mb > THRESHOLDS.sizeMb,
    thresholds: THRESHOLDS,
  };
}
