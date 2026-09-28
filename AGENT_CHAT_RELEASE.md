# Agent chat release

## Experience

Vectra opens on Chats rather than a workspace dashboard. Each account can create one workspace; all persistent agents live inside it. Existing accounts with several workspaces retain access to their records rather than losing data.

The shared **Agent group** is separate from each agent's direct conversations. A user message without a mention is routed to Main. Tagged messages run only the selected agents. Group activity links open the relevant agent conversation. Each agent may read group history; direct-message histories are not included in that shared context. A direct-message agent cannot publish into the group through the collaboration endpoint.

`vectra_bot` is available to persistent agent conversations, not their task subagents. Main alone creates agents. Any agent may privately delegate to another with `send`; an attributed completion is persisted into the same originating conversation's queue. Group turns use `mention` for public collaboration. The maximum automatic chain depth is six. Restarted in-flight work is marked interrupted, not blindly repeated. Result-delivery notifications are written atomically with the completion.

## Desktop

The embedded noVNC surface starts view-only and uses explicit Take over / Return control actions. Its fragment settings follow E2B's `path`, `autoconnect`, `reconnect`, `reconnect_delay`, `resize`, and `view_only` contract. It uses the authenticated existing relay to the sandbox's `127.0.0.1:6080/websockify`, rather than changing the raw no-password port to public access. Direct URL helper examples support `6080-{sandboxId}.e2b.app` and legacy `.e2b.dev`, but direct unauthenticated access is not the app's default transport.

The runtime and UI refuse takeover while another agent has work. Once a human handoff is active, queued agents wait until it ends. No background agent is force-stopped as a side effect of merely opening the viewer. `view_only` is a user-interface input mode, not an authentication boundary.

## Compatibility and rollout

Deploy the daemon/CLI and web API together: group and conversation-scoped collaboration require the new daemon endpoints. Agent credentials are derived per bot and conversation; the root instance capability is not passed to specialist CLI processes. Older runtimes receive a clear update-required error rather than silently impersonating Main.

Workspace creation is guarded on free and paid creation paths. A completed payment for an account that gained a workspace during checkout is retained for support resolution, not lost or automatically charged again. Existing workspaces are not deleted to enforce the policy.

No live credentials belong in source, test fixtures, screenshots, or release bundles.
