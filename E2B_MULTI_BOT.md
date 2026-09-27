# Persistent bots in one E2B sandbox

## Scope

The Supercharge E2B runtime supports a Main bot and persistent specialist bots in one existing sandbox. Bot records have names, preset or uploaded icons, instructions, a default folder, and revisioned settings. A bot owns multiple conversations. Local CLI and XibeCode do not get a new multi-bot runtime.

- Bots are stored in MongoDB, so listing bots does not wake the VM.
- New folders default to `/home/user/workspace/bots/<bot-id>`.
- Each conversation fixes its working folder at creation. Changing a bot's default folder affects new conversations only.
- Updating instructions takes effect at the next turn, preserving the CLI base prompt and existing history.
- Main uses the native `vectra_bot` tool (`list`, `create`, `send`, `get`). Sending work returns a job ID; Main can retrieve its result. The tool is restricted to Main, not a task subagent.
- Stored definitions have no fixed product count limit. The initial execution policy is four active bot turns per sandbox and one active turn per bot. Each bot has a bounded FIFO backlog; idle runtimes are evicted after ten idle minutes, unless they own background work.
- The shared browser has a single owner lease. Other bots wait/retry rather than changing each other's page; human handoff suspends bot input.

**Folders are not security isolation.** All bots share the sandbox OS account, ports, filesystem, provider credentials, and browser session. These are trusted bots for the same owner, not separate tenants. An instance-scoped bot capability is used instead of giving Main the deployment-wide gateway credential.

## Continuous-run lifecycle

The Supercharge gateway targets a full-memory pause/resume at 23 hours of continuous running, with margin before the stated 24-hour limit. Idle-paused VMs stay paused until activity wakes them.

The lifecycle journal records `running`, `draining`, `paused`, and `resuming` by sandbox ID. It survives a gateway restart. A confirmed pause followed by connect/resume establishes a new running window; the implementation does **not** assume E2B `getInfo().startedAt` changes after resume.

Before the cycle the daemon pauses admissions and gives current turns a short drain period. If they cannot finish, they are explicitly interrupted and recorded as such; queued work and histories remain. Non-idempotent tool actions are not blindly replayed. After confirmed resume the daemon reopens the queue and clears stale browser leases.

### Required deployment configuration

Set these on the gateway:

```dotenv
XIBECODE_E2B_ON_TIMEOUT=pause
XIBECODE_E2B_AUTO_RESUME=true
XIBECODE_E2B_MAX_CONTINUOUS_MS=82800000
VECTRA_LIFECYCLE_STATE_DIR=/var/lib/vectra-gateway/lifecycle
```

**Mount `/var/lib/vectra-gateway` as a persistent volume.** All gateway replicas controlling the same sandboxes must share the directory for cross-process lifecycle leases. A container-only directory that disappears during replacement is not durable. The Dockerfile creates the directory with the correct owner, but the deployment platform must actually preserve the volume.

The sandbox template and bootstrap now pin:

```dotenv
SUPERAGENT_SESSION_STATE=/home/user/.supercharge/state/sessions.json
SUPERAGENT_BOT_STATE=/home/user/.supercharge/state/bots.json
SUPERAGENT_BOT_QUEUE_STATE=/home/user/.supercharge/state/bot-queue.json
SUPERAGENT_BOT_MAINTENANCE_STATE=/home/user/.supercharge/state/bot-maintenance
```

Existing conversation IDs stay unchanged and are assigned to Main. Legacy index locations are read when the new absolute path does not yet exist. Existing CLI history homes are detected and pinned rather than overwritten. The `.supercharge` state directory is already part of the sandbox-recreation archive; pause/resume is not a replacement for backups after VM deletion.

The publisher defaults to **16 vCPUs / 16 GiB**. The gateway logs a warning when actual E2B resources differ. Confirm the published template alias and resource values during deployment; no automatic resizing or recreation is performed.

## Deployment sequence

1. Preserve existing instance state and active-task history. Prepare the persistent gateway volume.
2. Build the matching Supercharge CLI and daemon, and stage the updated browser runtime (`server.mjs` and `lease.mjs`) in the E2B template.
3. Deploy the updated web API and gateway; ship the updated Vectra app. The bot API is feature-detected by the app, so older servers retain the previous chat path.
4. Use a test E2B instance for a shortened-threshold cycle, with multiple bots and an active/queued task. Verify the same sandbox ID survives, the app reconnects, histories persist, and interruptions are reported honestly.
5. Run a real 23-hour soak before promising long-running production continuity. Roll out existing sandboxes only after that check, without force-closing unrelated user work.

No live deployment, template publication, production migration, or 23-hour soak was performed during local implementation.

## Local verification

From the main repository:

```bash
cargo test -p supercharge-superagent
cargo build -p supercharge-pager-bin --bin supercharge-pager
cargo build -p supercharge-superagent --bin supercharge-superagent-server
python3 sandbox/tests/e2b_bots_smoke.py
python3 sandbox/tests/e2b_bot_cli_smoke.py
node --test sandbox/browser-runtime/lease.test.mjs
```

The daemon smoke uses a fake CLI and verifies concurrent bots, separate folders/instructions, Main capability inheritance, incorrect-target rejection, scoped cancellation, maintenance, delegated-job idempotency, and daemon-restart recovery. The CLI smoke runs the real compiled CLI against a local fake model to verify the native bot-tool schema and caller identity. Neither uses cloud-model or E2B credentials.

From `cloud-infra/apps/gateway`:

```bash
npm run build
node --import tsx --test test/*.test.ts
```

From `cloud-infra/apps/web`:

```bash
npm run types:check
node --import ../gateway/node_modules/tsx/dist/loader.mjs --test lib/bots.test.ts lib/app-chat.test.ts
```

From `cloud-infra/apps/mobile`:

```bash
flutter analyze
flutter test
flutter build linux --release --dart-define-from-file=env.json
```

Local tests are not proof of live payment completion, live external-model behavior, real E2B account limits, or a completed 23-hour lifecycle soak.
