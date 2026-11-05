const { addEvent, consume } = require('@flight/common');
const { bookingEvent } = require('./bookingEvent');

const SEAT_COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F'];

function seatIds(totalSeats) {
  return Array.from({ length: totalSeats }, (_, index) => {
    const row = Math.floor(index / SEAT_COLUMNS.length) + 1;
    return `${row}${SEAT_COLUMNS[index % SEAT_COLUMNS.length]}`;
  });
}

// Each transition only applies to a PENDING booking, so of the racing branches
// (payment result, hold expiry) exactly one wins.
async function transition(client, bookingId, status, reason) {
  const { rows } = await client.query(
    `UPDATE bookings SET status = $2, cancel_reason = $3, updated_at = now()
     WHERE id = $1 AND status = 'PENDING'
     RETURNING *`,
    [bookingId, status, reason ?? null]
  );
  return rows[0];
}

const handlers = {
  'flight.updated': (client, { data }) => client.query(
    `INSERT INTO seats (flight_id, seat_id)
     SELECT $1, unnest($2::text[])
     ON CONFLICT DO NOTHING`,
    [data.id, seatIds(data.total_seats)]
  ),

  'payment.succeeded': async (client, event) => {
    const booking = await transition(client, event.data.booking_id, 'CONFIRMED');
    if (booking) {
      await addEvent(client, 'booking.confirmed', bookingEvent(booking), event.correlation_id);
      return;
    }
    // The hold expired before the money arrived: compensate.
    await addEvent(client, 'payment.refund_requested', event.data, event.correlation_id);
  },

  'payment.failed': async (client, event) => {
    const booking = await transition(client, event.data.booking_id, 'CANCELLED', 'PAYMENT_FAILED');
    if (booking) {
      await addEvent(client, 'booking.cancelled', bookingEvent(booking), event.correlation_id);
    }
  },
};

function registerConsumers(pool) {
  consume(pool, {
    queue: 'booking.events',
    routingKeys: Object.keys(handlers),
    handler: (client, event) => handlers[event.type](client, event),
  });
}

module.exports = { registerConsumers };
