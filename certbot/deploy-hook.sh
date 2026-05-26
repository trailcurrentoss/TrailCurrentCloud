#!/bin/sh
#
# Certbot deploy-hook. Invoked by certbot once per successful renewal.
#
# certbot sets RENEWED_LINEAGE to the live directory of the renewed cert
# (e.g. /etc/letsencrypt/live/cloud.trailcurrent.com).
#
# Steps:
#   1. Write new cert files into /keys via shell redirection. Using `>` truncates
#      the existing file in place, preserving its inode. This is critical
#      because frontend/mosquitto bind-mount these files individually — a fresh
#      inode would leave running containers pointing at the deleted-but-still-
#      open old file.
#   2. Restart frontend, mosquitto, backend so they re-read TLS material.
#      mosquitto and backend do not hot-reload TLS at all; nginx could, but a
#      full restart removes the inode-handling variable.
#
set -e

LIVE="${RENEWED_LINEAGE:-/etc/letsencrypt/live/${TLS_CERT_HOSTNAME}}"
PROJECT="${COMPOSE_PROJECT:-trailcurrent-cloud}"

echo "[deploy-hook] Renewal detected: ${LIVE}"

if [ ! -f "${LIVE}/fullchain.pem" ]; then
    echo "[deploy-hook] ERROR: ${LIVE}/fullchain.pem not found" >&2
    exit 1
fi

cat "${LIVE}/fullchain.pem" > /keys/server.crt
cat "${LIVE}/privkey.pem"   > /keys/server.key
cat "${LIVE}/chain.pem"     > /keys/ca.crt
cat "${LIVE}/chain.pem"     > /keys/ca.pem
chmod 644 /keys/server.crt /keys/ca.crt /keys/ca.pem
chmod 600 /keys/server.key
echo "[deploy-hook] Files written to /keys"

restart_service() {
    svc="$1"
    cid=$(docker ps -q \
        --filter "label=com.docker.compose.project=${PROJECT}" \
        --filter "label=com.docker.compose.service=${svc}")
    if [ -z "${cid}" ]; then
        echo "[deploy-hook] WARN: no running container for service ${svc}"
        return 0
    fi
    echo "[deploy-hook] Restarting ${svc} (${cid})..."
    docker restart "${cid}" >/dev/null
}

restart_service frontend
restart_service mosquitto
restart_service backend

echo "[deploy-hook] Done."
