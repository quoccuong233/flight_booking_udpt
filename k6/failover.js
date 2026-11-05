// Steady load for the failover demo. While it runs:
//   docker stop search-1   then   docker start search-1
// docker compose run --rm k6 run /scripts/failover.js
import http from 'k6/http';
import { Rate } from 'k6/metrics';
import { sleep } from 'k6';
import { authHeaders, BASE_URL, findFlights, registerUser } from './lib.js';

const serverErrors = new Rate('server_errors');
const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F'];

export const options = {
  vus: 20,
  duration: __ENV.DURATION || '90s',
  thresholds: { server_errors: ['rate<0.05'] },
};

export function setup() {
  return { token: registerUser(), flights: findFlights() };
}

export default function ({ token, flights }) {
  const search = http.get(`${BASE_URL}/api/search?origin=HAN&destination=SGN&sort=price`);
  serverErrors.add(search.status >= 500);

  const flight = flights[Math.floor(Math.random() * flights.length)];
  const row = 1 + Math.floor(Math.random() * 10);
  const column = COLUMNS[Math.floor(Math.random() * COLUMNS.length)];
  const booking = http.post(
    `${BASE_URL}/api/bookings`,
    JSON.stringify({ flightId: flight.id, seatId: `${row}${column}` }),
    {
      headers: authHeaders(token, { 'Idempotency-Key': crypto.randomUUID() }),
      responseCallback: http.expectedStatuses(200, 201, 409),
    }
  );
  serverErrors.add(booking.status >= 500);

  sleep(1);
}
