# Vectra Cloud

**Closed source / proprietary.** Managed AI coding sandboxes product.

> Not the public XibeCode CLI docs. Do not open-source this repository.

## Repo layout

```
cloud-infra/
├── app/                  # Next.js site (marketing, docs, auth, dashboard)
├── components/
├── content/docs/         # Product docs (Fumadocs)
├── lib/                  # auth, mongodb, gateway client
├── packages/
│   └── gateway/          # E2B control plane (was e2b-gateway)
├── .env.local            # site secrets (gitignored)
└── packages/gateway/.env # E2B key + gateway token (gitignored)
```

## Stack

| Layer | Tech |
| --- | --- |
| Site | Next.js 16, Fumadocs, MongoDB auth |
| Gateway | Bun HTTP server + E2B SDK |
| Sandboxes | Custom template `xibecode-full-sandbox` (4c/8GB) |

## Dev (bun)

```bash
# 1) Gateway
cp packages/gateway/.env.example packages/gateway/.env
# set E2B_API_KEY, XIBECODE_GATEWAY_TOKEN, XIBECODE_E2B_TEMPLATE
bun run --cwd packages/gateway install
bun run dev:gateway

# 2) Site
cp .env.example .env.local
# set MONGODB_URI, AUTH_SECRET, XIBECODE_SANDBOX_GATEWAY_URL, XIBECODE_GATEWAY_TOKEN
bun install
bun run dev:web
```

- Site: http://127.0.0.1:3001  
- Gateway: http://127.0.0.1:8787  

## License

**UNLICENSED / proprietary.** See `LICENSE`. No public use, forks, or redistribution without written permission.
