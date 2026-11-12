import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { CheckIcon, Steps, Ticket } from '../components.jsx';
import { CANCEL_REASONS, formatMoney } from '../format.js';
import { useFlights } from '../useFlights.js';

const POLL_INTERVAL_MS = 1000;
const NOT_READY_RETRIES = 5;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function useCountdown(expiresAt) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!expiresAt) return null;
  return Math.max(0, Math.floor((new Date(expiresAt) - now) / 1000));
}

function Result({ booking, flight }) {
  const confirmed = booking.status === 'CONFIRMED';

  return (
    <section className="result">
      <span className={`result-mark${confirmed ? '' : ' result-mark-bad'}`}>
        {confirmed ? <CheckIcon /> : '!'}
      </span>
      <h1>{confirmed ? 'Đặt vé thành công' : 'Đặt vé không thành công'}</h1>
      <p className="muted">
        {confirmed
          ? `Ghế ${booking.seatId} chuyến ${booking.flightNo} đã thuộc về bạn. Email xác nhận đang được gửi.`
          : CANCEL_REASONS[booking.cancelReason] ?? 'Booking đã bị hủy.'}
      </p>
      <Ticket booking={booking} flight={flight} />
      <div className="actions">
        <Link className="button" to="/bookings">Xem vé của tôi</Link>
        <Link className="button button-quiet" to="/">Tìm chuyến khác</Link>
      </div>
    </section>
  );
}

export default function CheckoutPage() {
  const { bookingId } = useParams();
  // Set by VnpayReturnPage when the customer comes back from VNPay.
  const { state: returned } = useLocation();
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState(returned?.message ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [waiting, setWaiting] = useState(Boolean(returned?.paid));
  const secondsLeft = useCountdown(booking?.holdExpiresAt);
  const flights = useFlights([booking?.flightId]);
  const flight = flights[booking?.flightId];

  useEffect(() => {
    api(`/bookings/${bookingId}`).then(setBooking).catch((err) => setError(err.message));
  }, [bookingId]);

  // The saga finishes asynchronously, so the result is read back from Booking.
  useEffect(() => {
    if (!waiting && secondsLeft !== 0) return undefined;
    if (booking?.status !== 'PENDING') return undefined;

    const timer = setInterval(() => {
      api(`/bookings/${bookingId}`)
        .then((latest) => latest.status !== 'PENDING' && setBooking(latest))
        .catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [waiting, secondsLeft, booking?.status, bookingId]);

  const pay = async () => {
    setSubmitting(true);
    setError('');
    const request = { method: 'POST', body: { bookingId } };

    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await api('/payments', request);
        // VNPay: leave the site to pay; VNPay sends the browser back to /payment/vnpay-return.
        if (result.payUrl) {
          window.location.assign(result.payUrl);
          return;
        }
        setWaiting(true);
        return;
      } catch (err) {
        if (err.code === 'PAYMENT_NOT_READY' && attempt < NOT_READY_RETRIES) {
          await wait(POLL_INTERVAL_MS);
          continue;
        }
        setError(err.message);
        setSubmitting(false);
        return;
      }
    }
  };

  if (!booking) {
    return error
      ? <p className="alert alert-bad" role="alert">{error}</p>
      : <p className="muted">Đang tải...</p>;
  }
  if (booking.status !== 'PENDING') {
    return (
      <>
        <Steps current={2} />
        <Result booking={booking} flight={flight} />
      </>
    );
  }

  const minutes = String(Math.floor((secondsLeft ?? 0) / 60)).padStart(2, '0');
  const seconds = String((secondsLeft ?? 0) % 60).padStart(2, '0');

  return (
    <>
      <Steps current={1} />
      <section className="checkout">
        <div className="checkout-ticket">
          <div className="page-head">
            <h1>Thanh toán</h1>
            <span className="countdown" role="timer">Giữ ghế {minutes}:{seconds}</span>
          </div>
          <Ticket booking={booking} flight={flight} />
        </div>
        <div className="panel">
          <dl className="details">
            <dt>Tổng tiền</dt>
            <dd className="price">{formatMoney(booking.amount)}</dd>
          </dl>
          {waiting ? (
            <p className="muted" role="status">Đang xác nhận giao dịch...</p>
          ) : (
            <>
              {error && <p className="alert alert-bad" role="alert">{error}</p>}
              <button
                type="button"
                className="button button-wide"
                disabled={submitting || secondsLeft === 0}
                onClick={pay}
              >
                {submitting ? 'Đang chuyển tới cổng thanh toán...' : 'Thanh toán'}
              </button>
              <p className="muted small pay-note">Thanh toán qua cổng VNPay. Vé được xác nhận ngay sau khi thanh toán.</p>
            </>
          )}
        </div>
      </section>
    </>
  );
}
