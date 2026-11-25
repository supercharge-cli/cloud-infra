# Vectrabot

Status: the sandbox host and the gateway attach call exist. The Electron and Android apps are not pointed at them yet.

## Product

The PC app is the OpenMausBot Electron app. The phone app is their Android app. Both become ours and keep the same work features: chat, agents, files, terminal, screen, preview, and workspace settings. Their Node harness and their website are not shipped.

Cloud-infra is the control plane. Sign-in and payment stay on our website. There is no second login. One paid workspace is one E2B sandbox. Chats and workspace files are stored on our side so a recreated sandbox comes back with the same work. That snapshot is not built yet.

Inside the sandbox, `apps/sandbox-host` is our Go server. It has no web page. It runs the Supercharge CLI only. The apps connect straight to the sandbox after our cloud mints a session.

## Attach

`POST /sessions/:id/attach` on the gateway, with the existing gateway bearer token.

- Supercharge session with a loaded token returns `{ url, token, port }`. `port` is 8788.
- Any other runtime returns 404.
- A Supercharge session whose token is not in this gateway process returns 409.

The raw token is kept in gateway memory. The SHA-256 hash is `sandboxSessionHash` on the session. On create, the gateway writes the token to `/home/user/.vectrabot-session` through stdin, so the command string does not contain it. The host reads `VECTRABOT_SESSION` or that file.

## Host routes

All routes except `GET /health` require `Authorization: Bearer <token>`.

| Route | Behavior |
|---|---|
| `GET /health` | Liveness. No token. |
| `GET/PUT /v1/files?path=` | Read or write under the workspace root. `..` is rejected. |
| `GET /v1/terminal` | WebSocket PTY. A JSON text message `{"type":"resize","cols":80,"rows":24}` resizes it. Other messages are keyboard input. |
| `POST /v1/turns` | Body `{ "engine": "supercharge", "prompt": "..." }`. Any other engine is 400. Runs `supercharge agent --prompt`. |
| `GET /v1/preview?port=` | Reports whether that port is listening. It does not proxy the app. |
| `GET /v1/screen` | Reports `VECTRABOT_DESKTOP_URL` when a desktop stream is configured. |

## Still later

Point the Electron and Android apps at attach. Persist the workspace onto our instance storage. Build the desktop stream. Put this host in the E2B template image.
