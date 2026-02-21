#!/bin/sh
set -e

if [ -z "$MQTT_USERNAME" ] || [ -z "$MQTT_PASSWORD" ]; then
    echo "Error: MQTT_USERNAME and MQTT_PASSWORD must be set"
    exit 1
fi

# Generate password file from environment variables
rm -f /mosquitto/config/passwd
mosquitto_passwd -b -c /mosquitto/config/passwd "$MQTT_USERNAME" "$MQTT_PASSWORD"
chown mosquitto:mosquitto /mosquitto/config/passwd

# Copy TLS certs from read-only host mount and fix ownership so the
# mosquitto user can read them (host files may be owned by root/other UIDs)
mkdir -p /mosquitto/certs
cp /mosquitto/host-certs/server.crt /mosquitto/certs/server.crt
cp /mosquitto/host-certs/server.key /mosquitto/certs/server.key
cp /mosquitto/host-certs/ca.crt     /mosquitto/certs/ca.crt
chown mosquitto:mosquitto /mosquitto/certs/*
chmod 600 /mosquitto/certs/server.key

exec mosquitto "$@"
