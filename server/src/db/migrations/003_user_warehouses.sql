-- =====================================================================
-- 003 — dostęp użytkowników do magazynów
--
-- Do tej pory każdy zalogowany widział każdy magazyn. Przy trzech placach
-- składowych i kilku osobach w terenie to za mało: magazynier z Rokitek nie
-- ma powodu księgować na Brąszewicach, a pomyłka w wyborze magazynu przenosi
-- towar tam, gdzie go fizycznie nie ma.
--
-- ZASADA DOMYŚLNA: brak wpisów = dostęp do wszystkich aktywnych magazynów.
--
-- Dzięki temu aktualizacja istniejącej instalacji nikomu nie odbiera dostępu
-- w dniu wdrożenia. Ograniczenie zaczyna obowiązywać dopiero wtedy, gdy
-- administrator świadomie przypisze komuś konkretne magazyny — wpisanie
-- pierwszego magazynu zamyka dostęp do pozostałych.
--
-- Administrator ma dostęp do wszystkich magazynów niezależnie od wpisów;
-- inaczej dałoby się zamknąć samego siebie poza systemem.
--
-- Migracja NIE zmienia istniejącej kartoteki magazynów. Nazwy placów to dane
-- firmy, nie schemat — zmiana nazwy cudzego magazynu skryptem aktualizacyjnym
-- rozjechałaby dokumenty z rzeczywistością. Magazyny startowe zakłada
-- `bootstrap()` wyłącznie na pustej kartotece.
-- =====================================================================

CREATE TABLE user_warehouses (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  warehouse_id  TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  granted_at    TEXT NOT NULL DEFAULT (datetime('now')),
  granted_by    TEXT REFERENCES users(id),
  PRIMARY KEY (user_id, warehouse_id)
);

-- Kontrola dostępu wykonuje się przy każdym żądaniu, więc odczyt po użytkowniku
-- musi być natychmiastowy.
CREATE INDEX ix_user_warehouses_user ON user_warehouses(user_id);

-- Odwrotny kierunek: „kto ma dostęp do tego magazynu” — widok kartoteki
-- magazynów i kontrola przed dezaktywacją placu.
CREATE INDEX ix_user_warehouses_warehouse ON user_warehouses(warehouse_id);

-- Rejestr dokumentów filtrowany magazynem był dotąd skanem po dacie.
-- Przy pracy w kontekście jednego placu to zapytanie wykonuje się na każdym
-- wejściu do rejestru, więc dostaje własne indeksy.
CREATE INDEX ix_operations_wh_from ON operations(warehouse_from_id, operation_date DESC);
CREATE INDEX ix_operations_wh_to   ON operations(warehouse_to_id, operation_date DESC);

-- Statystyki planisty po dołożeniu indeksów — bez tego SQLite może wybierać
-- plan na podstawie nieaktualnego obrazu danych (patrz migracja 002).
ANALYZE;
