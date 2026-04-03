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
        const doc = await this.db.collection('proximity_config').findOne({ _id: 'main' });
        this.config = doc || {
            enabled: false,
            zones: { approaching_radius_m: 500, arrived_radius_m: 50 },
            hysteresis_m: 20,
            debounce_ms: 5000
        };
    }

    // Called when a phone reports its location
    async processLocation(deviceUuid, latitude, longitude, accuracy) {
        if (!this.config || !this.config.enabled) return;

        const vehiclePos = this.mqttService.vehiclePosition;
        if (!vehiclePos) return;

        // Reject stale vehicle GPS (>60s old)
        if (Date.now() - vehiclePos.timestamp > 60000) return;

        const distance = haversineDistance(
            latitude, longitude,
            vehiclePos.latitude, vehiclePos.longitude
        );

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
        // Look up device name
        let deviceName = deviceUuid;
        try {
            const device = await this.db.collection('proximity_devices').findOne({ device_uuid: deviceUuid });
            if (device) deviceName = device.name;
        } catch (err) {
            console.error('[Proximity] Error looking up device name:', err);
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

        // Publish event via MQTT to vehicle (for logging/display on Overlook)
        this.mqttService.publishProximityEvent(event);

        // Broadcast to connected Farwatch WebSocket clients
        if (this.broadcast) {
            this.broadcast('proximity_event', event);
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

        // Publish to vehicle via MQTT
        this.mqttService.publishProximityStatus(status);

        // Broadcast to Farwatch WebSocket clients
        if (this.broadcast) {
            this.broadcast('proximity_status', status);
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
