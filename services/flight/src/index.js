const { randomUUID } = require('node:crypto');
const {
  addEvent, createApp, createPool, HttpError, logger, requireAdmin, requireAuth,
  serve, startMessaging, startOutboxPublisher, withTx,
} = require('@flight/common');
const { flightEvent } = require('./flightEvent');
const { seedFlights } = require('./seed');

const UUID_PATTERN = /^[0-9a-f-]{36}$/i;

const pool = createPool();
const app = createApp({ pool });

const FLIGHT_SELECT = `
  SELECT f.*, r.origin, r.destination
  FROM flights f JOIN routes r ON r.id = f.route_id`;

const publicFlight = (row) => ({
  id: row.id,
  flightNo: row.flight_no,
  airline: row.airline,
  origin: row.origin,
  destination: row.destination,
  departAt: row.depart_at,
  arriveAt: row.arrive_at,
  price: row.price,
  totalSeats: row.total_seats,
});

app.get('/api/flights/:id', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) throw new HttpError(404, 'Không tìm thấy chuyến bay');
  const { rows } = await pool.query(`${FLIGHT_SELECT} WHERE f.id = $1`, [req.params.id]);
  if (rows.length === 0) throw new HttpError(404, 'Không tìm thấy chuyến bay');
  res.json(publicFlight(rows[0]));
});

app.post('/api/flights', requireAuth, requireAdmin, async (req, res) => {
  const {
    origin, destination, flightNo, airline, departAt, arriveAt, price, totalSeats,
  } = req.body ?? {};
  if (!origin || !destination || !flightNo || !airline || !departAt || !arriveAt) {
    throw new HttpError(400, 'Thiếu thông tin chuyến bay');
  }
  if (!(price > 0) || !(totalSeats > 0)) throw new HttpError(400, 'Giá hoặc số ghế không hợp lệ');

  const flight = await withTx(pool, async (client) => {
    const { rows: routes } = await client.query(
      `INSERT INTO routes (id, origin, destination) VALUES ($1, $2, $3)
       ON CONFLICT (origin, destination) DO UPDATE SET origin = EXCLUDED.origin
       RETURNING *`,
      [randomUUID(), origin, destination]
    );
    const { rows } = await client.query(
      `INSERT INTO flights
         (id, route_id, flight_no, airline, depart_at, arrive_at, price, total_seats)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [randomUUID(), routes[0].id, flightNo, airline, departAt, arriveAt, price, totalSeats]
    );
    const row = { ...rows[0], origin, destination };
    await addEvent(client, 'flight.updated', flightEvent(row, row), req.correlationId);
    return row;
  });

  res.status(201).json(publicFlight(flight));
});

app.patch('/api/flights/:id', requireAuth, requireAdmin, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) throw new HttpError(404, 'Không tìm thấy chuyến bay');
  const { price, departAt, arriveAt } = req.body ?? {};
  if (price !== undefined && !(price > 0)) throw new HttpError(400, 'Giá không hợp lệ');

  const flight = await withTx(pool, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE flights SET
         price = COALESCE($2, price),
         depart_at = COALESCE($3, depart_at),
         arrive_at = COALESCE($4, arrive_at),
         updated_at = now()
       WHERE id = $1`,
      [req.params.id, price ?? null, departAt ?? null, arriveAt ?? null]
    );
    if (rowCount === 0) throw new HttpError(404, 'Không tìm thấy chuyến bay');

    const { rows } = await client.query(`${FLIGHT_SELECT} WHERE f.id = $1`, [req.params.id]);
    await addEvent(client, 'flight.updated', flightEvent(rows[0], rows[0]), req.correlationId);
    return rows[0];
  });

  res.json(publicFlight(flight));
});

const stopMessaging = startMessaging();
const stopPublisher = startOutboxPublisher(pool);
seedFlights(pool).catch((err) => logger.error({ err }, 'flight seed failed'));

serve(app, {
  pool,
  onShutdown: async () => {
    stopPublisher();
    await stopMessaging();
  },
});
