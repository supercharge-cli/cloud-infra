# Incident diagnosis: Supercharge chat and browser 502 responses

**Incident scope.** This note diagnoses the production failures recorded for instance `3IsQ08SGxq` in `cloud-infra-log-export-2026-08-22T16-32-23.json`. It is separate from the Supercharge website work.

## Executive summary

The immediate fault is a **runtime health-route mismatch**. Cloud-infra checks the app inbox at `GET /health`, but the Supercharge daemon exposes its unprotected readiness route at `GET /healthz`. As a result, the health check treats a healthy Supercharge daemon as unhealthy, repeatedly performs inbox bootstrap and daemon wake/restart work, and finally returns a `502` from every route that uses the shared inbox proxy.

The supplied log export is consistent with that conclusion. The Supercharge instance has `502` responses across chat events, browser streaming, status, commands, conversations, and chat submission, while the non-inbox instance metadata, configuration, pairing, and CLI-version routes return successfully. MongoDB connection/index timings are low and the recorded function memory use remains about 230–248 MB of the configured 2 GB, so neither database startup nor memory pressure is the primary failure.

> **Immediate diagnosis:** the Supercharge daemon can be running on port `8790`, yet cloud-infra will still declare it unavailable because it probes the wrong path.

| Evidence | Observed behavior | Interpretation |
| --- | --- | --- |
| `apps/web/lib/app-chat.ts` | `inboxHealthy()` requests `/health` and returns `health.ok` | A `404` from a healthy Supercharge daemon is classified as unhealthy. |
| `crates/codegen/supercharge-superagent/src/bin/server.rs` | The public route is `/healthz`; protected runtime routes begin at `/v1/*` | The health URI expected by cloud-infra and the actual Supercharge URI do not match. |
| Production export | `142` failures for `GET .../chat/events`; `20` failures for `GET .../computer/browser`; status, commands, conversations, and chat requests also fail | Those routes all depend on `proxyInbox()`, which calls `ensureInbox()` before forwarding the request. |
| Production export | Instance, pairing, config, and CLI-version calls return `200` | Authentication, Mongo persistence, and the general web deployment are not the common failure point. |

## Exact failure sequence

The failure is deterministic for a Supercharge instance.

1. A cloud-infra route calls `proxyInbox()`.
2. `proxyInbox()` calls `ensureInbox()`.
3. `ensureInbox()` calls `inboxHealthy()`, which requests `https://8790-<sandbox>.e2b.app/health`.
4. Supercharge exposes `/healthz`, not `/health`; the request therefore does not produce a successful status.
5. `ensureInbox()` assumes the inbox is down, rewrites bootstrap variables, wakes the E2B session, and asks the gateway to restart the daemon.
6. The same wrong health request is repeated up to eight times. It can never become healthy while the daemon correctly exposes only `/healthz`.
7. `ensureInbox()` throws. The route-level error handler converts that exception into `502`.

The gateway restart handler has a related diagnostic weakness: it considers the daemon ready when a matching process exists and then verifies only the separate wake/file-share service on port `8788`. It does not verify that the Supercharge inbox is reachable on `8790`, so it can report a successful restart while the app inbox remains inaccessible.

## Required remediation order

The first two items are the direct outage fix. The remaining items prevent the next independently visible failures after the health check is corrected.

| Priority | Change | Required outcome |
| --- | --- | --- |
| P0 | Make `inboxHealthy()` runtime-aware: use `/healthz` for `supercharge` and retain `/health` for the existing XibeCode runtime. | A live Supercharge daemon passes the shared inbox readiness probe instead of being restarted on every request. |
| P0 | In the gateway wake/restart sequence, require both process existence **and** a successful local `curl http://127.0.0.1:8790/healthz` for Supercharge before reporting `DAEMON_OK`. Keep the existing port-`8788` check separately. | Restart output diagnoses a real 8790 failure rather than producing a false positive. |
| P1 | Add the app-compatibility endpoints expected by cloud-infra: `GET /v1/commands`, `GET /v1/conversations`, and the corresponding session-specific/switch routes if the frontend uses them. Alternatively, change cloud-infra to use only Supercharge-native endpoints after updating the frontend contract. | Once the inbox is reachable, those pages no longer expose downstream `404` compatibility failures. |
| P1 | Bound every Vercel-proxied SSE request below the function timeout and close it cleanly, with a client reconnect. Use a shorter interval such as 40–45 seconds when the function timeout is 55 seconds. | SSE reconnects produce clean completion/reconnect behavior rather than `Vercel Runtime Timeout Error` and `502`. |
| P2 | Surface a structured readiness error from the gateway, including runtime, selected health URL, process PID, and last 8790 log lines. | Future template or port mistakes can be diagnosed without inferring the state from aggregate 502s. |

## Secondary compatibility gap: missing cloud-infra app routes

The current Supercharge server registers `/v1/status`, `/v1/chat`, `/v1/chat/events`, browser-control routes, memory routes, schedules, integrations, and other endpoints. It does **not** currently register the cloud-infra paths `/v1/commands` or `/v1/conversations` that the web application proxies. Correcting the health path will allow traffic to reach the daemon, but those requests will then fail as compatibility errors until one side of the contract is updated.

This is not the reason the exported requests are currently `502`: the shared health check fails before the proxy can forward them. It is nevertheless a real follow-on issue and should be corrected before calling the Supercharge runtime ready for the existing cloud UI.

## Independent streaming issue: Vercel 55-second timeout

The Supercharge `/v1/chat/events` handler is intentionally infinite. It sends a `ready` frame, emits a heartbeat every 15 seconds, and does not complete unless the subscriber closes. The cloud-infra event route sets `maxDuration = 55`; the production export includes the explicit message:

> `Vercel Runtime Timeout Error: Task timed out after 55 seconds`

That timeout is independent of the health-route bug. After the health fix, an indefinitely held chat or browser SSE connection can still run until the serverless function is terminated. The XibeCode instance's successful records do not prove that the Supercharge stream is safe: its event endpoint appears to have a different connection lifetime.

The safe serverless pattern is to make the proxy deliberately finite. It should send the normal `ready` frame, proxy events for a bounded interval below the deployment timeout, optionally emit a `reconnect` event, cancel the upstream reader, and end the response with `200`. The client must treat an orderly close or `reconnect` event as a signal to reconnect with the latest event ID. The same approach applies to the browser event stream, or that stream must move to a hosting path designed for persistent connections.

## Validation checklist after the fix

Before marking the incident resolved, create a fresh Supercharge instance and verify all of the following as the sandbox user:

1. `curl -fsS http://127.0.0.1:8790/healthz` returns success after provisioning and after an E2B pause/resume.
2. Cloud-infra's runtime-aware readiness check returns true for Supercharge without rewriting config or restarting the daemon.
3. `GET /api/instances/<id>/chat/status` returns a runtime status payload.
4. `GET /api/instances/<id>/chat/commands` and conversation endpoints return documented compatible responses rather than `404` or `502`.
5. Chat event and browser streams stay successful across at least two deliberate proxy reconnect cycles, with no Vercel timeout records.
6. Gateway restart output fails clearly if port `8790` is not listening, while port `8788` remains a separate wake/share readiness check.

## Source references

| Source | Relevant location |
| --- | --- |
| Uploaded production log export | `/home/ubuntu/upload/cloud-infra-log-export-2026-08-22T16-32-23.json` |
| Shared cloud-infra inbox readiness and proxy | `apps/web/lib/app-chat.ts`, `inboxHealthy()`, `ensureInbox()`, and `proxyInbox()` |
| Supercharge route registration and streaming implementation | `crates/codegen/supercharge-superagent/src/bin/server.rs`, `main()`, `app_chat_events()` |
| Cloud-infra Vercel event proxy | `apps/web/app/api/instances/[id]/chat/events/route.ts` |
| Cloud-infra gateway restart flow | `apps/gateway/src/index.ts`, `POST /sessions/:id/wake` |
| E2B template interface contract | `docs/supercharge-e2b-template.md` |
