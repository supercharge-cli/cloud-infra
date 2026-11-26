#!/bin/bash
# Boot: lock down internal ports, then the desktop stack (Xvfb, Chrome, VNC,
# desktop runtime, wake doorbell) from the base image, with the workspace host
# as the app daemon.
set -u
sudo -n /opt/vectrabot/lockdown.sh || true
export SUPERAGENT_DAEMON_COMMAND=/opt/vectrabot/run-host.sh
exec /opt/vectra/entrypoint.sh
