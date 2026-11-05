import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { PlaneIcon, Steps } from '../components.jsx';
import {
  cityName, formatDate, formatDuration, formatMoney, formatTime,
} from '../format.js';

const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F'];
const RETRIES_AFTER_NETWORK_ERROR = 1;

function groupByRow(seats) {
  const rows = new Map();
  for (const seat of seats) {
    const row = Number.parseInt(seat.seatId, 10);
    if (!rows.has(row)) rows.set(row, new Map());
    rows.get(row).set(seat.seatId.replace(String(row), ''), seat);
  }
  return [...rows.entries()].sort(([a], [b]) => a - b);
}

function Seat({ seat, selected, onSelect }) {
  if (!seat) return <span className="seat seat-empty" />;

  const taken = seat.status !== 'AVAILABLE';
  const className = [
    'seat',
    taken && (seat.mine ? 'seat-mine' : 'seat-taken'),
    selected && 'seat-selected',
  ].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={className}
      disabled={taken}
      aria-pressed={selected}
      aria-label={`Ghế ${seat.seatId}${taken ? ', đã có người đặt' : ''}`}
      onClick={() => onSelect(seat.seatId)}
    >
      {seat.seatId}
    </button>
  );
}

export default function SeatsPage() {
  const { flightId } = useParams();
  const navigate = useNavigate();
  const [flight, setFlight] = useState(null);
  const [seats, setSeats] = useState(null);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // One key per attempt: every resend of this attempt reuses it, so the server
  // returns the original booking instead of creating another.
  const idempotencyKey = useRef(null);

  const loadSeats = useCallback(async () => {
    const result = await api(`/bookings/flights/${flightId}/seats`);
    setSeats(result.seats);
  }, [flightId]);

  useEffect(() => {
    Promise.all([api(`/flights/${flightId}`).then(setFlight), loadSeats()])
      .catch((err) => setError(err.message));
  }, [flightId, loadSeats]);

  const rows = useMemo(() => groupByRow(seats ?? []), [seats]);
  const freeSeats = seats?.filter((seat) => seat.status === 'AVAILABLE').length;

  const selectSeat = (seatId) => {
    idempotencyKey.current = crypto.randomUUID();
    setSelectedSeat(seatId);
    setError('');
  };

  const book = async () => {
    setSubmitting(true);
    setError('');
    const request = {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey.current },
      body: { flightId, seatId: selectedSeat },
    };

    for (let attempt = 0; ; attempt += 1) {
      try {
        const booking = await api('/bookings', request);
        navigate(`/bookings/${booking.id}/pay`);
        return;
      } catch (err) {
        if (err.status === 0 && attempt < RETRIES_AFTER_NETWORK_ERROR) continue;
        setError(err.message);
        if (err.code === 'SEAT_TAKEN') {
          setSelectedSeat(null);
          await loadSeats().catch(() => {});
        }
        setSubmitting(false);
        return;
      }
    }
  };

  return (
    <>
      <Steps current={0} />
      <section className="seats-layout">
        <div className="seat-panel">
          <div className="page-head">
            <h1>Chọn chỗ ngồi</h1>
            {seats?.length > 0 && <p className="muted">Còn {freeSeats}/{seats.length} ghế trống</p>}
          </div>
          <ul className="legend">
            <li><span className="seat seat-sample" /> Còn trống</li>
            <li><span className="seat seat-sample seat-selected" /> Đang chọn</li>
            <li><span className="seat seat-sample seat-taken" /> Đã đặt</li>
            <li><span className="seat seat-sample seat-mine" /> Vé của bạn</li>
          </ul>
          {!seats && !error && <p className="muted">Đang tải sơ đồ ghế...</p>}
          {seats?.length === 0 && <p className="muted">Sơ đồ ghế đang được chuẩn bị, hãy tải lại sau.</p>}
          {rows.length > 0 && (
            <div className="cabin">
              <div className="cabin-nose"><PlaneIcon /></div>
              <div className="seat-map">
                <div className="seat-row seat-columns" aria-hidden="true">
                  {COLUMNS.slice(0, 3).map((column) => <span key={column}>{column}</span>)}
                  <span className="seat-aisle" />
                  {COLUMNS.slice(3).map((column) => <span key={column}>{column}</span>)}
                </div>
                {rows.map(([row, columns]) => (
                  <div className="seat-row" key={row}>
                    {COLUMNS.slice(0, 3).map((column) => (
                      <Seat
                        key={column}
                        seat={columns.get(column)}
                        selected={columns.get(column)?.seatId === selectedSeat}
                        onSelect={selectSeat}
                      />
                    ))}
                    <span className="seat-aisle">{row}</span>
                    {COLUMNS.slice(3).map((column) => (
                      <Seat
                        key={column}
                        seat={columns.get(column)}
                        selected={columns.get(column)?.seatId === selectedSeat}
                        onSelect={selectSeat}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="summary">
          <div className="summary-top">
            <span className="eyebrow">Chuyến bay của bạn</span>
            {flight && (
              <div className="summary-route">
                <div>
                  <strong>{flight.origin}</strong>
                  <span>{cityName(flight.origin)}</span>
                </div>
                <PlaneIcon className="summary-plane" />
                <div>
                  <strong>{flight.destination}</strong>
                  <span>{cityName(flight.destination)}</span>
                </div>
              </div>
            )}
          </div>
          <div className="summary-body">
            {flight && (
              <dl className="details">
                <dt>Chuyến bay</dt>
                <dd>{flight.airline} · {flight.flightNo}</dd>
                <dt>Khởi hành</dt>
                <dd>{formatTime(flight.departAt)}, {formatDate(flight.departAt)}</dd>
                <dt>Thời gian bay</dt>
                <dd>{formatDuration(flight.departAt, flight.arriveAt)}</dd>
                <dt>Ghế</dt>
                <dd className="summary-seat">{selectedSeat ?? 'Chưa chọn'}</dd>
                <dt>Giá vé</dt>
                <dd className="price">{formatMoney(flight.price)}</dd>
              </dl>
            )}
            {error && <p className="alert alert-bad" role="alert">{error}</p>}
            <button
              type="button"
              className="button button-wide"
              disabled={!selectedSeat || submitting}
              onClick={book}
            >
              {submitting ? 'Đang giữ ghế...' : 'Giữ ghế và thanh toán'}
            </button>
            <p className="muted small">Ghế được giữ trong 10 phút để bạn thanh toán.</p>
          </div>
        </aside>
      </section>
    </>
  );
}
