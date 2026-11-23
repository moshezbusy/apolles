-- Storage for the supplier layer on PostgreSQL. NOT in use yet.
-- Today one server instance keeps bookings in a durable JSON file
-- (BOOKINGS_FILE, src/store/file-booking-store.ts). Move to this schema
-- before running more than one instance: a file cannot be shared safely.
-- The in-memory stores in src/store are for development and tests only.

CREATE TABLE bookings (
  client_reference      TEXT PRIMARY KEY,          -- our id = idempotency key; UNIQUE stops double booking
  supplier_id           TEXT NOT NULL,
  hotel_id              TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN
                          ('PENDING','CONFIRMED','ON_REQUEST','FAILED','UNKNOWN','NEEDS_REVIEW','CANCELLED')),
  supplier_booking_ref  TEXT,
  hotel_confirmation    TEXT,
  total_minor           BIGINT NOT NULL,
  currency              CHAR(3) NOT NULL,
  payment_type          TEXT NOT NULL,             -- never card data, only the type
  offer                 JSONB NOT NULL,
  holder                JSONB NOT NULL,
  guests                JSONB NOT NULL,
  failure_reason        TEXT,
  reconcile_attempts    INT NOT NULL DEFAULT 0,
  cancellation_ref      TEXT,
  cancellation_fee_minor BIGINT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bookings_status_idx ON bookings (status) WHERE status IN ('UNKNOWN','NEEDS_REVIEW','PENDING');
CREATE UNIQUE INDEX bookings_supplier_ref_idx ON bookings (supplier_id, supplier_booking_ref) WHERE supplier_booking_ref IS NOT NULL;

CREATE TABLE booking_history (
  id                BIGSERIAL PRIMARY KEY,
  client_reference  TEXT NOT NULL REFERENCES bookings(client_reference),
  at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  status            TEXT NOT NULL,
  note              TEXT
);

-- Hotel mapping: one internal hotel, many supplier codes.
CREATE TABLE hotels (
  hotel_id   TEXT PRIMARY KEY,                       -- e.g. APL-CUN-0001
  name       TEXT NOT NULL,
  chain      TEXT,                                   -- e.g. RIU, Playa
  country    CHAR(2),
  city       TEXT
);

CREATE TABLE supplier_hotel_map (
  supplier_id          TEXT NOT NULL,
  supplier_hotel_code  TEXT NOT NULL,
  hotel_id             TEXT NOT NULL REFERENCES hotels(hotel_id),
  active               BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (supplier_id, supplier_hotel_code),
  UNIQUE (supplier_id, hotel_id)
);

CREATE TABLE supplier_board_map (
  supplier_id  TEXT NOT NULL,
  raw_code     TEXT NOT NULL,
  board        TEXT NOT NULL CHECK (board IN ('RO','BB','HB','FB','AI','UAI','OTHER')),
  PRIMARY KEY (supplier_id, raw_code)
);

-- Audit of every supplier call (already redacted by the transport).
-- Keep at least as long as the supplier contract requires (often 12-24 months).
CREATE TABLE supplier_calls (
  id              BIGSERIAL PRIMARY KEY,
  at              TIMESTAMPTZ NOT NULL,
  request_id      TEXT NOT NULL,
  supplier_id     TEXT NOT NULL,
  operation       TEXT NOT NULL,
  attempt         INT NOT NULL,
  method          TEXT NOT NULL,
  url             TEXT NOT NULL,
  request_headers JSONB,
  request_body    TEXT,
  status          INT,
  response_body   TEXT,
  duration_ms     INT NOT NULL,
  error           TEXT
);
CREATE INDEX supplier_calls_request_idx ON supplier_calls (request_id);
CREATE INDEX supplier_calls_supplier_at_idx ON supplier_calls (supplier_id, at);
