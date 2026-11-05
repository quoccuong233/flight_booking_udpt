-- Logical databases on the shared postgres-main instance, one per service.
CREATE DATABASE auth;
CREATE DATABASE flight;
CREATE DATABASE search;
CREATE DATABASE booking;
CREATE DATABASE payment;
CREATE DATABASE notification;

\connect auth
CREATE TABLE users (
  id            UUID PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  avatar        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE outbox (
  id             UUID PRIMARY KEY,
  type           TEXT NOT NULL,
  payload        JSONB NOT NULL,
  correlation_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ
);
CREATE INDEX idx_outbox_unpublished ON outbox (created_at) WHERE published_at IS NULL;

\connect flight
CREATE TABLE routes (
  id          UUID PRIMARY KEY,
  origin      TEXT NOT NULL,
  destination TEXT NOT NULL,
  UNIQUE (origin, destination)
);

CREATE TABLE flights (
  id          UUID PRIMARY KEY,
  route_id    UUID NOT NULL REFERENCES routes (id),
  flight_no   TEXT NOT NULL,
  airline     TEXT NOT NULL,
  depart_at   TIMESTAMPTZ NOT NULL,
  arrive_at   TIMESTAMPTZ NOT NULL,
  price       INTEGER NOT NULL CHECK (price > 0),
  total_seats INTEGER NOT NULL CHECK (total_seats > 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE outbox (
  id             UUID PRIMARY KEY,
  type           TEXT NOT NULL,
  payload        JSONB NOT NULL,
  correlation_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ
);
CREATE INDEX idx_outbox_unpublished ON outbox (created_at) WHERE published_at IS NULL;

\connect search
CREATE TABLE flights_read (
  id              UUID PRIMARY KEY,
  flight_no       TEXT NOT NULL,
  airline         TEXT NOT NULL,
  origin          TEXT NOT NULL,
  destination     TEXT NOT NULL,
  depart_at       TIMESTAMPTZ NOT NULL,
  arrive_at       TIMESTAMPTZ NOT NULL,
  price           INTEGER NOT NULL,
  total_seats     INTEGER NOT NULL,
  available_seats INTEGER NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_flights_read_lookup ON flights_read (origin, destination, depart_at);

CREATE TABLE processed_events (
  event_id     UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

\connect booking
CREATE TABLE seats (
  flight_id UUID NOT NULL,
  seat_id   TEXT NOT NULL,
  PRIMARY KEY (flight_id, seat_id)
);

CREATE TABLE bookings (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL,
  user_email      TEXT NOT NULL,
  flight_id       UUID NOT NULL,
  flight_no       TEXT NOT NULL,
  seat_id         TEXT NOT NULL,
  amount          INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED')),
  cancel_reason   TEXT,
  hold_expires_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (flight_id, seat_id) REFERENCES seats (flight_id, seat_id)
);

-- The final guarantee against double-selling: at most one active booking per seat.
CREATE UNIQUE INDEX uq_active_seat ON bookings (flight_id, seat_id)
WHERE status IN ('PENDING', 'CONFIRMED');

CREATE UNIQUE INDEX uq_idempotency ON bookings (user_id, idempotency_key);

CREATE INDEX idx_bookings_expiry ON bookings (hold_expires_at) WHERE status = 'PENDING';
CREATE INDEX idx_bookings_user ON bookings (user_id, created_at DESC);

CREATE TABLE outbox (
  id             UUID PRIMARY KEY,
  type           TEXT NOT NULL,
  payload        JSONB NOT NULL,
  correlation_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ
);
CREATE INDEX idx_outbox_unpublished ON outbox (created_at) WHERE published_at IS NULL;

CREATE TABLE processed_events (
  event_id     UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

\connect payment
CREATE TABLE payments (
  id          UUID PRIMARY KEY,
  booking_id  UUID NOT NULL UNIQUE,
  user_id     UUID NOT NULL,
  amount      INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE outbox (
  id             UUID PRIMARY KEY,
  type           TEXT NOT NULL,
  payload        JSONB NOT NULL,
  correlation_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ
);
CREATE INDEX idx_outbox_unpublished ON outbox (created_at) WHERE published_at IS NULL;

CREATE TABLE processed_events (
  event_id     UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

\connect notification
CREATE TABLE processed_events (
  event_id     UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
