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
  hasDiscordToken?: boolean;
  hasSlackToken?: boolean;
  apiKey?: string;
  telegramBotToken?: string;
  discordBotToken?: string;
  slackBotToken?: string;
  slackAppToken?: string;
  allowAllUsers?: boolean;
  apiKeyHint?: string;
  telegramHint?: string;
  discordHint?: string;
  slackHint?: string;
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
  isFree?: boolean;
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

type FreeQuota = {
  limit: number;
  used: number;
  available: number;
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
  const [freeQuota, setFreeQuota] = useState<FreeQuota>({
    limit: 1,
    used: 0,
    available: 1,
  });
  const [currency, setCurrency] = useState<'INR' | 'USD'>('INR');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [creatingFree, setCreatingFree] = useState(false);
  const [name, setName] = useState('workspace');
  const [selected, setSelected] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [pairing, setPairing] = useState<PairingView | null>(null);
  const [logs, setLogs] = useState('');
  const [logsSource, setLogsSource] = useState<'all' | 'daemon' | 'agent' | 'system'>('all');
  const [logsLoading, setLogsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Opt-in CLI update offer (E2B / Vectra Cloud sandboxes). */
  const [cliUpdate, setCliUpdate] = useState<{
    current: string | null;
    latest: string | null;
    updateAvailable: boolean;
  } | null>(null);
  /** Dismissed latest version per instance (session memory). */
  const [cliDismissed, setCliDismissed] = useState<Record<string, string>>({});

  // form fields
  const [provider, setProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [telegramToken, setTelegramToken] = useState('');
  const [discordToken, setDiscordToken] = useState('');
  const [slackBotToken, setSlackBotToken] = useState('');
  const [slackAppToken, setSlackAppToken] = useState('');
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
    // Default 1 free if API omits freeQuota (old deploy) — never silently zero it.
    if (data.freeQuota && typeof data.freeQuota === 'object') {
      const limit = Math.max(0, Math.floor(Number(data.freeQuota.limit)));
      const used = Math.max(0, Math.floor(Number(data.freeQuota.used)));
      const availRaw = data.freeQuota.available;
      const available =
        availRaw === undefined || availRaw === null
          ? Math.max(0, (Number.isFinite(limit) ? limit : 1) - (Number.isFinite(used) ? used : 0))
          : Math.max(0, Math.floor(Number(availRaw)));
      setFreeQuota({
        limit: Number.isFinite(limit) ? limit : 1,
        used: Number.isFinite(used) ? used : 0,
        available: Number.isFinite(available) ? available : 1,
      });
    } else {
      setFreeQuota({ limit: 1, used: 0, available: 1 });
    }
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

  async function createFreeInstance() {
    setCreatingFree(true);
    setError('');
    try {
      const res = await fetch('/api/instances', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Could not create free instance');
      await refresh();
      if (data.instance?.id) {
        setSelected(data.instance.id);
        setLogs('Free instance created — configure AI + chat channels below.');
        await loadDetail(data.instance.id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreatingFree(false);
    }
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
      setCliUpdate(null);
    }
    setSelected(id);
    setBusy(true);
    setLogs('');
    try {
      const [cRes, pRes, vRes] = await Promise.all([
        fetch(`/api/instances/${id}/config`),
        fetch(`/api/instances/${id}/pairing`),
        fetch(`/api/instances/${id}/cli-version`),
      ]);
      const cData = await cRes.json();
      const pData = await pRes.json();
      if (cRes.ok) {
        const s = cData.sandbox as ConfigView | undefined;
        setConfig(s || null);
        // Prefill form with whatever is already on the sandbox (env + profile).
        setProvider(s?.provider || 'openai');
        setModel(s?.model || '');
        setBaseUrl(s?.baseUrl || '');
        setApiKey(s?.apiKey || '');
        setTelegramToken(s?.telegramBotToken || '');
        setDiscordToken(s?.discordBotToken || '');
        setSlackBotToken(s?.slackBotToken || '');
        setSlackAppToken(s?.slackAppToken || '');
        setAllowAll(Boolean(s?.allowAllUsers));
      } else {
        setConfig(null);
        setProvider('openai');
        setModel('');
        setBaseUrl('');
        setApiKey('');
        setTelegramToken('');
        setDiscordToken('');
        setSlackBotToken('');
        setSlackAppToken('');
        setAllowAll(false);
        setError(cData.error || 'Config load failed');
      }
      if (pRes.ok) setPairing(pData.pairing);
      else setPairing({ pending: [], approved: [] });

      if (vRes.ok) {
        const vData = await vRes.json();
        setCliUpdate({
          current: vData.current || null,
          latest: vData.latest || null,
          updateAvailable: Boolean(vData.updateAvailable),
        });
      } else {
        setCliUpdate(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function applyCliUpdate() {
    if (!selected || !cliUpdate?.latest) return;
    setBusy(true);
    setLogs('');
    try {
      const res = await fetch(`/api/instances/${selected}/cli-update`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: cliUpdate.latest }),
      });
      const data = await res.json();
      setLogs(
        [
          data.ok
            ? `CLI update OK · ${data.from || '?'} → ${data.verified || data.to || '?'}`
            : data.error ||
              `CLI update failed · ${data.from || '?'} → ${data.verified || data.to || '?'} (wanted ${cliUpdate.latest})`,
          ...(data.logs || []),
        ].join('\n'),
      );
      if (res.status === 402) {
        setError(data.message || data.error || 'Subscription expired');
        return;
      }
      if (!res.ok || !data.ok) {
        throw new Error(
          data.error ||
            `CLI still ${data.verified || data.from || 'unknown'} after update (wanted ${cliUpdate.latest})`,
        );
      }
      setCliUpdate((prev) =>
        prev
          ? {
              ...prev,
              current: data.verified || data.to || prev.current,
              updateAvailable: false,
            }
          : prev,
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function dismissCliUpdate() {
    if (!selected || !cliUpdate?.latest) {
      setCliUpdate(null);
      return;
    }
    setCliDismissed((m) => ({ ...m, [selected]: cliUpdate.latest! }));
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
          discordBotToken: discordToken || undefined,
          slackBotToken: slackBotToken || undefined,
          slackAppToken: slackAppToken || undefined,
          restart,
          allowAllUsers: allowAll,
        }),
      });
      const data = await res.json();
      setLogs((data.logs || [data.error]).join('\n'));
      if (!res.ok) throw new Error(data.error || 'Save failed');
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

  /** Pull daemon / agent / system logs from the sandbox (wakes if paused). */
  async function loadLogs(opts?: {
    source?: 'all' | 'daemon' | 'agent' | 'system';
    lines?: number;
  }) {
    if (!selected) return;
    const source = opts?.source || logsSource;
    const lines = opts?.lines ?? 200;
    setLogsLoading(true);
    setBusy(true);
    setError('');
    try {
      const q = new URLSearchParams({
        source,
        lines: String(lines),
      });
      const res = await fetch(`/api/instances/${selected}/logs?${q.toString()}`);
      const data = await res.json();
      if (res.status === 402) {
        setError(data.message || data.error || 'Subscription expired');
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load logs');
      }
      setLogsSource(source);
      setLogs(
        data.text ||
          (Array.isArray(data.logs) ? data.logs.join('\n') : '') ||
          '(no log output)',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLogsLoading(false);
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

  async function approvePair(opts?: { platform?: string; code?: string }) {
    const code = (opts?.code || pairCode).trim();
    if (!selected || !code) return;
    setBusy(true);
    try {
      const match = pairing?.pending.find(
        (p) => p.code.toUpperCase() === code.toUpperCase(),
      );
      const platform = opts?.platform || match?.platform || 'telegram';
      const res = await fetch(`/api/instances/${selected}/pairing`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, platform }),
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
            {freeQuota.limit > 0 ? (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                Free: {freeQuota.available}/{freeQuota.limit} left
              </span>
            ) : null}
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
          {freeQuota.available > 0 ? (
            <button
              type="button"
              disabled={creatingFree || creating || busy}
              onClick={() => void createFreeInstance()}
              className="rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {creatingFree ? 'Creating free…' : 'Create free instance'}
            </button>
          ) : null}
          <button
            type="button"
            disabled={creating || creatingFree || busy}
            onClick={createInstance}
            className="rounded-lg bg-orange-600 px-5 py-2 font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
          >
            {creating ? 'Opening checkout…' : `${buttonLabel} & create`}
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          {freeQuota.limit > 0 ? (
            <>
              Every account includes <strong className="text-zinc-400">{freeQuota.limit} free</strong>{' '}
              instance (no expiry). Extra sandboxes via Razorpay · India{' '}
              <strong className="text-zinc-400">₹{plan.priceInr || '—'}</strong> · International{' '}
              <strong className="text-zinc-400">${plan.priceUsd || '—'}</strong> · {plan.periodDays}{' '}
              days.
            </>
          ) : (
            <>
              Razorpay · India <strong className="text-zinc-400">₹{plan.priceInr || '—'}</strong> ·
              International <strong className="text-zinc-400">${plan.priceUsd || '—'}</strong> ·{' '}
              {plan.periodDays} days access · sandbox only after payment.
            </>
          )}
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
                    AI {inst.aiConfigured ? '✓' : '—'} · Chat{' '}
                    {inst.telegramConfigured
                      ? [
                          inst.config?.hasTelegramToken ? 'TG' : null,
                          inst.config?.hasDiscordToken ? 'DC' : null,
                          inst.config?.hasSlackToken ? 'SL' : null,
                        ]
                          .filter(Boolean)
                          .join('+') || '✓'
                      : '—'}
                    {inst.isFree ? (
                      <span className="ml-2 text-emerald-400">· free tier</span>
                    ) : inst.paid === false || inst.billingStatus === 'past_due' ? (
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
                {!inst.isFree &&
                (inst.paid === false || inst.billingStatus === 'past_due') ? (
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
          {!selectedInst.isFree &&
            (selectedInst.paid === false || selectedInst.billingStatus === 'past_due') && (
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
          {selectedInst.isFree ? (
            <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-100/90">
              This is your <strong>free tier</strong> instance — no payment required, no expiry.
              Need another sandbox? Use <strong>Pay & create</strong> above.
            </div>
          ) : null}
          {(selectedInst.liveState === 'paused' || selectedInst.status === 'paused') &&
            selectedInst.paid !== false && (
            <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-100/90">
              This sandbox is <strong>paused</strong> (saved securely). Click{' '}
              <strong>Wake / resume</strong>, or DM the Telegram bot (first message wakes the VM —
              send again after the bot replies). Config and files are preserved.
            </div>
          )}
          {cliUpdate?.updateAvailable &&
            cliUpdate.latest &&
            cliDismissed[selectedInst.id] !== cliUpdate.latest && (
              <div className="rounded-xl border border-sky-800/50 bg-sky-950/30 px-4 py-3 text-sm text-sky-50">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <strong className="text-white">XibeCode update available</strong>
                    <p className="mt-1 text-sky-100/90">
                      {cliUpdate.latest} available
                      {cliUpdate.current ? (
                        <>
                          {' '}
                          (you have <code className="text-sky-200">{cliUpdate.current}</code>)
                        </>
                      ) : null}
                      . Opt-in only — installs on this sandbox and restarts the daemon. Workspace
                      and <code className="text-sky-200">~/.xibecode</code> secrets are kept.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void applyCliUpdate()}
                      className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                    >
                      Update &amp; restart
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={dismissCliUpdate}
                      className="rounded-lg border border-sky-800/60 px-3 py-1.5 text-xs text-sky-100 hover:bg-sky-950/50 disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
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
              {!selectedInst.isFree &&
                (selectedInst.paid === false || selectedInst.billingStatus === 'past_due') && (
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
                disabled={busy || logsLoading}
                onClick={() => void loadLogs({ source: 'all' })}
                className="rounded-lg border border-sky-800/60 bg-sky-950/40 px-3 py-1.5 text-sm font-medium text-sky-100 hover:bg-sky-900/40 disabled:opacity-50"
                title="Read daemon + agent logs from the sandbox (wakes if paused)"
              >
                {logsLoading ? 'Loading logs…' : 'View logs'}
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
            <h3 className="mb-3 font-semibold text-white">AI + chat channels</h3>
            {config ? (
              <p className="mb-4 text-xs text-zinc-500">
                On sandbox: API {config.hasApiKey ? config.apiKeyHint : 'none'} · TG{' '}
                {config.hasTelegramToken ? config.telegramHint : '—'} · DC{' '}
                {config.hasDiscordToken ? config.discordHint : '—'} · SL{' '}
                {config.hasSlackToken ? config.slackHint : '—'} · {config.provider || '?'} /{' '}
                {config.model || 'no model'}
              </p>
            ) : null}
            <p className="mb-3 text-xs text-zinc-500">
              Values below are loaded from the sandbox env. Edit any field, then save — the coding
              bot restarts automatically. The Flutter app chats through the first-party inbox (no
              bot token). Telegram, Discord, and Slack stay optional extras.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Provider">
                <input
                  list="ai-providers"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder="openai, anthropic, routingrun, openrouter…"
                  className="field"
                />
                <datalist id="ai-providers">
                  <option value="openai" />
                  <option value="anthropic" />
                  <option value="routingrun" />
                  <option value="openrouter" />
                  <option value="grok" />
                  <option value="google" />
                  <option value="deepseek" />
                  <option value="custom" />
                </datalist>
              </Field>
              <Field label="Model">
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. gpt-4o"
                  className="field"
                />
              </Field>
              <Field label="API key">
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
              <Field label="Telegram bot token">
                <input
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                  type="text"
                  autoComplete="off"
                  placeholder="123456:ABC… (BotFather)"
                  className="field"
                />
              </Field>
              <Field label="Discord bot token">
                <input
                  value={discordToken}
                  onChange={(e) => setDiscordToken(e.target.value)}
                  type="text"
                  autoComplete="off"
                  placeholder="Discord bot token · Message Content Intent on"
                  className="field"
                />
              </Field>
              <Field label="Slack bot token (xoxb-)">
                <input
                  value={slackBotToken}
                  onChange={(e) => setSlackBotToken(e.target.value)}
                  type="text"
                  autoComplete="off"
                  placeholder="xoxb-…"
                  className="field"
                />
              </Field>
              <Field label="Slack app token (xapp-)">
                <input
                  value={slackAppToken}
                  onChange={(e) => setSlackAppToken(e.target.value)}
                  type="text"
                  autoComplete="off"
                  placeholder="xapp-… (Socket Mode)"
                  className="field"
                />
              </Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                checked={allowAll}
                onChange={(e) => setAllowAll(e.target.checked)}
              />
              Allow all users on every channel (disable pairing)
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => saveConfig(true)}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
              >
                Save &amp; start bot
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => saveConfig(false)}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-900 disabled:opacity-50"
              >
                Save env only
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
            <h3 className="mb-3 font-semibold text-white">Channel pairing</h3>
            <p className="mb-3 text-sm text-zinc-400">
              User messages Telegram / Discord / Slack → gets a code → approve here.
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
                onClick={() => void approvePair()}
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
                        <li key={`${p.platform}-${p.code}`} className="font-mono text-amber-300">
                          <button
                            type="button"
                            className="underline decoration-amber-700/50 hover:text-amber-200"
                            onClick={() =>
                              void approvePair({ code: p.code, platform: p.platform })
                            }
                          >
                            {p.code}
                          </button>{' '}
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

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold text-white">Logs</h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Daemon, agent, and process output from the sandbox. Use this when Telegram goes
                  quiet or a run looks stuck.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['all', 'All'],
                    ['daemon', 'Daemon'],
                    ['agent', 'Agent'],
                    ['system', 'System'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    disabled={busy || logsLoading}
                    onClick={() => void loadLogs({ source: key })}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
                      logsSource === key && logs
                        ? 'bg-sky-600 text-white'
                        : 'border border-zinc-700 text-zinc-300 hover:bg-zinc-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={busy || logsLoading || !logs}
                  onClick={() => {
                    void navigator.clipboard?.writeText(logs);
                  }}
                  className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
                >
                  Copy
                </button>
                <button
                  type="button"
                  disabled={busy || logsLoading}
                  onClick={() => void loadLogs({ source: logsSource, lines: 400 })}
                  className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
                >
                  {logsLoading ? '…' : 'Refresh'}
                </button>
              </div>
            </div>
            {logs ? (
              <pre className="max-h-96 overflow-auto rounded-xl border border-zinc-800 bg-black p-4 text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">
                {logs}
              </pre>
            ) : (
              <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-600">
                Click <strong className="text-zinc-400">View logs</strong> above (or a source
                filter) to load live logs from this sandbox.
              </p>
            )}
          </div>
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
