'use strict';

// Proximity Engine — calculates distance between registered phones and the vehicle,
// manages per-device zone state machines, and publishes transition events via MQTT.

const EARTH_RADIUS_M = 6371000;

// Haversine distance between two lat/lon points in meters
function haversineDistance(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Zone state machine: away → approaching → arrived → departed → away
const ZONES = { AWAY: 'away', APPROACHING: 'approaching', ARRIVED: 'arrived', DEPARTED: 'departed' };

class ProximityEngine {
    constructor() {
        this.db = null;
        this.mqttService = null;
        this.broadcast = null;
        this.deviceStates = new Map();    // deviceUuid → { zone, enteredAt, debounceTimer }
        this.config = null;
        this.statusInterval = null;
    }

    async init(db, mqttService, broadcast) {
        this.db = db;
        this.mqttService = mqttService;
        this.broadcast = broadcast;

        // Load config from DB
        await this.reloadConfig();

        // Broadcast proximity status periodically (every 10s) for active devices
        this.statusInterval = setInterval(() => this.broadcastStatus(), 10000);
    }

    async reloadConfig() {
        try {
            const doc = await this.db.collection('proximity_config').findOne({ _id: 'main' });
            this.config = doc || {
                enabled: false,
                zones: { approaching_radius_m: 500, arrived_radius_m: 50 },
                hysteresis_m: 20,
                debounce_ms: 5000
            };
        } catch (err) {
            console.error('[Proximity] Failed to load config, using defaults:', err.message);
            if (!this.config) {
                this.config = {
                    enabled: false,
                    zones: { approaching_radius_m: 500, arrived_radius_m: 50 },
                    hysteresis_m: 20,
                    debounce_ms: 5000
                };
            }
        }
    }

    // Called when a phone reports its location
    async processLocation(deviceUuid, latitude, longitude, accuracy) {
        try {
            if (!this.config || !this.config.enabled) return;

            // Validate phone coordinates are real numbers
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

            const vehiclePos = this.mqttService?.vehiclePosition;
            if (!vehiclePos) return;

            // Validate vehicle coordinates are real numbers
            if (!Number.isFinite(vehiclePos.latitude) || !Number.isFinite(vehiclePos.longitude)) return;

            // Reject stale vehicle GPS (>60s old)
            if (Date.now() - vehiclePos.timestamp > 60000) return;

            const distance = haversineDistance(
                latitude, longitude,
                vehiclePos.latitude, vehiclePos.longitude
            );

            // Guard against NaN from haversine (shouldn't happen with validated inputs, but be safe)
            if (!Number.isFinite(distance)) return;

            // Skip if phone accuracy is worse than the arrived radius
            const arrivedRadius = this.config.zones.arrived_radius_m;
            if (accuracy > arrivedRadius) {
                // Still update distance for status display, but don't transition to arrived
                this.updateDeviceDistance(deviceUuid, distance);
                return;
            }

            const prevZone = this.getDeviceZone(deviceUuid);
            const newZone = this.computeZone(prevZone, distance);

            // Update stored distance
            this.updateDeviceDistance(deviceUuid, distance);

            if (newZone !== prevZone) {
                this.scheduleTransition(deviceUuid, prevZone, newZone, distance);
            }
        } catch (err) {
            console.error('[Proximity] Error processing location:', err.message);
        }
    }

    getDeviceZone(deviceUuid) {
        const state = this.deviceStates.get(deviceUuid);
        return state ? state.zone : ZONES.AWAY;
    }

    updateDeviceDistance(deviceUuid, distance) {
        const state = this.deviceStates.get(deviceUuid) || { zone: ZONES.AWAY, distance: null, debounceTimer: null };
        state.distance = distance;
        state.lastUpdate = Date.now();
        this.deviceStates.set(deviceUuid, state);
    }

    computeZone(currentZone, distance) {
        const { approaching_radius_m, arrived_radius_m } = this.config.zones;
        const hyst = this.config.hysteresis_m;

        switch (currentZone) {
            case ZONES.AWAY:
                if (distance < approaching_radius_m) return ZONES.APPROACHING;
                return ZONES.AWAY;

            case ZONES.APPROACHING:
                if (distance < arrived_radius_m) return ZONES.ARRIVED;
                if (distance > approaching_radius_m + hyst) return ZONES.AWAY;
                return ZONES.APPROACHING;

            case ZONES.ARRIVED:
                if (distance > arrived_radius_m + hyst) return ZONES.DEPARTED;
                return ZONES.ARRIVED;

            case ZONES.DEPARTED:
                if (distance < arrived_radius_m) return ZONES.ARRIVED;
                if (distance > approaching_radius_m + hyst) return ZONES.AWAY;
                return ZONES.DEPARTED;

            default:
                return ZONES.AWAY;
        }
    }

    scheduleTransition(deviceUuid, prevZone, newZone, distance) {
        const state = this.deviceStates.get(deviceUuid);
        if (!state) return;

        // Clear any existing debounce timer
        if (state.debounceTimer) {
            clearTimeout(state.debounceTimer);
            state.debounceTimer = null;
        }

        const debounceMs = this.config.debounce_ms || 5000;

        state.debounceTimer = setTimeout(async () => {
            // Re-check: the device might have moved back before debounce expired
            const currentState = this.deviceStates.get(deviceUuid);
            if (!currentState) return;

            const recheck = this.computeZone(prevZone, currentState.distance);
            if (recheck !== newZone) return; // Device moved back, cancel transition

            currentState.zone = newZone;
            currentState.debounceTimer = null;
            this.deviceStates.set(deviceUuid, currentState);

            await this.fireTransition(deviceUuid, prevZone, newZone, currentState.distance);
        }, debounceMs);
    }

    async fireTransition(deviceUuid, prevZone, newZone, distance) {
        // Look up device name (non-critical — fall back to UUID prefix)
        let deviceName = deviceUuid.substring(0, 8);
        try {
            const device = await this.db.collection('proximity_devices').findOne({ device_uuid: deviceUuid });
            if (device) deviceName = device.name;
        } catch (err) {
            console.error('[Proximity] Error looking up device name:', err.message);
        }

        const event = {
            device_uuid: deviceUuid,
            device_name: deviceName,
            zone: newZone,
            prev_zone: prevZone,
            distance_m: Math.round(distance * 10) / 10,
            timestamp: new Date().toISOString()
        };

        console.log(`[Proximity] ${deviceName}: ${prevZone} → ${newZone} (${event.distance_m}m)`);

        // Publish event via MQTT to vehicle (non-critical — don't block rule execution)
        try {
            this.mqttService.publishProximityEvent(event);
        } catch (err) {
            console.error('[Proximity] Failed to publish MQTT event:', err.message);
        }

        // Broadcast to connected Farwatch WebSocket clients
        try {
            if (this.broadcast) {
                this.broadcast('proximity_event', event);
            }
        } catch (err) {
            console.error('[Proximity] Failed to broadcast WebSocket event:', err.message);
        }

        // Execute matching automation rules
        await this.executeRules(newZone, event);
    }

    async executeRules(zone, event) {
        try {
            const rules = await this.db.collection('proximity_rules')
                .find({ trigger: zone, enabled: true }).toArray();

            for (const rule of rules) {
                console.log(`[Proximity] Executing rule "${rule.name}"`);
                for (const action of rule.actions) {
                    if (action.type === 'light') {
                        this.mqttService.publishLightCommand(
                            action.target_id,
                            action.state,
                            action.brightness !== undefined ? action.brightness : null
                        );
                    } else if (action.type === 'relay') {
                        // Relay toggle uses 0-indexed channel internally
                        this.mqttService.publishRelayToggle(action.target_id - 1);
                    }
                }
            }
        } catch (err) {
            console.error('[Proximity] Error executing rules:', err);
        }
    }

    broadcastStatus() {
        try {
            if (this.deviceStates.size === 0) return;

            const devices = [];
            for (const [uuid, state] of this.deviceStates) {
                // Skip devices that haven't reported in 5 minutes
                if (state.lastUpdate && Date.now() - state.lastUpdate > 300000) continue;
                devices.push({
                    device_uuid: uuid,
                    zone: state.zone,
                    distance_m: state.distance !== null ? Math.round(state.distance * 10) / 10 : null
                });
            }

            if (devices.length === 0) return;

            const status = { devices, timestamp: new Date().toISOString() };

            // Publish to vehicle via MQTT (non-critical)
            try {
                this.mqttService.publishProximityStatus(status);
            } catch (err) {
                // MQTT disconnected — skip silently
            }

            // Broadcast to Farwatch WebSocket clients
            if (this.broadcast) {
                this.broadcast('proximity_status', status);
            }
        } catch (err) {
            console.error('[Proximity] Error broadcasting status:', err.message);
        }
    }

    // Get current state for API response
    getStatus() {
        const devices = [];
        for (const [uuid, state] of this.deviceStates) {
            devices.push({
                device_uuid: uuid,
                zone: state.zone,
                distance_m: state.distance !== null ? Math.round(state.distance * 10) / 10 : null,
                last_update: state.lastUpdate ? new Date(state.lastUpdate).toISOString() : null
            });
        }
        return { devices };
    }

    shutdown() {
        if (this.statusInterval) {
            clearInterval(this.statusInterval);
        }
        for (const state of this.deviceStates.values()) {
            if (state.debounceTimer) clearTimeout(state.debounceTimer);
        }
        this.deviceStates.clear();
    }
}

// Singleton
const proximityEngine = new ProximityEngine();

module.exports = proximityEngine;
