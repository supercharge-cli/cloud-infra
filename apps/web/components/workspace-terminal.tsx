'use client';

import { useEffect, useRef, useState } from 'react';

export function WorkspaceTerminal({ instanceId, disabled }: { instanceId: string; disabled?: boolean }) {
  const screen = useRef<HTMLPreElement>(null);
  const [status, setStatus] = useState('Connecting…');
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (disabled) return;
    let closed = false;
    const abort = new AbortController();
    void (async () => {
      const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/attach`, {
        method: 'POST',
        signal: abort.signal,
      });
      const data = (await res.json()) as { url?: string; token?: string; error?: string };
      if (!res.ok || !data.url || !data.token) {
        if (!closed) setStatus(data.error || 'Terminal session unavailable');
        return;
      }
      const host = new URL(data.url);
      host.protocol = host.protocol === 'https:' ? 'wss:' : 'ws:';
      host.pathname = '/v1/terminal';
      host.search = `token=${encodeURIComponent(data.token)}`;
      const ws = new WebSocket(host.toString());
      socket.current = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { if (!closed) setStatus('Connected'); };
      ws.onclose = () => { if (!closed) setStatus('Disconnected'); };
      ws.onerror = () => { if (!closed) setStatus('Terminal connection failed'); };
      ws.onmessage = (event) => {
        const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
        if (screen.current) screen.current.textContent += text;
      };
    })().catch((error: Error) => { if (!closed) setStatus(error.message); });
    return () => {
      closed = true;
      abort.abort();
      socket.current?.close();
    };
  }, [disabled, instanceId]);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black">
      <div className="border-b border-zinc-800 px-3 py-2 text-xs text-zinc-400">{status}. This shell runs in the sandbox, not on this computer.</div>
      <pre
        ref={screen}
        className="h-80 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-zinc-100"
        tabIndex={0}
        onKeyDown={(event) => {
          if (!socket.current || socket.current.readyState !== WebSocket.OPEN) return;
          if (event.key === 'Enter') socket.current.send('\n');
          else if (event.key === 'Backspace') socket.current.send('\x7f');
          else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) socket.current.send(event.key);
          else return;
          event.preventDefault();
        }}
      />
    </div>
  );
}
