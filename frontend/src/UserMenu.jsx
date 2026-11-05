import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import {
  Avatar, LogoutIcon, TicketIcon, UserIcon,
} from './components.jsx';

const MENU_LINKS = [
  { to: '/account', label: 'Tài khoản', Icon: UserIcon },
  { to: '/bookings', label: 'Vé của tôi', Icon: TicketIcon },
];

export default function UserMenu() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const toggle = useRef(null);

  // A full page load, because on a protected page RequireAuth would otherwise win
  // the race and send the user to the login form.
  const signOut = () => {
    logout();
    window.location.assign('/');
  };

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return undefined;

    const closeOnOutsideClick = (event) => {
      if (!root.current.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggle.current.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={root}>
      <button
        ref={toggle}
        type="button"
        className="user-menu-toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Menu tài khoản của ${user.fullName}`}
        onClick={() => setOpen(!open)}
      >
        <Avatar seed={user.id} image={user.avatar} />
      </button>
      {open && (
        <div className="user-menu-list" role="menu">
          <div className="user-menu-head">
            <strong>{user.fullName}</strong>
            <span>{user.email}</span>
          </div>
          {MENU_LINKS.map(({ to, label, Icon }) => (
            <Link key={to} to={to} role="menuitem" onClick={() => setOpen(false)}>
              <Icon />
              {label}
            </Link>
          ))}
          <hr />
          <button type="button" role="menuitem" onClick={signOut}>
            <LogoutIcon />
            Đăng xuất
          </button>
        </div>
      )}
    </div>
  );
}
