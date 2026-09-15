-- =====================================================================
--  Model odczytu stanów magazynowych
--
--  PROBLEM
--  Stan magazynu jest z definicji sumą tabeli `stock_moves`. Model księgowo
--  nienaganny, ale każdy odczyt stanu bieżącego przegląda całą historię —
--  koszt rośnie liniowo z każdym zaksięgowanym dokumentem i nigdy nie maleje.
--  Pomiar na pięciu latach pracy (18 500 ruchów): stan bieżący 13,7 ms,
--  pulpit 43 ms, a te liczby podwajają się co kolejne pięć lat.
--
--  ROZWIĄZANIE
--  Saldo każdej pary (magazyn, produkt) utrzymywane przyrostowo w osobnej
--  tabeli. Odczyt stanu staje się odczytem kilkudziesięciu wierszy zamiast
--  sumowania setek tysięcy — koszt zależy od liczby produktów w magazynie,
--  nie od długości historii.
--
--  DLACZEGO WYZWALACZE, A NIE KOD SERWISU
--  Saldo musi być zgodne z ruchami ZAWSZE, bez wyjątku dla żadnej ścieżki:
--  księgowania, storna, przywrócenia korekty, przywrócenia kopii zapasowej,
--  generatora danych testowych, ręcznego SQL-a w konsoli. Warunek zapisany
--  w wyzwalaczu jest częścią bazy i obowiązuje każdego, kto do niej pisze.
--  Ten sam warunek rozpisany po serwisach obowiązywałby tylko tych, którzy
--  o nim pamiętają — a niezgodność sald w systemie magazynowym jest usterką
--  najgorszego rodzaju: cichą i narastającą.
--
--  NIEZMIENNIK
--  Dla każdej pary (magazyn, produkt):
--      stock_balances.qty_* = SUM(stock_moves.qty_*)
--      stock_balances.moves = COUNT(stock_moves)
--  Sprawdzany testem regresyjnym po każdej operacji zapisu.
-- =====================================================================

CREATE TABLE stock_balances (
  warehouse_id   TEXT    NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id     TEXT    NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  qty_mp         REAL    NOT NULL DEFAULT 0,
  qty_m3         REAL    NOT NULL DEFAULT 0,
  qty_tonne      REAL    NOT NULL DEFAULT 0,
  energy_gj      REAL    NOT NULL DEFAULT 0,
  value          REAL    NOT NULL DEFAULT 0,
  moves          INTEGER NOT NULL DEFAULT 0,
  last_move_date TEXT,
  PRIMARY KEY (warehouse_id, product_id)
);

-- Sortowanie listy stanów po ilości (największe pryzmy na wierzchu).
CREATE INDEX ix_balances_qty ON stock_balances(qty_mp);

-- --------------------------------------------------------------------
--  Ruch magazynowy jest faktem: powstaje i znika, nie zmienia się.
--
--  Storno i korekta usuwają ruchy i tworzą nowe — tak działa cały system.
--  Zakaz aktualizacji zapisany wprost pozwala utrzymać saldo dwoma prostymi
--  wyzwalaczami zamiast trzeciego, który musiałby rozbierać zmianę klucza
--  na odjęcie po staremu i dodanie po nowemu.
-- --------------------------------------------------------------------
CREATE TRIGGER tr_stock_moves_no_update
BEFORE UPDATE ON stock_moves
BEGIN
  SELECT RAISE(ABORT,
    'Ruch magazynowy jest niezmienny — popraw dokument przez korektę albo storno.');
END;

-- Dopisanie ruchu: saldo pary rośnie o jego wartości.
CREATE TRIGGER tr_stock_moves_after_insert
AFTER INSERT ON stock_moves
BEGIN
  INSERT INTO stock_balances (
    warehouse_id, product_id, qty_mp, qty_m3, qty_tonne, energy_gj, value, moves, last_move_date
  )
  VALUES (
    NEW.warehouse_id, NEW.product_id, NEW.qty_mp, NEW.qty_m3, NEW.qty_tonne,
    NEW.energy_gj, NEW.value, 1, NEW.move_date
  )
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET
    qty_mp         = stock_balances.qty_mp    + excluded.qty_mp,
    qty_m3         = stock_balances.qty_m3    + excluded.qty_m3,
    qty_tonne      = stock_balances.qty_tonne + excluded.qty_tonne,
    energy_gj      = stock_balances.energy_gj + excluded.energy_gj,
    value          = stock_balances.value     + excluded.value,
    moves          = stock_balances.moves     + 1,
    last_move_date = MAX(COALESCE(stock_balances.last_move_date, excluded.last_move_date),
                         excluded.last_move_date);
END;

-- Usunięcie ruchu (storno, przywrócenie korekty): saldo maleje o jego wartości.
-- `last_move_date` nie da się cofnąć przyrostowo, więc liczymy je na nowo —
-- wyłącznie dla dotkniętej pary, po indeksie `ix_moves_stock`. Usunięcia są
-- rzadkie (storno), więc ten jeden przeliczony maksimum nic nie kosztuje.
CREATE TRIGGER tr_stock_moves_after_delete
AFTER DELETE ON stock_moves
BEGIN
  UPDATE stock_balances SET
    qty_mp         = qty_mp    - OLD.qty_mp,
    qty_m3         = qty_m3    - OLD.qty_m3,
    qty_tonne      = qty_tonne - OLD.qty_tonne,
    energy_gj      = energy_gj - OLD.energy_gj,
    value          = value     - OLD.value,
    moves          = moves     - 1,
    last_move_date = (SELECT MAX(move_date) FROM stock_moves
                       WHERE warehouse_id = OLD.warehouse_id AND product_id = OLD.product_id)
  WHERE warehouse_id = OLD.warehouse_id AND product_id = OLD.product_id;

  -- Para bez ruchów znika z tabeli — tak samo, jak znikała z GROUP BY.
  DELETE FROM stock_balances
   WHERE warehouse_id = OLD.warehouse_id AND product_id = OLD.product_id AND moves <= 0;
END;

-- --------------------------------------------------------------------
--  Wypełnienie tabeli z historii istniejącej w bazie.
-- --------------------------------------------------------------------
INSERT INTO stock_balances (
  warehouse_id, product_id, qty_mp, qty_m3, qty_tonne, energy_gj, value, moves, last_move_date
)
SELECT warehouse_id, product_id,
       SUM(qty_mp), SUM(qty_m3), SUM(qty_tonne), SUM(energy_gj), SUM(value),
       COUNT(*), MAX(move_date)
  FROM stock_moves
 GROUP BY warehouse_id, product_id;

-- --------------------------------------------------------------------
--  Widok stanu bieżącego czyta teraz saldo zamiast sumować ruchy.
--  Sygnatura kolumn bez zmian, więc kod czytający widok nie wie o podmianie.
-- --------------------------------------------------------------------
DROP VIEW v_stock_current;
CREATE VIEW v_stock_current AS
SELECT
  b.warehouse_id,
  w.name  AS warehouse_name,
  b.product_id,
  p.name  AS product_name,
  p.category,
  ROUND(b.qty_mp,    3) AS qty_mp,
  ROUND(b.qty_m3,    3) AS qty_m3,
  ROUND(b.qty_tonne, 3) AS qty_tonne,
  ROUND(b.energy_gj, 2) AS energy_gj,
  b.last_move_date
FROM stock_balances b
JOIN warehouses w ON w.id = b.warehouse_id
JOIN products   p ON p.id = b.product_id;

-- --------------------------------------------------------------------
--  Indeks pod stronicowanie i zliczanie rejestru dokumentów.
--
--  Lista otwierana jest z filtrem `status = 'POSTED'` i sortowaniem po dacie.
--  Dotychczasowe indeksy zaczynały się od `type` albo `operation_date`, więc
--  COUNT(*) i pierwsza strona przeglądały cały rejestr.
-- --------------------------------------------------------------------
CREATE INDEX ix_operations_status_date ON operations(status, operation_date DESC, created_at DESC);

-- --------------------------------------------------------------------
--  Odświeżenie statystyk planisty.
--
--  Nowy indeks bez świeżych statystyk potrafi POGORSZYĆ wynik: planista
--  wybiera go na podstawie nieaktualnego rozkładu danych i trafia w gorszy
--  plan. Zmierzone na tej właśnie migracji — raport miesięczny 26 → 43 ms
--  przed `ANALYZE` i 26 ms po nim, pulpit 25 → 8 ms. Statystyki odświeża
--  potem `PRAGMA optimize` przy zamykaniu procesu i cyklicznie w tle.
-- --------------------------------------------------------------------
ANALYZE;
