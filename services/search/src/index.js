const { createHash } = require('node:crypto');
const {
  consume, createApp, createPool, createRedis, HttpError, metrics, serve, startMessaging,
} = require('@flight/common');

const CACHE_TTL_SECONDS = 15;
const VERSION_KEY = 'search:version';
const SORT_COLUMNS = { price: 'price ASC', depart: 'depart_at ASC' };
const SUGGESTED_UPCOMING = 12;
const UPCOMING_PER_DEPARTURE = 2;

const pool = createPool();
const redis = createRedis();
const app = createApp({ pool });

const cacheRequests = new metrics.Counter({
  name: 'search_cache_requests_total',
  help: 'Search cache lookups',
  labelNames: ['result'],
});

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
  availableSeats: row.available_seats,
});

// ---------- Cache: failures only mean a slower read from the database ----------

async function readCache(query) {
  try {
    const version = (await redis.get(VERSION_KEY)) ?? '0';
    const digest = createHash('sha1').update(JSON.stringify(query)).digest('hex');
    const key = `search:${version}:${digest}`;
    return { key, cached: await redis.get(key) };
  } catch {
    return { key: null, cached: null };
  }
}

async function writeCache(key, value) {
  if (!key) return;
  await redis.set(key, value, { EX: CACHE_TTL_SECONDS }).catch(() => {});
}

// A new version makes every older key unreachable; they expire on their own.
async function invalidateCache() {
  await redis.incr(VERSION_KEY).catch(() => {});
}

async function sendCached(res, query, load) {
  const { key, cached } = await readCache(query);
  if (cached) {
    cacheRequests.inc({ result: 'hit' });
    res.set('X-Cache', 'HIT').type('application/json').send(cached);
    return;
  }
  cacheRequests.inc({ result: 'miss' });

  const body = JSON.stringify(await load());
  await writeCache(key, body);
  res.set('X-Cache', 'MISS').type('application/json').send(body);
}

// ---------- Read API ----------

// Shown before the user searches. Many flights leave at the same hour, so capping
// each hour keeps the list varied.
app.get('/api/search/suggestions', async (req, res) => {
  await sendCached(res, { suggestions: true }, async () => {
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT *, row_number() OVER (PARTITION BY depart_at ORDER BY id) AS position
         FROM flights_read
         WHERE depart_at > now() AND available_seats > 0
       ) ranked
       WHERE position <= $2
       ORDER BY depart_at ASC, price ASC
       LIMIT $1`,
      [SUGGESTED_UPCOMING, UPCOMING_PER_DEPARTURE]
    );
    return { upcoming: rows.map(publicFlight) };
  });
});

app.get('/api/search', async (req, res) => {
  const { origin, destination, date, sort = 'depart', maxPrice, airline } = req.query;
  if (!origin || !destination) throw new HttpError(400, 'Vui lòng chọn điểm đi và điểm đến');
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Ngày không hợp lệ');
  if (maxPrice !== undefined && !Number.isFinite(Number(maxPrice))) {
    throw new HttpError(400, 'Giá không hợp lệ');
  }
  const orderBy = SORT_COLUMNS[sort];
  if (!orderBy) throw new HttpError(400, 'Kiểu sắp xếp không hợp lệ');

  const query = { origin, destination, date, sort, maxPrice, airline };
  await sendCached(res, query, async () => {
    const { rows } = await pool.query(
      `SELECT * FROM flights_read
       WHERE origin = $1 AND destination = $2 AND depart_at > now()
         AND ($3::date IS NULL OR (depart_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $3::date)
         AND ($4::int IS NULL OR price <= $4::int)
         AND ($5::text IS NULL OR airline = $5::text)
       ORDER BY ${orderBy}
       LIMIT 100`,
      [origin, destination, date ?? null, maxPrice ?? null, airline ?? null]
    );
    return { flights: rows.map(publicFlight) };
  });
});

app.get('/api/search/airports', async (req, res) => {
  const { rows } = await pool.query('SELECT DISTINCT origin FROM flights_read ORDER BY origin');
  res.json({ airports: rows.map((row) => row.origin) });
});

// ---------- Read model, updated from events ----------

const updateAvailability = (client, flightId, delta) => client.query(
  `UPDATE flights_read
   SET available_seats = LEAST(GREATEST(available_seats + $2, 0), total_seats)
   WHERE id = $1`,
  [flightId, delta]
);

const handlers = {
  'flight.updated': (client, { data }) => client.query(
    `INSERT INTO flights_read (
       id, flight_no, airline, origin, destination, depart_at, arrive_at,
       price, total_seats, available_seats, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       depart_at = EXCLUDED.depart_at,
       arrive_at = EXCLUDED.arrive_at,
       price = EXCLUDED.price,
       updated_at = EXCLUDED.updated_at
     WHERE flights_read.updated_at <= EXCLUDED.updated_at`,
    [data.id, data.flight_no, data.airline, data.origin, data.destination,
      data.depart_at, data.arrive_at, data.price, data.total_seats, data.updated_at]
  ),
  'booking.created': (client, { data }) => updateAvailability(client, data.flight_id, -1),
  'booking.cancelled': (client, { data }) => updateAvailability(client, data.flight_id, 1),
};

consume(pool, {
  queue: 'search.events',
  routingKeys: Object.keys(handlers),
  handler: async (client, event) => {
    await handlers[event.type](client, event);
    await invalidateCache();
  },
});

const stopMessaging = startMessaging();
serve(app, { pool, onShutdown: stopMessaging });
