import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../hooks/useApi';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const token = searchParams.get('token') || '';

  async function handleSubmit(event) {
    event.preventDefault();
    if (!token) return toast.error('This password-reset link is invalid. Please request a new one.');
    if (password.length < 8) return toast.error('Use at least 8 characters for your new password.');
    if (password !== confirmPassword) return toast.error('Passwords do not match.');
    setSubmitting(true);
    try {
      const response = await api.post('/auth/reset-password', { token, password });
      toast.success(response.data.message);
      navigate('/login', { replace: true });
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not update your password.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-lg">
        <h1 className="text-2xl font-semibold text-foreground">Choose a new password</h1>
        <p className="mt-2 text-sm text-muted-foreground">Use at least 8 characters. This link can only be used once.</p>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-foreground">New password</label>
            <input id="new-password" type="password" minLength="8" required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
          </div>
          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-foreground">Confirm new password</label>
            <input id="confirm-password" type="password" minLength="8" required autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
          </div>
          <button type="submit" disabled={submitting} className="w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50">
            {submitting ? 'Updating...' : 'Update password'}
          </button>
        </form>
        <Link to="/login" className="mt-5 block text-center text-sm font-medium text-brand hover:underline">Back to sign in</Link>
      </section>
    </main>
  );
}