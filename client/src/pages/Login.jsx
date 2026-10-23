import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import heroBg from '../assets/hero-bg.webp';
import heroLogo from '../assets/hero-logo.webp';
import heroLogo2 from '../assets/hero-logo2.webp';
import logo from '../assets/logo.svg';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
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
        <div className="relative hidden flex-col justify-between overflow-hidden bg-brand-light p-10 text-brand-ink md:flex">
          <div className="relative z-10">
            <img src={logo} alt="OWNERS TALENT" className="h-12 w-auto" />
            <div className="mt-10 h-1 w-12 rounded-full bg-brand-yellow" />
            <h1 className="mt-5 text-3xl font-bold leading-tight text-brand">OWNERS TALENT</h1>
            <p className="mt-3 max-w-xs text-sm text-brand-ink/70">
              One stage-gated hiring workflow — AI proposes the scores, your team makes the call.
            </p>
          </div>

          {/* <p className="relative z-10 text-xs text-white/60">Internal HR tool · Not for external distribution</p> */}
        </div>

        {/* Banner strip — mobile */}
        <div className="flex items-center border-b-4 border-brand-yellow bg-brand-light px-6 py-4 md:hidden">
          <img src={logo} alt="OWNERS TALENT" className="h-8 w-auto" />
        </div>

        {/* Form panel */}
        <div className="flex flex-col justify-center p-8 sm:p-10">
          <h2 className="text-xl font-semibold text-foreground">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">Welcome back! Sign in to pick up where you left off.</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground">Email</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground">Password</label>
              <div className="relative mt-1">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-input bg-background py-2 pl-3 pr-10 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Logging in...' : 'Log in'}
            </button>
          </form>
          <Link to="/forgot-password" className="mt-4 text-center text-sm font-medium text-brand hover:underline">
            Forgot your password?
          </Link>
        </div>
      </div>
    </div>
  );
}
