# Vectra Cloud (`cloud-infra`)

Managed **AI coding sandboxes** product site: marketing, Fumadocs docs, MongoDB auth, and a full dashboard wired to **e2b-gateway**.

> **Not** the XibeCode CLI docs (`xibecode/site`). That repo/folder stays for the open-source CLI product.

## Brand

**Vectra Cloud** — separate product line. Sandboxes still run [XibeCode](https://github.com/iotserver24/Xibecode) under the hood.

## Stack

- Next.js 16 + Fumadocs (from [VectraDocs](https://github.com/iotserver24/VectraDocs) template)
- MongoDB (`users`, `instances`)
- Session cookies (HMAC, no JWT dependency)
- Gateway client ported from the old `packages/hosting` prototype

## Setup

```bash
pnpm install
cp .env.example .env.local
# fill MONGODB_URI, AUTH_SECRET, gateway URL
pnpm dev
```

Open http://127.0.0.1:3001

## Repo

https://github.com/iotserver24/cloud-infra

## License

MIT
