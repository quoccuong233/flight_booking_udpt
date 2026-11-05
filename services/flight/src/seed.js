const { randomUUID } = require('node:crypto');
const { addEvent, withTx, logger } = require('@flight/common');
const { flightEvent } = require('./flightEvent');

const ROUTES = [
  ['HAN', 'SGN', 130], ['SGN', 'HAN', 130],
  ['HAN', 'DAD', 80], ['DAD', 'HAN', 80],
  ['SGN', 'DAD', 85], ['DAD', 'SGN', 85],
  ['SGN', 'PQC', 60], ['PQC', 'SGN', 60],
];
const AIRLINES = [['VN', 'Vietnam Airlines'], ['VJ', 'Vietjet Air'], ['QH', 'Bamboo Airways']];
const DEPARTURE_HOURS = [6, 7, 8.5, 10, 12, 13.5, 15, 16.5, 18, 19, 20.5, 22]; // Vietnam time
const DAYS_AHEAD = 30;
const TOTAL_SEATS = 60;

async function findOrCreateRoute(client, origin, destination) {
  const { rows } = await client.query(
    `INSERT INTO routes (id, origin, destination) VALUES ($1, $2, $3)
     ON CONFLICT (origin, destination) DO UPDATE SET origin = EXCLUDED.origin
     RETURNING id`,
    [randomUUID(), origin, destination]
  );
  return rows[0].id;
}

function departureTime(day, hour) {
  const departAt = new Date();
  departAt.setUTCDate(departAt.getUTCDate() + day);
  departAt.setUTCHours(Math.floor(hour) - 7, (hour % 1) * 60, 0, 0); // Vietnam is UTC+7
  return departAt;
}

// Adds only what the schedule is missing, so every start keeps flights on sale for the
// coming days and leaves existing flights and their bookings alone.
async function seedFlights(pool) {
  await withTx(pool, async (client) => {
    let created = 0;
    for (const [routeIndex, [origin, destination, minutes]] of ROUTES.entries()) {
      const routeId = await findOrCreateRoute(client, origin, destination);
      const { rows: scheduled } = await client.query(
        'SELECT depart_at FROM flights WHERE route_id = $1',
        [routeId]
      );
      const taken = new Set(scheduled.map((row) => row.depart_at.getTime()));

      for (let day = 1; day <= DAYS_AHEAD; day += 1) {
        for (const [hourIndex, hour] of DEPARTURE_HOURS.entries()) {
          const departAt = departureTime(day, hour);
          if (taken.has(departAt.getTime())) continue;

          const airlineIndex = hourIndex % AIRLINES.length;
          const [code, airline] = AIRLINES[airlineIndex];
          const arriveAt = new Date(departAt.getTime() + minutes * 60000);
          const price = 800000 + minutes * 8000 + airlineIndex * 150000 + (day % 4) * 50000;

          const { rows: inserted } = await client.query(
            `INSERT INTO flights
               (id, route_id, flight_no, airline, depart_at, arrive_at, price, total_seats)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [randomUUID(), routeId, `${code}${100 + routeIndex * 20 + hourIndex}`, airline,
              departAt, arriveAt, price, TOTAL_SEATS]
          );
          await addEvent(
            client,
            'flight.updated',
            flightEvent(inserted[0], { origin, destination })
          );
          created += 1;
        }
      }
    }
    logger.info({ created }, 'flights seeded');
  });
}

module.exports = { seedFlights };
