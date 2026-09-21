"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

type Props = {
  wsUrl: string;
  onDisconnected?: () => void;
};

/**
 * Canvas-based noVNC session. The short-lived WebSocket URL is obtained from a
 * server action after an explicit handoff, so this component never receives a
 * daemon or gateway credential.
 */
export function BrowserHandoffView({ wsUrl, onDisconnected }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Connecting secure browser handoff…");
  const notifyDisconnected = useEffectEvent(() => onDisconnected?.());

  useEffect(() => {
    let disposed = false;
    let rfb: {
      disconnect: () => void;
      addEventListener: (type: string, listener: () => void) => void;
      scaleViewport: boolean;
      resizeSession: boolean;
    } | undefined;
    void import("@novnc/novnc").then(({ default: RFB }) => {
      if (disposed || !host.current) return;
      rfb = new RFB(host.current, wsUrl, { shared: true, credentials: {} });
      rfb.scaleViewport = true;
      rfb.resizeSession = true;
      rfb.addEventListener("connect", () => setStatus("You are controlling the browser. Return control when finished."));
      rfb.addEventListener("disconnect", () => {
        setStatus("Browser handoff ended.");
        notifyDisconnected();
      });
    }).catch(() => setStatus("Unable to load the browser handoff client."));
    return () => {
      disposed = true;
      rfb?.disconnect();
    };
  }, [wsUrl]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <p className="text-xs text-slate-400">{status}</p>
      <div ref={host} className="min-h-0 flex-1 overflow-hidden rounded-lg border border-amber-400/40 bg-black" />
    </div>
  );
}
