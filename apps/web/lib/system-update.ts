import { appInboxFetch, execInSession, superchargeE2bUpdateBaseUrl } from "./gateway-client";
import { SYSTEM_STAMP_PATH, type SystemManifest, parseSystemManifest, systemUpdateAvailable, systemUpdateScript } from "./system-bundle";

export { SYSTEM_STAMP_PATH, parseSystemManifest, systemUpdateScript };
export type { SystemManifest };

export async function fetchSystemManifest(desktop = false): Promise<SystemManifest | null> {
  const base = superchargeE2bUpdateBaseUrl();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    // Older clients only read sandbox-system.json; never publish desktop migrations there.
    const res = await fetch(`${base}/${desktop ? "sandbox-desktop" : "sandbox-system"}.json`, { signal: ac.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return parseSystemManifest(await res.json());
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export async function getSystemVersionInfo(sessionId: string, sandboxId?: string): Promise<{ current: string | null; latest: string | null; notes: string[]; updateAvailable: boolean }> {
  const manifest = await fetchSystemManifest();
  const read = await execInSession(sessionId, `cat ${SYSTEM_STAMP_PATH} 2>/dev/null || true`, { timeout: 30, sandboxId, runtime: "supercharge" });
  const current = String(read.stdout || "").trim().replace(/^v/, "") || null;
  const latest = manifest?.version || null;
  return { current, latest, notes: manifest?.notes || [], updateAvailable: systemUpdateAvailable(latest, current) };
}

export async function applySystemUpdate(
  sessionId: string,
  sandboxId: string | undefined,
  version: string,
  options: { desktopOptIn?: boolean } = {},
): Promise<{ ok: boolean; from: string | null; to: string | null; notes: string[]; logs: string[] }> {
  const logs: string[] = [];
  const manifest = await fetchSystemManifest(options.desktopOptIn === true);
  const rejected = (message: string) => ({ ok: false, from: null, to: null, notes: manifest?.notes || [], logs: [...logs, message] });
  if (!manifest || manifest.version !== version) return rejected("Published system bundle does not match the requested version.");
  if (manifest.requiresOptIn && options.desktopOptIn !== true) return rejected("This sandbox requires explicit desktop upgrade opt-in.");
  const before = await getSystemVersionInfo(sessionId, sandboxId);
  const inbox = (path: string, action?: string) => appInboxFetch(sessionId, path, {
    signal: AbortSignal.timeout(10_000),
    ...(action ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) } : {}),
  }, { sandboxId, runtime: "supercharge" });
  let prepared = false;
  let applied = false;
  try {
    if (!manifest.desktopProtocol) {
      const statusResponse = await inbox("/v1/computer/status");
      if (!statusResponse.ok) return rejected("Cannot verify desktop capabilities; leaving this sandbox unchanged.");
      const status = await statusResponse.json() as { desktopProtocol?: number };
      if ((status.desktopProtocol || 0) > 0) return rejected("This sandbox has a desktop runtime; a browser-only system bundle must not replace it.");
    }
    // The daemon atomically refuses active tasks/handoffs and blocks new turns before files change.
    const preparation = await inbox("/v1/app/maintenance", "prepare_update");
    const state = await preparation.json() as { ok?: boolean; busy?: boolean; error?: string };
    if (!preparation.ok || state.ok !== true || state.busy !== false) return rejected(state.error || "The daemon cannot safely prepare this update. Update its CLI explicitly first; no processes were stopped.");
    prepared = true;
    const result = await execInSession(sessionId, systemUpdateScript(manifest, superchargeE2bUpdateBaseUrl()), { timeout: 300, sandboxId, runtime: "supercharge", cwd: "/tmp" });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    logs.push(output.slice(0, 5000));
    applied = result.exitCode === 0 && output.includes("SYSTEM_FILES_DONE");
    if (!applied) return { ...rejected("System files were not confirmed healthy. The stamp was left unchanged."), from: before.current };
    const health = await inbox("/healthz");
    if (!health.ok) return { ...rejected("Daemon health check failed; stamp left unchanged."), from: before.current };
    if (manifest.desktopProtocol) {
      const response = await inbox("/v1/computer/status");
      const status = await response.json() as { desktopProtocol?: number; connected?: boolean };
      if (!response.ok || status.desktopProtocol !== 1 || status.connected !== true) return { ...rejected("Desktop readiness check failed; stamp left unchanged."), from: before.current };
    }
    const stamp = await execInSession(sessionId, `mkdir -p /var/lib/superagent && printf '%s\\n' ${JSON.stringify(manifest.version)} > ${SYSTEM_STAMP_PATH} && echo STAMP_OK`, { timeout: 30, sandboxId, runtime: "supercharge" });
    const ok = stamp.exitCode === 0 && String(stamp.stdout || "").includes("STAMP_OK");
    logs.push(ok ? "System files and desktop health verified; workspace and running browser preserved." : "Version stamp could not be saved.");
    return { ok, from: before.current, to: ok ? manifest.version : null, notes: manifest.notes, logs };
  } catch (error) {
    return { ...rejected((error as Error).message), from: before.current };
  } finally {
    if (prepared) {
      // This never force-restarts the daemon or an existing browser on an update failure.
      const response = await inbox("/v1/app/maintenance", "resume").catch(() => null);
      if (!response?.ok) logs.push("Maintenance remains paused because safe resume could not be confirmed.");
    }
  }
}
