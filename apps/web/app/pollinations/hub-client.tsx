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
  balance?: { remaining?: number; paid?: number; quest?: number; budget?: number; note?: string };
  recent?: Array<{ at?: string; model?: string; cost?: number; tokens?: number; kind?: string }>;
  daily?: Array<{ day?: string; cost?: number; requests?: number }>;
  models?: Array<{
    name: string;
    title?: string;
    category: string;
    label: string;
    inPerMillion?: number;
    outPerMillion?: number;
    perImage?: number;
  }>;
  scopeHint?: string;
  error?: string;
};

function pollen(n?: number): string {
  if (n == null || Number.isNaN(n)) return '—';
  if (Math.abs(n) >= 100) return n.toFixed(1);
  if (Math.abs(n) >= 1) return n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return n.toPrecision(3);
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
        {st?.scopeHint ? <p className="mt-3 text-xs text-amber-400">{st.scopeHint}</p> : null}
        {msg ? <p className="mt-3 text-xs text-zinc-400">{msg}</p> : null}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Stat
          label="Pollen left"
          value={pollen(st?.balance?.remaining)}
          hint={st?.balance?.budget != null ? `Key budget ${pollen(st.balance.budget)}` : 'Remaining on this key'}
        />
        <Stat label="Paid Pollen" value={pollen(st?.balance?.paid)} hint="Cash-in balance" />
        <Stat label="Quest Pollen" value={pollen(st?.balance?.quest)} hint="Free/quest credits" />
        <Stat
          label="Workspaces"
          value={st?.workspaces ? `${st.workspaces.applied} / ${st.workspaces.total}` : '—'}
          hint="Using this Pollinations key"
        />
      </div>

      {st?.daily && st.daily.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-white">Daily spend</h2>
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-950 text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Day</th>
                  <th className="px-3 py-2">Pollen</th>
                  <th className="px-3 py-2">Requests</th>
                </tr>
              </thead>
              <tbody>
                {st.daily.map((d, i) => (
                  <tr key={`${d.day}-${i}`} className="border-t border-zinc-800">
                    <td className="px-3 py-2 text-zinc-300">{d.day || '—'}</td>
                    <td className="px-3 py-2 text-white">{pollen(d.cost)}</td>
                    <td className="px-3 py-2 text-zinc-400">{d.requests ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {st?.recent && st.recent.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-white">Recent requests</h2>
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-950 text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Cost</th>
                  <th className="px-3 py-2">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {st.recent.map((r, i) => (
                  <tr key={`${r.at}-${r.model}-${i}`} className="border-t border-zinc-800">
                    <td className="px-3 py-2 text-zinc-400">
                      {r.at ? new Date(r.at).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2 text-zinc-200">{r.model || r.kind || '—'}</td>
                    <td className="px-3 py-2 text-white">{pollen(r.cost)}</td>
                    <td className="px-3 py-2 text-zinc-400">{r.tokens ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {st?.models && st.models.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-1 text-sm font-semibold text-white">Model costing</h2>
          <p className="mb-3 text-xs text-zinc-500">
            Live from Pollinations. Text is pollen per 1M tokens. Images are pollen per image.
          </p>
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-950 text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Price</th>
                </tr>
              </thead>
              <tbody>
                {st.models.slice(0, 80).map((m) => (
                  <tr key={m.name} className="border-t border-zinc-800">
                    <td className="px-3 py-2">
                      <div className="text-white">{m.name}</div>
                      {m.title ? <div className="text-xs text-zinc-500">{m.title}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-zinc-400">{m.category}</td>
                    <td className="px-3 py-2 text-emerald-300">{m.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
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
