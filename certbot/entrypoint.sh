#!/bin/sh
#
# Certbot renewal loop.
#
# Wakes up every RENEWAL_INTERVAL seconds (default 12 hours) and asks certbot
# to renew. certbot is a no-op until the cert is within 30 days of expiry,
# so this is cheap. When a renewal actually happens, certbot invokes
# /deploy-hook.sh which copies the new files into /keys and restarts the
# services that consume them.
#
set -e

RENEWAL_INTERVAL="${RENEWAL_INTERVAL:-43200}"

echo "[certbot] Starting renewal loop (interval: ${RENEWAL_INTERVAL}s)"

# Run once immediately on startup so a freshly-deployed stack catches up if
# the cert expired while the certbot service was down.
while :; do
    echo "[certbot] $(date -u +%Y-%m-%dT%H:%M:%SZ) checking renewal..."
    certbot renew \
        --webroot -w /var/www/certbot \
        --deploy-hook /deploy-hook.sh \
        --non-interactive || echo "[certbot] renew exited non-zero (will retry next cycle)"
    sleep "${RENEWAL_INTERVAL}"
done
