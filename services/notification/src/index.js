const nodemailer = require('nodemailer');
const {
  consume, createApp, createPool, logger, serve, startMessaging,
} = require('@flight/common');

const CANCEL_REASONS = {
  HOLD_EXPIRED: 'hết thời gian giữ ghế',
  PAYMENT_FAILED: 'thanh toán không thành công',
};

const pool = createPool();
const app = createApp({ pool });

const SEND_TIMEOUT_MS = 10000;
const SENDER = process.env.MAIL_RELAY_USER || 'no-reply@flight.local';

function createRelay() {
  const { MAIL_RELAY_HOST: host, MAIL_RELAY_USER: user, MAIL_RELAY_PASS: pass } = process.env;
  if (!host) return null;

  const port = Number(process.env.MAIL_RELAY_PORT);
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: Boolean(user),
    auth: user ? { user, pass } : undefined,
    connectionTimeout: SEND_TIMEOUT_MS,
    greetingTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  });
}

const relay = createRelay();

// .local addresses can never be delivered, and a mail server is optional. Skipping keeps
// test accounts and machines without one out of the dead letter queue.
const canDeliver = (address) => relay && !address.endsWith('.local');

if (relay) {
  relay.verify()
    .then(() => logger.info('mail relay ready'))
    .catch((err) => logger.error({ err: err.message }, 'mail relay unavailable'));
} else {
  logger.warn('MAIL_RELAY_HOST is not set: emails will be skipped');
}

const formatMoney = (amount) => `${amount.toLocaleString('vi-VN')} VND`;

const templates = {
  'user.registered': (data) => ({
    subject: 'Chào mừng bạn đến với SkyBook',
    text: `Xin chào ${data.full_name},\n\nTài khoản SkyBook của bạn đã được tạo với email `
      + `${data.user_email}.\nBây giờ bạn có thể chọn chuyến bay, chọn ghế và đặt vé.\n`,
  }),
  'user.password_changed': (data) => ({
    subject: 'Mật khẩu SkyBook của bạn vừa được đổi',
    text: `Xin chào ${data.full_name},\n\nMật khẩu tài khoản SkyBook của bạn vừa được đổi.\n`
      + 'Nếu không phải bạn thực hiện, hãy đổi lại mật khẩu ngay.\n',
  }),
  'booking.confirmed': (data) => ({
    subject: `Xác nhận đặt vé chuyến ${data.flight_no}`,
    text: `Đặt vé thành công.\n\nChuyến bay: ${data.flight_no}\nGhế: ${data.seat_id}\n`
      + `Số tiền: ${formatMoney(data.amount)}\nMã đặt chỗ: ${data.booking_id}\n`,
  }),
  'booking.cancelled': (data) => ({
    subject: `Đặt vé chuyến ${data.flight_no} đã bị hủy`,
    text: `Booking của bạn đã bị hủy vì ${CANCEL_REASONS[data.reason] ?? 'lý do hệ thống'}.\n\n`
      + `Chuyến bay: ${data.flight_no}\nGhế: ${data.seat_id}\nMã đặt chỗ: ${data.booking_id}\n`,
  }),
};

consume(pool, {
  queue: 'notification.events',
  routingKeys: Object.keys(templates),
  handler: async (client, event, log) => {
    const { subject, text } = templates[event.type](event.data);
    const details = {
      emailType: event.type,
      userId: event.data.user_id,
      bookingId: event.data.booking_id,
    };
    if (!canDeliver(event.data.user_email)) {
      log.info(details, 'email skipped');
      return;
    }

    await relay.sendMail({
      from: `SkyBook <${SENDER}>`,
      to: event.data.user_email,
      subject,
      text,
    });
    log.info(details, 'email sent');
  },
});

const stopMessaging = startMessaging();
serve(app, { pool, onShutdown: stopMessaging });
