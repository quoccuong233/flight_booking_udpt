import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { clearSession, loadSession, onSessionExpired, saveSession } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => loadSession()?.user ?? null);

  const login = useCallback((session) => {
    saveSession(session);
    setUser(session.user);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  useEffect(() => onSessionExpired(logout), [logout]);

  const updateUser = useCallback((nextUser) => {
    saveSession({ ...loadSession(), user: nextUser });
    setUser(nextUser);
  }, []);

  const value = useMemo(
    () => ({ user, login, logout, updateUser }),
    [user, login, logout, updateUser]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
