# Vectra Cloud (Flutter)

First-party chat + console for hosted sandboxes. Talks only to the website API
(`Authorization: Bearer`). The daemon `app` inbox is never called from the phone.

## Run

```bash
# against local web (apps/web on :3001)
flutter run --dart-define=API_BASE=http://127.0.0.1:3001

# production
flutter run --dart-define=API_BASE=https://your-app.vercel.app
```

Android emulator cannot reach host `127.0.0.1` — use `http://10.0.2.2:3001`.

## Chat

Same daemon `ChatController` as Telegram: `/help`, `/stop`, `/model`, files,
approve / ask. Events are JSON (`typing`, `text`, `tool`, `ask`, `approve`,
`picker`, `file`, `done`, `error`), not MarkdownV2.
