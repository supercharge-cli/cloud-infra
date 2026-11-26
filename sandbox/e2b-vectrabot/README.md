# vectrabot-workspace

E2B template for vectrabot workspaces. It starts from the Supercharge desktop
image (`supercharge-full-sandbox`: Supercharge CLI, Xvfb desktop, Chrome, VNC,
desktop runtime, wake doorbell) and adds:

- the vectrabot workspace host at `/opt/vectrabot/sandbox-host`, run as the app
  daemon on **:8790**. It boots with no sessions and accepts the first one the
  gateway writes on attach (`/home/user/.vectrabot/sessions`). The gateway
  still installs its own host build when its digest differs.
- `lockdown.sh`, which rejects public traffic to the internal desktop ports
  **5900, 6080, 9222, 9223**. E2B forwards loopback listeners to the sandbox's
  public address; without the rule Chrome's debugging port and raw VNC would be
  reachable from `<port>-<sandbox>.e2b.app`. 8790 (session auth), 8788 (wake)
  and app preview ports stay reachable.

Build (E2B Pro, `E2B_API_KEY` set):

```bash
(cd ../../../vectrabot/backend && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o "$OLDPWD/sandbox-host" .)
node build.mjs vectrabot-workspace
```

The gateway's default Supercharge template is `vectrabot-workspace`;
`SUPERCHARGE_E2B_TEMPLATE` still overrides it.
