import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { FlightCard, seatsLeftLabel, SwapIcon } from '../components.jsx';
import {
  addDays, airportName, cityName, formatMoney, formatShortDate, formatTime, todayInVietnam,
} from '../format.js';

const DEFAULT_FORM = { origin: 'HAN', destination: 'SGN', sort: 'depart' };
const SORT_OPTIONS = [
  { value: 'depart', label: 'Bay sớm nhất' },
  { value: 'price', label: 'Giá thấp nhất' },
];
const LOADING_CARDS = [0, 1, 2, 3];
const STRIP_DAYS = 7;
const STRIP_DAYS_BEFORE = 3;

const firstFlightDate = () => addDays(todayInVietnam(), 1);

function HeroMap() {
  return (
    <svg className="hero-map" viewBox="0 0 360 300" aria-hidden="true">
      <path className="hero-arc" d="M90 34Q210 60 270 142" />
      <path className="hero-arc" d="M90 34Q30 150 200 252" />
      <path className="hero-arc" d="M270 142Q262 210 200 252" />
      <path className="hero-arc" d="M200 252Q140 290 76 276" />
      <path className="hero-arc hero-arc-live" d="M90 34Q30 150 200 252" />
      {[[90, 34, 'HAN'], [270, 142, 'DAD'], [200, 252, 'SGN'], [76, 276, 'PQC']].map(([x, y, code]) => (
        <g key={code}>
          <circle className="hero-dot-halo" cx={x} cy={y} r="11" />
          <circle className="hero-dot" cx={x} cy={y} r="4.5" />
          <text className="hero-city" x={x + 15} y={y + 5}>{code}</text>
        </g>
      ))}
    </svg>
  );
}

function DepartureBoard({ flights }) {
  return (
    <div className="board">
      <table>
        <thead>
          <tr>
            <th scope="col">Giờ bay</th>
            <th scope="col" className="board-flight">Chuyến</th>
            <th scope="col">Hành trình</th>
            <th scope="col" className="board-optional">Hãng</th>
            <th scope="col" className="board-optional">Ghế</th>
            <th scope="col" className="board-money">Giá vé</th>
            <th scope="col"><span className="visually-hidden">Đặt vé</span></th>
          </tr>
        </thead>
        <tbody>
          {flights.map((flight) => (
            <tr key={flight.id}>
              <td>
                <strong className="board-time">{formatTime(flight.departAt)}</strong>
                <span className="board-date">{formatShortDate(flight.departAt)}</span>
              </td>
              <td className="board-flight">{flight.flightNo}</td>
              <td className="board-route">{flight.origin} → {flight.destination}</td>
              <td className="board-optional board-plain">{flight.airline}</td>
              <td className="board-optional board-plain">{seatsLeftLabel(flight)}</td>
              <td className="board-money">{formatMoney(flight.price)}</td>
              <td className="board-action">
                <Link to={`/flights/${flight.id}/seats`}>Chọn</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Suggestions() {
  const [flights, setFlights] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api('/search/suggestions')
      .then((result) => active && setFlights(result.upcoming))
      .catch((err) => active && setError(err.message));
    return () => { active = false; };
  }, []);

  if (error) return <p className="alert alert-bad" role="alert">{error}</p>;

  return (
    <section className="section" aria-label="Chuyến sắp khởi hành">
      <div className="section-head">
        <h2>Sắp khởi hành</h2>
        <p className="muted">Những chuyến gần nhất còn nhận đặt chỗ, bấm Chọn để chọn ghế ngay.</p>
      </div>
      {!flights && <div className="skeleton skeleton-board" />}
      {flights?.length === 0 && <p className="empty">Chưa có chuyến bay nào đang mở bán.</p>}
      {flights?.length > 0 && <DepartureBoard flights={flights} />}
    </section>
  );
}

function DateStrip({ selected, onSelect }) {
  const first = firstFlightDate();
  const centered = selected ? addDays(selected, -STRIP_DAYS_BEFORE) : first;
  const start = centered > first ? centered : first;
  const days = Array.from({ length: STRIP_DAYS }, (_, index) => addDays(start, index));

  return (
    <div className="date-strip" role="group" aria-label="Chọn ngày bay">
      {days.map((day) => (
        <button
          key={day}
          type="button"
          className={day === selected ? 'date-active' : ''}
          aria-pressed={day === selected}
          onClick={() => onSelect(day)}
        >
          {formatShortDate(day)}
        </button>
      ))}
    </div>
  );
}

function SearchResults({
  params, flights, loading, onSort, onDate, onReset,
}) {
  const sort = params.get('sort') ?? DEFAULT_FORM.sort;
  const date = params.get('date');

  return (
    <section className="section" aria-label="Kết quả tìm kiếm">
      <div className="results-head">
        <div>
          <h2>{cityName(params.get('origin'))} → {cityName(params.get('destination'))}</h2>
          <p className="muted">{flights ? `${flights.length} chuyến bay` : 'Đang tìm chuyến bay...'}</p>
        </div>
        <div className="segmented" role="group" aria-label="Sắp xếp">
          {SORT_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={sort === value ? 'segmented-active' : ''}
              aria-pressed={sort === value}
              onClick={() => onSort(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <DateStrip selected={date} onSelect={onDate} />

      {loading && LOADING_CARDS.map((index) => <div key={index} className="skeleton skeleton-flight" />)}
      {!loading && flights?.length === 0 && (
        <div className="empty">
          <p>Không có chuyến bay phù hợp, hãy thử ngày hoặc chặng khác.</p>
          <button type="button" className="button button-quiet" onClick={onReset}>Về trang chủ</button>
        </div>
      )}
      {!loading && flights?.length > 0 && (
        <div className="flight-list">
          {flights.map((flight) => <FlightCard key={flight.id} flight={flight} />)}
        </div>
      )}
      {!loading && flights?.length > 0 && (
        <button type="button" className="link-button results-back" onClick={onReset}>
          Về trang chủ
        </button>
      )}
    </section>
  );
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [airports, setAirports] = useState(['HAN', 'SGN']);
  const [form, setForm] = useState(() => ({
    ...DEFAULT_FORM, date: firstFlightDate(), ...Object.fromEntries(params),
  }));
  const [flights, setFlights] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const searching = Boolean(params.get('origin'));

  useEffect(() => {
    api('/search/airports')
      .then(({ airports: codes }) => codes.length > 0 && setAirports(codes))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!searching) {
      setFlights(null);
      setError('');
      return undefined;
    }

    let active = true;
    setLoading(true);
    setError('');
    api(`/search?${params}`)
      .then((result) => active && setFlights(result.flights))
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [params, searching]);

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  const swap = () => setForm({ ...form, origin: form.destination, destination: form.origin });

  const submit = (event) => {
    event.preventDefault();
    if (form.origin === form.destination) {
      setError('Điểm đi và điểm đến phải khác nhau');
      return;
    }
    setError('');
    setParams(form);
  };

  const refine = (field) => (value) => {
    setForm({ ...form, [field]: value });
    setParams({ ...Object.fromEntries(params), [field]: value });
  };

  return (
    <>
      <section className={searching ? 'hero hero-compact' : 'hero'}>
        {!searching && (
          <div className="container hero-inner">
            <div className="hero-copy">
              <p className="eyebrow">Vé máy bay nội địa</p>
              <h1>Hôm nay bạn muốn bay đến đâu?</h1>
              <p className="hero-lead">
                Xem các chuyến sắp khởi hành, chọn chỗ trên sơ đồ ghế và giữ chỗ 10 phút để thanh toán.
              </p>
            </div>
            <HeroMap />
          </div>
        )}
      </section>

      <div className="container page-body">
        <form className="search-form" onSubmit={submit}>
          <label>
            Điểm đi
            <select value={form.origin} onChange={update('origin')}>
              {airports.map((code) => <option key={code} value={code}>{airportName(code)}</option>)}
            </select>
          </label>
          <button type="button" className="swap" aria-label="Đổi điểm đi và điểm đến" onClick={swap}>
            <SwapIcon />
          </button>
          <label>
            Điểm đến
            <select value={form.destination} onChange={update('destination')}>
              {airports.map((code) => <option key={code} value={code}>{airportName(code)}</option>)}
            </select>
          </label>
          <label>
            Ngày đi
            <input
              type="date"
              min={todayInVietnam()}
              value={form.date}
              onChange={update('date')}
              required
            />
          </label>
          <button type="submit" className="button">Tìm chuyến</button>
        </form>

        {error && <p className="alert alert-bad" role="alert">{error}</p>}
        {searching
          ? (
            <SearchResults
              params={params}
              flights={flights}
              loading={loading}
              onSort={refine('sort')}
              onDate={refine('date')}
              onReset={() => setParams({})}
            />
          )
          : <Suggestions />}
      </div>
    </>
  );
}
