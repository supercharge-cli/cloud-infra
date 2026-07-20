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
2. **Update & restart** runs `npm install -g xibecode@X.Y.Z` (via `xibecode update --apply`
   when the sandbox CLI supports it), then restarts the daemon.
3. **Dismiss** hides the offer until the next version / session.
4. Never auto-updates silently. Disable checks with
   `XIBECODE_DISABLE_UPDATE_CHECK=1` (or `XIBECODE_DISABLE_AUTO_UPDATE=1`) in the sandbox env.

APIs: `GET /api/instances/:id/cli-version`, `POST /api/instances/:id/cli-update`.

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
