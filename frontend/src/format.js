const TIME_ZONE = 'Asia/Ho_Chi_Minh';

export const CITY_NAMES = {
  HAN: 'Hà Nội',
  SGN: 'TP. Hồ Chí Minh',
  DAD: 'Đà Nẵng',
  PQC: 'Phú Quốc',
};

export const cityName = (code) => CITY_NAMES[code] ?? code;

export const airportName = (code) => (CITY_NAMES[code] ? `${CITY_NAMES[code]} (${code})` : code);

export const formatMoney = (amount) => `${Number(amount).toLocaleString('vi-VN')} ₫`;

export const formatTime = (value) => new Date(value).toLocaleTimeString('vi-VN', {
  hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE,
});

export const formatDate = (value) => new Date(value).toLocaleDateString('vi-VN', {
  weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TIME_ZONE,
});

export const formatShortDate = (value) => new Date(value).toLocaleDateString('vi-VN', {
  weekday: 'short', day: '2-digit', month: '2-digit', timeZone: TIME_ZONE,
});

// en-CA formats as YYYY-MM-DD, the value a date input expects.
export const todayInVietnam = () => new Date().toLocaleDateString('en-CA', { timeZone: TIME_ZONE });

export function addDays(date, days) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function formatDuration(from, to) {
  const minutes = Math.round((new Date(to) - new Date(from)) / 60000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}g ${minutes % 60}p` : `${minutes}p`;
}

export const BOOKING_STATUS = {
  PENDING: { label: 'Chờ thanh toán', tone: 'warning' },
  CONFIRMED: { label: 'Đã xác nhận', tone: 'good' },
  CANCELLED: { label: 'Đã hủy', tone: 'bad' },
};

export const CANCEL_REASONS = {
  HOLD_EXPIRED: 'Hết thời gian giữ ghế',
  PAYMENT_FAILED: 'Thanh toán không thành công',
};
