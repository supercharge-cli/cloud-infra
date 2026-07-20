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
  paid?: boolean;
  billingStatus?: string;
};

type PlanInfo = {
  priceInr: number;
  priceUsd: number;
  periodDays: number;
  label: string;
  currencies?: {
    INR: { priceLabel: string; buttonLabel: string; display: number };
    USD: { priceLabel: string; buttonLabel: string; display: number };
  };
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('No window'));
    if (window.Razorpay) return resolve();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Razorpay'));
    document.body.appendChild(s);
  });
}

export function Dashboard({ email }: { email: string }) {
  const [instances, setInstances] = useState<DashboardInstance[]>([]);
  const [plan, setPlan] = useState<PlanInfo>({
    priceInr: 0,
    priceUsd: 0,
    periodDays: 30,
    label: `${BRAND.plan.label} sandboxes`,
  });
  const [currency, setCurrency] = useState<'INR' | 'USD'>('INR');
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

  // Command pane (shell in sandbox)
  const [cmdInput, setCmdInput] = useState('');
  const [cmdCwd, setCmdCwd] = useState('/home/user/workspace');
  const [cmdTimeout, setCmdTimeout] = useState(120);
  const [cmdRunning, setCmdRunning] = useState(false);
  const [cmdHistory, setCmdHistory] = useState<
    Array<{
      id: string;
      command: string;
      cwd: string;
      exitCode: number | null;
      stdout: string;
      stderr: string;
      at: string;
      error?: string;
    }>
  >([]);
  const [cmdHistIdx, setCmdHistIdx] = useState(-1);

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
    if (data.plan) setPlan(data.plan);
  }, []);

  useEffect(() => {
    // Default INR for India (timezone / language), else USD
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const lang = navigator.language || '';
      if (tz.includes('Kolkata') || tz.includes('Calcutta') || lang.toLowerCase().startsWith('hi')) {
        setCurrency('INR');
      } else if (!tz.includes('Kolkata') && !lang.toLowerCase().includes('IN')) {
        // Keep INR as product default for this market; user can switch to USD
        setCurrency('INR');
      }
    } catch {
      setCurrency('INR');
    }
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const priceLabel =
    currency === 'USD'
      ? plan.currencies?.USD.priceLabel || `$${plan.priceUsd}/mo`
      : plan.currencies?.INR.priceLabel || `₹${plan.priceInr}/mo`;
  const buttonLabel =
    currency === 'USD'
      ? plan.currencies?.USD.buttonLabel || `Pay $${plan.priceUsd}`
      : plan.currencies?.INR.buttonLabel || `Pay ₹${plan.priceInr}`;

  async function payWithRazorpay(opts: {
    purpose: 'new_instance' | 'renew';
    name?: string;
    instanceId?: string;
  }) {
    setError('');
    await loadRazorpayScript();
    if (!window.Razorpay) throw new Error('Razorpay unavailable');

    const orderRes = await fetch('/api/billing/create-order', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        purpose: opts.purpose,
        name: opts.name,
        instanceId: opts.instanceId,
        currency,
      }),
    });
    const order = await orderRes.json();
    if (!orderRes.ok) throw new Error(order.error || 'Could not create order');

    return new Promise<void>((resolve, reject) => {
      const descPrice = order.plan?.priceLabel || priceLabel;
      const rzp = new window.Razorpay!({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'Vectra Cloud',
        description:
          opts.purpose === 'renew'
            ? `Renew instance · ${descPrice}`
            : `New instance · ${descPrice}`,
        order_id: order.orderId,
        prefill: { email },
        theme: { color: '#ea580c' },
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const vRes = await fetch('/api/billing/verify', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(response),
            });
            const v = await vRes.json();
            if (!vRes.ok) throw new Error(v.error || 'Payment verify failed');
            await refresh();
            if (v.instance?.id) {
              setSelected(v.instance.id);
              setLogs(
                `Payment OK · ${opts.purpose} · paid until ${v.paidUntil || v.instance.paidUntil || '—'}`,
              );
              if (opts.purpose === 'new_instance') {
                await loadDetail(v.instance.id);
              }
            }
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        modal: {
          ondismiss: () => reject(new Error('Payment cancelled')),
        },
      });
      rzp.open();
    });
  }

  async function createInstance() {
    setCreating(true);
    setError('');
    try {
      await payWithRazorpay({ purpose: 'new_instance', name });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== 'Payment cancelled') setError(msg);
    } finally {
      setCreating(false);
    }
  }

  async function renewInstance(id: string) {
    setBusy(true);
    setError('');
    try {
      await payWithRazorpay({ purpose: 'renew', instanceId: id });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== 'Payment cancelled') setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function loadDetail(id: string) {
    if (selected !== id) {
      setCmdHistory([]);
      setCmdInput('');
      setCmdHistIdx(-1);
      setCmdCwd('/home/user/workspace');
    }
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
      if (res.status === 402) {
        setError(data.message || data.error || 'Subscription expired — renew to resume');
        return;
      }
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
        setCmdHistory([]);
        setCmdInput('');
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runCommand(raw?: string) {
    if (!selected) return;
    const command = (raw ?? cmdInput).trim();
    if (!command || cmdRunning) return;

    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setCmdRunning(true);
    setError('');
    setCmdHistIdx(-1);

    // Optimistic pending row
    setCmdHistory((h) => [
      {
        id: entryId,
        command,
        cwd: cmdCwd,
        exitCode: null,
        stdout: '',
        stderr: 'Running…',
        at: new Date().toISOString(),
      },
      ...h,
    ].slice(0, 50));

    try {
      const res = await fetch(`/api/instances/${selected}/exec`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          command,
          cwd: cmdCwd || '/home/user/workspace',
          timeout: cmdTimeout,
        }),
      });
      const data = await res.json();

      if (res.status === 402) {
        setError(data.message || data.error || 'Subscription expired — renew to run commands');
        setCmdHistory((h) =>
          h.map((e) =>
            e.id === entryId
              ? {
                  ...e,
                  exitCode: 1,
                  stderr: data.message || data.error || 'Payment required',
                  error: data.error,
                }
              : e,
          ),
        );
        return;
      }

      if (!res.ok && data.exitCode === undefined) {
        throw new Error(data.error || `Exec failed (${res.status})`);
      }

      setCmdHistory((h) =>
        h.map((e) =>
          e.id === entryId
            ? {
                ...e,
                cwd: data.cwd || cmdCwd,
                exitCode: typeof data.exitCode === 'number' ? data.exitCode : res.ok ? 0 : 1,
                stdout: data.stdout || '',
                stderr: data.stderr || data.message || data.error || '',
                error: res.ok ? undefined : data.error,
              }
            : e,
        ),
      );

      if (!raw) setCmdInput('');
      // Soft-refresh status after shell activity (may wake paused sandbox)
      void refresh();
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      setCmdHistory((h) =>
        h.map((row) =>
          row.id === entryId
            ? { ...row, exitCode: 1, stderr: msg, error: msg }
            : row,
        ),
      );
    } finally {
      setCmdRunning(false);
    }
  }

  function onCmdKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void runCommand();
      return;
    }
    // Up/down cycle previous commands
    const prevCmds = cmdHistory.map((h) => h.command);
    if (e.key === 'ArrowUp' && prevCmds.length) {
      e.preventDefault();
      const next = Math.min(cmdHistIdx + 1, prevCmds.length - 1);
      setCmdHistIdx(next);
      setCmdInput(prevCmds[next] || '');
    } else if (e.key === 'ArrowDown' && cmdHistIdx >= 0) {
      e.preventDefault();
      const next = cmdHistIdx - 1;
      setCmdHistIdx(next);
      setCmdInput(next < 0 ? '' : prevCmds[next] || '');
    }
  }

  const quickCmds = [
    { label: 'pwd', cmd: 'pwd' },
    { label: 'ls', cmd: 'ls -la' },
    { label: 'disk', cmd: 'df -h /home/user 2>/dev/null; du -sh /home/user/workspace 2>/dev/null || true' },
    { label: 'procs', cmd: 'ps aux --sort=-%mem | head -20' },
    { label: 'daemon log', cmd: 'tail -n 80 /tmp/xibecode-daemon.log 2>/dev/null || echo "no daemon log yet"' },
    { label: 'xibecode -v', cmd: 'xibecode --version 2>&1 || which xibecode || true' },
  ];

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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Create sandbox</h2>
          <div className="flex items-center gap-2">
            <div className="flex rounded-full border border-zinc-700 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setCurrency('INR')}
                className={`rounded-full px-3 py-1 font-medium transition ${
                  currency === 'INR'
                    ? 'bg-orange-600 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                ₹{plan.priceInr || '—'}
              </button>
              <button
                type="button"
                onClick={() => setCurrency('USD')}
                className={`rounded-full px-3 py-1 font-medium transition ${
                  currency === 'USD'
                    ? 'bg-orange-600 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                ${plan.priceUsd || '—'}
              </button>
            </div>
            <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-300">
              {priceLabel} · {plan.periodDays}d
            </span>
          </div>
        </div>
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
            {creating ? 'Opening checkout…' : `${buttonLabel} & create`}
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Razorpay · India <strong className="text-zinc-400">₹{plan.priceInr || '—'}</strong> ·
          International <strong className="text-zinc-400">${plan.priceUsd || '—'}</strong> ·{' '}
          {plan.periodDays} days access · sandbox only after payment.
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
                    {inst.paid === false || inst.billingStatus === 'past_due' ? (
                      <span className="ml-2 text-red-400">· payment expired</span>
                    ) : inst.paidUntil ? (
                      <span className="ml-2 text-zinc-500">
                        · paid until {new Date(inst.paidUntil).toLocaleDateString()}
                      </span>
                    ) : null}
                    {isPaused ? (
                      <span className="ml-2 text-amber-400">· idle paused — still yours</span>
                    ) : null}
                  </p>
                </button>
                {inst.paid === false || inst.billingStatus === 'past_due' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void renewInstance(inst.id);
                    }}
                    className="mt-3 w-full rounded-lg bg-orange-600 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                  >
                    Renew {priceLabel}
                  </button>
                ) : isPaused && inst.resumable !== false ? (
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
          {(selectedInst.paid === false || selectedInst.billingStatus === 'past_due') && (
            <div className="rounded-xl border border-red-900/40 bg-red-950/20 px-4 py-3 text-sm text-red-100/90">
              Subscription expired
              {selectedInst.paidUntil
                ? ` (${new Date(selectedInst.paidUntil).toLocaleDateString()})`
                : ''}
              . Renew for <strong>{priceLabel}</strong> (₹{plan.priceInr} / ${plan.priceUsd}) to
              wake and use this instance.
              <button
                type="button"
                disabled={busy}
                onClick={() => renewInstance(selectedInst.id)}
                className="ml-3 rounded-lg bg-orange-600 px-3 py-1 text-xs font-semibold text-white"
              >
                Renew now
              </button>
            </div>
          )}
          {(selectedInst.liveState === 'paused' || selectedInst.status === 'paused') &&
            selectedInst.paid !== false && (
            <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-100/90">
              This sandbox is <strong>paused</strong> (saved securely). It still belongs to you —
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
              {(selectedInst.paid === false || selectedInst.billingStatus === 'past_due') && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => renewInstance(selectedInst.id)}
                  className="rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                >
                  Renew {buttonLabel}
                </button>
              )}
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
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold text-white">Command pane</h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Run shell commands in this sandbox (wakes if paused). Working directory defaults to{' '}
                  <span className="font-mono text-zinc-400">/home/user/workspace</span>.
                </p>
              </div>
              <button
                type="button"
                disabled={!cmdHistory.length}
                onClick={() => setCmdHistory([])}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 disabled:opacity-40"
              >
                Clear history
              </button>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              {quickCmds.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  disabled={
                    cmdRunning ||
                    busy ||
                    selectedInst.paid === false ||
                    selectedInst.billingStatus === 'past_due'
                  }
                  onClick={() => void runCommand(q.cmd)}
                  className="rounded-full border border-zinc-700 bg-zinc-900/80 px-3 py-1 text-xs font-medium text-zinc-300 hover:border-orange-500/40 hover:text-orange-300 disabled:opacity-40"
                >
                  {q.label}
                </button>
              ))}
            </div>

            <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_100px]">
              <Field label="Working directory (cwd)">
                <input
                  value={cmdCwd}
                  onChange={(e) => setCmdCwd(e.target.value)}
                  placeholder="/home/user/workspace"
                  className="field font-mono text-sm"
                  spellCheck={false}
                />
              </Field>
              <Field label="Timeout (s)">
                <input
                  type="number"
                  min={5}
                  max={300}
                  value={cmdTimeout}
                  onChange={(e) => setCmdTimeout(Number(e.target.value) || 120)}
                  className="field font-mono text-sm"
                />
              </Field>
            </div>

            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-orange-500">
                  $
                </span>
                <input
                  value={cmdInput}
                  onChange={(e) => {
                    setCmdInput(e.target.value);
                    setCmdHistIdx(-1);
                  }}
                  onKeyDown={onCmdKeyDown}
                  disabled={
                    cmdRunning ||
                    selectedInst.paid === false ||
                    selectedInst.billingStatus === 'past_due'
                  }
                  placeholder="ls -la · git status · npm install · …  (Enter to run, ↑↓ history)"
                  className="field font-mono text-sm !pl-8"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <button
                type="button"
                disabled={
                  cmdRunning ||
                  !cmdInput.trim() ||
                  selectedInst.paid === false ||
                  selectedInst.billingStatus === 'past_due'
                }
                onClick={() => void runCommand()}
                className="shrink-0 rounded-lg bg-orange-600 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
              >
                {cmdRunning ? 'Running…' : 'Run'}
              </button>
            </div>

            <div className="mt-4 max-h-[28rem] space-y-3 overflow-auto rounded-xl border border-zinc-800 bg-black p-3">
              {cmdHistory.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-zinc-600">
                  No commands yet. Try a quick action or type a command above.
                </p>
              ) : (
                cmdHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className="border-b border-zinc-900 pb-3 last:border-0 last:pb-0"
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2 font-mono text-xs">
                      <span className="text-orange-500">$</span>
                      <span className="text-zinc-100">{entry.command}</span>
                      <span className="text-zinc-600">· {entry.cwd}</span>
                      {entry.exitCode === null ? (
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                          …
                        </span>
                      ) : (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            entry.exitCode === 0
                              ? 'bg-emerald-950 text-emerald-400'
                              : 'bg-red-950 text-red-400'
                          }`}
                        >
                          exit {entry.exitCode}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-zinc-600">
                        {new Date(entry.at).toLocaleTimeString()}
                      </span>
                    </div>
                    {entry.stdout ? (
                      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-300">
                        {entry.stdout}
                      </pre>
                    ) : null}
                    {entry.stderr ? (
                      <pre
                        className={`mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed ${
                          entry.exitCode === 0 || entry.exitCode === null
                            ? 'text-zinc-500'
                            : 'text-red-400/90'
                        }`}
                      >
                        {entry.stderr}
                      </pre>
                    ) : null}
                  </div>
                ))
              )}
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
