import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

/**
 * The workspace host is the Go process that serves files, terminal, turns,
 * agents, settings and desktop handoff on the app port inside a Supercharge
 * sandbox. The gateway installs it, hands it per-device sessions, and keeps
 * exactly one copy running.
 */
export const HOST_PORT = 8790;
export const HOST_DIR = "/home/user/.vectrabot";
export const HOST_BIN = `${HOST_DIR}/bin/sandbox-host`;
/** Devices that can stay signed in at once; the oldest session drops off. */
export const HOST_MAX_SESSIONS = 8;

export type HostBinary = { bytes: Buffer; sha256: string };

/** Where the gateway image bakes the host (see Dockerfile). */
export const BAKED_HOST_BINARY = "/app/sandbox-host";

let cached: { key: string; binary: HostBinary } | undefined;

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Load the host binary from VECTRABOT_HOST_BINARY (a file in the gateway image)
 * or VECTRABOT_HOST_URL, which must match VECTRABOT_HOST_SHA256. With neither
 * set, the copy the Dockerfile bakes at /app/sandbox-host is used.
 */
export async function loadHostBinary(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  baked: string = BAKED_HOST_BINARY,
): Promise<HostBinary> {
  const url = env.VECTRABOT_HOST_URL?.trim();
  // With nothing configured, use the copy baked into the gateway image.
  const file = env.VECTRABOT_HOST_BINARY?.trim() || (!url && existsSync(baked) ? baked : undefined);
  const expected = env.VECTRABOT_HOST_SHA256?.trim().toLowerCase();
  const key = JSON.stringify([file, url, expected]);
  if (cached?.key === key) return cached.binary;
  let bytes: Buffer;
  if (file) {
    bytes = await readFile(file);
  } else if (url) {
    if (!expected || !/^[0-9a-f]{64}$/.test(expected)) {
      throw new Error("VECTRABOT_HOST_SHA256 is required with VECTRABOT_HOST_URL");
    }
    const response = await fetchImpl(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`Workspace host download failed (HTTP ${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
  } else {
    throw new Error("Workspace host binary is not configured (VECTRABOT_HOST_BINARY or VECTRABOT_HOST_URL)");
  }
  const digest = sha256(bytes);
  if (expected && digest !== expected) throw new Error("Workspace host binary does not match VECTRABOT_HOST_SHA256");
  if (bytes.length < 1024 || bytes.subarray(0, 4).toString("latin1") !== "\x7fELF") {
    throw new Error("Workspace host binary is not a Linux executable");
  }
  const binary = { bytes, sha256: digest };
  cached = { key, binary };
  return binary;
}

export function validSessionToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

export function validLabel(label: unknown): string {
  const text = typeof label === "string" ? label : "";
  return text.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 32) || "device";
}

/** Prints the installed binary's digest (or nothing). */
export const hostDigestCommand = `sha256sum ${HOST_BIN} 2>/dev/null | cut -d' ' -f1`;

/**
 * Adds a session and (re)starts the host when it is missing, unhealthy, or out
 * of date. Secrets arrive as environment variables, never in the script text:
 *   VECTRABOT_NEW_SESSION, VECTRABOT_NEW_LABEL, VECTRABOT_CLOUD_TOKEN, VECTRABOT_WANT_SHA
 * The template's own app daemon is stopped because the host replaces it on the
 * app port. Port 8788 (wake doorbell) is left alone.
 */
export function hostStartScript(): string {
  const dir = HOST_DIR;
  return [
    "set -u",
    `D=${dir}`,
    `BIN=${HOST_BIN}`,
    "umask 077",
    'mkdir -p "$D/bin" /home/user/workspace',
    'chmod 700 "$D"',
    'touch "$D/sessions"',
    `{ tail -n ${HOST_MAX_SESSIONS - 1} "$D/sessions"; printf '%s %s\\n' "$VECTRABOT_NEW_SESSION" "$VECTRABOT_NEW_LABEL"; } > "$D/sessions.next"`,
    'mv "$D/sessions.next" "$D/sessions"',
    'printf "%s" "$VECTRABOT_CLOUD_TOKEN" > "$D/cloud-token"',
    "healthy() { curl -sf -m 2 http://127.0.0.1:" + HOST_PORT + "/health 2>/dev/null | grep -q sandbox-host; }",
    'RUNNING=0',
    'if [ -f "$D/host.pid" ] && kill -0 "$(cat "$D/host.pid")" 2>/dev/null && healthy && [ "$(cat "$D/host.sha" 2>/dev/null)" = "$VECTRABOT_WANT_SHA" ]; then RUNNING=1; fi',
    'if [ "$RUNNING" = "1" ]; then echo HOST_REUSED; echo HOST_OK; exit 0; fi',
    'if [ -f "$D/host.pid" ]; then kill "$(cat "$D/host.pid")" 2>/dev/null || true; fi',
    'if [ -f /tmp/supercharge-daemon.pid ]; then kill "$(cat /tmp/supercharge-daemon.pid)" 2>/dev/null || true; fi',
    // Bracketed patterns so pkill cannot match this script's own command line.
    "pkill -f '[s]upercharge-superagent-server' 2>/dev/null || true",
    "pkill -f '[s]upercharge agent daemon' 2>/dev/null || true",
    "for i in $(seq 1 20); do ss -ltn 2>/dev/null | grep -q ':" + HOST_PORT + " ' || break; sleep 0.25; done",
    // Start from a clean slate: the host must not inherit this call's one-off values.
    'if [ -z "${E2B_SANDBOX_ID:-}" ] && [ -f /run/e2b/.E2B_SANDBOX_ID ]; then E2B_SANDBOX_ID=$(tr -d " \\n" < /run/e2b/.E2B_SANDBOX_ID); export E2B_SANDBOX_ID; fi',
    'env -u VECTRABOT_NEW_SESSION -u VECTRABOT_NEW_LABEL -u VECTRABOT_WANT_SHA VECTRABOT_HOST_ADDR=0.0.0.0:' + HOST_PORT + ' VECTRABOT_WORKSPACE=/home/user/workspace VECTRABOT_SESSION_FILE="$D/sessions" VECTRABOT_PIDFILE=/tmp/supercharge-daemon.pid VECTRABOT_CLOUD_TOKEN="$(cat "$D/cloud-token")" SUPERAGENT_BROWSER_SIDECAR_PORT="${SUPERAGENT_BROWSER_SIDECAR_PORT:-9223}" setsid nohup "$BIN" >"$D/host.log" 2>&1 < /dev/null &',
    'echo $! > "$D/host.pid"',
    'printf "%s" "$VECTRABOT_WANT_SHA" > "$D/host.sha"',
    "for i in $(seq 1 60); do if healthy; then echo HOST_STARTED; echo HOST_OK; exit 0; fi; sleep 0.25; done",
    "echo HOST_FAIL",
    'tail -20 "$D/host.log" 2>/dev/null || true',
  ].join("\n");
}
