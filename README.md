# Vectra Cloud (monorepo)

**Closed source / proprietary.** Hosted AI coding sandboxes product.

```
cloud-infra/
├── apps/
│   ├── web/       # Next.js site + dashboard → Vercel
│   ├── gateway/   # Sandbox control plane → Railway / Coolify
│   └── mobile/    # Flutter console + first-party daemon chat
├── package.json   # root scripts only (not a workspace hoist)
└── vercel.json    # fallback if Root Directory is not set
```

## Deploy

### Frontend — Vercel

1. Import **this** GitHub repo (`iotserver24/cloud-infra`).
2. **Root Directory:** `apps/web` (recommended).
3. Framework: **Next.js** (auto-detected).
4. Install / build: uses `apps/web/vercel.json` (`npm ci` + `npm run build`).
5. Env vars from `apps/web/.env.example`:

| Variable | Notes |
| --- | --- |
| `MONGODB_URI` | Atlas connection string |
| `MONGODB_DB` | `vectra_cloud` |
| `AUTH_SECRET` | long random string |
| `XIBECODE_SANDBOX_GATEWAY_URL` | public HTTPS gateway URL |
| `XIBECODE_GATEWAY_TOKEN` | same secret as gateway |
| `PUBLIC_BASE_URL` | public site origin (Telegram wake) |
| `POLLINATIONS_APP_KEY` | Pollinations BYOP App Key (`pk_…`) — server only |
| `CRON_SECRET` | auth for `/api/cron/arm-telegram-wake` (required on Vercel) |
| `E2B_LIFECYCLE_WEBHOOK_SECRET` | optional but recommended; E2B lifecycle → arm TG wake on pause |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | server keys |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | client key |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay dashboard webhook secret |
| `BILLING_PRICE_INR` | e.g. `399` (rupees) |
| `BILLING_PRICE_USD` | e.g. `4.59` (dollars) |
| `BILLING_PERIOD_DAYS` | e.g. `30` |

Production example:

```bash
XIBECODE_SANDBOX_GATEWAY_URL=https://your-gateway.up.railway.app
XIBECODE_GATEWAY_TOKEN=same-as-gateway
PUBLIC_BASE_URL=https://your-app.vercel.app
```

Razorpay webhook URL:

```text
https://your-app.vercel.app/api/billing/webhook
```

### Auto-resume (E2B pause → Telegram wake)

Follows [E2B auto-resume](https://e2b.dev/docs/sandbox/auto-resume):

```ts
Sandbox.create({
  timeoutMs: 15 * 60 * 1000, // default idle; override XIBECODE_E2B_SANDBOX_TIMEOUT_MS
  lifecycle: { onTimeout: 'pause', autoResume: true }, // full memory snapshot
})
```

Activity that wakes a paused sandbox ([docs](https://e2b.dev/docs/sandbox/auto-resume)):
gateway SDK ops (`commands.run`, files) **or HTTP traffic to a service inside the VM**
([public URL](https://e2b.dev/docs/network/public-url)).

**Preferred Telegram path (custom template wake HTTP, not the bot):**
```
Telegram setWebhook → https://8788-{sandboxId}.e2b.app/telegram
DM → E2B auto-resumes paused VM → /opt/vectra/wake-http (template)
    → restarts xibecode daemon long-poll (bot code unchanged)
```
Bake wake-http into `xibecode-full-sandbox` (`sandbox/e2b-template/wake-http`).
Dashboard save sets the webhook URL when Telegram is configured.

**Legacy:** host Vercel wake webhook + long-poll (if no sandbox wake URL).

1. **Instant path:** register an E2B project lifecycle webhook:
   - URL: `https://your-app.vercel.app/api/e2b/lifecycle`
   - Events: `sandbox.lifecycle.paused`, `resumed`, `killed`, `created`
   - Signature secret → Vercel `E2B_LIFECYCLE_WEBHOOK_SECRET`
2. **Fallback:** Vercel cron daily (`0 6 * * *` UTC — Hobby plan limit) hits `/api/cron/arm-telegram-wake` (needs `CRON_SECRET`). Re-affirms sandbox or host webhook.
3. **Dashboard list / Wake** also syncs webhook + status.
4. Redeploy **both** Vercel (web) and Railway (gateway) after pull; **Update CLI**
   in the sandbox so webhook mode is available.
   Set gateway `XIBECODE_E2B_SANDBOX_TIMEOUT_MS` (default 30m) and keep
   `XIBECODE_E2B_ON_TIMEOUT=pause` + `XIBECODE_E2B_AUTO_RESUME=true`.

### Backend — Railway or Coolify

**Service root / Docker context:** `apps/gateway`

| Setting | Value |
| --- | --- |
| Dockerfile | `apps/gateway/Dockerfile` (context `apps/gateway`) |
| Port | `8787` or platform `PORT` |
| Health | `GET /health` |
| Config | `apps/gateway/railway.toml` |

Env from `apps/gateway/.env.example` (provider API key, template, lifecycle, gateway token).

**Coolify:** Base Directory / Build Pack context = `apps/gateway`, Dockerfile = `Dockerfile`.

**Railway:** Root Directory = `apps/gateway`, builder = Dockerfile.

After the gateway has a public URL, put it in Vercel as `XIBECODE_SANDBOX_GATEWAY_URL`.

### CLI updates on existing sandboxes

New sandboxes get the runtime pinned in the E2B template (`XIBECODE_E2B_TEMPLATE`,
e.g. `xibecode-full-sandbox`). **Rebuilding/republishing that template** is still how you
raise the baseline for *new* instances.

### Second Rust-agent template

The Rust-first agent repository contains a second template at `sandbox/e2b-agent-template`. It reuses the existing interactive image baseline—Chromium with `agent-browser`, Node.js, Bun, Python/uv, Git/GitHub CLI, search utilities, process tools, and the workspace—but starts `xai-grok-superagent-server` as the primary daemon. It exposes the app-compatible daemon on port `8790`, the E2B wake/file-share service on `8788`, and the local browser stream on `9223`. Build the Rust binaries with `./sandbox/prepare-e2b-agent-assets.sh`, publish the template, and set the gateway’s `XIBECODE_E2B_TEMPLATE` to its new alias.

The gateway restart route remains backward-compatible. For the Rust-agent template, set `XIBECODE_SANDBOX_DAEMON_COMMAND=xai-grok-superagent-server`, `XIBECODE_SANDBOX_DAEMON_PIDFILE=/tmp/superagent-daemon.pid`, `XIBECODE_SANDBOX_DAEMON_LOGFILE=/tmp/superagent-daemon.log`, and `XIBECODE_SANDBOX_DAEMON_MATCH=xai-grok-superagent-server`. The web and mobile Computer pane already proxy `/v1/computer/browser`; the Rust daemon now emits the same view-only SSE frame contract used by the existing app.

For **existing** instances, the dashboard offers an **opt-in** upgrade when npm has a
newer `xibecode` than `xibecode -v` inside the sandbox:

1. Open the instance → banner *Update available: X.Y.Z (you have A.B.C)*.
2. **Update & restart** wakes the sandbox if paused, then installs **latest** global CLI:
   - Prefer **`sudo -n npm install -g xibecode@latest`** (template global prefix is often root-owned).
   - Fallbacks: interactive `sudo npm …`, then plain `npm install -g …`.
   - Then **restart daemon** (workspace, `daemon.env`, and pairing are kept).
3. **Dismiss** hides the offer for that version in the current browser session.
4. Never auto-updates silently.

APIs:

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/instances/:id/cli-version` | Host npm registry + in-sandbox `xibecode -v` |
| `POST` | `/api/instances/:id/cli-update` | Wake → install → restart daemon (`maxDuration` 300s) |
| `GET` | `/api/instances/:id/logs?source=all\|daemon\|agent\|system` | Diagnostic log pull (wakes if paused) |

### Gateway lifecycle env (summary)

| Variable | Default | Purpose |
| --- | --- | --- |
| `XIBECODE_E2B_TEMPLATE` | `xibecode-full-sandbox` | Published template id/alias |
| `XIBECODE_E2B_ON_TIMEOUT` | `pause` | `pause` (snapshot) or `kill` |
| `XIBECODE_E2B_AUTO_RESUME` | `true` | Wake on SDK/HTTP when paused |
| `XIBECODE_E2B_SANDBOX_TIMEOUT_MS` | `900000` (15m) | Idle before lifecycle pause |
| `XIBECODE_E2B_MAX_CONTINUOUS_MS` | `82800000` (~23h) | Pause/resume before E2B 24h hard limit; `0` = off |
| `XIBECODE_SANDBOX_DAEMON_COMMAND` | `xibecode daemon --workdir /home/user/workspace` | Command used by the restart route inside a sandbox |
| `XIBECODE_SANDBOX_DAEMON_PIDFILE` | `/tmp/xibecode-daemon.pid` | PID file used for safe daemon restarts |
| `XIBECODE_SANDBOX_DAEMON_LOGFILE` | `/tmp/xibecode-daemon.log` | Log file tailed after restart |
| `XIBECODE_SANDBOX_DAEMON_MATCH` | `node.*xibecode|xibecode/dist` | Optional process match for legacy fallback cleanup |

## Local dev

```bash
# install (each app keeps its own node_modules — no hoist)
bun install --cwd apps/web   # or: npm ci --prefix apps/web
bun install --cwd apps/gateway

# env
cp apps/web/.env.example apps/web/.env.local
cp apps/gateway/.env.example apps/gateway/.env

# run (from repo root)
bun run dev:gateway   # :8787
bun run dev:web       # :3001
```

Or from each app:

```bash
cd apps/gateway && bun run dev
cd apps/web && npm run dev
```

## License

**UNLICENSED / proprietary.** See `LICENSE`.
