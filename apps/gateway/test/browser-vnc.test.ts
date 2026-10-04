import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { test, type TestContext } from "node:test";
import { WebSocket, WebSocketServer } from "ws";

import { relayBrowserVnc, type BrowserVncRelayOptions } from "../src/browser-vnc.js";

// Deliberately fake credentials and local HTTP/WS servers: never import index.ts,
// load a .env file, or contact the E2B gateway/provider from these tests.
const headers = { authorization: "Bearer local-mock-only" };
const daemonTicket = "daemon-ticket-with+/=&characters";

type FixtureOptions = {
  ticketResponse?: (req: IncomingMessage, res: ServerResponse) => void;
  rejectUpgrade?: boolean;
  delayUpgrade?: boolean;
  relay?: Partial<BrowserVncRelayOptions>;
};

async function fixture(t: TestContext, options: FixtureOptions = {}) {
  const requests: Array<{ path: string; authorization?: string }> = [];
  const upgrades: Array<{ path: string; authorization?: string }> = [];
  const errors: string[] = [];
  const daemonSockets = new WebSocketServer({ noServer: true });
  const gatewaySockets = new WebSocketServer({ noServer: true });
  const sockets = new Set<WebSocket>();
  const received: Array<{ data: string; binary: boolean }> = [];
  let releaseUpgrade: (() => void) | undefined;
  let sawUpgrade!: () => void;
  const upgradeSeen = new Promise<void>((resolve) => { sawUpgrade = resolve; });
  let sawMessage!: () => void;
  const messageSeen = new Promise<void>((resolve) => { sawMessage = resolve; });

  const daemon = createServer((req, res) => {
    requests.push({ path: req.url || "", authorization: req.headers.authorization });
    if (options.ticketResponse) return options.ticketResponse(req, res);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ticket: daemonTicket, expiresInSeconds: 300 }));
  });
  daemon.on("upgrade", (req, socket, head) => {
    upgrades.push({ path: req.url || "", authorization: req.headers.authorization });
    sawUpgrade();
    const upgrade = () => {
      if (socket.destroyed) return;
      if (options.rejectUpgrade) {
        socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      daemonSockets.handleUpgrade(req, socket, head, (ws) => {
        sockets.add(ws);
        ws.on("error", () => undefined);
        ws.on("message", (data, binary) => {
          received.push({ data: data.toString(), binary });
          ws.send(data, { binary });
          sawMessage();
        });
      });
    };
    if (options.delayUpgrade) releaseUpgrade = upgrade;
    else upgrade();
  });
  daemon.listen(0, "127.0.0.1");
  await once(daemon, "listening");
  const address = daemon.address();
  assert(address && typeof address === "object");
  const daemonBase = `http://127.0.0.1:${address.port}`;

  const gateway = createServer();
  gateway.on("upgrade", (req, socket, head) => {
    gatewaySockets.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      void relayBrowserVnc(ws, {
        resolveDaemonBase: async () => daemonBase,
        headers,
        allowLegacyBearer: true,
        onError: (message) => errors.push(message),
        ...options.relay,
      });
    });
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  const gatewayAddress = gateway.address();
  assert(gatewayAddress && typeof gatewayAddress === "object");
  const client = new WebSocket(`ws://127.0.0.1:${gatewayAddress.port}`);
  sockets.add(client);
  client.on("error", () => undefined);
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    client.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  t.after(async () => {
    for (const ws of sockets) ws.terminate();
    daemonSockets.close();
    gatewaySockets.close();
    daemon.closeAllConnections();
    gateway.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => daemon.close(() => resolve())),
      new Promise<void>((resolve) => gateway.close(() => resolve())),
    ]);
  });
  await once(client, "open");
  return {
    client, closed, errors, requests, upgrades, received, upgradeSeen, messageSeen,
    releaseUpgrade: () => {
      assert(releaseUpgrade, "daemon upgrade must be waiting");
      releaseUpgrade();
    },
  };
}

test("exchanges the authenticated daemon ticket and relays queued RFB bytes in order", { timeout: 5000 }, async (t) => {
  const f = await fixture(t, { delayUpgrade: true });
  await f.upgradeSeen;
  f.client.send(Buffer.from("RFB 003.008\n"));
  f.client.send("second-frame");
  // Exercise the CONNECTING queue while the mock daemon deliberately holds its handshake.
  await new Promise((resolve) => setTimeout(resolve, 30));
  const echoed: Array<{ data: string; binary: boolean }> = [];
  const echoedBoth = new Promise<void>((resolve) => {
    f.client.on("message", (data, binary) => {
      echoed.push({ data: data.toString(), binary });
      if (echoed.length === 2) resolve();
    });
  });
  f.releaseUpgrade();
  await echoedBoth;
  assert.deepEqual(f.requests, [{ path: "/v1/computer/vnc-ticket?botId=main", authorization: headers.authorization }]);
  assert.equal(f.upgrades[0].authorization, headers.authorization);
  const upstream = new URL(f.upgrades[0].path, "http://localhost");
  assert.equal(upstream.pathname, "/v1/computer/browser/vnc");
  assert.equal(upstream.searchParams.get("ticket"), daemonTicket);
  assert.deepEqual(echoed, [
    { data: "RFB 003.008\n", binary: true },
    { data: "second-frame", binary: false },
  ]);
  assert.deepEqual(f.received, echoed);
  assert.deepEqual(f.errors, []);
});

for (const status of [404, 405]) {
  test(`keeps legacy bearer-only daemons working when tickets return ${status}`, { timeout: 5000 }, async (t) => {
    const f = await fixture(t, {
      ticketResponse: (_req, res) => { res.writeHead(status); res.end(); },
    });
    const echoed = once(f.client, "message");
    f.client.send(Buffer.from("RFB"));
    await echoed;
    assert.deepEqual(f.upgrades, [{ path: "/v1/computer/browser/vnc", authorization: headers.authorization }]);
    assert.deepEqual(f.errors, []);
  });
}

for (const status of [401, 403, 500, 503]) {
  test(`fails closed rather than bypassing a ticket HTTP ${status}`, { timeout: 5000 }, async (t) => {
    const f = await fixture(t, {
      ticketResponse: (_req, res) => { res.writeHead(status); res.end("private diagnostics"); },
    });
    const close = await f.closed;
    assert.equal(close.code, 1011);
    assert.equal(close.reason, `Browser VNC ticket request failed (HTTP ${status})`);
    assert.equal(f.upgrades.length, 0);
    assert.deepEqual(f.errors, [close.reason]);
    assert(!close.reason.includes("private diagnostics"));
  });
}

for (const body of ["{}", "null", '{"ticket":123}', '{"ticket":" "}', "not json"]) {
  test(`rejects malformed daemon tickets (${body})`, { timeout: 5000 }, async (t) => {
    const f = await fixture(t, {
      ticketResponse: (_req, res) => { res.setHeader("content-type", "application/json"); res.end(body); },
    });
    const close = await f.closed;
    assert.equal(close.code, 1011);
    assert.equal(f.upgrades.length, 0);
    assert.equal(f.errors.length, 1);
  });
}

test("specialist relay requests the matching bot and rejects an unbound daemon ticket", { timeout: 5000 }, async (t) => {
  const f = await fixture(t, { relay: { botId: "github", handoffId: "handoff-1234567890" } });
  const close = await f.closed;
  assert.equal(close.code, 1011);
  assert.equal(f.requests[0].path, "/v1/computer/vnc-ticket?handoffId=handoff-1234567890&botId=github");
  assert.equal(f.upgrades.length, 0);
});

test("specialist relay accepts only a bot-bound ticket", { timeout: 5000 }, async (t) => {
  const f = await fixture(t, {
    relay: { botId: "github", handoffId: "handoff-1234567890" },
    ticketResponse: (_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ticket: daemonTicket, botId: "github" })); },
  });
  f.client.send(Buffer.from("RFB"));
  await once(f.client, "message");
  assert.equal(f.requests[0].path, "/v1/computer/vnc-ticket?handoffId=handoff-1234567890&botId=github");
  assert.equal(f.upgrades.length, 1);
});

test("does not use the legacy bearer path unless explicitly allowed", { timeout: 5000 }, async (t) => {
  const f = await fixture(t, {
    ticketResponse: (_req, res) => { res.writeHead(404); res.end(); },
    relay: { allowLegacyBearer: false },
  });
  const close = await f.closed;
  assert.equal(close.code, 1011);
  assert.equal(f.upgrades.length, 0);
});

test("reports rejected WebSocket handshakes without leaking tickets or credentials", { timeout: 5000 }, async (t) => {
  const f = await fixture(t, { rejectUpgrade: true });
  const close = await f.closed;
  assert.equal(close.code, 1011);
  assert.equal(close.reason, "Browser VNC handshake failed (HTTP 401)");
  assert.deepEqual(f.errors, [close.reason]);
  assert(!f.errors.join(" ").includes(daemonTicket));
  assert(!f.errors.join(" ").includes(headers.authorization));
});

test("bounds pending input while the daemon connection is not open", { timeout: 5000 }, async (t) => {
  const f = await fixture(t, { delayUpgrade: true, relay: { maxPendingBytes: 4 } });
  await f.upgradeSeen;
  f.client.send(Buffer.from("12345"));
  const close = await f.closed;
  assert.equal(close.code, 1009);
  assert.equal(close.reason, "Browser VNC pending input exceeded limit");
  f.releaseUpgrade();
  assert.equal(f.received.length, 0);
});

test("times out a stalled ticket exchange without opening a VNC socket", { timeout: 5000 }, async (t) => {
  const f = await fixture(t, {
    ticketResponse: () => undefined,
    relay: { connectionTimeoutMs: 100 },
  });
  const close = await f.closed;
  assert.equal(close.code, 1011);
  assert.equal(close.reason, "Browser VNC connection timed out");
  assert.equal(f.upgrades.length, 0);
});

test("does not create an upstream after the browser closes during host resolution", { timeout: 5000 }, async (t) => {
  let resolveBase!: (base: string) => void;
  const base = new Promise<string>((resolve) => { resolveBase = resolve; });
  const f = await fixture(t, { relay: { resolveDaemonBase: () => base } });
  f.client.close();
  await f.closed;
  resolveBase("http://127.0.0.1:1");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(f.requests.length, 0);
  assert.equal(f.upgrades.length, 0);
  assert.deepEqual(f.errors, []);
});
