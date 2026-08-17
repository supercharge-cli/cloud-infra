'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

export function ConnectedClient({
  instanceId,
  fromApp,
  error,
  deepLink,
  dashboardHref,
}: {
  instanceId: string;
  fromApp: boolean;
  error: string;
  deepLink: string;
  dashboardHref: string;
}) {
  const [tried, setTried] = useState(false);
  const openHref = useMemo(() => {
    if (!deepLink) return '';
    if (typeof navigator === 'undefined') return deepLink;
    const android = /Android/i.test(navigator.userAgent);
    const path = instanceId
      ? `pollinations/connected?instance=${encodeURIComponent(instanceId)}`
      : 'pollinations/connected';
    return android
      ? `intent://${path}#Intent;scheme=vectra;package=cloud.vectra.vectra_cloud;end`
      : deepLink;
  }, [deepLink, instanceId]);

  useEffect(() => {
    if (error || !fromApp || !openHref) return;
    const t = window.setTimeout(() => {
      setTried(true);
      window.location.href = openHref;
    }, 450);
    return () => window.clearTimeout(t);
  }, [openHref, error, fromApp]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-zinc-100">
        <div className="w-full max-w-md rounded-2xl border border-red-900/50 bg-zinc-950 p-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-red-400">Not connected</p>
          <h1 className="mt-3 text-2xl font-semibold">Pollinations did not finish</h1>
          <p className="mt-3 text-sm text-zinc-400">{error}</p>
          <Link
            href={dashboardHref}
            className="mt-6 inline-flex rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-black"
          >
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-6 text-zinc-100">
      <div className="w-full max-w-md rounded-2xl border border-emerald-900/40 bg-zinc-950 p-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-3xl font-bold text-black">
          ✓
        </div>
        <p className="mt-5 text-sm font-semibold uppercase tracking-widest text-emerald-400">
          Payment confirmed
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Pollen connected</h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Pollinations is now the default for every workspace you create. Keys last about 7
          days — reconnect anytime. {fromApp ? 'Opening Vectra…' : 'Open the Pollinations page for usage.'}
        </p>
        {fromApp && openHref ? (
          <a
            href={openHref}
            className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-black"
          >
            {tried ? 'Tap to open Vectra' : 'Open Vectra'}
          </a>
        ) : null}
        <Link
          href={dashboardHref}
          className="mt-3 inline-flex w-full items-center justify-center rounded-lg border border-zinc-800 px-4 py-2.5 text-sm text-zinc-300"
        >
          Usage & disconnect
        </Link>
      </div>
    </main>
  );
}
