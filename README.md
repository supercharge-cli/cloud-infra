# Vectra Cloud

**Closed source / proprietary.** Managed AI coding sandboxes product.

> Not public. Do not open-source this repository.

## Layout

```
cloud-infra/
├── app/                  # Next.js site (marketing, docs, auth, dashboard)
├── components/
├── content/docs/         # Customer-facing docs only
├── lib/                  # auth, mongodb, billing, gateway client
├── packages/
│   └── gateway/          # Sandbox control plane
├── .env.local            # site secrets (gitignored)
└── packages/gateway/.env # provider keys (gitignored)
```

## Dev (bun)

```bash
bun run dev:gateway   # :8787
bun run dev:web       # :3001
```

## License

**UNLICENSED / proprietary.** See `LICENSE`.
