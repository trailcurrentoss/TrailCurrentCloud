// Location sharing service — uses browser Geolocation API to report
// the phone's position to the Farwatch backend for proximity calculations.
// Foreground only: location updates stop when the PWA tab is backgrounded.

import { API } from '../api.js';

const DEVICE_UUID_KEY = 'rv_proximity_device_uuid';
const LOCATION_ENABLED_KEY = 'rv_proximity_location_enabled';

class LocationService {
    constructor() {
        this.watchId = null;
        this.sendInterval = null;
        this.lastPosition = null;
        this.running = false;
    }

    get deviceUuid() {
        return localStorage.getItem(DEVICE_UUID_KEY);
    }

    get enabled() {
        return localStorage.getItem(LOCATION_ENABLED_KEY) === 'true';
    }

    set enabled(val) {
        localStorage.setItem(LOCATION_ENABLED_KEY, val ? 'true' : 'false');
    }

    // Generate and store a new device UUID
    static generateDeviceUuid() {
        const uuid = crypto.randomUUID();
        localStorage.setItem(DEVICE_UUID_KEY, uuid);
        return uuid;
    }

    static getDeviceUuid() {
        return localStorage.getItem(DEVICE_UUID_KEY);
    }

    static clearDeviceUuid() {
        localStorage.removeItem(DEVICE_UUID_KEY);
        localStorage.removeItem(LOCATION_ENABLED_KEY);
    }

    start() {
        if (this.running) return;
        if (!this.deviceUuid || !this.enabled) return;
        if (!navigator.geolocation) {
            console.warn('[LocationService] Geolocation API not available');
            return;
        }

        this.running = true;

        try {
            this.watchId = navigator.geolocation.watchPosition(
                (pos) => { this.lastPosition = pos; },
                (err) => {
                    // PERMISSION_DENIED (1) — user revoked location access, stop gracefully
                    if (err.code === 1) {
                        console.warn('[LocationService] Location permission denied, stopping');
                        this.stop();
                        return;
                    }
                    // POSITION_UNAVAILABLE (2) or TIMEOUT (3) — transient, keep trying
                    console.warn('[LocationService] Geolocation error:', err.message);
                },
                { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
            );
        } catch (err) {
            console.warn('[LocationService] Failed to start geolocation watch:', err.message);
            this.running = false;
            return;
        }

        // Send location every 15 seconds
        this.sendInterval = setInterval(() => this.sendLocation(), 15000);

        // Send immediately if we already have a position
        if (this.lastPosition) this.sendLocation();

        console.log('[LocationService] Started');
    }

    stop() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        if (this.sendInterval) {
            clearInterval(this.sendInterval);
            this.sendInterval = null;
        }
        this.lastPosition = null;
        this.running = false;
        console.log('[LocationService] Stopped');
    }

    async sendLocation() {
        if (!this.lastPosition || !this.deviceUuid) return;

        try {
            await API.sendProximityLocation({
                device_uuid: this.deviceUuid,
                latitude: this.lastPosition.coords.latitude,
                longitude: this.lastPosition.coords.longitude,
                accuracy: this.lastPosition.coords.accuracy
            });
        } catch (err) {
            // 429 (rate limited) is expected, don't log it
            if (!err.message?.includes('Rate limited')) {
                console.warn('[LocationService] Failed to send location:', err.message);
            }
        }
    }
}

// Singleton
export const locationService = new LocationService();
export { LocationService, DEVICE_UUID_KEY, LOCATION_ENABLED_KEY };
