# Handoff: Opt-in XibeCode CLI update (E2B / Vectra Cloud)

**For the AI (or human) working on `cloud-infra`.**  
**Shipped npm:** `xibecode@1.4.30` / `xibecode-core@1.4.30` (2026-07-20).  
**Repos CLI pin (new sandboxes):** rebuild E2B template with `npm install -g xibecode@1.4.30` when ready.

---

## Goal

When a sandbox is already running an **older** global CLI, the **user** can opt in to upgrade and **auto-restart** the daemon. **Never** silent auto-update.

Template rebuilds still define the **baseline** for *new* sandboxes. This flow upgrades *existing* ones.

---

## Already implemented (do not re-do blindly)

### XibeCode repo (`~/codes/xibecode`) — published **1.4.30**

| Piece | Path / command |
|--------|----------------|
| Check only | `xibecode update --check` / `--json` |
| Apply + E2B auto-relaunch | `xibecode update --apply --yes [--version X.Y.Z] [--restart]` |
| Helpers | `packages/cli/src/utils/npm-update-notice.ts`, `self-update.ts` |
| E2B detect | `isE2bHostedRuntime()` — `E2B*`, `XIBECODE_HOSTED`, `XIBECODE_SANDBOX_MODE=e2b`, `/home/user/workspace` |
| Disable | `XIBECODE_DISABLE_UPDATE_CHECK=1` or `XIBECODE_DISABLE_AUTO_UPDATE=1` |
| Daemon notify | On start in E2B: home channel message if update available |
| Chat | `/update` · `/update yes` (install + auto-restart) · `/update no` |
| Daemon does **not** self-update on boot | only notifies |

### cloud-infra (`~/codes/cloud-infra`) — **local changes** (wire/deploy)

| Piece | Path |
|--------|------|
| Version probe | `GET /api/instances/[id]/cli-version` |
| Opt-in upgrade | `POST /api/instances/[id]/cli-update` body `{ version?: string }` |
| Gateway helpers | `apps/web/lib/gateway-client.ts` → `getCliVersionInfo`, `updateCliInSandbox` |
| Dashboard banner | `apps/web/components/dashboard.tsx` — **Update & restart** / **Dismiss** |
| Docs note | `README.md` § CLI updates on existing sandboxes |

**Update path (hosting):**

1. Wake paused sandbox (`wakeSession`, no need to restart daemon first).  
2. Exec: `xibecode update --apply --yes --restart --version <offered> --json` (npm `-g` fallback if old CLI).  
3. `restartDaemon` again as hard guarantee.  
4. Return `{ ok, from, to, verified, logs }`.  

Auth: same as other instance routes (`getSessionUser`, `getInstance`, `hasInstanceAccess` — free + paid).

---

## What you should verify / finish on infra

1. **Commit + deploy** `apps/web` (Vercel) with `cli-version` / `cli-update` + dashboard banner if not already.  
2. **Smoke test** on a real instance:  
   - Old CLI in sandbox → banner shows `latest` vs `current`  
   - Dismiss → no install  
   - Update & restart → `xibecode -v` matches offered version; Telegram/daemon back  
3. **Optional later:** Telegram host-side “update available” link to dashboard (not required).  
4. **Template:** when ready, bump `XIBECODE_E2B_TEMPLATE` / Dockerfile pin to `xibecode@1.4.30` and rebuild template (new sandboxes only).  

---

## Contracts (stable)

### `GET /api/instances/:id/cli-version`

```json
{
  "instanceId": "...",
  "current": "1.4.2",
  "latest": "1.4.30",
  "updateAvailable": true,
  "logs": []
}
```

### `POST /api/instances/:id/cli-update`

```json
// request
{ "version": "1.4.30" }

// response
{ "ok": true, "from": "1.4.2", "to": "1.4.30", "verified": "1.4.30", "logs": ["..."] }
```

### In-sandbox (preferred)

```bash
xibecode update --check --json
xibecode update --apply --yes --restart --version 1.4.30 --json
```

Does **not** wipe `~/.xibecode/daemon.env`, workspace, or pairing.

---

## Non-goals

- Silent auto-update  
- Bulk “update all tenants”  
- Replacing E2B template rebuild for brand-new sandboxes  

---

## Paste for infra AI

```
You are working on ~/codes/cloud-infra (Vectra Cloud).

XibeCode shipped npm xibecode@1.4.30 with opt-in E2B CLI update:
- CLI: xibecode update --check | --apply --yes --restart --version X
- E2B detect + /update yes in daemon chat auto-installs and relaunches daemon
- Never silent

In cloud-infra we already added (or need deployed):
- GET /api/instances/[id]/cli-version
- POST /api/instances/[id]/cli-update  (wake → install exact version → restartDaemon)
- Dashboard banner Update & restart / Dismiss
- gateway-client: getCliVersionInfo, updateCliInSandbox
- README note about template vs existing sandbox upgrades

Tasks:
1. Ensure these routes + dashboard are committed and deployed to Vercel.
2. Smoke-test free + paid instance: banner, dismiss, accept, daemon + channels OK.
3. Do not implement silent auto-update.
4. Template pin to 1.4.30 is optional follow-up (new sandboxes only).

Full handoff: docs/HANDOFF-cli-update-e2b.md
```
