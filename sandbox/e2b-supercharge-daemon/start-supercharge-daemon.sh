#!/bin/bash
set -euo pipefail
mkdir -p /home/user/workspace /home/user/.superagent /home/user/workspace/.superagent-media
chown -R user:user /home/user/workspace /home/user/.superagent 2>/dev/null || true

if [ -x /opt/vectra/wake-http/start.sh ]; then
  /opt/vectra/wake-http/start.sh || true
fi

set -a
[ -f /home/user/.superagent/daemon.env ] && . /home/user/.superagent/daemon.env
[ -f /home/user/.superagent/gateway.env ] && . /home/user/.superagent/gateway.env
set +a

export SUPERAGENT_BIND="${SUPERAGENT_BIND:-0.0.0.0:8790}"
export SUPERAGENT_AGENT_BINARY="${SUPERAGENT_AGENT_BINARY:-/usr/local/bin/supercharge}"
export SUPERAGENT_DAEMON_WORKDIR="${SUPERAGENT_DAEMON_WORKDIR:-/home/user/workspace}"
export SUPERAGENT_SHARE_WORKSPACE_ROOT="${SUPERAGENT_SHARE_WORKSPACE_ROOT:-/home/user/workspace}"
export SUPERAGENT_MEDIA_ROOT="${SUPERAGENT_MEDIA_ROOT:-/home/user/workspace/.superagent-media}"
export SUPERAGENT_BROWSER_CONTROL_ENABLED="${SUPERAGENT_BROWSER_CONTROL_ENABLED:-true}"
export SUPERAGENT_WAKE_PORT="${SUPERAGENT_WAKE_PORT:-8788}"
export SUPERCHARGE_WORKSPACE="${SUPERCHARGE_WORKSPACE:-/home/user/workspace}"
# Latest supercharge template launches the static daemon binary directly.
export SUPERAGENT_DAEMON_COMMAND="${SUPERAGENT_DAEMON_COMMAND:-/usr/local/bin/supercharge-superagent-server}"

PIDFILE=/tmp/supercharge-daemon.pid
LOGFILE=/tmp/supercharge-daemon.log

if [ -f "$PIDFILE" ]; then
  old=$(cat "$PIDFILE" || true)
  if [ -n "${old:-}" ] && kill -0 "$old" 2>/dev/null; then
    kill "$old" 2>/dev/null || true
    sleep 0.5
  fi
fi

cd /home/user/workspace
nohup $SUPERAGENT_DAEMON_COMMAND >>"$LOGFILE" 2>&1 &
echo $! >"$PIDFILE"

for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8790/health >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done
echo "daemon did not become healthy on :8790" >&2
exit 1
