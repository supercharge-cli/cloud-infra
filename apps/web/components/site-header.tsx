'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { BRAND } from '@/lib/brand';

type Me = { id: string; email: string; role?: 'admin' | 'user' } | null;

export function SiteHeader() {
  const [user, setUser] = useState<Me>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUser(d?.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoaded(true));
  }, []);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    window.location.href = '/';
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-800/80 bg-black/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-bold tracking-tight text-white" aria-label="Vectra Cloud home">
          <Image src="/logo.png" alt="" width={36} height={36} className="h-9 w-9 rounded-lg object-cover" priority />
          <span className="hidden sm:inline">Vectra<span className="text-orange-500">Cloud</span></span>
        </Link>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          <Link
            href="/docs"
            className="rounded-md px-3 py-2 text-zinc-400 transition hover:bg-zinc-900 hover:text-white"
          >
            Docs
          </Link>
          {loaded && user ? (
            <>
              <Link
                href={BRAND.dashboard}
                className="rounded-md px-3 py-2 text-zinc-400 transition hover:bg-zinc-900 hover:text-white"
              >
                Dashboard
              </Link>
              <Link
                href="/dashboard/marketplace"
                className="rounded-md px-3 py-2 text-zinc-400 transition hover:bg-zinc-900 hover:text-white"
              >
                Marketplace
              </Link>
              <Link
                href="/pollinations"
                className="rounded-md px-3 py-2 text-zinc-400 transition hover:bg-zinc-900 hover:text-white"
              >
                Pollinations
              </Link>
              {user.role === 'admin' ? (
                <Link
                  href={BRAND.admin}
                  className="rounded-md px-3 py-2 text-orange-400 transition hover:bg-zinc-900 hover:text-orange-300"
                >
                  Admin
                </Link>
              ) : null}
              <span className="hidden px-2 text-zinc-600 sm:inline">{user.email}</span>
              <button
                type="button"
                onClick={logout}
                className="rounded-md px-3 py-2 text-zinc-400 transition hover:bg-zinc-900 hover:text-white"
              >
                Log out
              </button>
            </>
          ) : loaded ? (
            <>
              <Link
                href={BRAND.login}
                className="rounded-md px-3 py-2 text-zinc-400 transition hover:bg-zinc-900 hover:text-white"
              >
                Log in
              </Link>
              <Link
                href={BRAND.signup}
                className="ml-1 rounded-full bg-orange-600 px-4 py-2 font-medium text-white transition hover:bg-orange-500"
              >
                Sign up
              </Link>
            </>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
