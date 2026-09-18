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
export SUPERCHARGE_WORKSPACE="${SUPERCHARGE_WORKSPACE:-/home/user/workspace}"

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
nohup supercharge agent --always-approve daemon --bind 0.0.0.0:8790 \
  >>"$LOGFILE" 2>&1 &
echo $! >"$PIDFILE"

for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8790/health >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done
echo "daemon did not become healthy on :8790" >&2
exit 1
