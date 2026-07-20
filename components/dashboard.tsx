'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BRAND } from '@/lib/brand';
import type { Instance } from '@/lib/store';

type ConfigView = {
  provider?: string;
  model?: string;
  baseUrl?: string;
  hasApiKey: boolean;
  hasTelegramToken: boolean;
  apiKeyHint?: string;
  telegramHint?: string;
};

type PairingView = {
  pending: Array<{ code: string; platform: string; userId: string; chatId: string }>;
  approved: Array<{ platform: string; userId: string }>;
};

type DashboardInstance = Instance & {
  liveState?: string;
  resumable?: boolean;
  liveMessage?: string;
};

export function Dashboard({ email }: { email: string }) {
  const [instances, setInstances] = useState<DashboardInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('workspace');
  const [selected, setSelected] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [pairing, setPairing] = useState<PairingView | null>(null);
  const [logs, setLogs] = useState('');
  const [busy, setBusy] = useState(false);

  // form fields
  const [provider, setProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [telegramToken, setTelegramToken] = useState('');
  const [allowAll, setAllowAll] = useState(false);
  const [pairCode, setPairCode] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    const res = await fetch('/api/instances');
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed to load instances');
      setInstances([]);
      return;
    }
    setInstances(data.instances || []);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function createInstance() {
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/instances', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Create failed');
      await refresh();
      setSelected(data.instance.id);
      await loadDetail(data.instance.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function loadDetail(id: string) {
    setSelected(id);
    setBusy(true);
    setLogs('');
    try {
      const [cRes, pRes] = await Promise.all([
        fetch(`/api/instances/${id}/config`),
        fetch(`/api/instances/${id}/pairing`),
      ]);
      const cData = await cRes.json();
      const pData = await pRes.json();
      if (cRes.ok) {
        setConfig(cData.sandbox);
        if (cData.sandbox?.provider) setProvider(cData.sandbox.provider);
        if (cData.sandbox?.model) setModel(cData.sandbox.model || '');
        if (cData.sandbox?.baseUrl) setBaseUrl(cData.sandbox.baseUrl || '');
      } else {
        setConfig(null);
        setError(cData.error || 'Config load failed');
      }
      if (pRes.ok) setPairing(pData.pairing);
      else setPairing({ pending: [], approved: [] });
    } finally {
      setBusy(false);
    }
  }

  async function saveConfig(restart: boolean) {
    if (!selected) return;
    setBusy(true);
    setLogs('');
    try {
      const res = await fetch(`/api/instances/${selected}/config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider,
          apiKey: apiKey || undefined,
          baseUrl,
          model,
          telegramBotToken: telegramToken || undefined,
          restart,
          allowAllUsers: allowAll,
        }),
      });
      const data = await res.json();
      setLogs((data.logs || [data.error]).join('\n'));
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setApiKey('');
      setTelegramToken('');
      await refresh();
      await loadDetail(selected);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function restartOnly() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/instances/${selected}/restart`, { method: 'POST' });
      const data = await res.json();
      setLogs((data.logs || [data.error]).join('\n'));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function wakeInstance(id?: string) {
    const target = id || selected;
    if (!target) return;
    setBusy(true);
    setLogs('');
    setSelected(target);
    try {
      const res = await fetch(`/api/instances/${target}/wake`, { method: 'POST' });
      const data = await res.json();
      setLogs(
        [
          data.ok
            ? `Wake OK · state=${data.state || '?'} resumed=${data.resumed ? 'yes' : 'no'}`
            : data.error || 'Wake failed',
          ...(data.logs || []),
        ].join('\n'),
      );
      if (!res.ok) throw new Error(data.error || 'Wake failed');
      await refresh();
      await loadDetail(target);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function approvePair() {
    if (!selected || !pairCode.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/instances/${selected}/pairing`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: pairCode.trim() }),
      });
      const data = await res.json();
      setLogs((data.logs || [data.error || JSON.stringify(data)]).join('\n'));
      setPairCode('');
      await loadDetail(selected);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function destroy(id: string) {
    if (!confirm('Destroy this sandbox? This cannot be undone.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/instances/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      if (selected === id) {
        setSelected(null);
        setConfig(null);
        setPairing(null);
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectedInst = instances.find((i) => i.id === selected);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Signed in as <span className="text-zinc-200">{email}</span> · plan{' '}
            <span className="text-orange-400">{BRAND.plan.label}</span>
          </p>
        </div>
        <Link href="/docs" className="text-sm text-orange-400 hover:underline">
          Hosting docs →
        </Link>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {error}
          <button
            type="button"
            className="ml-3 text-red-200 underline"
            onClick={() => setError('')}
          >
            dismiss
          </button>
        </div>
      ) : null}

      <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="mb-3 text-lg font-semibold text-white">Create sandbox</h2>
        <div className="flex flex-wrap gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="workspace name"
            className="min-w-[200px] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
          />
          <button
            type="button"
            disabled={creating || busy}
            onClick={createInstance}
            className="rounded-lg bg-orange-600 px-5 py-2 font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
          >
            {creating ? 'Provisioning…' : 'Create instance'}
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Provisions a full sandbox via your e2b-gateway (XibeCode preinstalled). Gateway must be
          running.
        </p>
      </div>

      <p className="mb-3 text-xs text-zinc-500">
        Your sandboxes stay listed when <span className="text-amber-400">paused</span> (idle) —
        open them anytime and hit Resume. Only Destroy removes them.
      </p>

      {loading ? (
        <p className="text-zinc-500">Loading instances…</p>
      ) : instances.length === 0 ? (
        <p className="text-zinc-500">No instances yet. Create one above.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {instances.map((inst) => {
            const displayStatus = inst.liveState || inst.status;
            const isPaused = displayStatus === 'paused' || inst.status === 'paused';
            return (
              <div
                key={inst.id}
                className={`rounded-xl border p-4 transition ${
                  selected === inst.id
                    ? 'border-orange-500/60 bg-orange-500/5'
                    : isPaused
                      ? 'border-amber-800/50 bg-zinc-950'
                      : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                }`}
              >
                <button
                  type="button"
                  onClick={() => loadDetail(inst.id)}
                  className="w-full text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white">{inst.name}</span>
                    <StatusPill status={displayStatus} />
                  </div>
                  <p className="mt-1 font-mono text-xs text-zinc-500">
                    {inst.id}
                    {inst.sandboxId ? ` · ${inst.sandboxId.slice(0, 12)}…` : ''}
                  </p>
                  <p className="mt-2 text-xs text-zinc-400">
                    AI {inst.aiConfigured ? '✓' : '—'} · Telegram{' '}
                    {inst.telegramConfigured ? '✓' : '—'}
                    {isPaused ? (
                      <span className="ml-2 text-amber-400">· idle paused — still yours</span>
                    ) : null}
                  </p>
                </button>
                {isPaused && inst.resumable !== false ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void wakeInstance(inst.id);
                    }}
                    className="mt-3 w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    Resume sandbox
                  </button>
                ) : null}
                {displayStatus === 'missing' || displayStatus === 'error' ? (
                  <p className="mt-2 text-xs text-red-400">
                    {inst.liveMessage || inst.lastError || 'Sandbox missing on provider'}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {selectedInst ? (
        <div className="mt-8 space-y-6">
          {(selectedInst.liveState === 'paused' || selectedInst.status === 'paused') && (
            <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-100/90">
              This sandbox is <strong>paused</strong> (saved on E2B). It still belongs to you —
              click <strong>Wake / resume</strong> to continue. Config and files are preserved.
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-white">
              Manage · {selectedInst.name}{' '}
              <span className="align-middle">
                <StatusPill status={selectedInst.liveState || selectedInst.status} />
              </span>
            </h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => wakeInstance()}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Wake / resume
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={restartOnly}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
              >
                Restart daemon
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => destroy(selectedInst.id)}
                className="rounded-lg border border-red-900/50 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-50"
              >
                Destroy
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <h3 className="mb-3 font-semibold text-white">AI + Telegram config</h3>
            {config ? (
              <p className="mb-4 text-xs text-zinc-500">
                On sandbox: API {config.hasApiKey ? config.apiKeyHint : 'none'} · Telegram{' '}
                {config.hasTelegramToken ? config.telegramHint : 'none'} ·{' '}
                {config.provider || '?'} / {config.model || 'no model'}
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Provider">
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="field"
                >
                  <option value="openai">OpenAI-compatible</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </Field>
              <Field label="Model">
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. gpt-4o"
                  className="field"
                />
              </Field>
              <Field label="API key (leave blank to keep)">
                <input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  type="text"
                  autoComplete="off"
                  placeholder="sk-… or provider key"
                  className="field"
                />
              </Field>
              <Field label="Base URL (optional)">
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className="field"
                />
              </Field>
              <Field label="Telegram bot token (leave blank to keep)">
                <input
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                  type="text"
                  autoComplete="off"
                  placeholder="123456:ABC…"
                  className="field sm:col-span-2"
                />
              </Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                checked={allowAll}
                onChange={(e) => setAllowAll(e.target.checked)}
              />
              Allow all Telegram users (disable pairing)
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => saveConfig(false)}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-900 disabled:opacity-50"
              >
                Save config
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => saveConfig(true)}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
              >
                Save & restart
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <h3 className="mb-3 font-semibold text-white">Telegram pairing</h3>
            <p className="mb-3 text-sm text-zinc-400">
              User DMs the bot → gets a code → paste here to approve.
            </p>
            <div className="mb-4 flex flex-wrap gap-2">
              <input
                value={pairCode}
                onChange={(e) => setPairCode(e.target.value)}
                placeholder="Paste pairing code"
                className="field min-w-[180px] flex-1"
              />
              <button
                type="button"
                disabled={busy || !pairCode.trim()}
                onClick={approvePair}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => selected && loadDetail(selected)}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300"
              >
                Refresh
              </button>
            </div>
            {pairing ? (
              <div className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Pending</p>
                  {pairing.pending.length === 0 ? (
                    <p className="text-zinc-600">None</p>
                  ) : (
                    <ul className="space-y-1">
                      {pairing.pending.map((p) => (
                        <li key={p.code} className="font-mono text-amber-300">
                          {p.code}{' '}
                          <span className="text-zinc-500">
                            ({p.platform} {p.userId})
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Approved</p>
                  {pairing.approved.length === 0 ? (
                    <p className="text-zinc-600">None</p>
                  ) : (
                    <ul className="space-y-1">
                      {pairing.approved.map((p, i) => (
                        <li key={i} className="font-mono text-emerald-300/90">
                          {p.platform}:{p.userId}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {logs ? (
            <pre className="max-h-64 overflow-auto rounded-xl border border-zinc-800 bg-black p-4 text-xs text-zinc-400 whitespace-pre-wrap">
              {logs}
            </pre>
          ) : null}
        </div>
      ) : null}

      <style jsx global>{`
        .field {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid rgb(63 63 70);
          background: rgb(24 24 27);
          padding: 0.5rem 0.75rem;
          color: white;
          outline: none;
        }
        .field:focus {
          border-color: rgb(249 115 22);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === 'running'
      ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
      : status === 'paused'
        ? 'bg-amber-950 text-amber-300 border-amber-800'
        : status === 'error' || status === 'missing'
          ? 'bg-red-950 text-red-300 border-red-900'
          : 'bg-zinc-900 text-zinc-400 border-zinc-700';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${color}`}>
      {status}
    </span>
  );
}
