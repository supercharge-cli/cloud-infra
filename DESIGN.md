# Vectra chat interface

The app is a task-focused, familiar messaging interface for a user's persistent E2B agents. Preserve native desktop navigation, keyboard controls, and the in-window computer/browser area.

## Layout

- Chats is the startup destination. One persistent group leads the contact list; direct messages follow.
- Desktop: 292 px contact rail, flexible conversation, optional resizable computer pane. Avoid a redundant second agent rail when the global sidebar is visible.
- Phone: contact list first, then a full thread. Back returns to chats. Secondary tools live in the overflow menu so the conversation title remains readable.
- Workspace provisioning is first-run onboarding, not the normal home screen. Existing multiple-workspace records remain reachable.

## Visual system

Use a restrained dark blue-green palette for long technical work sessions: canvas `#0B141A`, navigation `#111B21`, received message `#1C2A32`, composer `#202F38`, borders `#314149`, secondary text `#AFBEC7`, primary accent `#35C5A3`, soft accent `#6EE5C4`, sent message `#145249`.

System sans typography carries the interface; Linux uses Adwaita Sans with native fallbacks. Main content is 14–16 px, secondary information 11–13 px, contact headings 22–27 px. Use recognizable Material/Lucide icons, not emoji font glyphs, for preset avatars.

## Interaction and state

Selected contact identity changes immediately. The prior transcript is hidden while the destination loads. Working animation represents real activity only and respects reduced motion. Queued is a separate static state. Group work chips open the exact agent thread. Agent name/avatar links open a DM; they do not trigger another model turn.

Group send uses a stable request ID for retries. Direct-message and group drafts stay separate. Images remain authenticated and versioned. The noVNC viewer starts read-only and input is enabled only after an explicit, verified takeover.

## Evidence scope

Flutter widget fixtures and automated tests validate layouts, routing, and state isolation. They do not establish that a signed-in production sandbox has been migrated or that every operating-system integration has been exercised. Use a production running-build check for that claim.
