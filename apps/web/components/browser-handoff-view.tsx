"use client";

import { useEffect, useEffectEvent, useRef, useState } from 'react';

type Props = {
  wsUrl: string;
  viewOnly?: boolean;
  expiresAt?: number;
  onDisconnected?: () => void;
};

type VncClient = {
  disconnect: () => void;
  addEventListener: (type: string, listener: () => void) => void;
  scaleViewport: boolean;
  resizeSession: boolean;
  viewOnly: boolean;
  focusOnClick: boolean;
};

export function BrowserHandoffView({ wsUrl, viewOnly = true, expiresAt = 0, onDisconnected }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const client = useRef<VncClient | null>(null);
  const permission = useRef({ viewOnly, expiresAt });
  const [status, setStatus] = useState('Connecting to the E2B desktop…');
  const notifyDisconnected = useEffectEvent(() => onDisconnected?.());

  useEffect(() => {
    permission.current = { viewOnly, expiresAt };
    const interactive = !viewOnly && expiresAt > Date.now();
    if (client.current) {
      client.current.viewOnly = !interactive;
      client.current.focusOnClick = interactive;
    }
    setStatus(interactive ? 'You have control · return it when finished' : 'Live desktop · view only');
  }, [viewOnly, expiresAt]);

  useEffect(() => {
    let disposed = false;
    let rfb: VncClient | undefined;
    void import('@novnc/novnc').then(({ default: RFB }) => {
      if (disposed || !host.current) return;
      rfb = new RFB(host.current, wsUrl, { shared: true, credentials: {} });
      client.current = rfb;
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.viewOnly = permission.current.viewOnly || permission.current.expiresAt <= Date.now();
      rfb.focusOnClick = !rfb.viewOnly;
      rfb.addEventListener('connect', () => {
        if (!disposed) setStatus(rfb?.viewOnly ? 'Live desktop · view only' : 'You have control · return it when finished');
      });
      rfb.addEventListener('disconnect', () => {
        if (!disposed) { setStatus('Desktop disconnected. Reconnect for a fresh access ticket.'); notifyDisconnected(); }
      });
    }).catch(() => { if (!disposed) setStatus('Unable to load the desktop viewer. Reconnect to try again.'); });
    const policy = setInterval(() => {
      if (!rfb) return;
      const interactive = !permission.current.viewOnly && permission.current.expiresAt > Date.now() && !document.hidden;
      rfb.viewOnly = !interactive;
      rfb.focusOnClick = interactive;
    }, 200);
    return () => {
      disposed = true;
      clearInterval(policy);
      if (rfb) { rfb.viewOnly = true; rfb.focusOnClick = false; rfb.disconnect(); }
      client.current = null;
    };
  }, [wsUrl]);

  return <div className="flex h-full min-h-0 flex-col gap-2 p-3">
    <p className="text-xs text-slate-300" role="status">{status}</p>
    <div ref={host} className="min-h-0 flex-1 overflow-hidden rounded-lg bg-black" />
  </div>;
}
