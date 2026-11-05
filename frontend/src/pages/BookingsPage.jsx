import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Ticket } from '../components.jsx';
import { CANCEL_REASONS, formatDate, formatTime } from '../format.js';
import { useFlights } from '../useFlights.js';

export default function BookingsPage() {
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');
  const flights = useFlights(bookings?.map((booking) => booking.flightId) ?? []);

  useEffect(() => {
    api('/bookings').then((result) => setBookings(result.bookings))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <section>
      <div className="page-head">
        <h1>Vé của tôi</h1>
        {bookings?.length > 0 && <p className="muted">{bookings.length} vé</p>}
      </div>
      {error && <p className="alert alert-bad" role="alert">{error}</p>}
      {!bookings && !error && <p className="muted">Đang tải...</p>}
      {bookings?.length === 0 && (
        <div className="empty">
          <p>Bạn chưa có vé nào.</p>
          <Link className="button" to="/">Xem chuyến bay gợi ý</Link>
        </div>
      )}
      <div className="booking-list">
        {bookings?.map((booking) => (
          <Ticket key={booking.id} booking={booking} flight={flights[booking.flightId]}>
            <span className="muted small">
              Đặt lúc {formatTime(booking.createdAt)}, {formatDate(booking.createdAt)}
            </span>
            {booking.cancelReason && (
              <span className="muted small">{CANCEL_REASONS[booking.cancelReason]}</span>
            )}
            {booking.status === 'PENDING' && (
              <Link className="button button-small" to={`/bookings/${booking.id}/pay`}>Thanh toán</Link>
            )}
          </Ticket>
        ))}
      </div>
    </section>
  );
}
