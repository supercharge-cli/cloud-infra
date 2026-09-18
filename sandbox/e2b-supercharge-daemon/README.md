# supercharge-daemon-sandbox

E2B template for Vectra Supercharge instances. The sandbox boots a **Paseo-style daemon** (`supercharge agent daemon`) that launches Supercharge CLI. Vectra web/mobile talk to **:8790**.

```bash
# After copying CLI + supercharge-superagent-server into the image as
# /usr/local/bin/supercharge and /usr/local/bin/supercharge-superagent-server:
e2b template build --name supercharge-daemon-sandbox
```

Set on gateway/web:

```
SUPERCHARGE_E2B_TEMPLATE=supercharge-daemon-sandbox
SUPERCHARGE_SANDBOX_DAEMON_COMMAND=supercharge agent daemon --bind 0.0.0.0:8790
```

Copy `start-supercharge-daemon.sh` to `/opt/vectra/start-supercharge-daemon.sh` in the image (mode 0755). Keep wake-http on 8788 and browser stream on 9223 from the existing Supercharge image contract.
