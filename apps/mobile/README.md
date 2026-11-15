# Vectra Cloud (Flutter)

First-party chat + console for hosted sandboxes. Talks only to the website API
(`Authorization: Bearer`). The daemon `app` inbox is never called from the phone.

## Run

Default API is **`https://infra.xibeai.in`** (`env.json` / `API_BASE`).

```bash
# production (default)
flutter run --dart-define-from-file=env.json

# or rely on the compiled default
flutter run

# local web (apps/web on :3001)
flutter run --dart-define=API_BASE=http://127.0.0.1:3001
```

Android emulator cannot reach host `127.0.0.1` — use `http://10.0.2.2:3001`.

## Chat

Same daemon `ChatController` as Telegram: `/help`, `/stop`, `/model`, files,
approve / ask. Events are JSON (`typing`, `text`, `tool`, `ask`, `approve`,
`picker`, `file`, `done`, `error`), not MarkdownV2.

## Linux desktop

To make a release, open GitHub Actions, select the **mobile** workflow, and run
it with a new version, for example `1.0.30`. The Android build number is assigned
automatically from the workflow run number. After
the tests and all platform builds succeed, the workflow creates a GitHub
Release with the Android APK, desktop archives, Linux AppImage, deb and rpm,
and an AUR recipe.
The AUR recipe is not automatically published to the AUR. The AppImage still
requires system GTK 3, WebKitGTK 4.1, libsecret and libmpv libraries. Android
uses a debug signing key and desktop packages are not release-signed or notarized.

Build with `flutter build linux --release --dart-define-from-file=env.json`.
Install the entire `build/linux/x64/release/bundle` directory, not just the executable.
In addition to Flutter's GTK toolchain, Linux requires WebKitGTK 4.1 development
headers to build and WebKitGTK 4.1 plus libmpv at runtime. The desktop uses the
system Adwaita/Cantarell font where available.

Desktop navigation uses a persistent sidebar and File / Edit / View / Workspace /
Help menus. Chat and the live computer share a resizable workspace. Narrow windows
collapse the sidebar, and Android/iOS retain their touch layout. Settings have
section navigation; files have search, an inline text preview, right-click actions,
native Save As dialogs, and authenticated archive export.

The Linux runner embeds WebKitGTK over measured browser areas in the main window:
website previews and the AI browser viewer stay inside Vectra. Chat HTTP(S) links
open an internal Preview; only the explicit **Open in browser** action launches the
system browser. The AI viewer retains its scoped loopback URL and control-lease
checks, and closing it does not close a preview.
Razorpay checkout opens in a modal app window; only the existing server payment
verification can authorize a paid workspace. Audio/video previews use libmpv on
desktop. Completion, approval, and CLI-update notifications use the Linux desktop
notification service. Native window size/maximized state is kept in
`$XDG_CONFIG_HOME/vectra-cloud/window.ini` (or `~/.config/vectra-cloud/window.ini`).

### Keyboard and pointer

| Shortcut | Action |
| --- | --- |
| Ctrl+1 | Workspaces |
| Ctrl+Shift+N | New workspace (workspaces view) |
| Ctrl+N | New conversation (chat) |
| Ctrl+H | Conversation history |
| Ctrl+K | Command palette |
| Ctrl+L | Focus message |
| Enter / Shift+Enter | Send / new line |
| Ctrl+O | Attach files |
| Ctrl+V | Paste text or a clipboard image in chat |
| Ctrl+. | Stop the running task |
| Ctrl+Shift+E | Workspace files |
| Ctrl+J | Show/hide the computer pane |
| Ctrl+Shift+P | Website preview |
| Ctrl+, / Ctrl+Shift+, | Workspace settings / account |
| Ctrl+R / F5 | Refresh the current view |
| Ctrl+F | Search the current workspace list, chat, or file list |
| Ctrl+S / Ctrl+Shift+S | Save / export (where available) |
| Ctrl+B | Show/hide the sidebar |
| Alt+Left | Back |
| Esc | Dismiss a dialog |
| F1 / F11 | Shortcut reference / fullscreen |

Drop local files on the active chat to attach them (up to 12 attachments; dropped
files are limited to 50 MB each). Standard text selection, copy/cut/paste/undo, Tab
navigation, mouse-wheel scrolling, and native window controls remain available.
Preview offers in-app back, forward, reload, address entry, and an explicit
**Open in browser** button for the system browser.

### Validation

`flutter analyze` and `flutter test` cover desktop keyboard routing, platform
adaptation, compact windows, chat/computer panes, settings section navigation,
file previews, and existing browser-control/API behavior. The optional
`--dart-define=DESKTOP_CAPTURE=true` on `test/desktop_ui_test.dart` writes local
fixture captures to `/tmp/vectra-desktop-review`; it never uses account data.
Actual payment completion, live cloud tasks, and system notification delivery
require their respective services and are not asserted by widget tests.
