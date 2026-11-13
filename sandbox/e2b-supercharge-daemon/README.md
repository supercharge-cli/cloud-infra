# supercharge-daemon-sandbox

E2B template for Vectra Supercharge instances. The sandbox boots the **latest Supercharge daemon** (`/usr/local/bin/supercharge-superagent-server`, the static binary the current Supercharge release ships) which launches the Supercharge CLI. Vectra web/mobile talk to **:8790**.

The image is built and published from the Supercharge source tree with `sandbox/prepare-e2b-agent-assets.sh` + `sandbox/publish-e2b-template.sh` (see `~/codes/supercharge/sandbox/`), then:

```bash
e2b template create supercharge-daemon-sandbox -d Dockerfile
 e2b template publish supercharge-daemon-sandbox -y
```

Set on gateway/web:

```
SUPERCHARGE_E2B_TEMPLATE=supercharge-daemon-sandbox
SUPERCHARGE_SANDBOX_DAEMON_COMMAND=/usr/local/bin/supercharge-superagent-server
```

Copy `start-supercharge-daemon.sh` to `/opt/vectra/start-supercharge-daemon.sh` in the image (mode 0755). Keep wake-http on 8788 and browser stream on 9223 from the existing Supercharge image contract.
