const { randomUUID } = require('node:crypto');
const {
  addEvent, createBreaker, HttpError, metrics, requireAuth, withTx,
} = require('@flight/common');
const { bookingEvent, publicBooking } = require('./bookingEvent');

const HOLD_SECONDS = Number(process.env.HOLD_SECONDS || 600);
const SEAT_LOCK_SECONDS = 5;
const UUID_PATTERN = /^[0-9a-f-]{36}$/i;

const bookingsCreated = new metrics.Counter({
  name: 'bookings_created_total',
  help: 'Bookings created',
});
const seatConflicts = new metrics.Counter({
  name: 'booking_seat_conflicts_total',
  help: 'Requests rejected because the seat was taken',
  labelNames: ['layer'],
});

async function fetchFlight(flightId, correlationId) {
  const response = await fetch(`${process.env.FLIGHT_URL}/api/flights/${flightId}`, {
    headers: { 'X-Correlation-ID': correlationId },
    signal: AbortSignal.timeout(2000),
  });
  if (response.status === 404) throw new HttpError(404, 'Không tìm thấy chuyến bay');
  if (!response.ok) throw new Error(`flight service returned ${response.status}`);
  return response.json();
}

const getFlight = createBreaker('flight-service', fetchFlight, {
  unavailableMessage: 'Hệ thống chuyến bay đang bận, vui lòng thử lại sau',
});

function registerRoutes(app, { pool, redis }) {
  // Redis only rejects early. If it is down we skip the lock and rely on uq_active_seat.
  async function tryLock(key) {
    try {
      return await redis.set(key, '1', { NX: true, EX: SEAT_LOCK_SECONDS });
    } catch {
      return true;
    }
  }

  async function findByIdempotencyKey(userId, key) {
    const { rows } = await pool.query(
      'SELECT * FROM bookings WHERE user_id = $1 AND idempotency_key = $2',
      [userId, key]
    );
    return rows[0];
  }

  app.post('/api/bookings', requireAuth, async (req, res) => {
    const { flightId, seatId } = req.body ?? {};
    const key = req.get('Idempotency-Key');
    if (!key) throw new HttpError(400, 'Thiếu Idempotency-Key');
    if (!UUID_PATTERN.test(flightId ?? '') || typeof seatId !== 'string') {
      throw new HttpError(400, 'Chuyến bay hoặc ghế không hợp lệ');
    }

    // Layer 3: the same attempt sent again gets the same booking.
    const previous = await findByIdempotencyKey(req.user.id, key);
    if (previous) return res.json(publicBooking(previous));

    const seat = await pool.query(
      'SELECT 1 FROM seats WHERE flight_id = $1 AND seat_id = $2',
      [flightId, seatId]
    );
    if (seat.rowCount === 0) throw new HttpError(404, 'Không tìm thấy ghế');

    // Layer 1: reject early so most losers never reach the database.
    if (!(await tryLock(`seat:${flightId}:${seatId}`))) {
      seatConflicts.inc({ layer: 'redis' });
      throw new HttpError(409, 'Ghế đang được người khác đặt', 'SEAT_TAKEN');
    }

    const flight = await getFlight(flightId, req.correlationId);
    if (new Date(flight.departAt) <= new Date()) {
      throw new HttpError(409, 'Chuyến bay đã khởi hành', 'FLIGHT_DEPARTED');
    }

    try {
      const booking = await withTx(pool, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO bookings (
             id, user_id, user_email, flight_id, flight_no, seat_id, amount,
             status, hold_expires_at, idempotency_key
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, 'PENDING',
             now() + make_interval(secs => $8), $9
           ) RETURNING *`,
          [randomUUID(), req.user.id, req.user.email, flightId, flight.flightNo,
            seatId, flight.price, HOLD_SECONDS, key]
        );
        await addEvent(client, 'booking.created', bookingEvent(rows[0]), req.correlationId);
        return rows[0];
      });
      bookingsCreated.inc();
      return res.status(201).json(publicBooking(booking));
    } catch (err) {
      // Layer 2: the database refuses a second active booking for the seat.
      if (err.constraint === 'uq_active_seat') {
        seatConflicts.inc({ layer: 'database' });
        throw new HttpError(409, 'Ghế đã được đặt', 'SEAT_TAKEN');
      }
      if (err.constraint === 'uq_idempotency') {
        return res.json(publicBooking(await findByIdempotencyKey(req.user.id, key)));
      }
      throw err;
    }
  });

  app.get('/api/bookings', requireAuth, async (req, res) => {
    const { rows } = await pool.query(
      'SELECT * FROM bookings WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
      [req.user.id]
    );
    res.json({ bookings: rows.map(publicBooking) });
  });

  app.get('/api/bookings/flights/:flightId/seats', requireAuth, async (req, res) => {
    if (!UUID_PATTERN.test(req.params.flightId)) throw new HttpError(404, 'Không tìm thấy chuyến bay');
    const { rows } = await pool.query(
      `SELECT s.seat_id, b.status, b.user_id
       FROM seats s
       LEFT JOIN bookings b
         ON b.flight_id = s.flight_id AND b.seat_id = s.seat_id
         AND b.status IN ('PENDING', 'CONFIRMED')
       WHERE s.flight_id = $1`,
      [req.params.flightId]
    );
    res.json({
      seats: rows.map((row) => ({
        seatId: row.seat_id,
        status: row.status ?? 'AVAILABLE',
        mine: row.user_id === req.user.id,
      })),
    });
  });

  app.get('/api/bookings/:id', requireAuth, async (req, res) => {
    if (!UUID_PATTERN.test(req.params.id)) throw new HttpError(404, 'Không tìm thấy booking');
    const { rows } = await pool.query(
      'SELECT * FROM bookings WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) throw new HttpError(404, 'Không tìm thấy booking');
    res.json(publicBooking(rows[0]));
  });
}

module.exports = { registerRoutes };
