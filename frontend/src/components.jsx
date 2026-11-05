import { Link } from 'react-router-dom';
import {
  BOOKING_STATUS, cityName, formatDuration, formatMoney, formatShortDate, formatTime,
} from './format.js';

const LOW_SEATS = 10;
const BOOKING_STEPS = ['Chọn ghế', 'Thanh toán', 'Hoàn tất'];

export const seatsLeftLabel = (flight) => (flight.availableSeats <= LOW_SEATS
  ? `Chỉ còn ${flight.availableSeats} ghế`
  : `Còn ${flight.availableSeats} ghế`);

export function PlaneIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" />
    </svg>
  );
}

function StrokeIcon({ path, className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export const SwapIcon = (props) => <StrokeIcon path="M7 20V4m0 0L3 8m4-4 4 4m6-4v16m0 0 4-4m-4 4-4-4" {...props} />;
export const CheckIcon = (props) => <StrokeIcon path="M5 13l4 4L19 7" {...props} />;
export const ArrowIcon = (props) => <StrokeIcon path="M5 12h14m-6-6 6 6-6 6" {...props} />;
export const UserIcon = (props) => <StrokeIcon path="M20 21a8 8 0 0 0-16 0M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8" {...props} />;
export const TicketIcon = (props) => <StrokeIcon path="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4zm11-2v12" {...props} />;
export const CameraIcon = (props) => <StrokeIcon path="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1m8 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8" {...props} />;
export const LogoutIcon = (props) => <StrokeIcon path="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9" {...props} />;

function hashText(text) {
  let hash = 0;
  for (const character of text) {
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

// The user's picture, or a mirrored 5x5 pattern unique to them until they add one.
export function Avatar({ seed, image }) {
  if (image) return <img className="avatar" src={image} alt="" />;

  const hash = hashText(seed);
  const hue = hash % 360;
  const cells = [];
  for (let column = 0; column < 3; column += 1) {
    for (let row = 0; row < 5; row += 1) {
      if ((hash >>> (column * 5 + row)) & 1) {
        cells.push([column, row], [4 - column, row]);
      }
    }
  }

  return (
    <svg className="avatar" viewBox="-1 -1 7 7" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="-1" y="-1" width="7" height="7" fill={`hsl(${hue} 60% 92%)`} />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={`hsl(${hue} 65% 42%)`} />
      ))}
    </svg>
  );
}

export function FlightCard({ flight }) {
  const soldOut = flight.availableSeats === 0;

  return (
    <article className="pass flight">
      <div className="pass-main">
        <div className="flight-airline">
          <strong>{flight.airline}</strong>
          <span className="muted">{flight.flightNo}</span>
        </div>
        <div className="flight-times">
          <div className="flight-point">
            <strong>{formatTime(flight.departAt)}</strong>
            <span className="muted">{flight.origin}</span>
          </div>
          <div className="flight-line">
            <span className="muted">{formatDuration(flight.departAt, flight.arriveAt)}</span>
            <span className="flight-rule"><PlaneIcon className="flight-plane" /></span>
            <span className="muted">{formatShortDate(flight.departAt)}</span>
          </div>
          <div className="flight-point">
            <strong>{formatTime(flight.arriveAt)}</strong>
            <span className="muted">{flight.destination}</span>
          </div>
        </div>
      </div>
      <div className="pass-stub flight-buy">
        <strong className="price">{formatMoney(flight.price)}</strong>
        <span className={flight.availableSeats <= LOW_SEATS ? 'seats-low' : 'muted'}>
          {soldOut ? 'Hết ghế' : seatsLeftLabel(flight)}
        </span>
        {soldOut
          ? <span className="button button-disabled">Hết ghế</span>
          : <Link className="button" to={`/flights/${flight.id}/seats`}>Chọn ghế</Link>}
      </div>
    </article>
  );
}

export function Steps({ current }) {
  return (
    <ol className="steps">
      {BOOKING_STEPS.map((label, index) => {
        const done = index < current;
        return (
          <li
            key={label}
            className={`step${done ? ' step-done' : ''}${index === current ? ' step-current' : ''}`}
            aria-current={index === current ? 'step' : undefined}
          >
            <span className="step-mark">{done ? <CheckIcon /> : index + 1}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

export function Ticket({ booking, flight, children }) {
  const status = BOOKING_STATUS[booking.status];

  return (
    <article className={`pass ticket ticket-${status.tone}`}>
      <div className="pass-main">
        <div className="ticket-head">
          <span className="ticket-carrier">
            {flight?.airline ?? 'Chuyến bay'} · {booking.flightNo}
          </span>
          <span className={`badge badge-${status.tone}`}>{status.label}</span>
        </div>
        {flight && (
          <div className="ticket-route">
            <div>
              <strong>{flight.origin}</strong>
              <span className="muted">{cityName(flight.origin)}</span>
            </div>
            <PlaneIcon className="ticket-plane" />
            <div>
              <strong>{flight.destination}</strong>
              <span className="muted">{cityName(flight.destination)}</span>
            </div>
          </div>
        )}
        <dl className="ticket-facts">
          {flight && (
            <div>
              <dt>Khởi hành</dt>
              <dd>{formatTime(flight.departAt)}, {formatShortDate(flight.departAt)}</dd>
            </div>
          )}
          <div>
            <dt>Ghế</dt>
            <dd>{booking.seatId}</dd>
          </div>
          <div>
            <dt>Mã đặt chỗ</dt>
            <dd>{booking.id.slice(0, 8).toUpperCase()}</dd>
          </div>
        </dl>
      </div>
      <div className="pass-stub ticket-stub">
        <strong className="price">{formatMoney(booking.amount)}</strong>
        {children}
        {booking.status === 'CONFIRMED' && <span className="barcode" aria-hidden="true" />}
      </div>
    </article>
  );
}
