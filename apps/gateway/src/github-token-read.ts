// The target bot, plugin, and configuration key are fixed by this command.
export const githubMcpTokenRead = String.raw`import json, os, pathlib, stat

if os.geteuid() != 0: raise SystemExit('Privileged credential access required')
base = pathlib.Path('/var/lib/superagent/plugin-control')
parts = ('services', 'github', 'data')
root = base
for part in parts:
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise SystemExit('Private plugin storage unavailable')
    root = root / part
info = root.lstat()
if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
    raise SystemExit('Private plugin data unavailable')
fd = os.open(root / 'registry.json', os.O_RDONLY | os.O_NOFOLLOW)
try:
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077 or info.st_uid != 0 or info.st_size > 28 * 1024 * 1024:
        raise SystemExit('Private plugin registry unavailable')
    with os.fdopen(fd, 'rb', closefd=False) as source:
        state = json.load(source)
finally:
    os.close(fd)
plugin = state.get('plugins', {}).get('vectra-github', {})
value = plugin.get('config', {}).get('github-token')
if not isinstance(value, str) or not value or len(value) > 8192:
    raise SystemExit('GitHub MCP credential unavailable')
print(json.dumps({'token':value}))
`;

export function githubMcpTokenCommand(): string {
  return `python3 -c '${githubMcpTokenRead.replace(/'/g, `'\\''`)}'`;
}
