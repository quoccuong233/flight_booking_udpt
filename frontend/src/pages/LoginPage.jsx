import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { CheckIcon } from '../components.jsx';

const EMPTY_FORM = { email: '', password: '', fullName: '' };

const BENEFITS = [
  'Xem sơ đồ ghế và chọn đúng chỗ bạn thích',
  'Giữ ghế 10 phút trong lúc thanh toán',
  'Nhận email xác nhận ngay khi đặt xong',
];

export default function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to={location.state?.from ?? '/'} replace />;

  const isRegister = mode === 'register';
  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  // Login details, typed or filled in by the browser, must not carry over to a new account.
  const switchMode = () => {
    setMode(isRegister ? 'login' : 'register');
    setForm(EMPTY_FORM);
    setError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      login(await api(`/auth/${mode}`, { method: 'POST', body: form }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="auth">
      <div className="auth-side">
        <p className="eyebrow">Chào mừng đến SkyBook</p>
        <h2>Đăng nhập một lần, đặt vé trong vài bước.</h2>
        <ul>
          {BENEFITS.map((benefit) => <li key={benefit}><CheckIcon />{benefit}</li>)}
        </ul>
      </div>
      <div className="auth-form">
        <h1>{isRegister ? 'Tạo tài khoản' : 'Đăng nhập'}</h1>
        <form key={mode} onSubmit={submit} className="form" autoComplete={isRegister ? 'off' : 'on'}>
          {isRegister && (
            <label>
              Họ tên
              <input value={form.fullName} onChange={update('fullName')} required autoComplete="name" />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={update('email')}
              required
              autoComplete={isRegister ? 'off' : 'email'}
            />
          </label>
          <label>
            Mật khẩu
            <input
              type="password"
              value={form.password}
              onChange={update('password')}
              required
              minLength={isRegister ? 6 : undefined}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
          </label>
          {error && <p className="alert alert-bad" role="alert">{error}</p>}
          <button type="submit" className="button" disabled={submitting}>
            {submitting ? 'Đang xử lý...' : isRegister ? 'Đăng ký' : 'Đăng nhập'}
          </button>
        </form>
        <button
          type="button"
          className="link-button auth-switch"
          onClick={switchMode}
        >
          {isRegister ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký'}
        </button>
      </div>
    </section>
  );
}
