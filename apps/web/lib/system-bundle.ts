/** Separate from the CLI version file. Written only after health checks pass. */
export const SYSTEM_STAMP_PATH = "/var/lib/superagent/system-stamp";

/** Archive members must live under one of these prefixes. /home/user is never allowed. */
export const SYSTEM_PATH_PREFIXES = [
  "/opt/vectra/wake-http/",
  "/opt/vectra/browser-runtime/",
  "/opt/vectra/bin/",
  "/usr/local/lib/supercharge/",
] as const;

export type SystemManifest = {
  version: string;
  notes: string[];
  archive: string;
  paths: string[];
  commands: string[];
};

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const COMMAND_RE = /^[A-Za-z0-9_ ./:=@+-]+$/;

export function parseSystemManifest(data: unknown): SystemManifest | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const version = String(row.version || "").replace(/^v/, "");
  if (!VERSION_RE.test(version)) return null;
  const notes = Array.isArray(row.notes)
    ? row.notes.map((note) => String(note).trim()).filter(Boolean).slice(0, 8)
    : [];
  const archive = String(row.archive || "").trim();
  if (!/^sandbox-system-\d+\.\d+\.\d+\.tar\.gz$/.test(archive)) return null;
  const paths = Array.isArray(row.paths) ? row.paths.map((path) => String(path)) : [];
  if (paths.length === 0 || paths.some((path) => !allowedSystemPath(`${path.replace(/\/+$/, "")}/`))) {
    return null;
  }
  const commands = Array.isArray(row.commands) ? row.commands.map((cmd) => String(cmd)) : [];
  if (commands.some((cmd) => !COMMAND_RE.test(cmd) || cmd.length > 200)) return null;
  return { version, notes, archive, paths, commands };
}

export function allowedSystemPath(path: string): boolean {
  if (path.includes("..") || path.startsWith("/home/user")) return false;
  return SYSTEM_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function compareSystemVersion(latest: string, current: string): number {
  const left = latest.split(".").map((part) => parseInt(part, 10) || 0);
  const right = current.split(".").map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0);
  }
  return 0;
}

export function systemUpdateScript(manifest: SystemManifest, archiveBase: string): string {
  const archiveUrl = `${archiveBase.replace(/\/+$/, "")}/${manifest.archive}`;
  const prefixes = SYSTEM_PATH_PREFIXES.map((prefix) => JSON.stringify(prefix)).join(", ");
  const commands = manifest.commands.map((cmd) => `sudo -n ${cmd}`).join("\n");
  return [
    "set -eu",
    'echo "--- stop services ---"',
    "for pidfile in /tmp/supercharge-daemon.pid /tmp/supercharge-wake-http.pid /tmp/supercharge-browser.pid; do",
    '  if [ -f "$pidfile" ]; then',
    '    pid="$(cat "$pidfile" 2>/dev/null || true)"',
    '    if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; sleep 1; kill -9 "$pid" 2>/dev/null || true; fi',
    '    rm -f "$pidfile"',
    "  fi",
    "done",
    'TMP="$(mktemp -d /tmp/supercharge-system-update.XXXXXX)"',
    'trap \'rm -rf "$TMP"\' EXIT',
    'echo "--- download ---"',
    `curl -fL --retry 3 -o "$TMP/bundle.tar.gz" ${JSON.stringify(archiveUrl)}`,
    'echo "--- check paths ---"',
    `python3 - "$TMP/bundle.tar.gz" <<'PY'`,
    "import sys, tarfile",
    `prefixes = (${prefixes})`,
    "with tarfile.open(sys.argv[1], 'r:gz') as archive:",
    "    for member in archive.getmembers():",
    "        name = member.name.lstrip('./')",
    "        path = name if name.startswith('/') else '/' + name",
    "        if '..' in path.split('/') or path.startswith('/home/user'):",
    "            raise SystemExit('refusing ' + path)",
    "        if not any(path.startswith(prefix) for prefix in prefixes):",
    "            raise SystemExit('refusing ' + path)",
    "print('paths ok')",
    "PY",
    'echo "--- unpack ---"',
    'sudo -n tar -C / -xzf "$TMP/bundle.tar.gz"',
    'echo "--- commands ---"',
    commands || "true",
    'echo "--- start wake and browser ---"',
    "if [ -x /opt/vectra/wake-http/start.sh ]; then /opt/vectra/wake-http/start.sh; fi",
    "if [ -x /opt/vectra/browser-runtime/start.sh ]; then /opt/vectra/browser-runtime/start.sh; fi",
    "curl -fsS http://127.0.0.1:8788/health >/dev/null",
    "echo SYSTEM_FILES_DONE",
  ].join("\n");
}

export function systemUpdateAvailable(latest: string | null, current: string | null): boolean {
  if (!latest || !VERSION_RE.test(latest)) return false;
  if (!current) return true;
  if (!VERSION_RE.test(current)) return false;
  return compareSystemVersion(latest, current) > 0;
}
