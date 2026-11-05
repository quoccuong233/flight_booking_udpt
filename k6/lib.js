import http from 'k6/http';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export function registerUser() {
  const email = `k6-${crypto.randomUUID()}@test.local`;
  const response = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({ email, password: 'secret123', fullName: 'K6 User' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  if (response.status !== 201) throw new Error(`register failed: ${response.status}`);
  return response.json('token');
}

export function findFlights() {
  const response = http.get(`${BASE_URL}/api/search?origin=HAN&destination=SGN&sort=depart`);
  if (response.status !== 200) throw new Error(`search failed: ${response.status}`);
  return response.json('flights');
}

export function authHeaders(token, extra = {}) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}
