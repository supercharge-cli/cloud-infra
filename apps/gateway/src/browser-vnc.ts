import { WebSocket, type RawData } from "ws";

export type BrowserVncRelayOptions = {
  resolveDaemonBase: () => Promise<string>;
  headers: Record<string, string>;
  handoffId?: string;
  botId?: string;
  /** Older daemons without the ticket endpoint accepted the gateway bearer. */
  allowLegacyBearer?: boolean;
  onError?: (message: string) => void;
  connectionTimeoutMs?: number;
  maxPendingBytes?: number;
};

function messageBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  return Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
}

/** Relay only the selected sandbox's browser; never expose its daemon credential. */
export async function relayBrowserVnc(
  client: WebSocket,
  options: BrowserVncRelayOptions,
): Promise<void> {
  if (client.readyState !== WebSocket.OPEN) return;

  const abort = new AbortController();
  const pending: Array<{ data: Buffer; binary: boolean }> = [];
  const maxPendingBytes = options.maxPendingBytes ?? 256 * 1024;
  let pendingBytes = 0;
  let upstream: WebSocket | undefined;
  let opened = false;
  let finished = false;
  const timeout = setTimeout(
    () => fail("Browser VNC connection timed out"),
    options.connectionTimeoutMs ?? 15_000,
  );
  timeout.unref?.();

  function closeBoth(code: number, reason: string): void {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    pending.length = 0;
    pendingBytes = 0;
    abort.abort();
    if (client.readyState === WebSocket.OPEN) client.close(code, reason);
    // close() alone does not dispose of a WebSocket still awaiting its handshake.
    if (upstream?.readyState === WebSocket.CONNECTING) upstream.terminate();
    else if (upstream?.readyState === WebSocket.OPEN) upstream.close(code, reason);
  }

  function fail(message: string, code = 1011): void {
    if (finished) return;
    closeBoth(code, message);
    // Use fixed diagnostics, never upstream error text (which may contain a ticket URL).
    options.onError?.(message);
  }

  function sendUpstream(data: Buffer, binary: boolean): void {
    upstream?.send(data, { binary }, (error) => {
      if (error) fail("Browser VNC input relay failed");
    });
  }

  // Register before host resolution and ticket exchange so early RFB bytes are not lost.
  client.on("message", (data, binary) => {
    if (finished) return;
    const buffer = messageBuffer(data);
    if (upstream?.readyState === WebSocket.OPEN) {
      sendUpstream(buffer, binary);
      return;
    }
    if (pendingBytes + buffer.length > maxPendingBytes || pending.length >= 256) {
      fail("Browser VNC pending input exceeded limit", 1009);
      return;
    }
    pending.push({ data: buffer, binary });
    pendingBytes += buffer.length;
  });
  client.on("close", () => closeBoth(1000, "Browser VNC client disconnected"));
  client.on("error", () => fail("Browser VNC client connection failed"));

  try {
    const base = (await options.resolveDaemonBase()).replace(/\/$/, "");
    if (finished) return;
    const ticketUrl = new URL(`${base}/v1/computer/vnc-ticket`);
    if (options.handoffId) ticketUrl.searchParams.set("handoffId", options.handoffId);
    ticketUrl.searchParams.set("botId", options.botId || "main");
    const response = await fetch(ticketUrl, {
      headers: { ...options.headers, accept: "application/json" },
      signal: abort.signal,
      redirect: "error",
    });
    if (finished) {
      await response.body?.cancel();
      return;
    }

    let ticket: string | undefined;
    if (response.ok) {
      const data = (await response.json()) as { ticket?: unknown; botId?: unknown; ok?: boolean } | null;
      if (data?.ok === false || typeof data?.ticket !== "string" || !data.ticket.trim() ||
          (data.botId || "main") !== (options.botId || "main")) {
        fail("Browser VNC daemon did not issue a ticket");
        return;
      }
      ticket = data.ticket;
    } else {
      await response.body?.cancel();
      // Only an explicitly absent endpoint permits the pre-ticket bearer contract.
      // Auth failures, unavailable sidecars, and malformed successes must fail closed.
      if (!options.allowLegacyBearer || (options.botId && options.botId !== "main") || ![404, 405].includes(response.status)) {
        fail(`Browser VNC ticket request failed (HTTP ${response.status})`);
        return;
      }
    }
    if (finished) return;

    const url = new URL(`${base}/v1/computer/browser/vnc`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (ticket) url.searchParams.set("ticket", ticket);
    upstream = new WebSocket(url, {
      headers: options.headers,
      handshakeTimeout: options.connectionTimeoutMs ?? 15_000,
    });
    upstream.on("open", () => {
      if (finished) return;
      opened = true;
      clearTimeout(timeout);
      for (const message of pending) sendUpstream(message.data, message.binary);
      pending.length = 0;
      pendingBytes = 0;
    });
    upstream.on("message", (data, binary) => {
      if (!finished && client.readyState === WebSocket.OPEN) {
        client.send(data, { binary }, (error) => {
          if (error) fail("Browser VNC output relay failed");
        });
      }
    });
    upstream.on("unexpected-response", (_request, response) => {
      fail(`Browser VNC handshake failed (HTTP ${response.statusCode ?? 502})`);
      response.destroy();
    });
    upstream.on("close", (code) => {
      if (opened && code === 1000) closeBoth(1000, "Browser VNC connection ended");
      else fail(opened ? "Browser VNC connection closed" : "Browser VNC handshake failed");
    });
    upstream.on("error", () => {
      fail(opened ? "Browser VNC tunnel failed" : "Browser VNC handshake failed");
    });
  } catch {
    fail("Unable to establish the browser VNC connection");
  }
}
