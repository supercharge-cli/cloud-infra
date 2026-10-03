// Reviewed assets are immutable; a missing or changed upstream asset fails closed.
export const pluginRuntimeAssets = Object.freeze([
  {
    name: "control.mjs",
    url: "https://raw.githubusercontent.com/iotserver24/supercharge-app/893407e48f125a857ef36a894c74623a0af2a670/public/managed-mcp/runtime-1/control.mjs",
    sha256: "21e8a7d98e5f1bdfb1cd2b27a34acd72f6fae8b0436a914c988e92e074d92e0f",
  },
  {
    name: "catalog.json",
    url: "https://raw.githubusercontent.com/iotserver24/supercharge-app/893407e48f125a857ef36a894c74623a0af2a670/public/managed-mcp/runtime-1/catalog.json",
    sha256: "7ca15670706504a575b7e94a97d607150c57d28fb5adb315295f83d7676534df",
  },
] as const);

// This program is executed only through the E2B control plane as root. Its only
// argument is a fixed mode; neither HTTP requests nor tenant files supply commands.
export const pluginRuntimeProgram = `import fcntl, hashlib, json, os, pathlib, stat, subprocess, sys, tempfile, urllib.request

BASE = pathlib.Path('/opt/vectra/plugin-api')
ASSETS = ${JSON.stringify(pluginRuntimeAssets)}
NODE = pathlib.Path('/usr/bin/node')
BUNDLED_NODE = BASE / 'node/bin/node'
BUNDLED_NODE_SHA = 'b1cbec894e45a5814b6ab756e1e14f8a76516273197e67e0412b57c1e10d0d9f'
BACKUP = BASE / '.runtime-update-backup'
LOCK = BASE / '.runtime-update.lock'
ORIGIN = 'https://api.githubcopilot.com'

def regular(path, optional=False):
    try:
        item = path.lstat()
    except FileNotFoundError:
        if optional:
            return False
        raise RuntimeError('Required runtime file is missing')
    if not stat.S_ISREG(item.st_mode) or item.st_uid != 0 or item.st_gid != 0 or item.st_mode & 0o022 or item.st_nlink != 1:
        raise RuntimeError('Unsafe runtime file ownership, link or permissions')
    return True

def directory(path):
    item = path.lstat()
    if not stat.S_ISDIR(item.st_mode) or item.st_uid != 0 or item.st_gid != 0 or item.st_mode & 0o022:
        raise RuntimeError('Unsafe runtime directory ownership or permissions')

def digest(data):
    return hashlib.sha256(data).hexdigest()

def file_digest(path):
    with open(path, 'rb') as source:
        h = hashlib.sha256()
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
        return h.hexdigest()

def node_safe():
    try:
        directory(BASE / 'node')
        directory(BASE / 'node/bin')
        regular(BUNDLED_NODE)
        return file_digest(BUNDLED_NODE) == BUNDLED_NODE_SHA
    except (RuntimeError, FileNotFoundError):
        return False

def secure_node():
    if node_safe():
        return
    directory(BASE / 'node')
    bin_dir = BASE / 'node/bin'
    info = bin_dir.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o022:
        raise RuntimeError('Bundled Node directory is unsafe')
    fd = os.open(BUNDLED_NODE, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o022:
            raise RuntimeError('Bundled Node executable is unsafe')
        h = hashlib.sha256()
        while True:
            block = os.read(fd, 1024 * 1024)
            if not block:
                break
            h.update(block)
        if h.hexdigest() != BUNDLED_NODE_SHA:
            raise RuntimeError('Bundled Node executable differs from reviewed Node release')
        os.chown(bin_dir, 0, 0)
        os.fchown(fd, 0, 0)
    finally:
        os.close(fd)
    node_dir = BASE / 'node'
    for current, dirs, files in os.walk(node_dir, followlinks=False):
        directory(pathlib.Path(current))
        for name in dirs + files:
            target = pathlib.Path(current) / name
            info = target.lstat()
            if stat.S_ISLNK(info.st_mode):
                resolved = target.resolve(strict=True)
                if not resolved.is_relative_to(node_dir):
                    raise RuntimeError('Bundled Node link escapes its runtime')
                os.chown(target, 0, 0, follow_symlinks=False)
                dirs[:] = [entry for entry in dirs if entry != name]
            elif stat.S_ISDIR(info.st_mode) or (stat.S_ISREG(info.st_mode) and info.st_nlink == 1):
                if info.st_mode & 0o022:
                    raise RuntimeError('Bundled Node file is writable by other users')
                os.chown(target, 0, 0, follow_symlinks=False)
            else:
                raise RuntimeError('Unexpected bundled Node file type')
    if not node_safe():
        raise RuntimeError('Bundled Node ownership repair failed')

def state():
    hashes = {}
    for asset in ASSETS:
        path = BASE / asset['name']
        hashes[asset['name']] = digest(path.read_bytes()) if regular(path, True) else None
    catalog = json.loads((BASE / 'catalog.json').read_bytes()) if hashes['catalog.json'] else {}
    reviewed = {p.get('id') for p in catalog.get('plugins', [])} if isinstance(catalog.get('plugins'), list) else set()
    return {'ready': hashes == {a['name']: a['sha256'] for a in ASSETS} and {'vectra-echo', 'vectra-github'} <= reviewed and node_safe(), 'hashes': hashes}

def validate():
    if not node_safe():
        raise RuntimeError('Bundled Node runtime is not root-owned and verified')
    for asset in ASSETS:
        path = BASE / asset['name']
        regular(path)
        if digest(path.read_bytes()) != asset['sha256']:
            raise RuntimeError('Runtime asset checksum mismatch')
    catalog = json.loads((BASE / 'catalog.json').read_bytes())
    if catalog.get('schemaVersion') != 1 or {p.get('id') for p in catalog.get('plugins', [])} != {'vectra-echo', 'vectra-github'}:
        raise RuntimeError('Reviewed catalog mismatch')
    if subprocess.run([str(NODE), '--check', str(BASE / 'control.mjs')], capture_output=True, timeout=15).returncode != 0:
        raise RuntimeError('Controller syntax check failed')
    if ORIGIN.encode() not in (BASE / 'control.mjs').read_bytes():
        raise RuntimeError('GitHub origin not allowlisted')
    regular(BASE / 'plugin-api-server-0.1.0.mjs')
    regular(BASE / 'plugin-bridge-0.1.0.mjs')
    for artifact in ('plugin-api-server-0.1.0.mjs', 'plugin-bridge-0.1.0.mjs'):
        sidecar = BASE / (artifact + '.sha256')
        regular(sidecar)
        if digest((BASE / artifact).read_bytes()) != sidecar.read_text().strip().split()[0]:
            raise RuntimeError('Plugin API service artifact checksum mismatch')

def write_atomic(path, data, mode=0o644):
    fd, temporary = tempfile.mkstemp(prefix='.runtime-stage-', dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.lexists(temporary):
            os.unlink(temporary)

def restore():
    directory(BACKUP)
    for asset in ASSETS:
        old = BACKUP / asset['name']
        if regular(old, True):
            write_atomic(BASE / asset['name'], old.read_bytes(), old.stat().st_mode & 0o777)
        else:
            target = BASE / asset['name']
            if regular(target, True):
                target.unlink()
    for asset in ASSETS:
        old = BACKUP / asset['name']
        if regular(old, True):
            old.unlink()
    BACKUP.rmdir()

def update():
    current = state()
    if current['ready']:
        validate()
        return {'ready': True, 'updated': False}
    if BACKUP.exists() or BACKUP.is_symlink():
        raise RuntimeError('Prior update backup requires operator review')
    for asset in ASSETS:
        regular(BASE / asset['name'], True)
    # Do not replace a controller while it is executing another plugin operation.
    for pid in os.listdir('/proc'):
        if not pid.isdigit() or int(pid) == os.getpid():
            continue
        try:
            cmd = (pathlib.Path('/proc') / pid / 'cmdline').read_bytes().split(b'\\0')
            if str(BASE / 'control.mjs').encode() in cmd:
                raise RuntimeError('Plugin controller is busy; retry later')
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
    staged = {}
    for asset in ASSETS:
        request = urllib.request.Request(asset['url'], headers={'User-Agent': 'VectraPluginRuntime/1'})
        with urllib.request.urlopen(request, timeout=20) as response:
            data = response.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024 or digest(data) != asset['sha256']:
            raise RuntimeError('Pinned asset download checksum mismatch')
        staged[asset['name']] = data
    secure_node()
    BACKUP.mkdir(mode=0o700)
    try:
        for asset in ASSETS:
            target = BASE / asset['name']
            if regular(target, True):
                write_atomic(BACKUP / asset['name'], target.read_bytes(), target.stat().st_mode & 0o777)
        for asset in ASSETS:
            target = BASE / asset['name']
            mode = target.stat().st_mode & 0o777 if regular(target, True) else 0o644
            write_atomic(target, staged[asset['name']], mode)
        validate()
        return {'ready': True, 'updated': True}
    except BaseException:
        restore()
        raise

if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in ('status', 'update', 'rollback', 'confirm'):
    raise SystemExit('Unauthorized runtime update invocation')
directory(BASE)
regular(NODE)
regular(LOCK, True)
fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
with os.fdopen(fd, 'rb') as lock:
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    mode = sys.argv[1]
    if mode == 'status':
        result = state()
    elif mode == 'update':
        result = update()
    else:
        if mode == 'rollback':
            restore()
            result = {'rolledBack': True}
        else:
            directory(BACKUP)
            validate()
            result = {'confirmed': True}
    print(json.dumps(result))
`;

export function pluginRuntimeCommand(mode: "status" | "update" | "rollback" | "confirm"): string {
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  return `python3 -c ${quote(pluginRuntimeProgram)} ${mode}`;
}
