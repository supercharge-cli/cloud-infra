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

| Variable                                  | Notes                                                          |
| ----------------------------------------- | -------------------------------------------------------------- |
| `MONGODB_URI`                             | Atlas connection string                                        |
| `MONGODB_DB`                              | `vectra_cloud`                                                 |
| `AUTH_SECRET`                             | long random string                                             |
| `XIBECODE_SANDBOX_GATEWAY_URL`            | public HTTPS gateway URL                                       |
| `XIBECODE_GATEWAY_TOKEN`                  | same secret as gateway                                         |
| `PUBLIC_BASE_URL`                         | public site origin (Telegram wake)                             |
| `POLLINATIONS_APP_KEY`                    | Pollinations BYOP App Key (`pk_…`) — server only               |
| `CRON_SECRET`                             | auth for `/api/cron/*` crons (required on Vercel)              |
| `E2B_LIFECYCLE_WEBHOOK_SECRET`            | optional but recommended; E2B lifecycle → arm TG wake on pause |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | server keys                                                    |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID`             | client key                                                     |
| `RAZORPAY_WEBHOOK_SECRET`                 | Razorpay dashboard webhook secret                              |
| `BILLING_PRICE_INR`                       | e.g. `399` (rupees)                                            |
| `BILLING_PRICE_USD`                       | e.g. `4.59` (dollars)                                          |
| `BILLING_PERIOD_DAYS`                     | e.g. `30`                                                      |
| `RAZORPAY_PLAN_ID_<SIZE>`                 | autopay plan per size: `2C4G`, `4C8G`, `8C8G`, `16C16G`        |
| `RAZORPAY_PLAN_ID_<SIZE>_USD`             | optional USD plans                                             |
| `BILLING_GRACE_DAYS`                      | access after a failed renewal before pause (default `3`)       |
| `BILLING_RETENTION_DAYS`                  | keep a paused workspace before deletion flag (default `14`)    |
| `BILLING_SUBSCRIPTION_TOTAL_COUNT`        | monthly cycles per subscription (default `120`)                |

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

### Billing: autopay subscriptions

Paid sandboxes renew monthly through Razorpay Subscriptions (card or UPI
Autopay / e-mandate). Workspaces bought as one-off 30-day orders keep their
paid-until date; when it ends the dashboard offers autopay, and moving onto
autopay before then sets the first charge to the old end date.

1. Razorpay dashboard → enable **Subscriptions** (test mode first).
2. Create the plans with your own keys and paste the printed lines into Vercel:

   ```bash
   cd apps/web
   RAZORPAY_KEY_ID=rzp_test_… RAZORPAY_KEY_SECRET=… node scripts/razorpay-create-plans.mjs
   ```

   It reuses plans it created before (matched by size, currency and amount), so
   rerunning is safe. Changing a price creates a new plan; existing subscribers
   stay on the old one.
3. Webhook `https://your-app/api/billing/webhook` with `RAZORPAY_WEBHOOK_SECRET`
   and these events: `payment.captured`, `order.paid` (one-off orders) plus
   `subscription.authenticated`, `subscription.activated`, `subscription.charged`,
   `subscription.pending`, `subscription.halted`, `subscription.cancelled`,
   `subscription.completed`, `subscription.paused`, `subscription.resumed`,
   `subscription.updated`.

Lifecycle: a failed renewal keeps access for `BILLING_GRACE_DAYS` while Razorpay
retries, then the daily `/api/cron/billing-lifecycle` pauses the sandbox. A
cancelled subscription runs to the end of the paid period, then pauses. A
paused workspace is kept `BILLING_RETENTION_DAYS`, then gets `deletionFlaggedAt`.
Nothing is deleted automatically. Paying again resumes it. A free workspace that
was upgraded falls back to the free base instead of pausing.

Size changes: upgrades apply now, downgrades at the cycle end. Razorpay does
not allow plan changes on UPI Autopay or e-mandate subscriptions, so those
customers cancel and subscribe to the new size.

### Auto-resume (E2B pause → Telegram wake)

Follows [E2B auto-resume](https://e2b.dev/docs/sandbox/auto-resume):

```ts
Sandbox.create({
  timeoutMs: 15 * 60 * 1000, // default idle; override XIBECODE_E2B_SANDBOX_TIMEOUT_MS
  lifecycle: { onTimeout: "pause", autoResume: true }, // full memory snapshot
});
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

| Setting    | Value                                              |
| ---------- | -------------------------------------------------- |
| Dockerfile | `apps/gateway/Dockerfile` (context `apps/gateway`) |
| Port       | `8787` or platform `PORT`                          |
| Health     | `GET /health`                                      |
| Config     | `apps/gateway/railway.toml`                        |

Env from `apps/gateway/.env.example` (provider API key, template, lifecycle, gateway token).

**Coolify:** Base Directory / Build Pack context = `apps/gateway`, Dockerfile = `Dockerfile`.

**Railway:** Root Directory = `apps/gateway`, builder = Dockerfile.

After the gateway has a public URL, put it in Vercel as `XIBECODE_SANDBOX_GATEWAY_URL`.

### CLI updates on existing sandboxes

New sandboxes get the selected runtime pinned to the matching E2B template alias
(`XIBECODE_E2B_TEMPLATE` or `SUPERCHARGE_E2B_TEMPLATE`). **Rebuilding/republishing the
selected template** is still how you raise the baseline for _new_ instances.

### Two selectable sandbox runtimes

New instances can use either the existing **XibeCode** image or the **Supercharge** image. The dashboard selection is persisted per instance and drives E2B template provisioning, gateway reattachment, wake/resume, daemon restart, workspace and file-sharing requests, and sandbox recreation. Existing database rows without a runtime remain backward-compatible and default to XibeCode. The gateway template aliases are configured independently:

| Runtime     | Environment variable       | Default alias              | Daemon                                         |
| ----------- | -------------------------- | -------------------------- | ---------------------------------------------- |
| XibeCode    | `XIBECODE_E2B_TEMPLATE`    | `xibecode-full-sandbox`    | Existing XibeCode daemon                       |
| Supercharge | `SUPERCHARGE_E2B_TEMPLATE` | `supercharge-daemon-sandbox` | `supercharge agent daemon --bind 0.0.0.0:8790` |

The Supercharge image is intentionally built and published by the repository owner’s local E2B workflow. This repository contains the application selection/configuration code and the exact [Supercharge E2B template contract](docs/supercharge-e2b-template.md), not a published image or embedded credentials. The image must expose the app-compatible daemon on `0.0.0.0:8790`, the wake/file-share service on `8788`, and the visible browser stream on `9223`. It must include `supercharge`, `sc`, Chromium, `agent-browser`, terminal/workspace tools, and the static `supercharge-superagent-server` binary.

Supercharge provider setup remains a runtime operation through the Vectra `/setup` and instance configuration flows. Provider keys, custom OpenAI-compatible URLs, Telegram/Discord/Slack tokens, and the Vectra app secret are written into the selected sandbox overlay only; none are baked into the image. The web and mobile Computer pane continue to use the app-compatible browser routes, while workspace upload/download/share and public media routes preserve the selected runtime during wake and reattachment.

For **existing** instances, the dashboard offers an **opt-in** upgrade when npm has a
newer `xibecode` than `xibecode -v` inside the sandbox:

1. Open the instance → banner _Update available: X.Y.Z (you have A.B.C)_.
2. **Update & restart** wakes the sandbox if paused, then installs **latest** global CLI:
   - Prefer **`sudo -n npm install -g xibecode@latest`** (template global prefix is often root-owned).
   - Fallbacks: interactive `sudo npm …`, then plain `npm install -g …`.
   - Then **restart daemon** (workspace, `daemon.env`, and pairing are kept).
3. **Dismiss** hides the offer for that version in the current browser session.
4. Never auto-updates silently.

APIs:

| Method | Path                                                        | Notes                                                |
| ------ | ----------------------------------------------------------- | ---------------------------------------------------- |
| `GET`  | `/api/instances/:id/cli-version`                            | Host npm registry + in-sandbox `xibecode -v`         |
| `POST` | `/api/instances/:id/cli-update`                             | Wake → install → restart daemon (`maxDuration` 300s) |
| `GET`  | `/api/instances/:id/logs?source=all\|daemon\|agent\|system` | Diagnostic log pull (wakes if paused)                |

### Gateway lifecycle env (summary)

| Variable                             | Default                                          | Purpose                                           |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------------- |
| `XIBECODE_E2B_TEMPLATE`              | `xibecode-full-sandbox`                          | Published XibeCode template id/alias              |
| `SUPERCHARGE_E2B_TEMPLATE`           | `supercharge-full-sandbox`                       | Published Supercharge template id/alias           |
| `XIBECODE_E2B_ON_TIMEOUT`            | `pause`                                          | `pause` (snapshot) or `kill`                      |
| `XIBECODE_E2B_AUTO_RESUME`           | `true`                                           | Wake on SDK/HTTP when paused                      |
| `XIBECODE_E2B_SANDBOX_TIMEOUT_MS`    | `900000` (15m)                                   | Idle before lifecycle pause                       |
| `XIBECODE_E2B_MAX_CONTINUOUS_MS`     | `82800000` (~23h)                                | Pause/resume before E2B 24h hard limit; `0` = off |
| `XIBECODE_SANDBOX_DAEMON_COMMAND`    | `xibecode daemon --workdir /home/user/workspace` | XibeCode restart command                          |
| `XIBECODE_SANDBOX_DAEMON_PIDFILE`    | `/tmp/xibecode-daemon.pid`                       | XibeCode pidfile                                  |
| `XIBECODE_SANDBOX_DAEMON_LOGFILE`    | `/tmp/xibecode-daemon.log`                       | XibeCode log file                                 |
| `XIBECODE_SANDBOX_DAEMON_MATCH`      | `node.*xibecode                                  | xibecode/dist`                                    | XibeCode process cleanup match    |
| `SUPERCHARGE_SANDBOX_DAEMON_COMMAND` | `/usr/local/bin/supercharge-superagent-server`   | Supercharge restart command                       |
| `SUPERCHARGE_SANDBOX_DAEMON_PIDFILE` | `/tmp/supercharge-daemon.pid`                    | Supercharge pidfile                               |
| `SUPERCHARGE_SANDBOX_DAEMON_LOGFILE` | `/tmp/supercharge-daemon.log`                    | Supercharge log file                              |
| `SUPERCHARGE_SANDBOX_DAEMON_MATCH`   | `supercharge-superagent-server                   | superagent-server`                                | Supercharge process cleanup match |

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
