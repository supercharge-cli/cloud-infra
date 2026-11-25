'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Monitor,
  Check,
  Download,
  ExternalLink,
  File,
  Folder,
  RefreshCw,
  Save,
  Share2,
  TerminalSquare,
  AppWindow,
  Settings,
} from 'lucide-react';
import { BrowserHandoffView } from './browser-handoff-view';
import { WorkspaceTerminal } from './workspace-terminal';
import { WorkspaceSettings } from './workspace-settings';
import './browser-control.css';

type WorkspaceEntry = {
  name: string;
  type: 'file' | 'directory';
  size: number;
};

type Props = {
  instanceId: string;
  botId?: string;
  sandboxId?: string;
  runtime?: 'xibecode' | 'supercharge';
  disabled?: boolean;
  onContinue?: (notes: string) => Promise<void>;
};

type BrowserEvent = {
  type?: string;
  data?: string;
  image?: string;
  jpeg?: string;
  base64?: string;
  error?: string;
  connected?: boolean;
  screencasting?: boolean;
  desktop?: boolean;
};

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 1024) return `${Math.max(0, value)} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

function frameData(event: BrowserEvent): string | null {
  const candidate = event.data || event.image || event.jpeg || event.base64;
  if (!candidate) return null;
  if (candidate.startsWith('data:image/')) return candidate;
  return `data:image/jpeg;base64,${candidate}`;
}

export function SandboxWorkspace({ instanceId, botId = 'main', sandboxId, runtime = 'xibecode', disabled = false, onContinue }: Props) {
  const [tab, setTab] = useState<'browser' | 'terminal' | 'preview' | 'files' | 'settings'>('browser');
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [previewPort, setPreviewPort] = useState('3000');
  const [previewUrl, setPreviewUrl] = useState('');
  const [directory, setDirectory] = useState('/home/user/workspace');
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [content, setContent] = useState('');
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [message, setMessage] = useState('');
  const [frame, setFrame] = useState('');
  const [browserStatus, setBrowserStatus] = useState('connecting');
  const [desktopAvailable, setDesktopAvailable] = useState(false);
  const [previewHosts, setPreviewHosts] = useState<{ app: string; wake: string; browser: string }>({ app: '', wake: '', browser: '' });
  const [controlBusy, setControlBusy] = useState(false);
  const [browserUrl, setBrowserUrl] = useState('');
  const [browserSelector, setBrowserSelector] = useState('');
  const [browserText, setBrowserText] = useState('');
  const [browserKey, setBrowserKey] = useState('Enter');
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffWsUrl, setHandoffWsUrl] = useState('');
  const [handoffExpires, setHandoffExpires] = useState(0);
  const [viewerRevision, setViewerRevision] = useState(0);
  const [controlOpen, setControlOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [controlNotes, setControlNotes] = useState('');
  const ownedHandoff = useRef(false);
  const handoffId = useRef('');
  const handoffPending = useRef(false);
  const finishDialog = useRef<HTMLDialogElement>(null);
  const continuation = useRef(onContinue);
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (finishOpen) finishDialog.current?.showModal();
    else finishDialog.current?.close();
  }, [finishOpen]);
  useEffect(() => {
    if (!controlOpen) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = before; };
  }, [controlOpen]);

  useEffect(() => () => {
    if (ownedHandoff.current) void fetch(`/api/instances/${encodeURIComponent(instanceId)}/computer/handoff`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'stop', handoffId: handoffId.current, botId }), keepalive: true,
    });
  }, [instanceId, botId]);

  const loadDirectory = useCallback(async (path: string) => {
    setLoadingFiles(true);
    setMessage('');
    try {
      const res = await fetch(
        `/api/instances/${encodeURIComponent(instanceId)}/workspace?path=${encodeURIComponent(path)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Directory load failed');
      setDirectory(path);
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoadingFiles(false);
    }
  }, [instanceId]);

  useEffect(() => {
    if (tab === 'files' && !disabled) void loadDirectory(directory);
  }, [directory, disabled, loadDirectory, tab]);

  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    void fetch(`/api/instances/${encodeURIComponent(instanceId)}/bots`, { signal: controller.signal })
      .then(async (res) => (res.ok ? res.json() : { bots: [] }))
      .then((data: { bots?: { id: string; name: string }[] }) => {
        if (!controller.signal.aborted) setAgents(Array.isArray(data.bots) ? data.bots : []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [disabled, instanceId]);

  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    void Promise.all([8790, 8788, 9223].map(async (port) => {
      const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/preview?port=${port}`, {
        signal: controller.signal,
      });
      if (!res.ok) return '';
      const data = (await res.json()) as { host?: string };
      return String(data.host || '');
    })).then(([app, wake, browser]) => {
      if (!controller.signal.aborted) setPreviewHosts({ app, wake, browser });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [disabled, instanceId]);

  useEffect(() => {
    if (tab !== 'browser' || disabled || controlOpen) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    async function listen() {
      if (disposed || document.hidden) return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      setBrowserStatus('connecting');
      try {
        const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/computer/browser?botId=${encodeURIComponent(botId)}`, {
          headers: { accept: 'text/event-stream' }, signal: request.signal,
        });
        if (!res.ok || !res.body) throw new Error(`Browser stream unavailable (${res.status})`);
        setBrowserStatus('connected');
        const reader = res.body.getReader(), decoder = new TextDecoder();
        let buffer = '';
        while (!request.signal.aborted) {
          const next = await reader.read();
          if (next.done) break;
          buffer += decoder.decode(next.value, { stream: true }).replace(/\r\n/g, '\n');
          const events = buffer.split('\n\n'); buffer = events.pop() || '';
          for (const text of events) {
            const line = text.split('\n').find((line) => line.startsWith('data:'));
            if (!line) continue;
            try {
              const event = JSON.parse(line.slice(5).trim()) as BrowserEvent;
              const image = frameData(event);
              if (image && !request.signal.aborted) setFrame(image);
              if (event.type === 'status') { setBrowserStatus(event.error ? 'offline' : event.connected ? 'connected' : 'starting'); setDesktopAvailable(event.desktop === true); }
            } catch { /* The next complete frame replaces malformed data. */ }
          }
        }
      } catch (error) {
        if (!request.signal.aborted && !disposed) { setBrowserStatus('offline'); setMessage((error as Error).message); }
      } finally {
        if (!disposed && !request.signal.aborted) reconnect = setTimeout(() => void listen(), 1500);
      }
    }
    const visibility = () => {
      clearTimeout(reconnect);
      if (document.hidden) controller?.abort(); else void listen();
    };
    void listen(); document.addEventListener('visibilitychange', visibility);
    return () => { disposed = true; clearTimeout(reconnect); controller?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, [disabled, instanceId, botId, tab, controlOpen]);

  const parentPath = useMemo(() => {
    if (directory === '/home/user/workspace') return directory;
    const trimmed = directory.replace(/\/$/, '');
    return trimmed.slice(0, Math.max(trimmed.lastIndexOf('/'), 1)) || '/';
  }, [directory]);

  async function openEntry(entry: WorkspaceEntry) {
    const path = `${directory.replace(/\/$/, '')}/${entry.name}`;
    if (entry.type === 'directory') {
      await loadDirectory(path);
      return;
    }
    setMessage('');
    try {
      const res = await fetch(
        `/api/instances/${encodeURIComponent(instanceId)}/workspace/file?path=${encodeURIComponent(path)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'File read failed');
      setSelectedPath(path);
      setContent(String(data.content || ''));
      setShareUrl('');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function saveFile() {
    if (!selectedPath || saving) return;
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/workspace/file`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: selectedPath, content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Save failed');
      setMessage('Saved to the sandbox workspace.');
      await loadDirectory(directory);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function createShare() {
    if (!selectedPath) return;
    setMessage('');
    try {
      const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/workspace/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: selectedPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Share failed');
      setShareUrl(String(data.share?.url || ''));
      setMessage('Share link created.');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  function exportWorkspace() {
    window.open(`/api/instances/${encodeURIComponent(instanceId)}/workspace/export`, '_blank', 'noopener,noreferrer');
  }

  async function runBrowserAction(action: Record<string, unknown>) {
    if (controlBusy) return;
    setControlBusy(true);
    setMessage('');
    try {
      const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/computer/control`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...action, botId }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || data.stderr || 'Browser action failed');
      setMessage(`Browser action completed: ${String(data.action || action.action)}.`);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setControlBusy(false);
    }
  }

  const handleHandoffDisconnected = useCallback(() => {
    setMessage('Desktop disconnected. Reconnect or return control.');
  }, []);

  async function openControlConnection() {
    const ticket = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/computer/vnc-ticket`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handoffId: handoffId.current, botId }) });
    const data = await ticket.json();
    if (!ticket.ok || !data.wsUrl) throw new Error(data.error || 'Desktop connection unavailable');
    if (mounted.current && ownedHandoff.current) { setHandoffWsUrl(String(data.wsUrl)); setViewerRevision((value) => value + 1); }
  }

  async function takeOver() {
    if (handoffPending.current || ownedHandoff.current) return;
    handoffPending.current = true; setHandoffBusy(true); setControlOpen(true); setMessage('');
    continuation.current = onContinue;
    try {
      if (!mounted.current) return;
      handoffId.current ||= crypto.randomUUID();
      const handoff = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/computer/handoff`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start', minutes: 10, handoffId: handoffId.current, botId }),
      });
      const data = await handoff.json();
      if (!handoff.ok || data.ok !== true || data.handoff !== true || data.handoffId !== handoffId.current) throw new Error(data.error || 'Takeover could not be confirmed');
      ownedHandoff.current = true;
      if (!mounted.current) {
        await fetch(`/api/instances/${encodeURIComponent(instanceId)}/computer/handoff`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'stop', handoffId: handoffId.current, botId }), keepalive: true });
        return;
      }
      const expiry = Number(data.expiresAt);
      if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('Control lease expired. Return control and retry.');
      setHandoffExpires(expiry);
      await openControlConnection();
    } catch (error) {
      if (mounted.current) { setMessage((error as Error).message); if (!ownedHandoff.current) setControlOpen(false); }
    } finally {
      handoffPending.current = false; if (mounted.current) setHandoffBusy(false);
    }
  }

  async function reconnectControl() {
    if (handoffPending.current || !ownedHandoff.current) return;
    if (handoffExpires <= Date.now()) { setFinishOpen(true); setMessage('Control expired. Return to viewing before taking over again.'); return; }
    handoffPending.current = true; setHandoffBusy(true); setHandoffWsUrl(''); setMessage('');
    try { await openControlConnection(); }
    catch (error) { setMessage((error as Error).message); }
    finally { handoffPending.current = false; if (mounted.current) setHandoffBusy(false); }
  }

  function requestReturn() {
    if (handoffPending.current) return;
    if (!ownedHandoff.current) { setControlOpen(false); return; }
    setHandoffWsUrl('');
    setFinishOpen(true);
  }

  async function keepControl() {
    setFinishOpen(false);
    await reconnectControl();
  }

  async function returnControl(resume: boolean) {
    if (handoffPending.current || !ownedHandoff.current) return;
    handoffPending.current = true; setHandoffBusy(true); setHandoffWsUrl('');
    try {
      const response = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/computer/handoff`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'stop', handoffId: handoffId.current, botId }),
      });
      const data = await response.json();
      if (!response.ok || data.ok !== true || data.handoff !== false || data.handoffId !== handoffId.current) throw new Error(data.error || 'Return could not be confirmed. Input stays disabled; retry.');
      ownedHandoff.current = false; handoffId.current = ''; setHandoffExpires(0); setFinishOpen(false); setControlOpen(false);
      setMessage('Control returned.');
      if (resume && continuation.current && handoffExpires > Date.now()) {
        try { await continuation.current(controlNotes.trim()); }
        catch { setMessage('Control returned, but the agent could not continue. Send a message to retry.'); }
      }
      setControlNotes('');
    } catch (error) { setMessage((error as Error).message); }
    finally { handoffPending.current = false; if (mounted.current) setHandoffBusy(false); }
  }

  async function openPreview() {
    const port = Number(previewPort);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      setMessage('Preview port must be between 1 and 65535');
      return;
    }
    const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/preview?port=${port}`);
    const data = await res.json();
    if (!res.ok || !data.host) {
      setMessage(data.error || 'Preview is not available');
      setPreviewUrl('');
      return;
    }
    setPreviewUrl(String(data.host));
    setMessage('');
  }

  const tabs = [
    { id: 'browser' as const, label: runtime === 'supercharge' && desktopAvailable ? 'Desktop' : 'Browser', icon: Monitor },
    { id: 'terminal' as const, label: 'Terminal', icon: TerminalSquare },
    { id: 'preview' as const, label: 'Preview', icon: AppWindow },
    { id: 'files' as const, label: 'Files', icon: File },
    { id: 'settings' as const, label: 'Settings', icon: Settings },
  ];

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-white">Workspace</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            {desktopAvailable ? 'Live Ubuntu VM desktop' : 'Browser'}, terminal, preview, and files. Every agent on this workspace shares this sandbox.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={exportWorkspace}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> Export workspace
          </button>
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ${
                tab === id ? 'bg-sky-600 text-white' : 'border border-zinc-700 text-zinc-300 hover:bg-zinc-900'
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {agents.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2 text-[11px] text-zinc-400">
          {agents.map((agent) => (
            <span key={agent.id} className={`rounded-full border px-2 py-0.5 ${agent.id === botId ? 'border-sky-700 text-sky-300' : 'border-zinc-800'}`}>
              {agent.name}
            </span>
          ))}
        </div>
      ) : null}

      {message ? <p className="mb-3 rounded-lg border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-300">{message}</p> : null}

      {tab === 'terminal' ? <WorkspaceTerminal instanceId={instanceId} disabled={disabled} /> : null}
      {tab === 'settings' ? <WorkspaceSettings instanceId={instanceId} disabled={disabled} /> : null}
      {tab === 'preview' ? (
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black">
          <div className="flex gap-2 border-b border-zinc-800 p-2">
            <input value={previewPort} onChange={(event) => setPreviewPort(event.target.value)} className="w-24 rounded border border-zinc-800 bg-black px-2 py-1 text-xs text-zinc-200" />
            <button type="button" onClick={() => void openPreview()} className="rounded bg-sky-700 px-3 py-1 text-xs text-white">Open preview</button>
            {[3000, 5173, 8080].map((port) => (
              <button key={port} type="button" onClick={() => { setPreviewPort(String(port)); }} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300">{port}</button>
            ))}
          </div>
          {previewUrl ? <iframe title="Sandbox preview" src={previewUrl} className="h-[540px] w-full bg-white" sandbox="allow-scripts allow-forms allow-same-origin allow-downloads" /> : <p className="p-6 text-sm text-zinc-500">Choose the port your agent is serving.</p>}
        </div>
      ) : null}

      {tab === 'browser' ? (
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2 text-xs text-zinc-400">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span>Watching AI {desktopAvailable ? 'desktop' : 'browser'} · {browserStatus}</span>
              {runtime === 'supercharge' ? <span className="text-emerald-400">{desktopAvailable ? 'Ubuntu VM · same screen as the agent' : 'E2B browser'}</span> : null}
            </div>
            {sandboxId ? <span className="font-mono text-zinc-600">{sandboxId.slice(0, 16)}…</span> : null}
          </div>
          {runtime !== 'supercharge' ? (
          <div className="grid gap-2 border-b border-zinc-800 bg-zinc-950 p-3 text-xs sm:grid-cols-2">
            <div className="flex gap-2 sm:col-span-2">
              <input value={browserUrl} onChange={(event) => setBrowserUrl(event.target.value)} placeholder="https://example.com" className="min-w-0 flex-1 rounded border border-zinc-800 bg-black px-2 py-1.5 text-zinc-200 outline-none focus:border-sky-700" />
              <button type="button" disabled={controlBusy || !browserUrl.trim() || disabled} onClick={() => void runBrowserAction({ action: 'navigate', url: browserUrl.trim() })} className="rounded bg-sky-700 px-3 py-1.5 font-medium text-white hover:bg-sky-600 disabled:opacity-50">Go</button>
            </div>
            <input value={browserSelector} onChange={(event) => setBrowserSelector(event.target.value)} placeholder="CSS selector or @ref" className="rounded border border-zinc-800 bg-black px-2 py-1.5 text-zinc-200 outline-none focus:border-sky-700" />
            <div className="flex gap-2">
              <button type="button" disabled={controlBusy || !browserSelector.trim() || disabled} onClick={() => void runBrowserAction({ action: 'click', selector: browserSelector.trim() })} className="flex-1 rounded border border-zinc-700 px-2 py-1.5 text-zinc-300 hover:bg-zinc-900 disabled:opacity-50">Click</button>
              <button type="button" disabled={controlBusy || disabled} onClick={() => void runBrowserAction({ action: 'scroll', direction: 'down', pixels: 650 })} className="flex-1 rounded border border-zinc-700 px-2 py-1.5 text-zinc-300 hover:bg-zinc-900 disabled:opacity-50">Scroll down</button>
              <button type="button" disabled={controlBusy || disabled} onClick={() => void runBrowserAction({ action: 'back' })} className="rounded border border-zinc-700 px-2 py-1.5 text-zinc-300 hover:bg-zinc-900 disabled:opacity-50">Back</button>
            </div>
            <input value={browserText} onChange={(event) => setBrowserText(event.target.value)} placeholder="Text to fill/type" className="rounded border border-zinc-800 bg-black px-2 py-1.5 text-zinc-200 outline-none focus:border-sky-700" />
            <div className="flex gap-2">
              <button type="button" disabled={controlBusy || !browserSelector.trim() || disabled} onClick={() => void runBrowserAction({ action: 'fill', selector: browserSelector.trim(), text: browserText })} className="flex-1 rounded border border-zinc-700 px-2 py-1.5 text-zinc-300 hover:bg-zinc-900 disabled:opacity-50">Fill</button>
              <button type="button" disabled={controlBusy || !browserSelector.trim() || disabled} onClick={() => void runBrowserAction({ action: 'type', selector: browserSelector.trim(), text: browserText })} className="flex-1 rounded border border-zinc-700 px-2 py-1.5 text-zinc-300 hover:bg-zinc-900 disabled:opacity-50">Type</button>
              <input value={browserKey} onChange={(event) => setBrowserKey(event.target.value)} placeholder="Enter" className="w-20 rounded border border-zinc-800 bg-black px-2 py-1.5 text-zinc-200" />
              <button type="button" disabled={controlBusy || !browserKey.trim() || disabled} onClick={() => void runBrowserAction({ action: 'press', key: browserKey.trim() })} className="rounded border border-zinc-700 px-2 py-1.5 text-zinc-300 hover:bg-zinc-900 disabled:opacity-50">Key</button>
            </div>
            <p className="sm:col-span-2 text-[10px] text-amber-500/80">Every action is sent through the authenticated app route and requires browser control to be enabled in the sandbox environment.</p>
          </div>
          ) : null}
          <div className="flex min-h-[320px] items-center justify-center bg-zinc-950 p-2">
            {frame ? (
              // The stream is view-only by design; all browser input remains approval-gated elsewhere.
              <img src={frame} alt={desktopAvailable ? 'Live Ubuntu VM desktop' : 'Live browser workspace'} className="max-h-[540px] w-full rounded-lg object-contain" />
            ) : (
              <div className="text-center text-sm text-zinc-600">
                <Monitor className="mx-auto mb-2 h-8 w-8" />
                Waiting for the {desktopAvailable ? 'desktop' : 'browser'} stream…
              </div>
            )}
          </div>
          {runtime === 'supercharge' && <footer className="browser-control-bar">
            <span>Live view</span>
            <button type="button" disabled={disabled || handoffBusy} onClick={() => void takeOver()}>Take over</button>
          </footer>}
        </div>
      ) : tab === 'files' ? (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-[11px] text-zinc-500">
            {previewHosts.app ? <a href={previewHosts.app} target="_blank" rel="noreferrer" className="rounded border border-zinc-800 px-2 py-1 hover:border-sky-700 hover:text-sky-300">App API · {previewHosts.app}</a> : null}
            {previewHosts.wake ? <a href={`${previewHosts.wake}/health`} target="_blank" rel="noreferrer" className="rounded border border-zinc-800 px-2 py-1 hover:border-sky-700 hover:text-sky-300">Wake/share · {previewHosts.wake}</a> : null}
          </div>
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="rounded-xl border border-zinc-800 bg-black p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="truncate font-mono text-xs text-zinc-400">{directory}</span>
              <button type="button" onClick={() => void loadDirectory(directory)} disabled={loadingFiles} className="text-zinc-500 hover:text-white disabled:opacity-50" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loadingFiles ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <button type="button" onClick={() => void loadDirectory(parentPath)} className="mb-2 text-xs text-sky-400 hover:underline">↑ parent directory</button>
            <div className="max-h-72 space-y-1 overflow-auto">
              {entries.map((entry) => {
                const path = `${directory.replace(/\/$/, '')}/${entry.name}`;
                const active = selectedPath === path;
                return (
                  <button key={path} type="button" onClick={() => void openEntry(entry)} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${active ? 'bg-sky-950 text-sky-200' : 'text-zinc-300 hover:bg-zinc-900'}`}>
                    {entry.type === 'directory' ? <Folder className="h-3.5 w-3.5 text-amber-400" /> : <File className="h-3.5 w-3.5 text-zinc-500" />}
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    {entry.type === 'file' ? <span className="text-[10px] text-zinc-600">{formatBytes(entry.size)}</span> : null}
                  </button>
                );
              })}
              {!entries.length && !loadingFiles ? <p className="py-6 text-center text-xs text-zinc-600">Workspace is empty.</p> : null}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-black p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="truncate font-mono text-xs text-zinc-400">{selectedPath || 'Select a file'}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => void saveFile()} disabled={!selectedPath || saving} className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"><Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save'}</button>
                <button type="button" onClick={() => void createShare()} disabled={!selectedPath} className="inline-flex items-center gap-1 rounded border border-emerald-700/60 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-950 disabled:opacity-50"><Share2 className="h-3.5 w-3.5" /> Share</button>
              </div>
            </div>
            <textarea value={content} onChange={(event) => setContent(event.target.value)} disabled={!selectedPath} spellCheck={false} className="min-h-[290px] w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-200 outline-none focus:border-sky-700 disabled:opacity-60" placeholder="Select a text file to inspect or edit it." />
            {shareUrl ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-3 py-2 text-xs"><Check className="h-3.5 w-3.5 text-emerald-400" /><a href={shareUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-emerald-300 hover:underline">{shareUrl}</a><a href={shareUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-300 hover:underline"><ExternalLink className="h-3.5 w-3.5" /> Open</a></div> : null}
          </div>
          </div>
        </>
      ) : null}
      {controlOpen && typeof document !== 'undefined' && createPortal(
        <div className="browser-control-overlay" role="dialog" aria-modal="true" aria-label="Control desktop">
          {handoffWsUrl && !finishOpen
            ? <BrowserHandoffView key={viewerRevision} wsUrl={handoffWsUrl} expiresAt={handoffExpires} paused={handoffBusy}
                onDisconnected={handleHandoffDisconnected} onReturn={requestReturn} onReconnect={() => void reconnectControl()} />
            : <><div className="browser-control-pending">{handoffBusy ? 'Taking over…' : finishOpen ? 'Input paused' : message || 'Desktop disconnected'}</div>
                <footer className="browser-control-bar"><span>Desktop control</span><button type="button" disabled={handoffBusy} onClick={requestReturn}>Return control</button></footer></>}
          <dialog ref={finishDialog} className="browser-finish-dialog" onCancel={(event) => { event.preventDefault(); if (!handoffBusy) void keepControl(); }}>
            <h2>Return control?</h2>
            <label>What did you change? (optional)
              <textarea value={controlNotes} onChange={(event) => setControlNotes(event.target.value)} maxLength={4000} rows={3} placeholder="For example: signed in and opened the project." disabled={handoffBusy} />
            </label>
            <small>Do not include passwords or codes.</small>
            {message && <p className="browser-control-error" role="alert">{message}</p>}
            <div className="actions">
              <button type="button" disabled={handoffBusy} onClick={() => void keepControl()}>Keep control</button>
              <button type="button" disabled={handoffBusy} onClick={() => void returnControl(false)}>Exit without resuming</button>
              {continuation.current && <button type="button" className="primary" disabled={handoffBusy} onClick={() => void returnControl(true)}>Return & continue</button>}
            </div>
          </dialog>
        </div>, document.body)}
    </section>
  );
}
