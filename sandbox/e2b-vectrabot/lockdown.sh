#!/bin/bash
# Keep the desktop's internal services private. E2B forwards every loopback
# listener to the sandbox's public address (169.254.0.21), which would let
# anyone with the sandbox host name reach Chrome's debugging port, the raw VNC
# server, the noVNC bridge and the desktop runtime. The workspace host on 8790
# (session auth) and the wake doorbell on 8788 stay reachable; app preview
# ports are untouched.
set -u
PORTS=5900,6080,9222,9223
RULE=(INPUT -d 169.254.0.21 -p tcp -m multiport --dports "$PORTS" -j REJECT --reject-with tcp-reset)
iptables -C "${RULE[@]}" 2>/dev/null || iptables -I "${RULE[@]}"
if command -v ip6tables >/dev/null 2>&1; then
  ip6tables -C INPUT -p tcp -m multiport --dports "$PORTS" ! -i lo -j REJECT --reject-with tcp-reset 2>/dev/null ||
    ip6tables -I INPUT -p tcp -m multiport --dports "$PORTS" ! -i lo -j REJECT --reject-with tcp-reset 2>/dev/null || true
fi
