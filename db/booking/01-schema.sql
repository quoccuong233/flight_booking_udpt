-- booking runs on its own instance, postgres-booking, so heavy seat contention
-- cannot slow down the other services and the other way round.
CREATE DATABASE booking;

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

