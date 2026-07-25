# Vectra Cloud (monorepo)

**Closed source / proprietary.** Hosted AI coding sandboxes product.

```
cloud-infra/
├── apps/
│   ├── web/       # Next.js site + dashboard → Vercel
│   └── gateway/   # Sandbox control plane → Railway / Coolify
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
  timeoutMs: 30 * 60 * 1000,
  lifecycle: { onTimeout: 'pause', autoResume: true }, // full memory snapshot
})
```

Activity that wakes a paused sandbox ([docs](https://e2b.dev/docs/sandbox/auto-resume)):
gateway SDK ops (`commands.run`, files) **or HTTP traffic to a service inside the VM**
([public URL](https://e2b.dev/docs/network/public-url)).

**Preferred Telegram path (sandbox webhook):**
```
Telegram setWebhook → https://8788-{sandboxId}.e2b.app/telegram
DM → E2B auto-resumes paused VM → xibecode daemon webhook handler
```
Configured automatically when you save AI + Telegram in the dashboard (needs
xibecode with `TELEGRAM_WEBHOOK_PORT` support — Update CLI if needed).

**Legacy:** host Vercel wake webhook + long-poll (only if sandbox webhook mode off).

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

New sandboxes get the CLI version pinned in the E2B template (`XIBECODE_E2B_TEMPLATE`,
e.g. `xibecode-full-sandbox`). **Rebuilding/republishing that template** is still how you
raise the baseline for *new* instances.

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
| `XIBECODE_E2B_SANDBOX_TIMEOUT_MS` | `1800000` (30m) | Idle before lifecycle action |
| `XIBECODE_E2B_MAX_CONTINUOUS_MS` | `82800000` (~23h) | Pause/resume before E2B 24h hard limit; `0` = off |

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
