/** Separate from the CLI version file. Written only after health checks pass. */
export const SYSTEM_STAMP_PATH = "/var/lib/superagent/system-stamp";

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
  desktopProtocol?: 1;
  requiresOptIn?: boolean;
  sha256?: string;
};

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const COMMAND_RE = /^[A-Za-z0-9_ ./:=@+-]+$/;

export function parseSystemManifest(data: unknown): SystemManifest | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const version = String(row.version || "").replace(/^v/, "");
  if (!VERSION_RE.test(version)) return null;
  const notes = Array.isArray(row.notes) ? row.notes.map((note) => String(note).trim()).filter(Boolean).slice(0, 8) : [];
  const archive = String(row.archive || "").trim();
  if (!/^sandbox-(system|desktop)-\d+\.\d+\.\d+\.tar\.gz$/.test(archive)) return null;
  const paths = Array.isArray(row.paths) ? row.paths.map(String) : [];
  if (!paths.length || paths.some((path) => !allowedSystemPath(`${path.replace(/\/+$/, "")}/`))) return null;
  const commands = Array.isArray(row.commands) ? row.commands.map(String) : [];
  if (commands.some((cmd) => !COMMAND_RE.test(cmd) || cmd.length > 200)) return null;
  const desktop = archive.startsWith("sandbox-desktop-");
  if (desktop && (row.desktopProtocol !== 1 || row.requiresOptIn !== true || !/^[a-f0-9]{64}$/.test(String(row.sha256)) || commands.length)) return null;
  if (!desktop && row.desktopProtocol !== undefined) return null;
  return { version, notes, archive, paths, commands, ...(desktop ? { desktopProtocol: 1, requiresOptIn: true, sha256: String(row.sha256) } : {}) };
}

export function allowedSystemPath(path: string): boolean {
  if (path.includes("..") || path.startsWith("/home/user")) return false;
  return SYSTEM_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function compareSystemVersion(latest: string, current: string): number {
  const left = latest.split(".").map((part) => parseInt(part, 10) || 0);
  const right = current.split(".").map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i++) if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0);
  return 0;
}

export function systemUpdateScript(manifest: SystemManifest, archiveBase: string): string {
  const archiveUrl = `${archiveBase.replace(/\/+$/, "")}/${manifest.archive}`;
  const prefixes = SYSTEM_PATH_PREFIXES.map((prefix) => JSON.stringify(prefix)).join(", ");
  return [
    "set -eu",
    'TMP="$(mktemp -d /tmp/supercharge-system-update.XXXXXX)"',
    'trap \'rm -rf "$TMP"\' EXIT',
    'echo "--- download ---"',
    `curl -fL --retry 3 -o "$TMP/bundle.tar.gz" ${JSON.stringify(archiveUrl)}`,
    manifest.sha256 ? `printf '%s  %s\\n' '${manifest.sha256}' "$TMP/bundle.tar.gz" | sha256sum -c -` : "true",
    'echo "--- check paths ---"',
    `python3 - "$TMP/bundle.tar.gz" <<'PY'`,
    "import os, sys, tarfile",
    `prefixes = (${prefixes})`,
    "with tarfile.open(sys.argv[1], 'r:gz') as archive:",
    "    members = archive.getmembers()",
    "    if len(members) > 10000 or sum(m.size for m in members) > 512 * 1024 * 1024:",
    "        raise SystemExit('refusing oversized system bundle')",
    "    for member in members:",
    "        name = member.name",
    "        while name.startswith('./'): name = name[2:]",
    "        path = '/' + name.rstrip('/')",
    "        if name.startswith('/') or '..' in name.split('/') or path.startswith('/home/user'):",
    "            raise SystemExit('refusing ' + path)",
    "        parent = member.isdir() and any(prefix.startswith(path + '/') for prefix in prefixes)",
    "        allowed = any(path.startswith(prefix) or (member.isdir() and path + '/' == prefix) for prefix in prefixes)",
    "        if not (parent or allowed) or not (member.isfile() or member.isdir()) or member.mode & 0o6000:",
    "            raise SystemExit('refusing ' + path)",
    "        current = path",
    "        while current != '/':",
    "            if os.path.islink(current): raise SystemExit('refusing destination symlink ' + current)",
    "            current = os.path.dirname(current)",
    "print('paths ok')",
    "PY",
    ...(manifest.desktopProtocol ? [
      'echo "--- desktop prerequisites ---"',
      "for command in Xvfb xdpyinfo xfce4-session xdotool wmctrl xclip dbus-daemon xauth; do command -v \"$command\" >/dev/null || { echo \"Missing desktop dependency: $command. Explicit runtime preparation is required.\"; exit 1; }; done",
      "python3 -c 'import PIL.ImageGrab, Xlib'",
      // Legacy Playwright owns Chromium's lifetime and has no persistent CDP listener.
      // Refuse to kill that process or discard its live tabs during a file-only update.
      "curl -fsS --max-time 3 http://127.0.0.1:9222/json/version >/dev/null || { echo 'This legacy browser requires an explicit desktop migration, not a hot update. Current tabs were preserved.'; exit 1; }",
    ] : []),
    'echo "--- stop services ---"',
    "python3 - <<'PY'",
    "import os, pathlib, signal, time",
    "services = [('/tmp/supercharge-wake-http.pid', 'wake-http'), ('/tmp/supercharge-browser/pid', 'browser-runtime/server.mjs')]",
    "for filename, expected in services:",
    "    path = pathlib.Path(filename)",
    "    if not path.exists(): continue",
    "    raw = path.read_text().strip()",
    "    if not raw.isdecimal(): raise SystemExit('invalid service pid: ' + filename)",
    "    pid = int(raw)",
    "    proc = pathlib.Path('/proc') / str(pid)",
    "    if not proc.exists(): continue",
    "    args = (proc / 'cmdline').read_bytes().replace(b'\\0', b' ').decode(errors='replace')",
    "    if not args: continue",
    "    if expected not in args: raise SystemExit('refusing unrelated process: ' + filename)",
    "    os.kill(pid, signal.SIGTERM)",
    "    for _ in range(100):",
    "        if not proc.exists() or ') Z ' in (proc / 'stat').read_text(): break",
    "        time.sleep(0.1)",
    "    else: raise SystemExit('service did not stop; refusing forced termination')",
    "    path.unlink(missing_ok=True)",
    "PY",
    'echo "--- unpack ---"',
    'if [ -w /opt/vectra ]; then tar --no-same-owner --no-same-permissions -C / -xzf "$TMP/bundle.tar.gz"; else sudo -n tar --no-same-owner --no-same-permissions -C / -xzf "$TMP/bundle.tar.gz"; fi',
    ...manifest.commands.map((cmd) => `sudo -n ${cmd}`),
    'echo "--- start wake and browser ---"',
    "if [ -x /opt/vectra/wake-http/start.sh ]; then /opt/vectra/wake-http/start.sh; fi",
    "if [ -x /opt/vectra/browser-runtime/start.sh ]; then /opt/vectra/browser-runtime/start.sh; fi",
    "curl -fsS http://127.0.0.1:8788/health >/dev/null",
    ...(manifest.desktopProtocol ? ["curl -fsS http://127.0.0.1:9224/health | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get(\"desktopProtocol\")==1 and d.get(\"handoffProtocol\")==2 and d.get(\"browser\")'" ] : []),
    "echo SYSTEM_FILES_DONE",
  ].join("\n");
}

export function systemUpdateAvailable(latest: string | null, current: string | null): boolean {
  if (!latest || !VERSION_RE.test(latest)) return false;
  if (!current) return true;
  if (!VERSION_RE.test(current)) return false;
  return compareSystemVersion(latest, current) > 0;
}
