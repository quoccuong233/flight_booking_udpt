// End-to-end checks against the running stack: node tests/e2e.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const GOOD_CARD = '4111111111111111';
const DECLINED_CARD = '4111111111110000';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(path, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json().catch(() => null),
  };
}

async function eventually(check, { timeout = 15000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() > deadline) assert.fail('condition not met in time');
    await sleep(interval);
  }
}

async function newUser() {
  const email = `e2e-${randomUUID()}@test.local`;
  const { status, body } = await call('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'secret123', fullName: 'E2E User' },
  });
  assert.equal(status, 201);
  return { token: body.token, email, id: body.user.id };
}

async function anyFlight() {
  const { body } = await call('/api/search?origin=SGN&destination=PQC');
  assert.ok(body.flights.length > 0, 'seeded flights reach the read model');
  return body.flights[Math.floor(Math.random() * body.flights.length)];
}

async function freeSeat(token, flightId) {
  const seats = await eventually(async () => {
    const { body } = await call(`/api/bookings/flights/${flightId}/seats`, { token });
    return body.seats.length > 0 && body.seats;
  });
  const free = seats.filter((seat) => seat.status === 'AVAILABLE');
  return free[Math.floor(Math.random() * free.length)].seatId;
}

function book(token, flightId, seatId, key = randomUUID()) {
  return call('/api/bookings', {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': key },
    body: { flightId, seatId },
  });
}

async function pay(token, bookingId, cardNumber) {
  return eventually(async () => {
    const result = await call('/api/payments', {
      method: 'POST', token, body: { bookingId, cardNumber },
    });
    return result.body?.code === 'PAYMENT_NOT_READY' ? null : result;
  });
}

const bookingStatus = (token, id, status) => eventually(async () => {
  const { body } = await call(`/api/bookings/${id}`, { token });
  return body.status === status && body;
});

// Test accounts use .local addresses, so Notification logs the email instead of sending it.
function emailHandled(emailType, id) {
  const log = execFileSync('docker', ['logs', '--since', '3m', 'notification'], { encoding: 'utf8' });
  return log.split(/\r?\n/).some((line) => line.includes(`"emailType":"${emailType}"`) && line.includes(id));
}

function bookingSql(sql) {
  return execFileSync('docker', [
    'exec', 'postgres-main', 'psql', '-U', 'postgres', '-d', 'booking', '-Atc', sql,
  ], { encoding: 'utf8' }).trim();
}

test('protected routes need a token and internal routes are not exposed', async () => {
  assert.equal((await call('/api/bookings')).status, 401);
  // Kong sends every non-/api path to the website, so these must come back as the
  // app's HTML rather than a service's metrics or health answer.
  for (const path of ['/metrics', '/health/ready']) {
    const { headers } = await call(path);
    assert.match(headers.get('content-type') ?? '', /text\/html/, path);
  }
});

test('login returns a token that Kong accepts', async () => {
  const email = `e2e-${randomUUID()}@test.local`;
  const credentials = { email, password: 'secret123' };
  await call('/api/auth/register', {
    method: 'POST', body: { ...credentials, fullName: 'E2E User' },
  });
  assert.equal((await call('/api/auth/login', {
    method: 'POST', body: { ...credentials, password: 'wrong-password' },
  })).status, 401);

  const { status, body } = await call('/api/auth/login', { method: 'POST', body: credentials });
  assert.equal(status, 200);
  assert.equal((await call('/api/bookings', { token: body.token })).status, 200);
});

test('a new account triggers a welcome email', async () => {
  const { id } = await newUser();
  await eventually(() => emailHandled('user.registered', id));
});

test('a user can rename the account and change the password', async () => {
  const { token, email, id } = await newUser();
  assert.equal((await call('/api/auth/me', { method: 'PATCH', body: { fullName: 'Tên' } })).status, 401);

  const renamed = await call('/api/auth/me', {
    method: 'PATCH', token, body: { fullName: '  Tên Mới  ' },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.user.fullName, 'Tên Mới');
  const { body: me } = await call('/api/auth/me', { token: renamed.body.token });
  assert.equal(me.user.fullName, 'Tên Mới');
  assert.ok(me.user.createdAt);

  const change = (currentPassword, newPassword) => call('/api/auth/me/password', {
    method: 'POST', token, body: { currentPassword, newPassword },
  });
  assert.equal((await change('wrong-password', 'new-secret')).status, 400);
  assert.equal((await change('secret123', 'abc')).status, 400);
  assert.equal((await change('secret123', 'secret123')).status, 400);
  assert.equal((await change('secret123', 'new-secret')).status, 204);

  const login = (password) => call('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal((await login('secret123')).status, 401);
  assert.equal((await login('new-secret')).status, 200);
  await eventually(() => emailHandled('user.password_changed', id));
});

test('a user can set and remove a profile picture', async () => {
  const { token, email } = await newUser();
  const image = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const put = (value, auth = token) => call('/api/auth/me/avatar', {
    method: 'PUT', token: auth, body: { image: value },
  });

  assert.equal((await put(image, null)).status, 401);
  assert.equal((await put('data:image/svg+xml;base64,PHN2Zz4=')).status, 400);
  assert.equal((await put('https://example.com/a.jpg')).status, 400);
  assert.equal((await put(`data:image/jpeg;base64,${'A'.repeat(90000)}`)).status, 400);

  const saved = await put(image);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.user.avatar, image);

  const login = await call('/api/auth/login', {
    method: 'POST', body: { email, password: 'secret123' },
  });
  assert.equal(login.body.user.avatar, image);

  const removed = await call('/api/auth/me/avatar', { method: 'DELETE', token });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.user.avatar, null);
});

test('search is cached and filters results', async () => {
  const { body: first } = await call('/api/search?origin=HAN&destination=DAD&sort=price');
  const prices = first.flights.map((flight) => flight.price);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));

  const again = await call('/api/search?origin=HAN&destination=DAD&sort=price');
  assert.equal(again.headers.get('x-cache'), 'HIT');
});

test('suggestions list bookable flights without a search', async () => {
  const { status, body } = await call('/api/search/suggestions');
  assert.equal(status, 200);
  assert.ok(body.upcoming.length > 0);

  const departures = body.upcoming.map((flight) => new Date(flight.departAt).getTime());
  assert.deepEqual(departures, [...departures].sort((a, b) => a - b));

  for (const flight of body.upcoming) {
    assert.ok(flight.availableSeats > 0);
    assert.ok(new Date(flight.departAt) > new Date());
  }
});

test('paying confirms the booking, sends an email and updates search', async () => {
  const { token } = await newUser();
  const flight = await anyFlight();
  const seatId = await freeSeat(token, flight.id);

  const { status, body: booking } = await book(token, flight.id, seatId);
  assert.equal(status, 201);
  assert.equal(booking.status, 'PENDING');
  assert.equal(booking.amount, flight.price);

  const payment = await pay(token, booking.id);
  assert.equal(payment.body.status, 'SUCCEEDED');
  await bookingStatus(token, booking.id, 'CONFIRMED');

  await eventually(() => emailHandled('booking.confirmed', booking.id));

  await eventually(async () => {
    const { body } = await call(`/api/search?origin=SGN&destination=PQC&cachebust=${randomUUID()}`);
    const updated = body.flights.find((item) => item.id === flight.id);
    return updated.availableSeats < flight.availableSeats;
  }, { timeout: 20000 });
});

test('a resent request returns the same booking', async () => {
  const { token } = await newUser();
  const flight = await anyFlight();
  const seatId = await freeSeat(token, flight.id);
  const key = randomUUID();

  const first = await book(token, flight.id, seatId, key);
  const second = await book(token, flight.id, seatId, key);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.id, first.body.id);
});

test('two people cannot hold one seat, even without Redis in the way', async () => {
  const alice = await newUser();
  const bob = await newUser();
  const flight = await anyFlight();
  const seatId = await freeSeat(alice.token, flight.id);

  assert.equal((await book(alice.token, flight.id, seatId)).status, 201);
  assert.equal((await book(bob.token, flight.id, seatId)).status, 409);

  await sleep(5500); // lets the Redis lock expire, so only the unique index remains
  const late = await book(bob.token, flight.id, seatId);
  assert.equal(late.status, 409);
  assert.equal(late.body.code, 'SEAT_TAKEN');
});

test('a declined card cancels the booking and frees the seat', async () => {
  const { token } = await newUser();
  const flight = await anyFlight();
  const seatId = await freeSeat(token, flight.id);

  const { body: booking } = await book(token, flight.id, seatId);
  const payment = await pay(token, booking.id, DECLINED_CARD);
  assert.equal(payment.body.status, 'FAILED');

  const cancelled = await bookingStatus(token, booking.id, 'CANCELLED');
  assert.equal(cancelled.cancelReason, 'PAYMENT_FAILED');

  await sleep(5000);
  assert.equal((await book(token, flight.id, seatId)).status, 201);
});

test('an expired hold is cancelled and late money is refunded', async () => {
  const { token } = await newUser();
  const flight = await anyFlight();
  const seatId = await freeSeat(token, flight.id);

  const { body: booking } = await book(token, flight.id, seatId);
  await eventually(async () => {
    const { body } = await call(`/api/payments/${booking.id}`, { token }).catch(() => ({}));
    return body?.status === 'PENDING';
  });

  bookingSql(`UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = '${booking.id}'`);
  const cancelled = await bookingStatus(token, booking.id, 'CANCELLED');
  assert.equal(cancelled.cancelReason, 'HOLD_EXPIRED');

  await pay(token, booking.id, GOOD_CARD);
  await eventually(async () => {
    const { body } = await call(`/api/payments/${booking.id}`, { token });
    return body.status === 'REFUNDED';
  });
  assert.equal(bookingSql(`SELECT status FROM bookings WHERE id = '${booking.id}'`), 'CANCELLED');
});

test('the replica receives bookings', async () => {
  const { token } = await newUser();
  const flight = await anyFlight();
  const seatId = await freeSeat(token, flight.id);
  const { body: booking } = await book(token, flight.id, seatId);

  await eventually(() => execFileSync('docker', [
    'exec', 'postgres-replica', 'psql', '-U', 'postgres', '-d', 'booking', '-Atc',
    `SELECT count(*) FROM bookings WHERE id = '${booking.id}'`,
  ], { encoding: 'utf8' }).trim() === '1');
});
