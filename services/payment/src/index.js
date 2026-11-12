const { randomUUID } = require('node:crypto');
const {
  addEvent, consume, createApp, createBreaker, createPool, HttpError, logger, requireAuth,
  serve, startMessaging, startOutboxPublisher, withTx,
} = require('@flight/common');
const vnpay = require('./vnpay');

const UUID_PATTERN = /^[0-9a-f-]{36}$/i;
const DECLINED_CARD_SUFFIX = '0000';

// VNPay once its credentials are set, otherwise the simulated gateway below.
const PROVIDER = vnpay.enabled ? 'vnpay' : 'simulated';

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

// Records the gateway's final answer and the event that drives the booking saga.
async function settle(client, payment, approved, correlationId) {
  const { rows } = await client.query(
    'UPDATE payments SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [payment.id, approved ? 'SUCCEEDED' : 'FAILED']
  );
  await addEvent(
    client,
    approved ? 'payment.succeeded' : 'payment.failed',
    { booking_id: payment.booking_id, payment_id: payment.id, amount: payment.amount },
    correlationId
  );
  return rows[0];
}

// Kong passes the browser's address in X-Forwarded-For.
function clientIp(req) {
  const forwarded = req.get('X-Forwarded-For')?.split(',')[0].trim();
  return (forwarded || req.socket.remoteAddress || '127.0.0.1').replace(/^::ffff:/, '');
}

app.post('/api/payments', requireAuth, async (req, res) => {
  const { bookingId, cardNumber } = req.body ?? {};
  if (!UUID_PATTERN.test(bookingId ?? '')) throw new HttpError(400, 'Booking không hợp lệ');
  // Optional: the website sends none, tests pass a declined card to reach the failure branch.
  if (cardNumber !== undefined && !/^\d{12,19}$/.test(cardNumber)) {
    throw new HttpError(400, 'Số thẻ không hợp lệ');
  }

  const result = await withTx(pool, async (client) => {
    // The row lock stops two concurrent requests from charging the card twice.
    const { rows } = await client.query(
      'SELECT * FROM payments WHERE booking_id = $1 AND user_id = $2 FOR UPDATE',
      [bookingId, req.user.id]
    );
    const current = rows[0];
    if (!current) {
      throw new HttpError(409, 'Giao dịch đang được khởi tạo, vui lòng thử lại', 'PAYMENT_NOT_READY');
    }
    if (current.status !== 'PENDING') return { payment: current };

    // VNPay: the customer pays on VNPay's page, the result comes back through /vnpay/return.
    if (PROVIDER === 'vnpay') {
      return { payUrl: vnpay.buildPayUrl({ payment: current, ipAddr: clientIp(req) }) };
    }

    // A gateway outage rolls back and leaves the payment PENDING, so it can be retried.
    const { approved } = await chargeCard(cardNumber);
    return { payment: await settle(client, current, approved, req.correlationId) };
  });

  res.json(result.payUrl ? { payUrl: result.payUrl } : publicPayment(result.payment));
});

// Applies a result VNPay signed. Both the browser return and the IPN call land here,
// in any order and any number of times: only the first one that finds PENDING settles it.
// An unsuccessful attempt (including the customer pressing cancel) leaves the payment
// PENDING so it can be paid again until the seat hold runs out.
async function applyVnpayResult(query, correlationId) {
  const result = vnpay.verify(query);
  if (!result.valid) return { outcome: 'invalid-signature' };
  if (!result.paymentId) return { outcome: 'not-found' };

  return withTx(pool, async (client) => {
    const { rows } = await client.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [
      result.paymentId,
    ]);
    const payment = rows[0];
    if (!payment) return { outcome: 'not-found' };
    if (payment.amount !== result.amount) return { outcome: 'wrong-amount', payment };

    const log = logger.child({ correlationId, paymentId: payment.id });
    if (payment.status !== 'PENDING') {
      if (result.success && payment.status !== 'SUCCEEDED') {
        log.warn({ status: payment.status, transactionNo: result.transactionNo },
          'vnpay charged a payment that is no longer pending');
      }
      return { outcome: 'already', payment, responseCode: result.responseCode };
    }
    if (!result.success) {
      log.info({ responseCode: result.responseCode }, 'vnpay payment not completed');
      return { outcome: 'unpaid', payment, responseCode: result.responseCode };
    }

    log.info({ transactionNo: result.transactionNo }, 'vnpay payment succeeded');
    const settled = await settle(client, payment, true, correlationId);
    return { outcome: 'settled', payment: settled, responseCode: result.responseCode };
  });
}

// The browser comes back here from VNPay. No token is needed: VNPay's signature is the proof.
app.get('/api/payments/vnpay/return', async (req, res) => {
  const { outcome, payment, responseCode } = await applyVnpayResult(req.query, req.correlationId);
  if (outcome === 'invalid-signature') throw new HttpError(400, 'Chữ ký VNPay không hợp lệ');
  if (outcome === 'not-found') throw new HttpError(400, 'Không tìm thấy giao dịch');
  if (outcome === 'wrong-amount') throw new HttpError(400, 'Số tiền không khớp với giao dịch');
  res.json({ bookingId: payment.booking_id, status: payment.status, responseCode });
});

// Server-to-server notification. VNPay only reaches it when this site has a public address.
const IPN_REPLIES = {
  'invalid-signature': { RspCode: '97', Message: 'Invalid signature' },
  'not-found': { RspCode: '01', Message: 'Order not found' },
  'wrong-amount': { RspCode: '04', Message: 'Invalid amount' },
  already: { RspCode: '02', Message: 'Order already confirmed' },
  unpaid: { RspCode: '00', Message: 'Confirm Success' },
  settled: { RspCode: '00', Message: 'Confirm Success' },
};

app.get('/api/payments/vnpay/ipn', async (req, res) => {
  try {
    const { outcome } = await applyVnpayResult(req.query, req.correlationId);
    res.json(IPN_REPLIES[outcome]);
  } catch (err) {
    req.log.error({ err }, 'vnpay ipn failed');
    res.json({ RspCode: '99', Message: 'Unknown error' });
  }
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
logger.info({ provider: PROVIDER }, 'payment provider');

serve(app, {
  pool,
  onShutdown: async () => {
    stopPublisher();
    await stopMessaging();
  },
});
