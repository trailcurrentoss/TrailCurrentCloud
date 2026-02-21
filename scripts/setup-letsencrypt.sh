#!/bin/bash

################################################################################
# TrailCurrent Let's Encrypt Certificate Setup
#
# Obtains trusted TLS certificates from Let's Encrypt for production
# deployments. Uses certbot standalone mode (binds port 80 directly),
# so this script must run BEFORE docker compose up.
#
# Certificates are copied to data/keys/ so all existing service volume
# mounts work unchanged (nginx, mosquitto, backend).
#
# USAGE:
#   ./scripts/setup-letsencrypt.sh
#
# Requirements:
#   - .env file with TLS_CERT_HOSTNAME and LETSENCRYPT_EMAIL set
#   - Docker installed (certbot runs in a container)
#   - Port 80 available (not bound by another process)
#   - DNS A record pointing TLS_CERT_HOSTNAME to this server's public IP
################################################################################

set -o pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env"
KEYS_DIR="$PROJECT_ROOT/data/keys"
LE_DIR="$PROJECT_ROOT/data/letsencrypt"

################################################################################
# Functions
################################################################################

print_header() {
    echo ""
    echo "========================================"
    echo "$1"
    echo "========================================"
    echo ""
}

print_success() {
    echo "✓ $1"
}

print_error() {
    echo "✗ $1" >&2
}

print_warning() {
    echo "⚠ $1"
}

print_info() {
    echo "ℹ $1"
}

check_requirements() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker and try again."
        exit 1
    fi
    print_success "Docker found"

    if [ ! -f "$ENV_FILE" ]; then
        print_error ".env file not found. Copy .env.example to .env and configure it."
        exit 1
    fi
    print_success ".env file found"
}

load_config() {
    DOMAIN=$(grep -E "^TLS_CERT_HOSTNAME=" "$ENV_FILE" | cut -d'=' -f2 | xargs)
    EMAIL=$(grep -E "^LETSENCRYPT_EMAIL=" "$ENV_FILE" | cut -d'=' -f2 | xargs)

    if [ -z "$DOMAIN" ]; then
        print_error "TLS_CERT_HOSTNAME not set in .env"
        exit 1
    fi

    if [ -z "$EMAIL" ]; then
        print_error "LETSENCRYPT_EMAIL not set in .env"
        print_info "Let's Encrypt requires an email for certificate registration and renewal notices."
        exit 1
    fi

    print_success "Domain: $DOMAIN"
    print_success "Email: $EMAIL"
}

check_port_80() {
    if ss -tlnp 2>/dev/null | grep -q ':80 ' || netstat -tlnp 2>/dev/null | grep -q ':80 '; then
        print_warning "Port 80 appears to be in use"
        print_info "Certbot standalone mode needs port 80. Stop any services using it first."
        print_info "If docker compose is running: docker compose down"
        echo ""
        read -p "Continue anyway? (y/N): " confirm
        if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
            exit 1
        fi
    else
        print_success "Port 80 is available"
    fi
}

backup_existing() {
    if [ -f "$KEYS_DIR/server.crt" ] || [ -f "$KEYS_DIR/server.key" ]; then
        print_warning "Existing certificates found"
        BACKUP_DIR="$KEYS_DIR/backup_$(date +%Y%m%d_%H%M%S)"
        mkdir -p "$BACKUP_DIR"
        cp "$KEYS_DIR"/*.{key,crt,pem} "$BACKUP_DIR/" 2>/dev/null || true
        print_success "Backed up to: $BACKUP_DIR"
    fi
}

obtain_certificates() {
    print_header "Obtaining Let's Encrypt Certificates"

    mkdir -p "$KEYS_DIR"
    mkdir -p "$LE_DIR"

    print_info "Running certbot (standalone mode on port 80)..."
    echo ""

    docker run --rm \
        -p 80:80 \
        -v "$LE_DIR:/etc/letsencrypt" \
        certbot/certbot certonly \
            --standalone \
            --non-interactive \
            --agree-tos \
            --email "$EMAIL" \
            -d "$DOMAIN"

    if [ $? -ne 0 ]; then
        print_error "Certbot failed. Check the output above for details."
        print_info "Common issues:"
        print_info "  - DNS not pointing to this server"
        print_info "  - Port 80 blocked by firewall"
        print_info "  - Rate limit exceeded (5 certs per domain per week)"
        exit 1
    fi

    print_success "Certificates obtained from Let's Encrypt"
}

copy_certificates() {
    print_header "Installing Certificates"

    mkdir -p "$KEYS_DIR"

    # Certbot runs as root inside Docker. The archive/ directory and symlinks in
    # live/ use container-internal absolute paths (/etc/letsencrypt/...) that are
    # broken on the host, and archive/ is created with 0700 root ownership.
    # Solution: run the copy inside a container where the volume is mounted at
    # /etc/letsencrypt so the live/ symlinks resolve correctly.
    print_info "Copying certificates from certbot volume to data/keys/..."

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
        print_error "Failed to copy certificates from certbot volume"
        exit 1
    fi

    print_success "server.crt  ← fullchain.pem (nginx, mosquitto)"
    print_success "server.key  ← privkey.pem   (nginx, mosquitto)"
    print_success "ca.crt      ← chain.pem     (mosquitto)"
    print_success "ca.pem      ← chain.pem     (backend MQTT)"
}

display_cert_info() {
    print_header "Certificate Information"

    echo "Certificate details:"
    openssl x509 -in "$KEYS_DIR/server.crt" -noout -subject -dates -issuer 2>/dev/null | sed 's/^/  /'
    echo ""
    echo "Subject Alternative Names:"
    openssl x509 -in "$KEYS_DIR/server.crt" -noout -text 2>/dev/null | grep -A 2 "Subject Alternative Name" | sed 's/^/  /'
}

display_next_steps() {
    print_header "Next Steps"

    echo "1. Start services:"
    echo "   docker compose up -d"
    echo ""
    echo "2. Access the app:"
    echo "   https://$DOMAIN"
    echo ""
    echo "3. Set up automatic certificate renewal (cron):"
    echo "   crontab -e"
    echo "   0 0,12 * * * $SCRIPT_DIR/renew-certs.sh >> /var/log/trailcurrent-cert-renewal.log 2>&1"
    echo ""

    print_warning "IMPORTANT"
    echo "Let's Encrypt certificates expire after 90 days."
    echo "The renewal cron job handles this automatically."
    echo ""
}

################################################################################
# Main
################################################################################

main() {
    if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
        echo "Usage: $0"
        echo ""
        echo "Obtains Let's Encrypt TLS certificates for production deployment."
        echo "Run this BEFORE docker compose up."
        echo ""
        echo "Requirements:"
        echo "  - .env with TLS_CERT_HOSTNAME and LETSENCRYPT_EMAIL"
        echo "  - Docker installed"
        echo "  - Port 80 available"
        echo "  - DNS pointing to this server"
        exit 0
    fi

    print_header "TrailCurrent Let's Encrypt Setup"

    check_requirements
    load_config
    check_port_80
    backup_existing
    obtain_certificates
    copy_certificates
    display_cert_info
    display_next_steps
}

main "$@"
