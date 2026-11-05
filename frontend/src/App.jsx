import {
  Link, NavLink, Navigate, Outlet, Route, Routes, useLocation,
} from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { PlaneIcon } from './components.jsx';
import UserMenu from './UserMenu.jsx';
import AccountPage from './pages/AccountPage.jsx';
import BookingsPage from './pages/BookingsPage.jsx';
import CheckoutPage from './pages/CheckoutPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import SeatsPage from './pages/SeatsPage.jsx';

function RequireAuth({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function Header() {
  const { user } = useAuth();

  return (
    <header className="header">
      <div className="container header-row">
        <Link to="/" className="brand">
          <span className="brand-mark"><PlaneIcon /></span>
          SkyBook
        </Link>
        <nav className="nav">
          <NavLink to="/" end>Tìm chuyến bay</NavLink>
          {user ? <UserMenu /> : <NavLink to="/login">Đăng nhập</NavLink>}
        </nav>
      </div>
    </header>
  );
}

// The home page has a full-width hero, so only the other pages sit in the container.
function ContainedPage() {
  return (
    <div className="container main">
      <Outlet />
    </div>
  );
}

export default function App() {
  return (
    <>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route element={<ContainedPage />}>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/flights/:flightId/seats"
              element={<RequireAuth><SeatsPage /></RequireAuth>}
            />
            <Route
              path="/bookings/:bookingId/pay"
              element={<RequireAuth><CheckoutPage /></RequireAuth>}
            />
            <Route path="/bookings" element={<RequireAuth><BookingsPage /></RequireAuth>} />
            <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="footer">
        <div className="container">SkyBook · Đồ án môn Hệ thống phân tán</div>
      </footer>
    </>
  );
}
