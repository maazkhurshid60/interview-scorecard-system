import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import heroBg from '../assets/hero-bg.webp';
import heroLogo from '../assets/hero-logo.webp';
import heroLogo2 from '../assets/hero-logo2.webp';
import redstarIcon from '../assets/redstar-icon.png';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(email, password);
      const redirectTo = location.state?.from?.pathname || '/';
      navigate(redirectTo, { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white p-4">
      {/* Ambient background — same technique as redstartechs.com: one glow image, scaled up and blurred */}
      <img
        src={heroBg} alt="" aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-90 blur-3xl"
      />

      {/* Crisp floating accent shapes, matching the real site's layout */}
      <img src={heroLogo} alt="" aria-hidden="true" className="pointer-events-none absolute -right-6 top-12 h-32 w-32 sm:h-48 sm:w-48" />
      <img src={heroLogo2} alt="" aria-hidden="true" className="pointer-events-none absolute bottom-16 left-6 h-14 w-14 sm:h-20 sm:w-20" />

      <div className="relative z-10 grid w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl md:grid-cols-2">
        {/* Banner panel — desktop */}
        <div className="relative hidden flex-col justify-between overflow-hidden bg-[#d21e2b] p-10 text-white md:flex">
          <div className="relative z-10">
            <div className="flex items-center gap-2">
              <img src={redstarIcon} alt="" className="h-6 w-6 brightness-0 invert" />
              <span className="text-sm font-semibold uppercase tracking-wider text-white/80">Red Star Technologies</span>
            </div>
            <h1 className="mt-10 text-3xl font-bold leading-tight">Interview Scorecard System</h1>
            <p className="mt-3 max-w-xs text-sm text-white/80">
              One stage-gated hiring workflow — AI proposes the scores, your team makes the call.
            </p>
          </div>

          <p className="relative z-10 text-xs text-white/60">Internal HR tool · Not for external distribution</p>
        </div>

        {/* Banner strip — mobile */}
        <div className="flex items-center gap-2 bg-[#d21e2b] px-6 py-5 text-white md:hidden">
          <img src={redstarIcon} alt="" className="h-5 w-5 brightness-0 invert" />
          <span className="text-sm font-semibold">Red Star Technologies</span>
        </div>

        {/* Form panel */}
        <div className="flex flex-col justify-center p-8 sm:p-10">
          <h2 className="text-xl font-semibold text-foreground">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">Interview Scorecard System</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground">Email</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-[#d21e2b] focus:outline-none focus:ring-1 focus:ring-[#d21e2b]"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground">Password</label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-[#d21e2b] focus:outline-none focus:ring-1 focus:ring-[#d21e2b]"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-[#d21e2b] px-3 py-2 text-sm font-medium text-white hover:bg-[#d21e2b]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Logging in...' : 'Log in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
