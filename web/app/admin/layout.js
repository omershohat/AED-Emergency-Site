'use client';
// ============================================================================
//  Admin area layout - the session guard (Requirement #11)
// ============================================================================
//  AuthProvider is mounted HERE and not in the root layout on purpose: every
//  mount fires a silent refresh request, and a visitor reading the landing page
//  has no session to restore. Only the admin area pays that cost.
// ============================================================================
import { AuthProvider, useAuth } from '@/lib/auth';
import LoginForm from './LoginForm';

export default function AdminLayout({ children }) {
  return (
    <AuthProvider>
      <Guard>{children}</Guard>
    </AuthProvider>
  );
}

function Guard({ children }) {
  const { admin, loading } = useAuth();

  // While the silent refresh is in flight we show neither the panel nor the
  // login form - otherwise a logged-in admin would see the login screen flash
  // on every page load.
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-slate-500">
        בודק הרשאות...
      </div>
    );
  }

  if (!admin) return <LoginForm />;

  return children;
}
