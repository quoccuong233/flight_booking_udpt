const { randomUUID } = require('node:crypto');
const {
  addEvent, consume, createApp, createBreaker, createPool, HttpError, requireAuth,
  serve, startMessaging, startOutboxPublisher, withTx,
} = require('@flight/common');

const UUID_PATTERN = /^[0-9a-f-]{36}$/i;
const DECLINED_CARD_SUFFIX = '0000';

const pool = createPool();
const app = createApp({ pool });

// Simulated payment gateway. GATEWAY_FAIL_RATE makes it fail like a real outage.
async function callGateway(cardNumber = '') {
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (Math.random() < Number(process.env.GATEWAY_FAIL_RATE || 0)) {
    throw new Error('payment gateway unavailable');
  }
  return { approved: !cardNumber.endsWith(DECLINED_CARD_SUFFIX) };
}

const chargeCard = createBreaker('payment-gateway', callGateway, {
  unavailableMessage: 'Cổng thanh toán đang gián đoạn, vui lòng thử lại sau',
});

const publicPayment = (payment) => ({
  id: payment.id,
  bookingId: payment.booking_id,
  amount: payment.amount,
  status: payment.status,
});

app.post('/api/payments', requireAuth, async (req, res) => {
  const { bookingId, cardNumber } = req.body ?? {};
  if (!UUID_PATTERN.test(bookingId ?? '')) throw new HttpError(400, 'Booking không hợp lệ');
  // Optional: the website sends none, tests pass a declined card to reach the failure branch.
  if (cardNumber !== undefined && !/^\d{12,19}$/.test(cardNumber)) {
    throw new HttpError(400, 'Số thẻ không hợp lệ');
  }

  const payment = await withTx(pool, async (client) => {
    // The row lock stops two concurrent requests from charging the card twice.
    const { rows } = await client.query(
      'SELECT * FROM payments WHERE booking_id = $1 AND user_id = $2 FOR UPDATE',
      [bookingId, req.user.id]
    );
    const current = rows[0];
    if (!current) {
      throw new HttpError(409, 'Giao dịch đang được khởi tạo, vui lòng thử lại', 'PAYMENT_NOT_READY');
    }
    if (current.status !== 'PENDING') return current;

    // A gateway outage rolls back and leaves the payment PENDING, so it can be retried.
    const { approved } = await chargeCard(cardNumber);
    const status = approved ? 'SUCCEEDED' : 'FAILED';
    const { rows: updated } = await client.query(
      'UPDATE payments SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [current.id, status]
    );
    await addEvent(
      client,
      approved ? 'payment.succeeded' : 'payment.failed',
      { booking_id: current.booking_id, payment_id: current.id, amount: current.amount },
      req.correlationId
    );
    return updated[0];
  });

  res.json(publicPayment(payment));
});

app.get('/api/payments/:bookingId', requireAuth, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.bookingId)) throw new HttpError(404, 'Không tìm thấy giao dịch');
  const { rows } = await pool.query(
    'SELECT * FROM payments WHERE booking_id = $1 AND user_id = $2',
    [req.params.bookingId, req.user.id]
  );
  if (rows.length === 0) throw new HttpError(404, 'Không tìm thấy giao dịch');
  res.json(publicPayment(rows[0]));
});

const handlers = {
  'booking.created': (client, { data }) => client.query(
    `INSERT INTO payments (id, booking_id, user_id, amount)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (booking_id) DO NOTHING`,
    [randomUUID(), data.booking_id, data.user_id, data.amount]
  ),
  'payment.refund_requested': (client, { data }) => client.query(
    `UPDATE payments SET status = 'REFUNDED', updated_at = now()
     WHERE booking_id = $1 AND status = 'SUCCEEDED'`,
    [data.booking_id]
  ),
};

consume(pool, {
  queue: 'payment.events',
  routingKeys: Object.keys(handlers),
  handler: (client, event) => handlers[event.type](client, event),
});

const stopMessaging = startMessaging();
const stopPublisher = startOutboxPublisher(pool);

serve(app, {
  pool,
  onShutdown: async () => {
    stopPublisher();
    await stopMessaging();
  },
});
