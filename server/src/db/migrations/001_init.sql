-- =====================================================================
-- ResInvest ERP — schemat początkowy
--
-- Zasady przyjęte w modelu:
--  1. Klucze główne to UUID (TEXT) — pozwala scalać bazy oddziałów bez kolizji.
--  2. `operations` to rejestr dokumentów (głowa), `stock_moves` to wyliczone
--     ruchy magazynowe (pozycje). Stan magazynu = SUMA ruchów, nigdy nie jest
--     przechowywany jako pole modyfikowane w miejscu.
--  3. Wielkości przeliczone (m³, MP, tony, GJ) oraz UŻYTE PRZELICZNIKI zapisujemy
--     w dokumencie. Zmiana przeliczników w ustawieniach nie zmienia historii.
--  4. Dokumenty nie są usuwane — są storno (`status = 'CANCELLED'`), a każda
--     edycja tworzy wpis w `corrections`.
--  5. Kwoty w PLN jako REAL z zaokrągleniem do 2 miejsc na poziomie aplikacji;
--     ilości jako REAL z zaokrągleniem do 3 miejsc.
-- =====================================================================

-- --------------------------- Użytkownicy -----------------------------

CREATE TABLE users (
  id                    TEXT PRIMARY KEY,
  email                 TEXT NOT NULL UNIQUE,
  full_name             TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  role                  TEXT NOT NULL CHECK (role IN ('ADMIN','KIEROWNIK','MAGAZYNIER','KSIEGOWY','AUDYTOR')),
  phone                 TEXT,
  is_active             INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  must_change_password  INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
  failed_logins         INTEGER NOT NULL DEFAULT 0,
  locked_until          TEXT,
  last_login_at         TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  issued_at     TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT,
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX ix_sessions_user ON sessions(user_id, expires_at);

-- ----------------------------- Słowniki ------------------------------

CREATE TABLE warehouses (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL UNIQUE,
  address     TEXT,
  is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE products (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL UNIQUE,
  category      TEXT NOT NULL CHECK (category IN ('SUROWIEC','ZREBKA','PRODUKT_UBOCZNY','INNE')),
  default_unit  TEXT NOT NULL DEFAULT 'MP' CHECK (default_unit IN ('M3','MP','TONA')),
  -- Przeliczniki indywidualne; NULL oznacza użycie wartości globalnej z `settings`.
  m3_to_mp      REAL CHECK (m3_to_mp IS NULL OR m3_to_mp > 0),
  mp_to_tonne   REAL CHECK (mp_to_tonne IS NULL OR mp_to_tonne > 0),
  tonne_to_gj   REAL CHECK (tonne_to_gj IS NULL OR tonne_to_gj > 0),
  notes         TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_products_category ON products(category, is_active);

CREATE TABLE partners (
  id          TEXT PRIMARY KEY,
  code        TEXT UNIQUE,
  name        TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL CHECK (kind IN ('DOSTAWCA','ODBIORCA','OBA','PRZEWOZNIK')),
  nip         TEXT,
  address     TEXT,
  email       TEXT,
  phone       TEXT,
  notes       TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_partners_kind ON partners(kind, is_active);

CREATE TABLE vehicles (
  id            TEXT PRIMARY KEY,
  plate         TEXT NOT NULL UNIQUE,
  carrier_id    TEXT REFERENCES partners(id) ON DELETE SET NULL,
  carrier_name  TEXT,
  description   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE forest_districts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  region      TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE forest_ranges (
  id            TEXT PRIMARY KEY,
  district_id   TEXT NOT NULL REFERENCES forest_districts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (district_id, name)
);

CREATE TABLE loading_places (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  address     TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------- Numeracja i okresy rozliczeniowe -----------------

-- Licznik numerów dokumentów; numeracja resetuje się co rok kalendarzowy.
CREATE TABLE document_counters (
  series      TEXT NOT NULL,
  year        INTEGER NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (series, year)
);

-- Miesięczne okresy rozliczeniowe. Zamknięcie blokuje zapisy wstecz.
CREATE TABLE periods (
  month        TEXT PRIMARY KEY,                    -- 'RRRR-MM'
  status       TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  closed_at    TEXT,
  closed_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  reopened_at  TEXT,
  reopened_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  note         TEXT
);

-- ------------------------ Rejestr dokumentów -------------------------

CREATE TABLE operations (
  id                TEXT PRIMARY KEY,

  -- Identyfikacja dokumentu
  doc_no            TEXT NOT NULL UNIQUE,           -- np. 'PZ/2026/000123'
  doc_series        TEXT NOT NULL CHECK (doc_series IN ('PZ','WZ','PW','RW','MM','BO')),
  doc_year          INTEGER NOT NULL,
  doc_number        INTEGER NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('ZAKUP','SPRZEDAZ','PRODUKCJA','ZUZYCIE','MM','BO')),
  status            TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','CANCELLED')),

  -- Daty
  operation_date    TEXT NOT NULL,                  -- 'RRRR-MM-DD'
  operation_month   TEXT GENERATED ALWAYS AS (substr(operation_date, 1, 7)) STORED,
  loading_date      TEXT,

  -- Towar
  product_id        TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name      TEXT NOT NULL,                  -- migawka nazwy z chwili księgowania
  grade             TEXT,                           -- rodzaj zrębki A / B

  -- Ilości: wartość wprowadzona + wszystkie przeliczenia + użyte przeliczniki
  quantity          REAL NOT NULL CHECK (quantity > 0),
  unit              TEXT NOT NULL CHECK (unit IN ('M3','MP','TONA')),
  qty_m3            REAL NOT NULL DEFAULT 0,
  qty_mp            REAL NOT NULL DEFAULT 0,
  qty_tonne         REAL NOT NULL DEFAULT 0,
  energy_gj         REAL NOT NULL DEFAULT 0,
  m3_mode           TEXT NOT NULL DEFAULT 'AUTO' CHECK (m3_mode IN ('AUTO','RECZNIE')),
  m3_manual         REAL,
  mp_mode           TEXT NOT NULL DEFAULT 'AUTO' CHECK (mp_mode IN ('AUTO','RECZNIE')),
  mp_manual         REAL,
  tonne_mode        TEXT NOT NULL DEFAULT 'AUTO' CHECK (tonne_mode IN ('AUTO','RECZNIE')),
  tonne_manual      REAL,
  factor_m3_mp      REAL NOT NULL,
  factor_mp_tonne   REAL NOT NULL,
  factor_tonne_gj   REAL NOT NULL,

  -- Strony operacji
  warehouse_from_id TEXT REFERENCES warehouses(id) ON DELETE RESTRICT,
  warehouse_to_id   TEXT REFERENCES warehouses(id) ON DELETE RESTRICT,
  partner_from_id   TEXT REFERENCES partners(id) ON DELETE SET NULL,
  partner_to_id     TEXT REFERENCES partners(id) ON DELETE SET NULL,
  supplier_name     TEXT,
  recipient_name    TEXT,

  -- Pochodzenie / las
  loading_place     TEXT,
  origin_place      TEXT,
  forest_district   TEXT,
  forest_range      TEXT,
  haulage_note_no   TEXT,                           -- nr kwitu wywozowego

  -- Wartości
  price_purchase    REAL NOT NULL DEFAULT 0,
  price_sale        REAL NOT NULL DEFAULT 0,
  value_purchase    REAL NOT NULL DEFAULT 0,
  value_sale        REAL NOT NULL DEFAULT 0,
  chipping_mode     TEXT,                           -- własne / wynajęte
  chipping_price    REAL NOT NULL DEFAULT 0,
  chipping_cost     REAL NOT NULL DEFAULT 0,

  -- Transport
  carrier_name      TEXT,
  vehicle_plate     TEXT,
  distance_km       REAL NOT NULL DEFAULT 0,
  transport_cost    REAL NOT NULL DEFAULT 0,

  -- Zgodność
  certificate       TEXT NOT NULL DEFAULT 'BRAK',   -- KZR / SURE / BRAK
  is_stored         INTEGER NOT NULL DEFAULT 1 CHECK (is_stored IN (0,1)),

  -- Powiązania łańcucha operacji (zakup → zużycie → produkcja → sprzedaż)
  chain_ref         TEXT,
  parent_id         TEXT REFERENCES operations(id) ON DELETE SET NULL,

  notes             TEXT,
  signature         TEXT NOT NULL,                  -- podpis zatwierdzającego

  -- Metryka
  revision          INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  created_by        TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at        TEXT,
  updated_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at      TEXT,
  cancelled_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason     TEXT,

  UNIQUE (doc_series, doc_year, doc_number)
);

CREATE INDEX ix_operations_date     ON operations(operation_date DESC);
CREATE INDEX ix_operations_month    ON operations(operation_month, type);
CREATE INDEX ix_operations_type     ON operations(type, status);
CREATE INDEX ix_operations_product  ON operations(product_id, operation_date);
CREATE INDEX ix_operations_chain    ON operations(chain_ref);
CREATE INDEX ix_operations_partner  ON operations(partner_to_id, partner_from_id);
CREATE INDEX ix_operations_plate    ON operations(vehicle_plate);

-- ------------------------- Ruchy magazynowe --------------------------
-- Jeden dokument generuje 1 ruch (PZ/WZ/PW/RW/BO) albo 2 ruchy (MM: -/+).
-- Stan magazynu liczony jest wyłącznie jako suma tej tabeli.

CREATE TABLE stock_moves (
  id            TEXT PRIMARY KEY,
  operation_id  TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  move_date     TEXT NOT NULL,
  move_month    TEXT GENERATED ALWAYS AS (substr(move_date, 1, 7)) STORED,
  warehouse_id  TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  direction     INTEGER NOT NULL CHECK (direction IN (-1, 1)),
  qty_mp        REAL NOT NULL,                      -- ze znakiem kierunku
  qty_m3        REAL NOT NULL,
  qty_tonne     REAL NOT NULL,
  energy_gj     REAL NOT NULL,
  value         REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_moves_stock  ON stock_moves(warehouse_id, product_id);
CREATE INDEX ix_moves_month  ON stock_moves(move_month, product_id);
CREATE INDEX ix_moves_op     ON stock_moves(operation_id);
CREATE INDEX ix_moves_date   ON stock_moves(move_date);

-- Migawka stanów na koniec zamkniętego miesiąca (podstawa raportu i kontroli).
CREATE TABLE stock_snapshots (
  month         TEXT NOT NULL,
  warehouse_id  TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty_mp        REAL NOT NULL,
  qty_m3        REAL NOT NULL,
  qty_tonne     REAL NOT NULL,
  energy_gj     REAL NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (month, warehouse_id, product_id)
);

-- ---------------------------- Załączniki -----------------------------

CREATE TABLE attachments (
  id            TEXT PRIMARY KEY,
  operation_id  TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  storage_path  TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'SKAN',       -- SKAN / KWIT / FAKTURA / INNE
  uploaded_by   TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_attachments_op ON attachments(operation_id);

-- ----------------------- Korekty i dziennik --------------------------

CREATE TABLE corrections (
  id               TEXT PRIMARY KEY,
  operation_id     TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  doc_no           TEXT NOT NULL,
  operation_type   TEXT NOT NULL,
  product_name     TEXT,
  changed_at       TEXT NOT NULL DEFAULT (datetime('now')),
  changed_by       TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  changed_by_name  TEXT NOT NULL,
  reason           TEXT,
  changes_json     TEXT NOT NULL,                   -- [{field,label,from,to}]
  snapshot_before  TEXT NOT NULL                    -- pełny dokument sprzed zmiany
);
CREATE INDEX ix_corrections_op   ON corrections(operation_id);
CREATE INDEX ix_corrections_time ON corrections(changed_at DESC);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL DEFAULT (datetime('now')),
  user_id     TEXT,
  user_email  TEXT,
  action      TEXT NOT NULL,                        -- LOGIN, CREATE, UPDATE, CANCEL, EXPORT, ...
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  ip          TEXT,
  user_agent  TEXT,
  detail      TEXT
);
CREATE INDEX ix_audit_ts     ON audit_log(ts DESC);
CREATE INDEX ix_audit_entity ON audit_log(entity, entity_id);

-- ---------------------------- Ustawienia ------------------------------

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,                        -- JSON
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- Globalne przeliczniki jednostek (nadrzędne dla produktów bez własnych wartości).
INSERT INTO settings(key, value) VALUES
  ('units.m3_to_mp',    '4'),
  ('units.mp_to_tonne', '0.33'),
  ('units.tonne_to_gj', '8.5'),
  ('rules.allow_negative_stock', 'true'),
  ('rules.require_signature',    'true'),
  ('rules.backdate_days',        '90');

-- ------------------------------- Widoki -------------------------------

-- Bieżący stan magazynowy w rozbiciu na magazyn i produkt.
CREATE VIEW v_stock_current AS
SELECT
  m.warehouse_id,
  w.name  AS warehouse_name,
  m.product_id,
  p.name  AS product_name,
  p.category,
  ROUND(SUM(m.qty_mp),    3) AS qty_mp,
  ROUND(SUM(m.qty_m3),    3) AS qty_m3,
  ROUND(SUM(m.qty_tonne), 3) AS qty_tonne,
  ROUND(SUM(m.energy_gj), 2) AS energy_gj,
  MAX(m.move_date)           AS last_move_date
FROM stock_moves m
JOIN warehouses w ON w.id = m.warehouse_id
JOIN products   p ON p.id = m.product_id
GROUP BY m.warehouse_id, m.product_id;

-- Obroty miesięczne w rozbiciu na typ dokumentu — podstawa raportu miesięcznego.
CREATE VIEW v_monthly_turnover AS
SELECT
  o.operation_month AS month,
  o.type,
  o.product_id,
  o.product_name,
  COUNT(*)                        AS documents,
  ROUND(SUM(o.qty_mp), 3)         AS qty_mp,
  ROUND(SUM(o.qty_m3), 3)         AS qty_m3,
  ROUND(SUM(o.qty_tonne), 3)      AS qty_tonne,
  ROUND(SUM(o.energy_gj), 2)      AS energy_gj,
  ROUND(SUM(o.value_purchase), 2) AS value_purchase,
  ROUND(SUM(o.value_sale), 2)     AS value_sale,
  ROUND(SUM(o.chipping_cost), 2)  AS chipping_cost,
  ROUND(SUM(o.transport_cost), 2) AS transport_cost
FROM operations o
WHERE o.status = 'POSTED'
GROUP BY o.operation_month, o.type, o.product_id;
