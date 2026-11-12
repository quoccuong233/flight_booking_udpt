const { createHmac, timingSafeEqual } = require('node:crypto');

// VNPay payment gateway, API version 2.1.0.
// https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html

const config = {
  tmnCode: process.env.VNPAY_TMN_CODE || '',
  hashSecret: process.env.VNPAY_HASH_SECRET || '',
  payUrl: process.env.VNPAY_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
  returnUrl: process.env.VNPAY_RETURN_URL || 'http://localhost:8000/payment/vnpay-return',
};

const enabled = Boolean(config.tmnCode && config.hashSecret);
const EXPIRE_MINUTES = 15;
const PAYMENT_ID_LENGTH = 32; // a UUID without dashes

// VNPay wants local Vietnam time (GMT+7) as yyyyMMddHHmmss.
function vnTime(date) {
  return new Date(date.getTime() + 7 * 3600 * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

// The exact encoding VNPay signs: keys sorted, values URI-encoded with spaces as '+'.
function signData(params) {
  return Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key]).replace(/%20/g, '+')}`)
    .join('&');
}

const sign = (data) => createHmac('sha512', config.hashSecret).update(data, 'utf8').digest('hex');

// A new reference for every attempt, since VNPay rejects a reused vnp_TxnRef.
// Its first 32 characters are the payment id, so the result maps back without extra storage.
const txnRef = (paymentId) => `${paymentId.replace(/-/g, '')}${Math.floor(Date.now() / 1000)}`;

function paymentIdFromTxnRef(ref) {
  const hex = String(ref ?? '').slice(0, PAYMENT_ID_LENGTH);
  if (!/^[0-9a-f]{32}$/i.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function buildPayUrl({ payment, ipAddr }) {
  const now = new Date();
  const params = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: config.tmnCode,
    vnp_Amount: String(payment.amount * 100),
    vnp_CurrCode: 'VND',
    vnp_TxnRef: txnRef(payment.id),
    // No Vietnamese accents or special characters: VNPay rejects them here.
    vnp_OrderInfo: `Thanh toan ve SkyBook ${payment.booking_id}`,
    vnp_OrderType: 'other',
    vnp_Locale: 'vn',
    vnp_ReturnUrl: config.returnUrl,
    vnp_IpAddr: ipAddr,
    vnp_CreateDate: vnTime(now),
    vnp_ExpireDate: vnTime(new Date(now.getTime() + EXPIRE_MINUTES * 60 * 1000)),
  };
  const data = signData(params);
  return `${config.payUrl}?${data}&vnp_SecureHash=${sign(data)}`;
}

// Checks a return or IPN query string that VNPay signed.
function verify(query) {
  const { vnp_SecureHash: received, vnp_SecureHashType: _type, ...params } = query ?? {};
  const fields = Object.entries(params).filter(([key]) => key.startsWith('vnp_'));
  const wellFormed = typeof received === 'string' && fields.every(([, value]) => typeof value === 'string');
  if (!wellFormed) return { valid: false };

  const expected = Buffer.from(sign(signData(Object.fromEntries(fields))), 'utf8');
  const actual = Buffer.from(received.toLowerCase(), 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { valid: false };

  return {
    valid: true,
    paymentId: paymentIdFromTxnRef(params.vnp_TxnRef),
    amount: Number(params.vnp_Amount) / 100,
    responseCode: params.vnp_ResponseCode,
    transactionNo: params.vnp_TransactionNo,
    success: params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00',
  };
}

module.exports = { buildPayUrl, enabled, verify };
