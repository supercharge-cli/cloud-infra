import { execInSession, restartDaemon, superchargeE2bUpdateBaseUrl } from "./gateway-client";
import {
  SYSTEM_STAMP_PATH,
  type SystemManifest,
  parseSystemManifest,
  systemUpdateAvailable,
  systemUpdateScript,
} from "./system-bundle";

export { SYSTEM_STAMP_PATH, parseSystemManifest, systemUpdateScript };
export type { SystemManifest };

export async function fetchSystemManifest(): Promise<SystemManifest | null> {
  const base = superchargeE2bUpdateBaseUrl();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(`${base}/sandbox-system.json`, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return parseSystemManifest(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getSystemVersionInfo(
  sessionId: string,
  sandboxId?: string,
): Promise<{
  current: string | null;
  latest: string | null;
  notes: string[];
  updateAvailable: boolean;
}> {
  const manifest = await fetchSystemManifest();
  const read = await execInSession(
    sessionId,
    `cat ${SYSTEM_STAMP_PATH} 2>/dev/null || true`,
    { timeout: 30, sandboxId, runtime: "supercharge" },
  );
  const current = String(read.stdout || "").trim().replace(/^v/, "") || null;
  const latest = manifest?.version || null;
  return {
    current,
    latest,
    notes: manifest?.notes || [],
    updateAvailable: systemUpdateAvailable(latest, current),
  };
}

export async function applySystemUpdate(
  sessionId: string,
  sandboxId: string | undefined,
  version: string,
): Promise<{ ok: boolean; from: string | null; to: string | null; notes: string[]; logs: string[] }> {
  const logs: string[] = [];
  const manifest = await fetchSystemManifest();
  if (!manifest || manifest.version !== version) {
    return {
      ok: false,
      from: null,
      to: null,
      notes: [],
      logs: ["Published system bundle does not match the requested version."],
    };
  }
  const before = await getSystemVersionInfo(sessionId, sandboxId);
  const applied = await execInSession(
    sessionId,
    systemUpdateScript(manifest, superchargeE2bUpdateBaseUrl()),
    { timeout: 300, sandboxId, runtime: "supercharge", cwd: "/tmp" },
  );
  const out = `${applied.stdout || ""}\n${applied.stderr || ""}`;
  logs.push(out.slice(0, 5000));
  if (applied.exitCode !== 0 || !out.includes("SYSTEM_FILES_DONE")) {
    await restartDaemon(sessionId, sandboxId, "supercharge").catch(() => undefined);
    return { ok: false, from: before.current, to: null, notes: manifest.notes, logs };
  }
  const restart = await restartDaemon(sessionId, sandboxId, "supercharge");
  logs.push(...restart.logs);
  if (!restart.ok) {
    return { ok: false, from: before.current, to: null, notes: manifest.notes, logs };
  }
  const health = await execInSession(
    sessionId,
    "curl -fsS http://127.0.0.1:8790/healthz >/dev/null && echo DAEMON_OK",
    { timeout: 30, sandboxId, runtime: "supercharge" },
  );
  if (!String(health.stdout || "").includes("DAEMON_OK")) {
    logs.push("Daemon health check failed. Stamp left unchanged.");
    return { ok: false, from: before.current, to: null, notes: manifest.notes, logs };
  }
  const stamp = await execInSession(
    sessionId,
    `sudo -n mkdir -p /var/lib/superagent && printf '%s\\n' ${JSON.stringify(manifest.version)} | sudo -n tee ${SYSTEM_STAMP_PATH} >/dev/null && echo STAMP_OK`,
    { timeout: 30, sandboxId, runtime: "supercharge" },
  );
  logs.push(String(stamp.stdout || "").slice(0, 500));
  const ok = String(stamp.stdout || "").includes("STAMP_OK");
  return {
    ok,
    from: before.current,
    to: ok ? manifest.version : null,
    notes: manifest.notes,
    logs,
  };
}
