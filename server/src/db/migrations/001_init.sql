-- ============================================================================
--  ResInvest ERP - schemat początkowy
--  Konwencje:
--    * kwoty pieniezne: INTEGER w groszach (kolumny z sufiksem _gr)
--    * ilości: REAL w jednostce bazowej produktu (zaokraglane do 4 miejsc)
--    * daty biznesowe: TEXT 'YYYY-MM-DD'
--    * znaczniki czasu: TEXT ISO-8601 UTC 'YYYY-MM-DDTHH:MM:SS.sssZ'
--    * flagi logiczne: INTEGER 0/1
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Role i uprawnienia
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at  TEXT    NOT NULL
);

CREATE TABLE permissions (
  code        TEXT PRIMARY KEY,
  module      TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE role_permissions (
  role_id         INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code TEXT    NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

-- ---------------------------------------------------------------------------
-- Uzytkownicy
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  login              TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  full_name          TEXT    NOT NULL,
  email              TEXT    NULL COLLATE NOCASE,
  password_hash      TEXT    NOT NULL,
  role_id            INTEGER NOT NULL REFERENCES roles(id),
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  locale             TEXT    NOT NULL DEFAULT 'pl' CHECK (locale IN ('pl', 'cs', 'en')),
  theme              TEXT    NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  default_warehouse_id INTEGER NULL,
  failed_logins      INTEGER NOT NULL DEFAULT 0,
  locked_until       TEXT    NULL,
  last_login_at      TEXT    NULL,
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL,
  created_by         INTEGER NULL REFERENCES users(id)
);

CREATE INDEX idx_users_role ON users(role_id);
CREATE INDEX idx_users_active ON users(is_active);

CREATE TABLE refresh_tokens (
  id          TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL,
  issued_at   TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  revoked_at  TEXT    NULL,
  ip          TEXT    NULL,
  user_agent  TEXT    NULL
);

CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_expires ON refresh_tokens(expires_at);

-- ---------------------------------------------------------------------------
-- Magazyny i przypisania użytkowników
-- ---------------------------------------------------------------------------
CREATE TABLE warehouses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT    NOT NULL,
  address     TEXT    NOT NULL DEFAULT '',
  city        TEXT    NOT NULL DEFAULT '',
  postal_code TEXT    NOT NULL DEFAULT '',
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  notes       TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE TABLE user_warehouses (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  granted_at   TEXT    NOT NULL,
  granted_by   INTEGER NULL REFERENCES users(id),
  PRIMARY KEY (user_id, warehouse_id)
);

CREATE INDEX idx_user_warehouses_wh ON user_warehouses(warehouse_id);

-- ---------------------------------------------------------------------------
-- Produkty
-- ---------------------------------------------------------------------------
CREATE TABLE products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name            TEXT    NOT NULL,
  kind            TEXT    NOT NULL CHECK (kind IN ('RAW', 'FINISHED', 'GOODS', 'SERVICE')),
  base_unit       TEXT    NOT NULL CHECK (base_unit IN ('M3', 'MP', 'T', 'SZT')),
  -- Przeliczniki produktu; NULL = użyj globalnych z tabeli settings
  m3_per_mp       REAL    NULL CHECK (m3_per_mp IS NULL OR m3_per_mp > 0),
  t_per_mp        REAL    NULL CHECK (t_per_mp IS NULL OR t_per_mp > 0),
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  notes           TEXT    NOT NULL DEFAULT '',
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);

CREATE INDEX idx_products_active ON products(is_active);
CREATE INDEX idx_products_kind ON products(kind);

-- ---------------------------------------------------------------------------
-- Kontrahenci (dostawcy i odbiorcy w jednej encji - ten sam podmiot
-- czesto występuje w obu rolach, co eliminuje duplikaty danych)
-- ---------------------------------------------------------------------------
CREATE TABLE partners (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name         TEXT    NOT NULL,
  tax_id       TEXT    NOT NULL DEFAULT '',
  address      TEXT    NOT NULL DEFAULT '',
  city         TEXT    NOT NULL DEFAULT '',
  postal_code  TEXT    NOT NULL DEFAULT '',
  country      TEXT    NOT NULL DEFAULT 'PL',
  phone        TEXT    NOT NULL DEFAULT '',
  email        TEXT    NOT NULL DEFAULT '',
  is_supplier  INTEGER NOT NULL DEFAULT 0 CHECK (is_supplier IN (0, 1)),
  is_customer  INTEGER NOT NULL DEFAULT 0 CHECK (is_customer IN (0, 1)),
  is_carrier   INTEGER NOT NULL DEFAULT 0 CHECK (is_carrier IN (0, 1)),
  is_forestry  INTEGER NOT NULL DEFAULT 0 CHECK (is_forestry IN (0, 1)),
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  notes        TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

CREATE INDEX idx_partners_active ON partners(is_active);
CREATE INDEX idx_partners_name ON partners(name);

-- ---------------------------------------------------------------------------
-- Dokumenty (naglowek wspolny dla wszystkich typow operacji)
--   PZ   - przyjęcie zewnętrzne (zakup / dostawa do magazynu)
--   WZ   - wydanie zewnętrzne (sprzedaż z magazynu)
--   MM   - przesunięcie międzymagazynowe
--   PROD - produkcja (zużycie surowca + powstanie wyrobu)
--   TR   - transport (operacja kosztowa, bez wpływu na stan)
--   SD   - sprzedaż bezpośrednia (zakup -> sprzedaż z pominieciem magazynu)
-- ---------------------------------------------------------------------------
CREATE TABLE documents (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type           TEXT    NOT NULL CHECK (doc_type IN ('PZ', 'WZ', 'MM', 'PROD', 'TR', 'SD')),
  doc_number         TEXT    NOT NULL UNIQUE,
  doc_year           INTEGER NOT NULL,
  doc_seq            INTEGER NOT NULL,
  doc_date           TEXT    NOT NULL,
  status             TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),

  -- Kontekst magazynowy
  warehouse_id       INTEGER NULL REFERENCES warehouses(id),
  warehouse_from_id  INTEGER NULL REFERENCES warehouses(id),
  warehouse_to_id    INTEGER NULL REFERENCES warehouses(id),

  -- Kontrahenci
  supplier_id        INTEGER NULL REFERENCES partners(id),
  customer_id        INTEGER NULL REFERENCES partners(id),
  carrier_id         INTEGER NULL REFERENCES partners(id),

  -- Zakup od nadleśnictwa
  forest_ticket_no   TEXT    NOT NULL DEFAULT '',
  forest_district    TEXT    NOT NULL DEFAULT '',
  forest_subdistrict TEXT    NOT NULL DEFAULT '',

  -- Produkcja (rąbanie)
  chipping_mode      TEXT    NULL CHECK (chipping_mode IS NULL OR chipping_mode IN ('OWN', 'EXTERNAL')),
  chipping_company   TEXT    NOT NULL DEFAULT '',
  chipping_rate_gr   INTEGER NOT NULL DEFAULT 0,
  chipping_cost_gr   INTEGER NOT NULL DEFAULT 0,
  production_place   TEXT    NOT NULL DEFAULT '',

  -- Transport
  vehicle_plate      TEXT    NOT NULL DEFAULT '',
  driver_name        TEXT    NOT NULL DEFAULT '',
  load_place         TEXT    NOT NULL DEFAULT '',
  unload_place       TEXT    NOT NULL DEFAULT '',
  distance_km        REAL    NOT NULL DEFAULT 0 CHECK (distance_km >= 0),
  transport_rate_gr  INTEGER NOT NULL DEFAULT 0,
  transport_cost_gr  INTEGER NOT NULL DEFAULT 0,

  -- Wartości
  total_value_gr     INTEGER NOT NULL DEFAULT 0,
  total_cost_gr      INTEGER NOT NULL DEFAULT 0,

  -- Klucz idempotencji chroniący przed podwojnym zapisem tego samego formularza
  client_request_id  TEXT    NULL UNIQUE,

  -- Powiazania i korekty
  parent_document_id INTEGER NULL REFERENCES documents(id),
  correction_of_id   INTEGER NULL REFERENCES documents(id),
  cancel_reason      TEXT    NOT NULL DEFAULT '',

  external_number    TEXT    NOT NULL DEFAULT '',
  notes              TEXT    NOT NULL DEFAULT '',
  version            INTEGER NOT NULL DEFAULT 1,

  created_at         TEXT    NOT NULL,
  created_by         INTEGER NOT NULL REFERENCES users(id),
  updated_at         TEXT    NOT NULL,
  updated_by         INTEGER NULL REFERENCES users(id),
  posted_at          TEXT    NULL,
  posted_by          INTEGER NULL REFERENCES users(id),
  cancelled_at       TEXT    NULL,
  cancelled_by       INTEGER NULL REFERENCES users(id)
);

CREATE INDEX idx_documents_type_date ON documents(doc_type, doc_date DESC);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_warehouse ON documents(warehouse_id, doc_date DESC);
CREATE INDEX idx_documents_wh_from ON documents(warehouse_from_id);
CREATE INDEX idx_documents_wh_to ON documents(warehouse_to_id);
CREATE INDEX idx_documents_supplier ON documents(supplier_id);
CREATE INDEX idx_documents_customer ON documents(customer_id);
CREATE INDEX idx_documents_date ON documents(doc_date DESC);
CREATE INDEX idx_documents_parent ON documents(parent_document_id);

-- ---------------------------------------------------------------------------
-- Pozycje dokumentu
--   line_role: STD    - pozycja standardowa (PZ/WZ/MM/TR/SD)
--              INPUT  - surowiec zużyty w produkcji
--              OUTPUT - wyrob powstaly w produkcji
--   Powiazanie "zużycie -> produkcja" wynika ze wspolnego document_id:
--   każda produkcja jest jednym dokumentem zawierajacym pozycje INPUT i OUTPUT.
-- ---------------------------------------------------------------------------
CREATE TABLE document_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  line_no         INTEGER NOT NULL,
  line_role       TEXT    NOT NULL DEFAULT 'STD' CHECK (line_role IN ('STD', 'INPUT', 'OUTPUT')),
  product_id      INTEGER NOT NULL REFERENCES products(id),
  base_unit       TEXT    NOT NULL CHECK (base_unit IN ('M3', 'MP', 'T', 'SZT')),
  qty_base        REAL    NOT NULL CHECK (qty_base > 0),

  -- Prezentacja w jednostkach pochodnych; *_manual = wartość rzeczywista podana ręcznie
  qty_m3          REAL    NOT NULL DEFAULT 0,
  qty_mp          REAL    NOT NULL DEFAULT 0,
  qty_t           REAL    NOT NULL DEFAULT 0,
  qty_m3_manual   INTEGER NOT NULL DEFAULT 0 CHECK (qty_m3_manual IN (0, 1)),
  qty_mp_manual   INTEGER NOT NULL DEFAULT 0 CHECK (qty_mp_manual IN (0, 1)),
  qty_t_manual    INTEGER NOT NULL DEFAULT 0 CHECK (qty_t_manual IN (0, 1)),

  -- Cena podstawowa dokumentu: zakupu dla PZ, sprzedaży dla WZ/SD
  unit_price_gr   INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_gr >= 0),
  value_gr        INTEGER NOT NULL DEFAULT 0 CHECK (value_gr >= 0),
  -- Cena kosztowa: dla SD cena zakupu, dla produkcji koszt surowca
  cost_unit_price_gr INTEGER NOT NULL DEFAULT 0 CHECK (cost_unit_price_gr >= 0),
  cost_value_gr      INTEGER NOT NULL DEFAULT 0 CHECK (cost_value_gr >= 0),
  notes           TEXT    NOT NULL DEFAULT '',
  UNIQUE (document_id, line_no)
);

CREATE INDEX idx_lines_document ON document_lines(document_id);
CREATE INDEX idx_lines_product ON document_lines(product_id);

-- ---------------------------------------------------------------------------
-- Rejestr ruchow magazynowych (księga niemodyfikowalna)
-- ---------------------------------------------------------------------------
CREATE TABLE stock_movements (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id      INTEGER NOT NULL REFERENCES documents(id),
  document_line_id INTEGER NULL REFERENCES document_lines(id),
  warehouse_id     INTEGER NOT NULL REFERENCES warehouses(id),
  product_id       INTEGER NOT NULL REFERENCES products(id),
  direction        TEXT    NOT NULL CHECK (direction IN ('IN', 'OUT')),
  qty_base         REAL    NOT NULL CHECK (qty_base <> 0),
  base_unit        TEXT    NOT NULL,
  doc_date         TEXT    NOT NULL,
  reason           TEXT    NOT NULL DEFAULT 'POSTING' CHECK (reason IN ('POSTING', 'REVERSAL')),
  created_at       TEXT    NOT NULL,
  created_by       INTEGER NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_mov_wh_prod ON stock_movements(warehouse_id, product_id, doc_date);
CREATE INDEX idx_mov_document ON stock_movements(document_id);
CREATE INDEX idx_mov_date ON stock_movements(doc_date);

-- ---------------------------------------------------------------------------
-- Stan magazynowy (saldo zmaterializowane, aktualizowane w tej samej transakcji
-- co ruchy magazynowe)
-- ---------------------------------------------------------------------------
CREATE TABLE stock (
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty_base     REAL    NOT NULL DEFAULT 0,
  updated_at   TEXT    NOT NULL,
  PRIMARY KEY (warehouse_id, product_id)
);

CREATE INDEX idx_stock_product ON stock(product_id);

-- ---------------------------------------------------------------------------
-- Numeracja dokumentów
-- ---------------------------------------------------------------------------
CREATE TABLE doc_sequences (
  doc_type     TEXT    NOT NULL,
  doc_year     INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL DEFAULT 0,
  last_seq     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, doc_year, warehouse_id)
);

-- ---------------------------------------------------------------------------
-- Zalaczniki (skany dokumentów PZ/WZ/MM i pozostalych)
-- ---------------------------------------------------------------------------
CREATE TABLE attachments (
  id            TEXT    PRIMARY KEY,
  document_id   INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  file_name     TEXT    NOT NULL,
  original_name TEXT    NOT NULL,
  mime_type     TEXT    NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT    NOT NULL,
  uploaded_at   TEXT    NOT NULL,
  uploaded_by   INTEGER NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_attachments_document ON attachments(document_id);

-- ---------------------------------------------------------------------------
-- Historia zmian / audyt
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at  TEXT    NOT NULL,
  user_id      INTEGER NULL REFERENCES users(id),
  user_login   TEXT    NOT NULL DEFAULT '',
  user_name    TEXT    NOT NULL DEFAULT '',
  action       TEXT    NOT NULL,
  module       TEXT    NOT NULL,
  entity_type  TEXT    NOT NULL,
  entity_id    TEXT    NOT NULL DEFAULT '',
  entity_label TEXT    NOT NULL DEFAULT '',
  warehouse_id INTEGER NULL REFERENCES warehouses(id),
  changes_json TEXT    NOT NULL DEFAULT '[]',
  ip           TEXT    NOT NULL DEFAULT '',
  user_agent   TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX idx_audit_occurred ON audit_logs(occurred_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_module ON audit_logs(module);

-- Ochrona audytu przed modyfikacja i usunieciem na poziomie bazy danych
CREATE TRIGGER trg_audit_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only');
END;

CREATE TRIGGER trg_audit_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only');
END;

-- Ruchy magazynowe są niemodyfikowalne - storno realizowane jest wpisem odwrotnym
CREATE TRIGGER trg_movements_no_update
BEFORE UPDATE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock_movements is append-only');
END;

CREATE TRIGGER trg_movements_no_delete
BEFORE DELETE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock_movements is append-only');
END;

-- ---------------------------------------------------------------------------
-- Ustawienia systemowe (przeliczniki, stawki, dane firmy)
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER NULL REFERENCES users(id)
);
