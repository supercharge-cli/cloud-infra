'use client';

import { useCallback, useEffect, useState } from 'react';

type Status = {
  configured?: boolean;
  connected?: boolean;
  expired?: boolean;
  username?: string;
  name?: string;
  email?: string;
  connectedAt?: string;
  expiresAt?: string;
  workspaces?: { total: number; applied: number };
  usage?: Record<string, unknown>;
  error?: string;
};

function pretty(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function PollinationsHub() {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/pollinations/start');
    const data = (await res.json()) as Status;
    setSt(data);
  }, []);

  useEffect(() => {
    load().catch(() => setSt({ error: 'Could not load status' }));
  }, [load]);

  async function connect() {
    setBusy('connect');
    setMsg('');
    try {
      const res = await fetch('/api/pollinations/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromApp: false }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start connect');
      window.location.href = data.url;
    } catch (e) {
      setMsg((e as Error).message);
      setBusy('');
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect Pollinations from all future workspaces?')) return;
    setBusy('disconnect');
    setMsg('');
    try {
      const res = await fetch('/api/pollinations/start', { method: 'DELETE' });
      if (!res.ok) throw new Error('Disconnect failed');
      await load();
      setMsg('Disconnected. Existing VMs keep the old key until it expires.');
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy('');
  }

  async function applyAll() {
    setBusy('apply');
    setMsg('');
    try {
      const res = await fetch('/api/pollinations/start', { method: 'PUT' });
      const data = (await res.json()) as { applied?: number; total?: number; error?: string };
      if (!res.ok) throw new Error(data.error || 'Apply failed');
      await load();
      setMsg(`Applied to ${data.applied ?? 0} of ${data.total ?? 0} workspaces.`);
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy('');
  }

  const usageEntries = Object.entries(st?.usage || {}).filter(([, v]) => v != null).slice(0, 12);
  const connected = Boolean(st?.connected);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-[11px] font-semibold tracking-[0.18em] text-emerald-400">BEST · CHEAPEST</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Pollinations</h1>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">
        Connect once. Every workspace you create (and existing ones we can reach) uses your Pollen
        balance — GPT, Claude, Gemini, Qwen and more. No per-VM key.
      </p>

      <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
        {st == null ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : connected ? (
          <>
            <p className="text-sm font-semibold text-emerald-400">Connected</p>
            <p className="mt-1 text-lg text-white">
              {st.name || st.username || st.email || 'Your Pollinations account'}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {st.expiresAt
                ? `Key expires ${new Date(st.expiresAt).toLocaleString()}`
                : 'Connected'}
              {st.workspaces
                ? ` · ${st.workspaces.applied}/${st.workspaces.total} workspaces using it`
                : ''}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={applyAll}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
              >
                {busy === 'apply' ? 'Applying…' : 'Apply to all workspaces'}
              </button>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={connect}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
              >
                Reconnect
              </button>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={disconnect}
                className="rounded-lg border border-red-900/60 px-3 py-2 text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-50"
              >
                {busy === 'disconnect' ? '…' : 'Disconnect'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-zinc-400">
              {st.expired ? 'Your Pollinations key expired.' : 'Not connected yet.'} Approve once
              — we attach it to every VM.
            </p>
            <button
              type="button"
              disabled={Boolean(busy) || st.configured === false}
              onClick={connect}
              className="mt-4 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy === 'connect' ? 'Opening…' : 'Connect with Pollinations'}
            </button>
            {st.configured === false ? (
              <p className="mt-2 text-xs text-amber-400">Server needs POLLINATIONS_APP_KEY.</p>
            ) : null}
          </>
        )}
        {msg ? <p className="mt-3 text-xs text-zinc-400">{msg}</p> : null}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Stat
          label="Workspaces"
          value={
            st?.workspaces ? `${st.workspaces.applied} / ${st.workspaces.total}` : '—'
          }
          hint="Using this Pollinations key"
        />
        <Stat
          label="Status"
          value={connected ? 'Live' : st?.expired ? 'Expired' : 'Off'}
          hint={st?.connectedAt ? `Since ${new Date(st.connectedAt).toLocaleDateString()}` : 'Account default'}
        />
        {usageEntries.map(([k, v]) => (
          <Stat key={k} label={k.replace(/_/g, ' ')} value={pretty(v)} hint="From Pollinations" />
        ))}
      </div>
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold text-white">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-zinc-600">{hint}</p> : null}
    </div>
  );
}
