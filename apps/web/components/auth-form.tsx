'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  Cloud,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Shield,
  Sparkles,
  Zap,
} from 'lucide-react';
import { BRAND } from '@/lib/brand';

const perks = [
  { icon: Zap, text: `${BRAND.plan.label} sandboxes` },
  { icon: Cloud, text: 'XibeCode agent preinstalled' },
  { icon: Shield, text: 'Telegram / Discord / Slack pairing' },
  { icon: Sparkles, text: 'Dashboard config in under a minute' },
];

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: 'Weak', color: 'bg-red-500' };
  if (score <= 3) return { score, label: 'Okay', color: 'bg-amber-500' };
  return { score, label: 'Strong', color: 'bg-emerald-500' };
}

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);
  const isSignup = mode === 'signup';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (isSignup && password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (isSignup && password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      const path = isSignup ? '/api/auth/register' : '/api/auth/login';
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || 'Request failed');
        return;
      }
      router.push(BRAND.dashboard);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* ambient */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 top-0 h-[480px] w-[480px] rounded-full bg-orange-600/20 blur-[120px]" />
        <div className="absolute -right-20 bottom-0 h-[420px] w-[420px] rounded-full bg-amber-500/10 blur-[100px]" />
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
      </div>

      <div className="relative mx-auto grid min-h-[calc(100vh-3.5rem)] max-w-6xl items-center gap-10 px-4 py-10 lg:grid-cols-2 lg:gap-16 lg:py-16">
        {/* Left marketing panel */}
        <div className="order-2 hidden lg:order-1 lg:block">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-orange-500/25 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-300">
            <Sparkles className="h-3.5 w-3.5" />
            Managed AI infrastructure
          </div>
          <h2 className="mb-4 text-4xl font-bold leading-tight tracking-tight text-white xl:text-5xl">
            {isSignup ? (
              <>
                Spin up agents
                <br />
                <span className="bg-gradient-to-r from-orange-400 to-amber-300 bg-clip-text text-transparent">
                  that actually ship
                </span>
              </>
            ) : (
              <>
                Welcome back to
                <br />
                <span className="bg-gradient-to-r from-orange-400 to-amber-300 bg-clip-text text-transparent">
                  {BRAND.name}
                </span>
              </>
            )}
          </h2>
          <p className="mb-8 max-w-md text-base leading-relaxed text-zinc-400">
            {isSignup
              ? `Create an account and provision a ${BRAND.plan.label} sandbox with AI + chat channels in one dashboard.`
              : 'Pick up where you left off — manage sandboxes, keys, and channel pairing.'}
          </p>
          <ul className="space-y-3">
            {perks.map((p) => (
              <li
                key={p.text}
                className="flex items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-300 backdrop-blur"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/15 text-orange-400">
                  <p.icon className="h-4 w-4" />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>

        {/* Form card */}
        <div className="order-1 lg:order-2">
          <div className="relative overflow-hidden rounded-3xl border border-zinc-800/90 bg-zinc-950/90 p-7 shadow-[0_0_80px_-20px_rgba(249,115,22,0.35)] backdrop-blur-xl sm:p-9">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-orange-500/60 to-transparent" />

            <div className="mb-7">
              <Link href="/" className="mb-5 inline-block text-lg font-bold tracking-tight">
                Vectra<span className="text-orange-500">Cloud</span>
              </Link>
              <h1 className="text-2xl font-bold text-white sm:text-3xl">
                {isSignup ? 'Create your account' : 'Sign in'}
              </h1>
              <p className="mt-1.5 text-sm text-zinc-400">
                {isSignup
                  ? 'No credit card for setup — just email and a password.'
                  : `Sign in to your ${BRAND.name} dashboard.`}
              </p>
            </div>

            {/* mobile perks */}
            <div className="mb-6 grid grid-cols-2 gap-2 lg:hidden">
              {perks.slice(0, 2).map((p) => (
                <div
                  key={p.text}
                  className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-2.5 py-2 text-[11px] text-zinc-400"
                >
                  <Check className="h-3 w-3 shrink-0 text-orange-500" />
                  <span className="leading-snug">{p.text}</span>
                </div>
              ))}
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-300" htmlFor="email">
                  Email
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-zinc-700/80 bg-zinc-900/80 py-3 pl-10 pr-3 text-white placeholder:text-zinc-600 outline-none transition focus:border-orange-500/70 focus:ring-2 focus:ring-orange-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-300" htmlFor="password">
                  Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    id="password"
                    type={showPw ? 'text' : 'password'}
                    autoComplete={isSignup ? 'new-password' : 'current-password'}
                    required
                    minLength={8}
                    placeholder={isSignup ? 'At least 8 characters' : 'Your password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-zinc-700/80 bg-zinc-900/80 py-3 pl-10 pr-11 text-white placeholder:text-zinc-600 outline-none transition focus:border-orange-500/70 focus:ring-2 focus:ring-orange-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {isSignup && password ? (
                  <div className="mt-2">
                    <div className="mb-1 flex gap-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full ${
                            i <= strength.score ? strength.color : 'bg-zinc-800'
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-zinc-500">Strength: {strength.label}</p>
                  </div>
                ) : null}
              </div>

              {isSignup ? (
                <div>
                  <label
                    className="mb-1.5 block text-sm font-medium text-zinc-300"
                    htmlFor="confirm"
                  >
                    Confirm password
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <input
                      id="confirm"
                      type={showPw ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      minLength={8}
                      placeholder="Repeat password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className="w-full rounded-xl border border-zinc-700/80 bg-zinc-900/80 py-3 pl-10 pr-3 text-white placeholder:text-zinc-600 outline-none transition focus:border-orange-500/70 focus:ring-2 focus:ring-orange-500/20"
                    />
                  </div>
                </div>
              ) : null}

              {error ? (
                <div
                  role="alert"
                  className="rounded-xl border border-red-900/50 bg-red-950/50 px-3.5 py-2.5 text-sm text-red-300"
                >
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="group relative mt-1 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-orange-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-orange-600/25 transition hover:bg-orange-500 disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {isSignup ? 'Creating account…' : 'Signing in…'}
                  </>
                ) : (
                  <>
                    {isSignup ? 'Create account' : 'Sign in'}
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-7 text-center text-sm text-zinc-500">
              {isSignup ? (
                <>
                  Already have an account?{' '}
                  <Link
                    href={BRAND.login}
                    className="font-medium text-orange-400 hover:text-orange-300"
                  >
                    Sign in
                  </Link>
                </>
              ) : (
                <>
                  New here?{' '}
                  <Link
                    href={BRAND.signup}
                    className="font-medium text-orange-400 hover:text-orange-300"
                  >
                    Create an account
                  </Link>
                </>
              )}
            </p>

            {isSignup ? (
              <p className="mt-4 text-center text-[11px] leading-relaxed text-zinc-600">
                By creating an account you agree to our{' '}
                <Link href={BRAND.terms} className="text-zinc-400 underline-offset-2 hover:underline">
                  Terms
                </Link>
                ,{' '}
                <Link
                  href={BRAND.privacy}
                  className="text-zinc-400 underline-offset-2 hover:underline"
                >
                  Privacy Policy
                </Link>
                , and{' '}
                <Link
                  href={BRAND.refund}
                  className="text-zinc-400 underline-offset-2 hover:underline"
                >
                  Refund Policy
                </Link>{' '}
                (sales are final). Use {BRAND.name} only for authorized access.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
