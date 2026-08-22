# Supercharge E2B template contract

This repository does not build or publish the E2B image. The image is a user-owned deployment artifact. The Vectra Cloud gateway selects it through `SUPERCHARGE_E2B_TEMPLATE`, whose default alias is `supercharge-full-sandbox`.

## Runtime selection

The web application sends one of two values when an instance is created:

| Runtime value | Gateway template variable  | Default template alias     | Daemon                                         |
| ------------- | -------------------------- | -------------------------- | ---------------------------------------------- |
| `xibecode`    | `XIBECODE_E2B_TEMPLATE`    | `xibecode-full-sandbox`    | Existing XibeCode daemon                       |
| `supercharge` | `SUPERCHARGE_E2B_TEMPLATE` | `supercharge-full-sandbox` | `/usr/local/bin/supercharge-superagent-server` |

The selected value is persisted on the instance record. It is reused for gateway reattachment, wake/resume, daemon restart, workspace/file operations, and sandbox recreation. Existing database rows without a runtime are treated as `xibecode`.

## Required image contents

The Supercharge image should be functionally equivalent to the existing Vectra sandbox image, replacing only the agent runtime. It must include the following assets and capabilities:

| Area                  | Required contract                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent CLI             | Static or otherwise portable `/usr/local/bin/supercharge` and `/usr/local/bin/sc` symlink. The interactive terminal command is `supercharge` or `sc`.                                                         |
| Agent daemon          | `/usr/local/bin/supercharge-superagent-server`, executable by the non-root sandbox user. Do not use the old `xai-grok-*`, `superagent-server`, or `superagent-provider-bridge` names as the primary launcher. |
| Workspace             | `/home/user/workspace`, writable by the sandbox user and used as the daemon working directory.                                                                                                                |
| Browser               | Chromium plus the existing browser automation tools, `agent-browser`, and the visible browser stream expected by the Vectra Computer pane. The stream endpoint must be available on port `9223`.              |
| Wake and file sharing | `/opt/vectra/wake-http/start.sh`, executable and idempotent. Its service must listen on `8788`, expose `/health`, and retain the existing Vectra share contract used by `POST /share`.                        |
| Developer tools       | Node.js, npm, Bun, Python/uv, Git, GitHub CLI, common shell/process utilities, and the same terminal/workspace tooling available in the XibeCode image.                                                       |
| Long-running process  | The image must tolerate E2B pause/resume. The daemon and wake service should be started by the template launcher rather than requiring a user shell to remain open.                                           |

The image should use the existing E2B base image conventions for the sandbox user and browser setup. It should not contain Vercel, E2B, provider, Telegram, Discord, Slack, or GitHub credentials.

## Ports and process contract

The Vectra app and gateway expect these ports:

| Port   | Process or purpose                | Required behavior                                                                                                                                                      |
| ------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `8790` | Supercharge app-compatible daemon | Bind `0.0.0.0:8790` using `SUPERAGENT_BIND`. The Vectra app proxies chat, SSE/events, browser-control, memory, schedule, integration, and file endpoints to this port. |
| `8788` | Vectra wake/file-share service    | Keep the existing `/health` and `/share` behavior. E2B public preview URLs use `https://8788-{sandbox-id}.e2b.app`.                                                    |
| `9223` | Visible browser stream            | Keep the existing browser stream and Chromium/VNC behavior used by the Computer pane.                                                                                  |

The Supercharge daemon’s upstream default bind is `127.0.0.1:8787`; that default is not acceptable for this app integration. The template launcher or Vectra setup must set:

```bash
export SUPERAGENT_BIND="0.0.0.0:8790"
export SUPERAGENT_AGENT_BINARY="/usr/local/bin/supercharge"
export SUPERAGENT_DAEMON_WORKDIR="/home/user/workspace"
export SUPERAGENT_SHARE_WORKSPACE_ROOT="/home/user/workspace"
export SUPERAGENT_MEDIA_ROOT="/home/user/workspace/.superagent-media"
export SUPERAGENT_BROWSER_CONTROL_ENABLED="true"
export SUPERAGENT_WAKE_PORT="8788"
```

## Launcher requirements

The image should provide a launcher or startup script that is safe to run repeatedly after E2B resume. The launcher should perform the following steps in order:

1. Create `/home/user/workspace`, `/home/user/.superagent`, and `/home/user/workspace/.superagent-media` if they do not exist.
2. Start the wake/file-share service from `/opt/vectra/wake-http/start.sh` if it is not already healthy.
3. Source `/home/user/.superagent/daemon.env` and `/home/user/.superagent/gateway.env` when present. These are Vectra’s orchestration overlays, not the Supercharge CLI’s primary configuration directory.
4. Preserve any values already supplied by the image or E2B. Use defaults only when a value is absent; do not replace secrets with placeholders.
5. Set `SUPERAGENT_BIND=0.0.0.0:8790` and `SUPERAGENT_AGENT_BINARY=/usr/local/bin/supercharge` unless explicit deployment overrides are supplied.
6. Stop only the prior `supercharge-superagent-server` process for this sandbox, then start the daemon with `/usr/local/bin/supercharge-superagent-server` and write its pid/log to `/tmp/supercharge-daemon.pid` and `/tmp/supercharge-daemon.log`.
7. Return success only after the daemon responds on port `8790` and the wake service responds on port `8788`.

A launcher must not store credentials in the Dockerfile, image layers, source repository, or a public template manifest. The Vectra control plane writes the per-instance overlay after provisioning and again after wake/restart.

## Provider setup contract

The Vectra `/setup` and instance configuration flows are the provider configuration path. They write provider settings to `/home/user/.superagent/daemon.env` and `gateway.env`, then restart the selected daemon. Supercharge reads these settings at startup:

```bash
SUPERAGENT_PROVIDER=<provider-id>
SUPERAGENT_MODEL=<model-id>
SUPERAGENT_PROVIDER_BASE_URL=<optional-openai-compatible-or-anthropic-url>
SUPERAGENT_PROVIDER_FORMAT=openai|anthropic
SUPERAGENT_PROVIDER_API_KEY_ENV=<environment-variable-name>
SUPERAGENT_PROVIDER_CONFIG_PATH=/home/user/.supercharge/provider-config.toml
```

The active credential is written only to the provider-specific environment variable named by `SUPERAGENT_PROVIDER_API_KEY_ENV` (for example, `POLLINATIONS_API_KEY`, `OPENAI_API_KEY`, or a user-selected custom variable). The generated runtime TOML contains provider metadata and an environment-variable name, never the secret itself. Custom OpenAI-compatible providers must use an HTTPS URL, except for loopback development addresses.

The actual Supercharge CLI configuration home remains `~/.supercharge`. The `/home/user/.superagent` directory is the Vectra app orchestration overlay and compatibility location. If the image’s CLI needs a provider profile in `~/.supercharge/config.toml`, generate it at runtime from the non-secret provider metadata or use the Supercharge provider configuration endpoint; never bake a provider key into that file or the image.

## App compatibility

The daemon must preserve the routes already implemented by Supercharge for the Vectra application, including `/v1/status`, `/v1/chat`, `/v1/chat/events`, `/api/v1/chat`, `/api/v1/sessions`, `/api/v1/stream`, browser control, memory, schedules, integrations, and file/media operations. Protected routes accept the Vectra gateway secret as `Authorization: Bearer <secret>`; the server may resolve it from `SUPERAGENT_API_TOKEN` or `SUPERAGENT_APP_INBOX_SECRET`.

Browser actions remain explicitly approved by the app. The daemon must keep `SUPERAGENT_BROWSER_CONTROL_ENABLED=true` in the runtime environment and retain the view-only browser stream contract on `9223`. Workspace sharing must resolve under `/home/user/workspace`, and media generated by the app must be readable through the configured `SUPERAGENT_MEDIA_ROOT` and Vectra public-media proxy.

Telegram, Discord, and Slack tokens are supplied at runtime by the authenticated Vectra configuration flow. The image should include the required client libraries and process support, but no channel token. Telegram uses long-polling while the sandbox is running; the Vectra wake service and E2B lifecycle integration handle resume after idle pause. Discord and Slack remain compatible where their upstream gateway integrations are enabled.

## Local build and publish checklist

Build and publish the image from the user’s local Supercharge source tree. The following is a contract checklist rather than a command that this repository executes:

```bash
# From the Supercharge source checkout, build the portable release artifacts.
cargo build --release --ignore-rust-version -p supercharge-superagent --bin supercharge-superagent-server
cargo build --release --ignore-rust-version -p supercharge-pager --bin supercharge-pager

# Copy the resulting binaries into the image as:
#   /usr/local/bin/supercharge-superagent-server
#   /usr/local/bin/supercharge
# and create /usr/local/bin/sc -> /usr/local/bin/supercharge.

# Build and publish the local E2B template using the chosen alias.
e2b template build --name supercharge-full-sandbox
# Publish according to the E2B CLI version used by the local account.
# Then set SUPERCHARGE_E2B_TEMPLATE to that published alias or template id.
```

If the local workspace uses different Cargo package names, use the package names shown by `cargo metadata`; the installed artifact names and runtime paths above remain the image contract. Before publishing, test inside a clean image that `supercharge --help`, `sc --help`, `/usr/local/bin/supercharge-superagent-server --help`, `curl http://127.0.0.1:8790/health`, `curl http://127.0.0.1:8788/health`, browser stream availability on `9223`, workspace file creation, and `POST /share` all work as the non-root sandbox user.

After publishing, configure the gateway with `SUPERCHARGE_E2B_TEMPLATE=<published-alias>`, redeploy the gateway and web app, then create a new Supercharge instance from the dashboard. Existing XibeCode instances remain unchanged and continue to use `XIBECODE_E2B_TEMPLATE`.

## References

[1]: https://e2b.dev/docs/sandbox/auto-resume "E2B sandbox auto-resume documentation"
[2]: https://e2b.dev/docs/network/public-url "E2B sandbox public URL documentation"

The lifecycle and public URL requirements above follow the E2B behavior described in [1] and [2].
