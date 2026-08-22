'use client';
// ============================================================================
//  Admin login (Requirement #11)
// ============================================================================
//  What happens on submit:
//    1. POST /auth/login with the username and password,
//    2. the server returns an ACCESS token in the JSON body -> kept in memory,
//    3. and a REFRESH token in an httpOnly cookie -> the browser stores it and
//       this JavaScript can never read it.
//
//  Note there is no "remember me" checkbox and nothing written to localStorage.
//  The refresh cookie already is the "remember me", and it is safer.
// ============================================================================
import { useState } from 'react';
import { useAuth } from '@/lib/auth';

export default function LoginForm() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="card">
        <h1 className="text-2xl font-bold text-slate-900">כניסת מנהל</h1>
        <p className="mt-2 text-sm text-slate-600">
          האזור הזה מוגן באמצעות JWT עם Access Token קצר-מועד ו-Refresh Token מתחדש.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="label">שם משתמש</span>
            <input
              value={username} onChange={(e) => setUsername(e.target.value)}
              className="input ltr-num" autoComplete="username" autoFocus
            />
          </label>

          <label className="block">
            <span className="label">סיסמה</span>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="input ltr-num" autoComplete="current-password"
            />
          </label>

          {error && (
            <p className="rounded-xl bg-emergency-light px-4 py-3 text-sm font-medium text-emergency">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'מתחבר...' : 'כניסה'}
          </button>
        </form>

        <p className="mt-4 rounded-xl bg-slate-100 p-3 text-xs text-slate-600">
          פרטי הגישה לסימולטור:{' '}
          <span className="ltr-num font-mono font-semibold">micha / 1234</span>
          <span className="mt-1 block">
            (מוגדרים בקובץ ה-seed ונשמרים במסד הנתונים כ-hash של bcrypt, לא כטקסט)
          </span>
        </p>
      </div>
    </div>
  );
}
