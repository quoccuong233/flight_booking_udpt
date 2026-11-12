import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

// vnp_ResponseCode values a customer is likely to meet in the sandbox.
const RESPONSE_MESSAGES = {
  11: 'Đã hết thời gian chờ thanh toán.',
  12: 'Thẻ hoặc tài khoản đang bị khóa.',
  13: 'Mã OTP không đúng.',
  24: 'Bạn đã hủy thanh toán.',
  51: 'Tài khoản không đủ số dư.',
  65: 'Tài khoản đã vượt hạn mức giao dịch trong ngày.',
  75: 'Ngân hàng đang bảo trì.',
  79: 'Nhập sai mật khẩu thanh toán quá số lần cho phép.',
};

// VNPay sends the browser here. Payment checks VNPay's signature and records the result,
// then the checkout page waits for the booking saga to confirm the ticket.
export default function VnpayReturnPage() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api(`/payments/vnpay/return${search}`)
      .then(({ bookingId, status, responseCode }) => {
        if (!active) return;
        const paid = status === 'SUCCEEDED';
        const message = status === 'PENDING'
          ? `${RESPONSE_MESSAGES[responseCode] ?? `Thanh toán chưa thành công (mã ${responseCode}).`} Bạn có thể thanh toán lại trong thời gian giữ ghế.`
          : '';
        navigate(`/bookings/${bookingId}/pay`, { replace: true, state: { paid, message } });
      })
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, [search, navigate]);

  if (!error) return <p className="muted" role="status">Đang xác nhận kết quả từ VNPay...</p>;
  return (
    <>
      <p className="alert alert-bad" role="alert">{error}</p>
      <Link className="button" to="/bookings">Xem vé của tôi</Link>
    </>
  );
}
