# Supercharge sandbox outage: 2026-09-19

## Scope and current finding

Investigated Vectra instance `GpYl_9yhJX`, E2B sandbox `ia1mgawicf6dcxtxpthhv`, gateway session `98e6599c-1e60-4033-ac91-0a4fb26c4868`. No Supercharge App authentication changes are part of this investigation.

The current 8790 outage is an incompatible executable, not a dead VM. The original report of a second-prompt stall must be distinguished from that later update failure.

## Evidence collected before repair

All times below are UTC.

| Check | Observation |
| --- | --- |
| E2B API, 01:02:26 | Sandbox `running`, alias `supercharge-full-sandbox`, template `i555ld3tcet21gyd3mry`, 16 CPUs / 16 GiB. |
| Sandbox OS | Ubuntu 24.04.4 LTS, `getconf GNU_LIBC_VERSION` reports `glibc 2.39`. |
| `supercharge --version` | Exit 1: `libm.so.6: version GLIBC_2.43 not found`. The executable exists; the loader cannot run it. |
| ELF imports | `atan2f`, `acosf`, and `log10f` require `GLIBC_2.43`. |
| Installed CLI SHA-256 | `09ca6c0efa6425336bad24d7ba95ee9d0debd6d83cbd3d83f503fe402d617997`. |
| Published release | GitHub v1.3.16 `supercharge-linux-x86_64` and `sc-linux-x86_64` have the exact same SHA-256. The local host build in `target/release/supercharge-pager` also matches. |
| Installation time | `journalctl` records `sudo install ... /usr/local/bin/supercharge` at 00:50:29. The file's modification/change times agree. |
| Daemon binary | The separately installed `supercharge-superagent-server` requires at most glibc 2.39; launching through the incompatible CLI still fails before reaching it. |
| Public 8790 endpoints | `/health`, `/healthz`, `/v1/status`, and an authenticated empty POST to `/v1/chat` return E2B 502: sandbox running, port not open. |
| Port 8788 | HTTP 200, `daemon_alive: false`; browser sidecar PID 634 remains running. |
| PID evidence | Supplied log: dead PID 20672. At 01:03:41: pidfile 24874, no corresponding process. At 01:17:51: 25213; at 01:18:00: 25492. Failed startup rewrites the pidfile and log; these are not healthy replacement daemons. |
| Kernel logs | No OOM-kill or segmentation-fault records were found. |
| Image version file | `/var/lib/superagent/e2b-version` still says 1.3.8, last modified September 16. It is not proof the CLI works. |
| Production web | Authenticated `/api/instances/GpYl_9yhJX/chat/status` returns 502 after 73.9 seconds. Instance metadata and logs APIs return 200. |
| Production gateway | `https://cloud-inf.xibeai.in/health` reports pause, auto-resume, 900000 ms timeout. Authenticated session listing reports runtime `supercharge`, configured template `supercharge-full-sandbox`. |
| Vercel deployment | GitHub deployment status confirms commit `626f7886296361fa2f2a9195300c1ec5a564018b` deployed successfully September 18 at 17:07:47. This does not establish the Coolify gateway's commit. |

No credentials or full configuration files are reproduced here.

## Failure chain

1. The existing VM started from the old full-sandbox image, with a working 1.3.8 CLI.
2. The dashboard updater downloaded the published 1.3.16 host-built Linux CLI and installed it at 00:50:29 without first running it on the sandbox.
3. The updater used `set +e`, suppressed the post-install version failure, and printed `UPDATE_DONE` regardless. Its version stamp could also remain stale because that root-owned path was written without sudo.
4. Restart paths launch `supercharge agent daemon --bind 0.0.0.0:8790`. The dynamic loader exits before that command runs.
5. Subsequent inbox health checks correctly find no listener, rewrite the bootstrap environment and request another restart. That repeats the loader failure; it cannot repair the executable.
6. Gateway/web process-existence readiness fallbacks and completion markers can misreport success. A running VM or wake service does not imply a working inbox.

Both health paths are already tried by the deployed web code. This incident is not evidence of the earlier health-path-only bug returning.

## What the pre-update chat logs actually show

The sandbox retained CLI lifecycle records under:

`/home/user/.supercharge/agent-runtime/pollinations/logs/unified.jsonl`

and session events under:

`/home/user/.supercharge/agent-runtime/pollinations/sessions/%2Fhome%2Fuser%2Fworkspace/1d65a3ff-70ce-5db8-acac-8498251d9afe/`

| Prompt | CLI start | Logical completion | Process/session cleanup |
| --- | --- | --- | --- |
| 1 | September 18 16:56:26.783 | 16:56:30.194, `ok: true` | 16:56:30.360 |
| 2 | 17:08:26.913 | 17:08:30.851, `ok: true` | 17:08:30.913 |
| 3 | 17:09:38.926 | 17:09:42.715, `ok: true` | 17:09:42.776 |
| Website-building turn | 17:10:42.584 | 17:14:20.573, `ok: true` | 17:24:20.707 |

There is no evidence here of the VM dying on prompt 2. There is direct evidence of a separate ten-minute post-turn stall: the website-building turn started a tracked background Next.js server; `--single` headless mode defaults to waiting 600 seconds for background work. The CLI then killed that task during teardown. The inbox waits for stdout/stderr EOF and `child.wait()` before clearing its busy state, so a logical answer can already exist while the inbox still considers the turn active.

Adding `--no-wait-for-background` indiscriminately is not a safe preview-preserving fix: the CLI's exit cleanup explicitly kills pending background work. Persistent preview ownership needs a deliberate lifecycle solution; this investigation does not silently change that behavior.

## SSE and pause findings

The mobile client already reconnects both after EOF and transient errors and resumes with numeric `since=` IDs. The existing web event proxy nevertheless streams indefinitely despite `maxDuration = 55`; that is a separate serverless timeout defect. It cannot explain an absent 8790 listener, but it can interrupt delivery during otherwise healthy turns. After the binary repair, a live production SSE connection returned 200, replayed both diagnostic replies, and ended at **55.774 seconds**. Reconnecting with `since=1789781635828086` returned 200; a third diagnostic prompt returned 202 and streamed `DIAGNOSTIC_RECONNECT_OK` plus `done` on the new connection. This demonstrates working cursor recovery rather than a deterministic second-prompt death.

E2B reports `onTimeout: pause` and `autoResume: true`. The sandbox was running during the current failure. No evidence ties the original second prompt to an idle pause.

## Narrow source changes

### Vercel web

- Validate downloaded CLI execution, daemon command support, and daemon shared libraries before replacing installed files.
- Use per-update temporary directories and renamed binaries; abort failed updates before requesting a restart.
- Record/report the version from a runnable executable, not a stale image stamp.
- Require HTTP readiness for Supercharge, propagate failed startup, and avoid recommending another blind update.
- Close chat SSE below the function limit, cancel the upstream reader on timeout/disconnect, and retain event IDs for the existing client reconnect path.

### Coolify gateway

- Require a healthy 8790 HTTP response for Supercharge; a PID/process match alone is not readiness.
- Existing XibeCode readiness behavior is unchanged.

### CLI build tooling

- Use a separate `target-e2b-release` directory for the Ubuntu build and artifact staging instead of sharing host `target/release` outputs.
- No release publication, template replacement, or source push is implied by a local build.

## Validation

- 18 focused Node regression tests pass, including consecutive healthy inbox checks, failed binary/download preservation, refusal to restart after failed update, genuine HTTP readiness, SSE cancellation and expiry.
- Gateway and web TypeScript checks pass after installing their already-declared missing local WebSocket dependencies.
- Build-isolation shell regression passes.
- Running the actual failed release's version preflight inside the sandbox returns exit 1 and rejects installation without changing the installed file.

## Live repair performed

At **01:33:55 UTC**, replaced only `/usr/local/bin/supercharge` with an Ubuntu 24.04 build of the checked-out CLI source. It reports **1.3.15 (unknown)** because the source package version is 1.3.15 and this is a local recovery build, not a published release. It includes `agent daemon`. Maximum ELF glibc requirement is **2.39**.

- Recovery CLI SHA-256: `649069b03d5817a194f086623159c7719ccf4c60bfa1abfc1988d7b413e3e72b`.
- Original binary retained at `/usr/local/bin/supercharge.pre-repair-20260919`.
- Original env files, pidfile, log, and image version stamp retained under `/tmp/supercharge-runtime-repair-20260919` inside the sandbox.
- Added only `SUPERCHARGE_DISABLE_AUTOUPDATER=1` to the existing daemon/gateway env overlays to prevent the known incompatible latest release from being adopted automatically. Existing provider credentials/settings were not changed.
- Existing daemon binary and workspace were not replaced. The sandbox was not recreated.
- Started `supercharge agent daemon --bind 0.0.0.0:8790`; it execs `/usr/local/bin/supercharge-superagent-server` at PID **25805**.
- Both public health routes returned **200** after the repair; wake HTTP returned `daemon_alive: true`.
- At 01:34 UTC, two consecutive prompts sent through the authenticated production web chat API returned HTTP **202**, completed with exactly `DIAGNOSTIC_OK_1` and `DIAGNOSTIC_OK_2`, and were persisted in a separate diagnostic conversation. Status returned HTTP **200**, `busy: false`, after each turn.
- Ten PID/health samples from 01:34:20 through 01:34:56 all reported PID **25805**, alive, health **200**. No daemon restart occurred on the second prompt.
- Two production SSE connections each ended near the existing 55-second limit (55.774 s and 55.519 s); reconnecting with the last event ID delivered a third successful reply. At **01:37:42 UTC**, PID **25805** was still alive and `/v1/status` reported `busy: false`, uptime 227 seconds.
- Compared both env overlays against their saved copies: every pre-existing setting was byte-for-byte preserved after excluding the single added auto-updater flag. The daemon binary hash remained unchanged.

### Source validation commands

```bash
node --import ./apps/gateway/node_modules/tsx/dist/loader.mjs --test \
  apps/gateway/test/daemon-readiness.test.ts \
  apps/web/lib/gateway-client.test.ts \
  apps/web/lib/app-chat.test.ts \
  apps/web/lib/inbox-event-stream.test.ts
npm --prefix apps/gateway run lint
apps/web/node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit --incremental false
```

In the Supercharge repository: `python3 sandbox/test-e2b-build-isolation.py`.

## Persistent runtime delivery (Paseo-pattern upgrade, later on 2026-09-19)

Following the getpaseo/paseo reference model (agent stays resident across turns; "answer finished" is distinct from "background work finished"), the E2B inbox now runs the CLI as a **persistent ACP process** instead of one `--single` headless spawn per prompt.

Supercharge-side (`crates/codegen/supercharge-superagent`):

- New `acp_runtime.rs`: speaks ACP over stdio to `supercharge agent stdio` (`--no-leader --always-approve --no-auto-update`), dedicates a process group, auto-resumes via `session/load` when history exists, fails closed on unexpected interactive permission requests, and rejects in-flight requests with a subscriber notification if the runtime dies.
- On E2B, app chat turns use the persistent runtime (`runtimeMode: "persistent"` in `/v1/status`); headless behavior elsewhere is unchanged.
- Replies stream as they arrive; the turn ends at the ACP prompt response, **not** at background-task completion.
- `background_tasks` ACP updates are normalized into `/v1/status → backgroundTasks` and `background` chat events (taskId, command, title, sessionId, runtimeGeneration). Runtime death clears that generation's tasks and emits `runtime`/`background` error events.
- Graceful shutdown closes persistent runtimes; cancel settles the foreground prompt (10 s budget) without killing the runtime.
- Event replay now includes a `snapshot` frame (busy state + background tasks) and a `resync` marker when the in-memory log gaps, so re-attaching clients reconcile.
- `app_emit` timestamps are milliseconds; per-chat event routing filters on the deterministic CLI session id.

Vectra-side (cloud-infra):

- Gateway: readiness for Supercharge requires real HTTP health; a keepalive tick extends the E2B idle timeout only when `/v1/status` reports a busy turn or running background work (paused/idle sandboxes still pause normally); the Coolify `SUPERCHARGE_SANDBOX_DAEMON_*` contract is unchanged.
- Web: wake reuses a healthy frozen daemon (`restartDaemon: false` for Supercharge) instead of restarting work; chat SSE closes at 40 s and cancels upstream on disconnect.
- Mobile: shared SSE decoder (CRLF-safe, multi-line `data:`), monotonic numeric cursor incl. status/snapshot events, generation-guarded listener with cancellation (backgrounding/dispose cannot leak a second loop), reconnect triggers status poll + remote hydration, and a visible `BackgroundTasksBar` ("N background tasks running · you can keep chatting").
- Fixed pre-existing compile breaks in the mobile checkout: missing braces in `lib/api/providers.dart` (same commit that broke the web provider-defaults earlier) and a duplicate `/model` entry in `superchargeBotCommands`.

Validation:

- `cargo test -p supercharge-superagent --features e2b acp_runtime` — process reuse, cancel-settling, and death-notification tests pass; full crate builds against Ubuntu 24.04/glibc 2.39.
- `flutter analyze` clean; full `flutter test` suite passes (17 tests incl. new stream/cursor/background UI tests).
- Gateway/web: 15 Node regressions + `tsc` clean.
- Real ACP handshake with the installed CLI verified initialize + `session/new` capabilities.
- Isolated daemon on :8791 inside the sandbox: two real provider turns answered (`PERSISTENT_OK_1/2`), history persisted.

Live deployment (02:14–02:20 UTC): new daemon SHA-256 `2e8ca6fda97ed47deb88283297d07b6614dae6e5a20f31ddb6f27bf21ce78baa` installed with rollback copy `/usr/local/bin/supercharge-superagent-server.pre-persistent-20260919`. Verified live: `PERSIST_LIVE_1/2` answered in 4–5 s with one stable CLI process; a `sleep 45` background task stayed visible in `backgroundTasks`, replied `BG_LIVE_OK` immediately, the next prompt finished in 8 s while it ran, and the task drained on its own; after a daemon restart the same conversation resumed (`RESUME_OK`, full history). One earlier deploy attempt aborted safely on a stale-hash guard; a duplicate start then failed with "Address already in use" and was cleaned up (pidfile restored, no runtime impact).

## Release 1.3.17 (later on 2026-09-19)

Published under the user's explicit release authorization. Note: the requested tag `v1.3.8` already existed (2026-09-16), so the release went out as **v1.3.17** (next after v1.3.16).

- Source pushed to `iotserver24/supercharge` main: persistent ACP runtime (`a85d4e2a2`), sandbox-compatible release builds (`7b17f042a`), version bump (`f7eedc734`). Release binaries were built with the dedicated scripts (`prepare-e2b-agent-assets.sh` / `publish-e2b-update.sh`), verified in the live sandbox preflight (glibc ≤ 2.39, version 1.3.17, daemon subcommand), then published; tag `v1.3.17` triggered the cross-platform Actions build, which merges its assets into the same release via `--clobber`.
- cloud-infra pushed to main (`73f31aa` gateway/web, `681403c` mobile, `dbb0b39` docs); Vercel deployed `dbb0b39` successfully at 02:50 UTC.
- End-to-end update through the deployed website: `/api/instances/GpYl_9yhJX/cli-update` returned 200, `from 1.3.15 → to 1.3.17, verified 1.3.17`, daemon restarted healthy; `/v1/status` reports `runtimeMode: persistent` and a live prompt answered in 9 s.
- Deployed web confirmed live: idle chat SSE now closes at ~41 s (previously ~55 s).
- The Coolify gateway must be redeployed separately (readiness + keepalive changes); Vercel and GitHub Actions do not deploy it.

## Rollout boundaries

No source commits, pushes, release publications, template recreations, or Vercel/Coolify deployments were performed. Source changes remain on local branches `fix/e2b-supercharge-runtime-validation` (cloud-infra) and `fix/e2b-compatible-runtime-build` (Supercharge). **Already live in the sandbox:** the compatible CLI (1.3.15 recovery build) and the persistent-runtime daemon.

Still undeployed and required for full effect:

- **Vercel web** — validated/atomic CLI updates, truthful version reporting, wake-without-restart, 40 s bounded chat SSE. Until then the web SSE still relies on the daemon's long-lived stream (works, but hits the 55 s serverless cut).
- **Coolify gateway** — HTTP-only Supercharge readiness and the busy/background keepalive tick. Until then, do not rely on the dashboard while a sandbox sits paused with a running preview.
- **Mobile app** — stream decoder, cursor monotonicity, listener cancellation, background-task bar. Requires a new Flutter build/install.
- **Release feed** — v1.3.16 Linux assets remain incompatible (GLIBC_2.43). Corrected artifacts must be built on Ubuntu 24.04 and published before any "Update & restart". The sandbox carries `SUPERCHARGE_DISABLE_AUTOUPDATER=1` as a guard; existing sandboxes do not change images when a gateway template default changes.

Historical Vercel function logs and the Coolify container's full log history were not available through the supplied local credentials. Authenticated production API responses, live sandbox system/CLI logs, GitHub deployment status, and gateway session metadata were inspected instead.
