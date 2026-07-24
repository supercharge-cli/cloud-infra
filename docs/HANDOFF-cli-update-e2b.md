# Handoff: Opt-in CLI update (Vectra Cloud / E2B)

**For the AI (or human) working on `cloud-infra` only.**  
Agent product behavior lives in the XibeCode repo; this file is the **hosting contract**.

---

## Goal

When a sandbox is already running an **older** global CLI, the **user** can opt in from the **dashboard** to upgrade and **auto-restart** the daemon. **Never** silent auto-update.

Template rebuilds still define the **baseline** for *new* sandboxes. This flow upgrades *existing* ones.

---

## Implemented in cloud-infra

| Piece | Path |
|--------|------|
| Version probe | `GET /api/instances/[id]/cli-version` |
| Opt-in upgrade | `POST /api/instances/[id]/cli-update` |
| Logs pull | `GET /api/instances/[id]/logs?source=all\|daemon\|agent\|system` |
| Gateway helpers | `apps/web/lib/gateway-client.ts` → `getCliVersionInfo`, `updateCliInSandbox`, `readSandboxLogs`, `wakeSession`, `restartDaemon` |
| Dashboard | `apps/web/components/dashboard.tsx` — **Update & restart** / **Dismiss**, **View logs** |
| Product docs | `apps/web/content/docs/dashboard.mdx` |

### Update path (hosting)

1. **Wake** paused sandbox (`wakeSession`, no need to restart daemon first).
2. **Install** latest global package inside the sandbox:

```bash
# Prefer passwordless sudo — template global prefix is often root-owned
sudo -n npm install -g xibecode@latest --no-fund --no-audit \
  || sudo npm install -g xibecode@latest --no-fund --no-audit \
  || npm install -g xibecode@latest --no-fund --no-audit
```

3. **`restartDaemon`** as hard guarantee (reload env from `~/.xibecode/daemon.env`).
4. Return `{ ok, from, to, verified, logs }`.

Auth: same as other instance routes (`getSessionUser`, `getInstance`, `hasInstanceAccess` — free + paid).  
Route `maxDuration`: **300** (install can be slow).

Does **not** wipe `~/.xibecode/daemon.env`, workspace, or pairing.

### Version probe

1. Host fetches `https://registry.npmjs.org/xibecode/latest`.
2. Sandbox runs `xibecode -v` (via gateway exec).
3. `updateAvailable` when `latest > current` (semver core compare).

---

## Operator checklist

1. Deploy **Vercel** (`apps/web`) after changes to cli-version / cli-update / logs / dashboard.
2. Deploy **gateway** (`apps/gateway`) when lifecycle or template env changes.
3. Smoke-test free + paid instance:
   - Banner shows `latest` vs `current`
   - Dismiss → no install
   - Update & restart → `xibecode -v` matches latest; channels work after daemon restart
   - View logs → daemon log tail after wake
4. **Template:** bump `XIBECODE_E2B_TEMPLATE` / rebuild template when raising baseline for *new* sandboxes only.

---

## Contracts (stable)

### `GET /api/instances/:id/cli-version`

```json
{
  "instanceId": "...",
  "current": "1.6.0",
  "latest": "1.17.0",
  "updateAvailable": true,
  "logs": []
}
```

### `POST /api/instances/:id/cli-update`

```json
// request (optional; install currently targets npm latest)
{ "version": "1.17.0" }

// response
{ "ok": true, "from": "1.6.0", "to": "1.17.0", "verified": "1.17.0", "logs": ["..."] }
```

### `GET /api/instances/:id/logs`

Query: `lines` (default 200), `source` = `all` | `daemon` | `agent` | `system`.

```json
{ "ok": true, "instanceId": "...", "source": "daemon", "text": "...", "logs": ["..."] }
```

---

## Non-goals

- Silent auto-update  
- Bulk “update all tenants”  
- Replacing E2B template rebuild for brand-new sandboxes  
- Documenting agent slash commands / product CLI features here (see XibeCode docs site)

---

## Related operator docs

- Root `README.md` — Vercel + gateway env, lifecycle webhooks, CLI update summary  
- User-facing: `/docs/dashboard`, `/docs/pause-resume`, `/docs/telegram`
