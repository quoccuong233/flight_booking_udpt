// 100 concurrent requests for one seat: exactly one must win.
// docker compose run --rm k6 run /scripts/seat-race.js
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { authHeaders, BASE_URL, findFlights, registerUser } from './lib.js';

const created = new Counter('seat_created');
const conflicts = new Counter('seat_conflict');
const unexpected = new Counter('seat_unexpected');

export const options = {
  scenarios: {
    race: { executor: 'shared-iterations', vus: 100, iterations: 100, maxDuration: '30s' },
  },
  thresholds: {
    seat_created: ['count==1'],
    seat_conflict: ['count==99'],
    seat_unexpected: ['count==0'],
  },
};

export function setup() {
  const token = registerUser();
  const flight = findFlights()[0];
  const seats = http.get(`${BASE_URL}/api/bookings/flights/${flight.id}/seats`, {
    headers: authHeaders(token),
  }).json('seats');
  const seat = seats.find((item) => item.status === 'AVAILABLE');
  if (!seat) throw new Error('no available seat, restart with a fresh flight');
  console.log(`target: flight ${flight.flightNo}, seat ${seat.seatId}`);
  return { token, flightId: flight.id, seatId: seat.seatId };
}

export default function ({ token, flightId, seatId }) {
  const response = http.post(
    `${BASE_URL}/api/bookings`,
    JSON.stringify({ flightId, seatId }),
    {
      headers: authHeaders(token, { 'Idempotency-Key': crypto.randomUUID() }),
      responseCallback: http.expectedStatuses(201, 409),
    }
  );

  if (response.status === 201) created.add(1);
  else if (response.status === 409) conflicts.add(1);
  else {
    unexpected.add(1);
    console.error(`unexpected status ${response.status}: ${response.body}`);
  }
}
