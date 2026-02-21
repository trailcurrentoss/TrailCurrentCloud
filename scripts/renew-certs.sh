#!/bin/bash

################################################################################
# TrailCurrent Let's Encrypt Certificate Renewal
#
# Renews Let's Encrypt certificates using certbot webroot mode through the
# running nginx container, then copies renewed certs to data/keys/ and
# reloads services.
#
# Designed to run via cron:
#   0 0,12 * * * /path/to/scripts/renew-certs.sh >> /var/log/trailcurrent-cert-renewal.log 2>&1
#
# Requirements:
#   - Docker compose services must be running (nginx serves ACME challenge)
#   - data/letsencrypt/ must exist from initial setup-letsencrypt.sh run
################################################################################

set -o pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env"
KEYS_DIR="$PROJECT_ROOT/data/keys"
LE_DIR="$PROJECT_ROOT/data/letsencrypt"
COMPOSE_PROJECT="trailcurrent-cloud"

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

log_info() {
    echo "[$TIMESTAMP] INFO: $1"
}

log_error() {
    echo "[$TIMESTAMP] ERROR: $1" >&2
}

log_success() {
    echo "[$TIMESTAMP] OK: $1"
}

# Load domain from .env
DOMAIN=$(grep -E "^TLS_CERT_HOSTNAME=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 | xargs)
if [ -z "$DOMAIN" ]; then
    log_error "TLS_CERT_HOSTNAME not set in .env"
    exit 1
fi

# Record cert fingerprint before renewal to detect changes
BEFORE_HASH=$(openssl x509 -in "$KEYS_DIR/server.crt" -noout -fingerprint -sha256 2>/dev/null)

# Run certbot renewal using webroot mode through nginx
# The certbot-webroot volume is shared between this container and nginx
log_info "Running certbot renewal for $DOMAIN..."

docker run --rm \
    -v "$LE_DIR:/etc/letsencrypt" \
    -v "${COMPOSE_PROJECT}_certbot-webroot:/var/www/certbot" \
    certbot/certbot renew \
        --webroot \
        -w /var/www/certbot \
        --non-interactive

CERTBOT_EXIT=$?

if [ $CERTBOT_EXIT -ne 0 ]; then
    log_error "Certbot renewal failed (exit code: $CERTBOT_EXIT)"
    exit 1
fi

# Check if cert actually changed. Read the current fullchain from inside the
# certbot volume (archive/ is root-owned and live/ symlinks use container paths,
# so both are unreadable from the host — must read inside a container).
AFTER_HASH=$(docker run --rm \
    -v "$LE_DIR:/etc/letsencrypt:ro" \
    alpine sh -c "cat /etc/letsencrypt/live/$DOMAIN/fullchain.pem" \
    | openssl x509 -noout -fingerprint -sha256 2>/dev/null)

if [ "$BEFORE_HASH" = "$AFTER_HASH" ]; then
    log_info "Certificate not yet due for renewal. No changes needed."
    exit 0
fi

# Certificate was renewed — copy from certbot volume to data/keys/
log_info "Certificate renewed. Copying to data/keys/..."

docker run --rm \
    -v "$LE_DIR:/etc/letsencrypt:ro" \
    -v "$KEYS_DIR:/output" \
    alpine sh -c "
        cd /etc/letsencrypt/live/$DOMAIN || exit 1
        cp fullchain.pem /output/server.crt && \
        cp privkey.pem   /output/server.key && \
        cp chain.pem     /output/ca.crt && \
        cp chain.pem     /output/ca.pem && \
        chmod 644 /output/server.crt /output/ca.crt /output/ca.pem && \
        chmod 600 /output/server.key
    "

if [ $? -ne 0 ]; then
    log_error "Failed to copy certificates from certbot volume"
    exit 1
fi

log_success "Certificates copied to data/keys/"

# Reload nginx (picks up new certs without downtime)
log_info "Reloading nginx..."
docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec frontend nginx -s reload 2>/dev/null
if [ $? -eq 0 ]; then
    log_success "Nginx reloaded"
else
    log_error "Failed to reload nginx. Restart frontend container manually."
fi

# Restart mosquitto (does not support hot-reload of TLS certs)
log_info "Restarting mosquitto..."
docker compose -f "$PROJECT_ROOT/docker-compose.yml" restart mosquitto 2>/dev/null
if [ $? -eq 0 ]; then
    log_success "Mosquitto restarted"
else
    log_error "Failed to restart mosquitto. Restart it manually."
fi

log_success "Certificate renewal complete for $DOMAIN"
