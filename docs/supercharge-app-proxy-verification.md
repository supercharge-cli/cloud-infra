# Supercharge App-Proxy Verification Status

## Completed contract verification

The Supercharge daemon was exercised locally against the same upstream routes that the cloud-infra application proxies for its mobile chat experience. The check opened `GET /v1/chat/events?chatId=owner`, submitted `POST /v1/chat` without a `chatId`, and verified that the owner stream received a final `text` event followed by a non-busy `status` event and `done` event. It also verified that `GET /v1/commands`, `POST /v1/conversations/new`, and `GET /v1/conversations/{sessionId}` return the JSON shapes used by the mobile client.

The local test used a deterministic `/bin/echo` agent executable only to prove request routing and event delivery; it did not use a model provider or production credentials.

## Why the complete cloud-infra proxy path was not run in this sandbox

The local checkout contains only `apps/web/.env.example`; it has no configured runtime environment file, no running cloud-infra web process, and no running cloud-infra gateway process. The real `POST /api/instances/{id}/chat` and `GET /api/instances/{id}/chat/events` paths need all of the following before they can be exercised legitimately:

| Requirement | Why it is required |
| --- | --- |
| `MONGODB_URI` and `MONGODB_DB` | The web API resolves a persisted, user-owned instance before proxying any chat request. |
| Valid cloud-infra user authentication | The chat routes reject unauthenticated callers and enforce ownership and billing access. |
| A real instance record | The record supplies the E2B sandbox ID, gateway session ID, and selected `supercharge` runtime. |
| `XIBECODE_SANDBOX_GATEWAY_URL` and matching `XIBECODE_GATEWAY_TOKEN` | The web API uses the gateway to wake and proxy the runtime inbox. |
| A running E2B sandbox built from the updated Supercharge template | The sandbox must run the pushed daemon release on port `8790`. |

No production credentials, user authentication session, production gateway URL, or eligible Supercharge-backed instance record is available in this sandbox. Creating synthetic database rows or bypassing authentication would not validate the real product path and would be unsafe.

## Recommended production smoke test

After the Supercharge template is rebuilt from the new release and an existing cloud-infra instance is set to the `supercharge` runtime, run the app’s normal flow: open the instance chat screen, submit a short message, verify a visible assistant reply, start a new conversation, switch back, and confirm the saved conversation transcript is displayed. The browser or device network log should show successful `POST /api/instances/{id}/chat`, `GET /api/instances/{id}/chat/events`, `GET /api/instances/{id}/chat/commands`, and conversation requests rather than `502` responses.
