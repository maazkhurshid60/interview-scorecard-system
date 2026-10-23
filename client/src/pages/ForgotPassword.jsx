import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../hooks/useApi';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const response = await api.post('/auth/forgot-password', { email });
      setSent(true);
      toast.success(response.data.message);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not request a password reset.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-lg">
        <h1 className="text-2xl font-semibold text-foreground">Reset your password</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter your work email and we will send a secure reset link if an active account matches it.
        </p>
        {sent ? (
          <p className="mt-6 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
            Check your inbox. The link expires after a short time for your security.
          </p>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="reset-email" className="block text-sm font-medium text-foreground">Work email</label>
              <input id="reset-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
            </div>
            <button type="submit" disabled={submitting} className="w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? 'Sending...' : 'Send reset link'}
            </button>
          </form>
        )}
        <Link to="/login" className="mt-5 block text-center text-sm font-medium text-brand hover:underline">Back to sign in</Link>
      </section>
    </main>
  );
}