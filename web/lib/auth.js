'use client';
// ============================================================================
//  Admin session state, shared by the whole admin area through React Context.
// ============================================================================
//  Context is used here instead of passing props down, because the header, the
//  guard and every admin page all need the same three things: who is logged in,
//  a login function and a logout function.
// ============================================================================
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setAccessToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  // `loading` starts as true so the guard shows a spinner instead of flashing
  // the login page for a moment while the silent refresh is still running.
  const [loading, setLoading] = useState(true);

  // On mount, try to restore the session from the httpOnly refresh cookie.
  // A page reload throws away the in-memory access token, but the cookie
  // survives - this is what makes F5 not log the admin out.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await api.refresh();
      if (!cancelled) {
        if (data?.admin) setAdmin(data.admin);
        setLoading(false);
      }
    })();
    // The cleanup flag stops us calling setState on a component that already
    // unmounted (React strict mode mounts, unmounts and mounts again in dev).
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await api.login(username, password);
    setAccessToken(data.accessToken);
    setAdmin(data.admin);
    return data.admin;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();          // revokes the row in refresh_tokens
    } finally {
      setAccessToken(null);
      setAdmin(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ admin, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
