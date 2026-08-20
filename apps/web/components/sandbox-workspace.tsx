'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';

type WorkspaceEntry = {
  name: string;
  type: 'file' | 'directory';
  size: number;
};

type Props = {
  instanceId: string;
  sandboxId?: string;
  disabled?: boolean;
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

export function SandboxWorkspace({ instanceId, sandboxId, disabled = false }: Props) {
  const [tab, setTab] = useState<'browser' | 'files'>('browser');
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
  const [previewHosts, setPreviewHosts] = useState<{ app: string; wake: string; browser: string }>({ app: '', wake: '', browser: '' });
  const [controlBusy, setControlBusy] = useState(false);
  const [browserUrl, setBrowserUrl] = useState('');
  const [browserSelector, setBrowserSelector] = useState('');
  const [browserText, setBrowserText] = useState('');
  const [browserKey, setBrowserKey] = useState('Enter');

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
    if (tab !== 'browser' || disabled) return;
    const controller = new AbortController();
    setBrowserStatus('connecting');
    setMessage('');
    setFrame('');
    void (async () => {
      try {
        const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/computer/browser`, {
          headers: { accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`Browser stream unavailable (${res.status})`);
        setBrowserStatus('connected');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!controller.signal.aborted) {
          const next = await reader.read();
          if (next.done) break;
          buffer += decoder.decode(next.value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';
          for (const eventText of events) {
            const dataLine = eventText
              .split('\n')
              .find((line) => line.startsWith('data:'));
            if (!dataLine) continue;
            try {
              const event = JSON.parse(dataLine.slice(5).trim()) as BrowserEvent;
              const nextFrame = frameData(event);
              if (nextFrame) setFrame(nextFrame);
              if (event.type === 'status') {
                setBrowserStatus(event.error ? `error: ${event.error}` : event.connected ? 'connected' : 'starting');
              }
            } catch {
              // Ignore comments and incomplete frames; the stream remains usable.
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setBrowserStatus('offline');
          setMessage((error as Error).message);
        }
      }
    })();
    return () => controller.abort();
  }, [disabled, instanceId, tab]);

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
        body: JSON.stringify(action),
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

  const tabs = [
    { id: 'browser' as const, label: 'Browser', icon: Monitor },
    { id: 'files' as const, label: 'Files', icon: File },
  ];

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-white">Workspace</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Browser visibility and file sharing for this sandbox. The terminal remains available in the Command pane above.
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

      {message ? <p className="mb-3 rounded-lg border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-300">{message}</p> : null}

      {tab === 'browser' ? (
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2 text-xs text-zinc-400">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span>Computer stream · port 9223 · {browserStatus}</span>
              {previewHosts.browser ? <a href={previewHosts.browser} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">Open raw port</a> : null}
            </div>
            {sandboxId ? <span className="font-mono text-zinc-600">{sandboxId.slice(0, 16)}…</span> : null}
          </div>
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
          <div className="flex min-h-[320px] items-center justify-center bg-zinc-950 p-2">
            {frame ? (
              // The stream is view-only by design; all browser input remains approval-gated elsewhere.
              <img src={frame} alt="Live browser workspace" className="max-h-[540px] w-full rounded-lg object-contain" />
            ) : (
              <div className="text-center text-sm text-zinc-600">
                <Monitor className="mx-auto mb-2 h-8 w-8" />
                Waiting for the browser stream…
              </div>
            )}
          </div>
        </div>
      ) : (
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
      )}
    </section>
  );
}
