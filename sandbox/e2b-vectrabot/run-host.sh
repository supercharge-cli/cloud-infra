#!/bin/bash
# The template's app daemon: the vectrabot workspace host on 8790. It starts
# with no sessions and accepts the first one the cloud writes on attach.
set -u
sudo -n /opt/vectrabot/lockdown.sh || true
D=/home/user/.vectrabot
mkdir -p "$D/bin" /home/user/workspace
chmod 700 "$D"
touch "$D/sessions"
exec env VECTRABOT_HOST_ADDR=0.0.0.0:8790 VECTRABOT_WORKSPACE=/home/user/workspace \
  VECTRABOT_SESSION_FILE="$D/sessions" VECTRABOT_WAIT_FOR_SESSION=1 \
  VECTRABOT_PIDFILE=/tmp/supercharge-daemon.pid /opt/vectrabot/sandbox-host
