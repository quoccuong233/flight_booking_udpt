import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { toAvatarImage } from '../avatarImage.js';
import { Avatar, CameraIcon, Ticket } from '../components.jsx';
import { formatDate, formatMoney } from '../format.js';
import { useFlights } from '../useFlights.js';

const ROLE_LABELS = { admin: 'Quản trị viên', user: 'Khách hàng' };
const EMPTY_PASSWORDS = { currentPassword: '', newPassword: '', confirmPassword: '' };

function useAvatarUpload(onSaved) {
  const { updateUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const run = async (request) => {
    setSaving(true);
    setError('');
    try {
      const { user } = await request();
      updateUser(user);
      onSaved(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const upload = (file) => run(async () => api('/auth/me/avatar', {
    method: 'PUT',
    body: { image: await toAvatarImage(file) },
  }));
  const remove = () => run(() => api('/auth/me/avatar', { method: 'DELETE' }));

  return { upload, remove, saving, error };
}

function ProfileForm({ profile, onSaved }) {
  const { login } = useAuth();
  const [fullName, setFullName] = useState(profile.fullName);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setNotice('');
    setError('');
    try {
      const session = await api('/auth/me', { method: 'PATCH', body: { fullName } });
      login(session);
      onSaved(session.user);
      setNotice('Đã cập nhật họ tên');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="panel form" onSubmit={submit}>
      <h2>Thông tin cá nhân</h2>
      <label>
        Họ tên
        <input
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          maxLength={100}
          required
          autoComplete="name"
        />
      </label>
      <label>
        Email
        <input value={profile.email} disabled />
      </label>
      {error && <p className="alert alert-bad" role="alert">{error}</p>}
      {notice && <p className="alert alert-good" role="status">{notice}</p>}
      <button type="submit" className="button" disabled={submitting || fullName.trim() === profile.fullName}>
        {submitting ? 'Đang lưu...' : 'Lưu thay đổi'}
      </button>
    </form>
  );
}

function PasswordForm() {
  const [form, setForm] = useState(EMPTY_PASSWORDS);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  const submit = async (event) => {
    event.preventDefault();
    setNotice('');
    if (form.newPassword !== form.confirmPassword) {
      setError('Mật khẩu nhập lại không khớp');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await api('/auth/me/password', {
        method: 'POST',
        body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
      });
      setForm(EMPTY_PASSWORDS);
      setNotice('Đã đổi mật khẩu');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="panel form" onSubmit={submit}>
      <h2>Đổi mật khẩu</h2>
      <label>
        Mật khẩu hiện tại
        <input
          type="password"
          value={form.currentPassword}
          onChange={update('currentPassword')}
          required
          autoComplete="current-password"
        />
      </label>
      <label>
        Mật khẩu mới
        <input
          type="password"
          value={form.newPassword}
          onChange={update('newPassword')}
          required
          minLength={6}
          autoComplete="new-password"
        />
      </label>
      <label>
        Nhập lại mật khẩu mới
        <input
          type="password"
          value={form.confirmPassword}
          onChange={update('confirmPassword')}
          required
          minLength={6}
          autoComplete="new-password"
        />
      </label>
      {error && <p className="alert alert-bad" role="alert">{error}</p>}
      {notice && <p className="alert alert-good" role="status">{notice}</p>}
      <button type="submit" className="button" disabled={submitting}>
        {submitting ? 'Đang đổi...' : 'Đổi mật khẩu'}
      </button>
    </form>
  );
}

// Ticket stats and the next trip come from the booking service. They load on their own so the
// profile (auth service) still shows when booking is down, and the other way round.
function BookingSummary() {
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const confirmed = bookings?.filter((booking) => booking.status === 'CONFIRMED') ?? [];
  const flights = useFlights(confirmed.map((booking) => booking.flightId));
  const nextTrip = confirmed
    .filter((booking) => new Date(flights[booking.flightId]?.departAt) > new Date())
    .sort((a, b) => new Date(flights[a.flightId].departAt) - new Date(flights[b.flightId].departAt))[0];

  const load = () => {
    setLoading(true);
    setError('');
    api('/bookings')
      .then((result) => setBookings(result.bookings))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (error) {
    return (
      <div className="panel">
        <p className="alert alert-bad" role="alert">Không tải được thông tin vé: {error}</p>
        <button type="button" className="button" onClick={load} disabled={loading}>
          {loading ? 'Đang thử lại...' : 'Thử lại'}
        </button>
      </div>
    );
  }
  if (!bookings) return <p className="muted">Đang tải thông tin vé...</p>;

  const pending = bookings.filter((booking) => booking.status === 'PENDING').length;
  const spent = confirmed.reduce((total, booking) => total + booking.amount, 0);

  return (
    <>
      <dl className="stats">
        <div>
          <dt>Vé đã xác nhận</dt>
          <dd>{confirmed.length}</dd>
        </div>
        <div>
          <dt>Chờ thanh toán</dt>
          <dd>{pending}</dd>
        </div>
        <div>
          <dt>Tổng đã chi</dt>
          <dd>{formatMoney(spent)}</dd>
        </div>
      </dl>

      <div className="section">
        <div className="section-head">
          <h2>Chuyến sắp tới</h2>
        </div>
        {nextTrip
          ? <Ticket booking={nextTrip} flight={flights[nextTrip.flightId]} />
          : (
            <div className="empty">
              <p>Bạn chưa có chuyến bay nào sắp tới.</p>
              <Link className="button" to="/">Tìm chuyến bay</Link>
            </div>
          )}
      </div>
    </>
  );
}

export default function AccountPage() {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const fileInput = useRef(null);
  const avatar = useAvatarUpload(setProfile);

  useEffect(() => {
    api('/auth/me')
      .then((me) => setProfile(me.user))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="alert alert-bad" role="alert">{error}</p>;
  if (!profile) return <p className="muted">Đang tải...</p>;

  const chooseFile = (event) => {
    const file = event.target.files[0];
    event.target.value = ''; // lets the same file be picked again
    if (file) avatar.upload(file);
  };

  return (
    <section className="account">
      <div className="account-head">
        <button
          type="button"
          className="avatar-edit"
          aria-label="Đổi ảnh đại diện"
          title="Đổi ảnh đại diện"
          disabled={avatar.saving}
          onClick={() => fileInput.current.click()}
        >
          <Avatar seed={profile.id} image={profile.avatar} />
          <span className="avatar-badge"><CameraIcon /></span>
        </button>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept="image/*"
          tabIndex={-1}
          aria-hidden="true"
          onChange={chooseFile}
        />
        <div className="account-identity">
          <h1>{profile.fullName}</h1>
          <p>{profile.email}</p>
          <p className="account-meta">
            {ROLE_LABELS[profile.role]} · Thành viên từ {formatDate(profile.createdAt)}
          </p>
          <div className="avatar-actions">
            <button type="button" disabled={avatar.saving} onClick={() => fileInput.current.click()}>
              {avatar.saving ? 'Đang lưu ảnh...' : profile.avatar ? 'Đổi ảnh' : 'Thêm ảnh đại diện'}
            </button>
            {profile.avatar && (
              <button type="button" disabled={avatar.saving} onClick={avatar.remove}>Xóa ảnh</button>
            )}
          </div>
        </div>
      </div>
      {avatar.error && <p className="alert alert-bad" role="alert">{avatar.error}</p>}

      <BookingSummary />

      <div className="account-forms">
        <ProfileForm profile={profile} onSaved={setProfile} />
        <PasswordForm />
      </div>
    </section>
  );
}
