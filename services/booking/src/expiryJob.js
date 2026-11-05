const cron = require('node-cron');
const { addEvent, logger, withTx } = require('@flight/common');
const { bookingEvent } = require('./bookingEvent');

// SKIP LOCKED makes each instance pass over rows another one is already handling,
// so no distributed lock is needed if Booking is scaled out.
async function cancelExpiredBookings(pool) {
  const cancelled = await withTx(pool, async (client) => {
    const { rows } = await client.query(
      `WITH expired AS (
         SELECT id FROM bookings
         WHERE status = 'PENDING' AND hold_expires_at < now()
         FOR UPDATE SKIP LOCKED
         LIMIT 100
       )
       UPDATE bookings b
       SET status = 'CANCELLED', cancel_reason = 'HOLD_EXPIRED', updated_at = now()
       FROM expired
       WHERE b.id = expired.id
       RETURNING b.*`
    );
    for (const booking of rows) {
      await addEvent(client, 'booking.cancelled', bookingEvent(booking));
    }
    return rows.length;
  });
  if (cancelled > 0) logger.info({ cancelled }, 'expired bookings cancelled');
}

function startExpiryJob(pool) {
  const task = cron.schedule('*/15 * * * * *', () => {
    cancelExpiredBookings(pool).catch((err) => {
      logger.warn({ err: err.message }, 'expiry job failed');
    });
  });
  return () => task.stop();
}

module.exports = { startExpiryJob };
