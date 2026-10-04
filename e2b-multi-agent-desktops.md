# Multiple agent desktops on E2B: one shared filesystem, a separate screen per agent

## 1. How it works

Each agent gets its own X display (`:1`, `:2`, …) inside one Linux VM. Each display is a separate `Xvfb` server, so it has its own screen, mouse pointer, keyboard focus and clipboard. Every display runs its own window manager, its own Chrome profile and debugging port, and its own x11vnc/noVNC viewer, while all agents share the same disk.

- **Watching a screen:** `DISPLAY=:N scrot`, or that display's noVNC URL.
- **Controlling it:** `DISPLAY=:N xdotool …` for any app, or Chrome's debugging protocol (CDP) on that agent's port for the browser.
- **Running shell commands:** `sandbox.commands.run(...)`.

The E2B Desktop SDK does exactly this for a single display. Its source starts `Xvfb {display} -ac -screen 0 WxHx24 ...` and then a desktop session, and every click or keypress is a `commands.run("xdotool ...")`. Here we just repeat that for N displays.

### What the docs confirm (with URLs)

| Thing | API |
|---|---|
| Base sandbox | `from e2b import Sandbox` / `AsyncSandbox` → `Sandbox.create(template=None, timeout=None, metadata=None, envs=None, ...)` (timeout is in **seconds** in Python; JS uses `timeoutMs`). https://docs.e2b.dev/sandbox.md |
| Desktop sandbox | `from e2b_desktop import Sandbox` (`pip install e2b-desktop`) / `import { Sandbox } from '@e2b/desktop'`. Extra args: `resolution=(w,h)` (default 1024×768), `dpi` (96), `display` (":0"). Default template `"desktop"`. https://docs.e2b.dev/sdk-reference/desktop-python-sdk/v2.4.2/desktop.md |
| Shell | `sandbox.commands.run(cmd, background=None, envs=None, user=None, cwd=None, timeout=60, ...)`. Background runs return a handle (`.pid`, `.kill()`, `.wait()`); `timeout=0` = no limit. https://docs.e2b.dev/commands.md · https://docs.e2b.dev/commands/background.md |
| Desktop control | `screenshot()`, `left_click(x,y)`, `double_click`, `right_click`, `middle_click`, `scroll(direction,amount)`, `move_mouse(x,y)`, `mouse_press/mouse_release(button)`, `drag(fr,to)`, `write(text)`, `press(key or [keys])`, `get_cursor_position()`, `get_screen_size()`, `wait(ms)`, `open(file_or_url)`, `launch(app)`. JS uses camelCase. https://docs.e2b.dev/use-cases/computer-use.md |
| Live view | `stream.start(vnc_port=None, port=None, require_auth=False, window_id=None)`, `stream.get_url(...)`, `stream.get_auth_key()`, `stream.stop()`. Under the hood: x11vnc on 5900 → noVNC on 6080. One stream at a time. https://github.com/e2b-dev/desktop |
| Public URL for a port | `sandbox.get_host(port)` → `https://{port}-{sandboxId}.e2b.app`. https://docs.e2b.dev/network/public-url.md |
| Desktop template | Ubuntu 22.04, XFCE, xvfb, xdotool, scrot, x11vnc, noVNC at `/opt/noVNC`, google-chrome-stable, firefox-esr, VS Code. Built 8 vCPU / 8192 MB. https://docs.e2b.dev/template/examples/desktop.md |

---

## 2. Option A: one Desktop sandbox per agent (simplest, fully isolated)

The SDK's mouse/keyboard API works unchanged. To share files between agents, mount the same E2B **Volume** in every sandbox (https://docs.e2b.dev/volumes/mount.md). Volumes are in beta (https://docs.e2b.dev/faq/volumes-beta-limitations.md).

```python
# pip install e2b-desktop
# export E2B_API_KEY=...
from e2b import Volume
from e2b_desktop import Sandbox

shared = Volume.create("agents-shared")          # persistent, shared between sandboxes

def make_agent(name: str) -> Sandbox:
    d = Sandbox.create(
        resolution=(1280, 800),
        dpi=96,
        timeout=3600,                             # seconds; Hobby max 1h, Pro max 24h
        metadata={"agent": name},
        volume_mounts={"/mnt/shared": shared},    # same files for every agent
    )
    d.stream.start(require_auth=True)
    print(name, "live view:", d.stream.get_url(auth_key=d.stream.get_auth_key()))
    return d

agents = {n: make_agent(n) for n in ["researcher", "coder", "browser"]}

a = agents["browser"]
a.launch("google-chrome")                         # gtk-launch <app>
a.wait(5000)
a.left_click(640, 60)
a.write("https://e2b.dev")
a.press("enter")
open("browser.png", "wb").write(a.screenshot())   # bytes

a.commands.run("echo hi > /mnt/shared/from-browser.txt")
print(agents["coder"].commands.run("cat /mnt/shared/from-browser.txt").stdout)

for d in agents.values():
    d.kill()
```

```ts
// npm i @e2b/desktop
import { Sandbox } from '@e2b/desktop'

const d = await Sandbox.create({ resolution: [1280, 800], dpi: 96, timeoutMs: 3_600_000 })
await d.stream.start({ requireAuth: true })
console.log(d.stream.getUrl({ authKey: d.stream.getAuthKey() }))
await d.launch('google-chrome'); await d.wait(5000)
await d.leftClick(640, 60); await d.write('https://e2b.dev'); await d.press('enter')
const png = await d.screenshot()                  // Uint8Array
await d.kill()
```

---

## 3. Option B: one sandbox, many displays (shared filesystem, separate screens)

### 3a. Bootstrap script — `multi_display.sh`

Agent `i` gets `DISPLAY=:(BASE+i)`, VNC port `5900+D`, noVNC port `6080+D`, CDP port `9222+i`. With `BASE=1` this never collides with the SDK's own `:0`, 5900 or 6080.

```bash
#!/usr/bin/env bash
# multi_display.sh: one Xvfb + WM + Chrome + x11vnc + noVNC per agent, in ONE sandbox.
# Usage: multi_display.sh <N_AGENTS> [BASE_DISPLAY=1] [WIDTH=1280] [HEIGHT=800]
set -euo pipefail
N=${1:-3}; BASE=${2:-1}; W=${3:-1280}; H=${4:-800}
NOVNC_DIR=${NOVNC_DIR:-/opt/noVNC}
CHROME=${CHROME:-$(command -v google-chrome || command -v chromium || true)}
mkdir -p /tmp/agents

for i in $(seq 0 $((N-1))); do
  D=$((BASE+i)); DISP=":$D"
  VNC=$((5900+D)); WEB=$((6080+D)); CDP=$((9222+i))
  LOG=/tmp/agents/agent$i; mkdir -p "$LOG"

  # 1) Virtual framebuffer = own screen, pointer, keyboard focus, clipboard
  Xvfb "$DISP" -ac -screen 0 "${W}x${H}x24" -nolisten tcp >"$LOG/xvfb.log" 2>&1 &
  for _ in $(seq 1 50); do xdpyinfo -display "$DISP" >/dev/null 2>&1 && break; sleep 0.2; done

  # 2) Lightweight window manager, one per display, with its own dbus session
  DISPLAY="$DISP" dbus-launch --exit-with-session openbox >"$LOG/wm.log" 2>&1 &

  # 3) Browser with its OWN profile and its OWN CDP port
  if [ -n "$CHROME" ]; then
    DISPLAY="$DISP" "$CHROME" --no-first-run --no-default-browser-check \
      --user-data-dir="${PROFILE_ROOT:-/home/user}/.agent$i-chrome" \
      --remote-debugging-port="$CDP" --window-position=0,0 --window-size="$W,$H" \
      about:blank >"$LOG/chrome.log" 2>&1 &
  fi

  # 4) VNC server for this display only, plus the noVNC web client
  x11vnc -display "$DISP" -forever -shared -nopw -rfbport "$VNC" -bg -o "$LOG/x11vnc.log" >/dev/null 2>&1
  if [ -x "$NOVNC_DIR/utils/novnc_proxy" ]; then
    (cd "$NOVNC_DIR/utils" && ./novnc_proxy --vnc "localhost:$VNC" --listen "$WEB" --web "$NOVNC_DIR" >"$LOG/novnc.log" 2>&1 &)
  fi

  echo "agent$i DISPLAY=$DISP vnc=$VNC novnc=$WEB cdp=$CDP"
done
```

Notes:
- **Window manager:** openbox, because two XFCE sessions for the same user fight over the session bus. openbox isn't in the desktop template — install at runtime or bake into a custom template.
- **Passwords:** noVNC public URLs are open by default. For real use replace `-nopw` with `-rfbauth ~/.vnc/passwdN` (create with `x11vnc -storepasswd <pw> ~/.vnc/passwdN`).

### 3b. Python driver

```python
# pip install e2b-desktop
from e2b_desktop import Sandbox   # desktop template: Xvfb, xdotool, scrot, x11vnc, noVNC, Chrome included

N = 3
sbx = Sandbox.create(resolution=(1280, 800), timeout=3600)    # :0 = the SDK's own desktop
# Start the :0 stream NOW if you want it. Once extra x11vnc servers run,
# stream.start() raises "Stream is already running".
sbx.stream.start()

sbx.commands.run("apt-get update -qq && apt-get install -y -qq openbox", user="root", timeout=300)
sbx.files.write("/home/user/multi_display.sh", open("multi_display.sh").read())
print(sbx.commands.run(f"bash /home/user/multi_display.sh {N} 1 1280 800", timeout=120).stdout)

class AgentScreen:
    """Per-agent desktop: every command is pinned to DISPLAY=:N."""
    def __init__(self, sbx, i, base=1):
        self.sbx, self.i, self.d = sbx, i, base + i
        self.cdp_port = 9222 + i
        self.view_url = f"https://{sbx.get_host(6080 + self.d)}/vnc.html?autoconnect=true&resize=scale"

    def sh(self, cmd, **kw):
        return self.sbx.commands.run(f"DISPLAY=:{self.d} {cmd}", **kw)

    def click(self, x, y):   self.sh(f"xdotool mousemove --sync {x} {y} click 1")
    def type(self, text):
        import shlex; self.sh(f"xdotool type --delay 30 -- {shlex.quote(text)}")
    def key(self, combo):    self.sh(f"xdotool key {combo}")              # "ctrl+l", "Return"
    def scroll(self, n=3, down=True): self.sh(f"xdotool click --repeat {n} {5 if down else 4}")
    def launch(self, app):   self.sbx.commands.run(f"DISPLAY=:{self.d} {app}", background=True, timeout=0)

    def screenshot(self) -> bytes:
        p = f"/tmp/shot-{self.d}.png"
        self.sh(f"scrot -o {p}")
        return bytes(self.sbx.files.read(p, format="bytes"))

agents = [AgentScreen(sbx, i) for i in range(N)]
for a in agents:
    print(f"agent{a.i}: watch at {a.view_url}")

agents[0].key("ctrl+l"); agents[0].type("https://e2b.dev/docs"); agents[0].key("Return")
agents[1].key("ctrl+l"); agents[1].type("https://github.com/e2b-dev/desktop"); agents[1].key("Return")
agents[2].launch("xfce4-terminal")                 # any GUI app works, not just the browser
open("agent0.png", "wb").write(agents[0].screenshot())

sbx.commands.run("echo shared > /home/user/notes.txt")
```

### 3c. Browser control over CDP, run inside the sandbox

```python
sbx.commands.run("pip install -q playwright", timeout=300)   # connect_over_cdp needs no browser download
script = r'''
import sys, asyncio
from playwright.async_api import async_playwright
async def main(port, url):
    async with async_playwright() as p:
        b = await p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
        page = b.contexts[0].pages[0] if b.contexts[0].pages else await b.contexts[0].new_page()
        await page.goto(url); print(await page.title())
asyncio.run(main(int(sys.argv[1]), sys.argv[2]))
'''
sbx.files.write("/home/user/cdp.py", script)
print(sbx.commands.run(f"python3 /home/user/cdp.py {agents[1].cdp_port} https://e2b.dev").stdout)
```

Quick health check: `sbx.commands.run("curl -s localhost:9222/json/version")`.

---

## 4. Limits and which option to pick

**Plan limits** (https://docs.e2b.dev/billing.md):

| | Hobby | Pro |
|---|---|---|
| Max vCPU / RAM | 8 / 8 GiB | 8+ / 8+ GiB |
| Disk | 10 GiB | 20+ GiB |
| Max continuous runtime | 1 hour | 24 hours |
| Concurrent sandboxes | 20 | 100–1,100 |

- **Runtime:** default timeout 300 s; extend with `set_timeout(s)` / `setTimeout(ms)`. Pause/resume keeps full state (https://docs.e2b.dev/sandbox/persistence.md).
- **CPU/RAM:** set at template build (`cpu_count`/`memory_mb`), not at create. `desktop` is 8 vCPU / 8192 MB.
- **No GPU:** CPU rendering only (https://docs.e2b.dev/faq/gpu-support.md).
- **Multi-display isn't an official feature** — it works because the sandbox is a normal Linux VM with root.
- **How many agents fit:** each display+Chrome ≈ 0.3–0.8 GB RAM (estimate), so roughly 4–8 agents per 8 GiB sandbox.

**Which to pick:**
- **Option A (one sandbox per agent):** real isolation, official SDK API with no workarounds, independent lifetimes. Costs N VMs; file sharing via Volumes (beta).
- **Option B (one sandbox, many displays):** agents share one filesystem directly, cheaply. Your wrapper / CDP controls displays `:1+`; all agents share one sandbox's runtime cap and RAM.
- **Mix:** one sandbox + multiple displays per team.
