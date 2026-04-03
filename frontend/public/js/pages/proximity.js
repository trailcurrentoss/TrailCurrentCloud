// Proximity page — device registration, location sharing, zone config, automation rules
import { API, wsClient } from '../api.js';
import { locationService, LocationService, DEVICE_UUID_KEY } from '../services/location-service.js';

let proximityConfig = null;

export const proximityPage = {
    render() {
        return `
            <section class="page-proximity">
                <h1 class="section-title">Proximity</h1>
                <div class="settings-container" id="proximity-container">
                    <!-- Content rendered after data loads -->
                </div>
            </section>
        `;
    },

    async init() {
        try {
            const [config, devices, rules] = await Promise.all([
                API.getProximityConfig(),
                API.getProximityDevices(),
                API.getProximityRules()
            ]);
            proximityConfig = config;

            document.getElementById('proximity-container').innerHTML = this.renderContent(config, devices, rules);
            this.setupListeners(devices, rules);
            this.setupWebSocket();
        } catch (error) {
            console.error('Failed to load proximity data:', error);
            document.getElementById('proximity-container').innerHTML =
                '<p style="color: var(--danger);">Failed to load proximity settings</p>';
        }
    },

    renderContent(config, devices, rules) {
        const thisDeviceUuid = LocationService.getDeviceUuid();
        const isRegistered = thisDeviceUuid && devices.some(d => d.device_uuid === thisDeviceUuid);
        const isSharing = locationService.enabled && isRegistered;
        const hasGeolocation = 'geolocation' in navigator;

        return `
            <!-- Enable/Disable Proximity -->
            <div class="card settings-item">
                <div>
                    <span class="settings-label">Proximity Detection</span>
                    <p class="settings-description">Enable distance-based automations between your phone and vehicle</p>
                </div>
                <button class="toggle-switch ${config.enabled ? 'active' : ''}"
                        id="proximity-enabled-toggle"
                        aria-pressed="${config.enabled}">
                </button>
            </div>

            <!-- This Device -->
            <div class="card settings-item-vertical">
                <div class="settings-item-header">
                    <span class="settings-label">This Device</span>
                    <p class="settings-description">
                        ${!hasGeolocation
                            ? 'Geolocation is not available in this browser'
                            : isRegistered
                                ? 'Registered and ready for proximity detection'
                                : 'Register this device to enable proximity detection'}
                    </p>
                </div>
                ${!isRegistered ? `
                    <div class="api-keys-actions">
                        <input type="text" id="device-name-input" class="api-key-input"
                               placeholder="Device name (e.g., Dave's iPhone)" maxlength="50">
                        <button class="api-key-btn" id="register-device-btn" ${!hasGeolocation ? 'disabled' : ''}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                <path d="M12 5v14M5 12h14"></path>
                            </svg>
                            Register Device
                        </button>
                    </div>
                ` : `
                    <div class="settings-item" style="padding: 0;">
                        <div>
                            <span class="settings-label" style="font-size: 0.85rem;">Share Location</span>
                            <p class="settings-description">Send GPS to Farwatch while this tab is open</p>
                        </div>
                        <button class="toggle-switch ${isSharing ? 'active' : ''}"
                                id="location-sharing-toggle"
                                aria-pressed="${isSharing}">
                        </button>
                    </div>
                `}
                <div id="device-message" class="api-key-message hidden"></div>
            </div>

            <!-- Registered Devices -->
            <div class="card settings-item-vertical">
                <div class="settings-item-header">
                    <span class="settings-label">Registered Devices</span>
                    <p class="settings-description">${devices.length} device${devices.length !== 1 ? 's' : ''} registered</p>
                </div>
                <div id="devices-list" class="api-keys-list">
                    ${this.renderDevicesList(devices)}
                </div>
            </div>

            <!-- Live Status -->
            <div class="card settings-item-vertical">
                <div class="settings-item-header">
                    <span class="settings-label">Live Status</span>
                    <p class="settings-description">Current proximity state for active devices</p>
                </div>
                <div id="proximity-status" class="system-stats-grid">
                    <p class="settings-description">Waiting for location data...</p>
                </div>
            </div>

            <!-- Zone Configuration -->
            <div class="card settings-item-vertical">
                <div class="settings-item-header">
                    <span class="settings-label">Zone Radii</span>
                    <p class="settings-description">Distance thresholds for proximity zones</p>
                </div>
                <div class="password-form">
                    <div class="password-form-group">
                        <label class="password-label">
                            Approaching radius: <span id="approaching-value">${config.zones.approaching_radius_m}</span>m
                        </label>
                        <input type="range" id="approaching-radius" class="range-input"
                               min="50" max="5000" step="50" value="${config.zones.approaching_radius_m}">
                    </div>
                    <div class="password-form-group">
                        <label class="password-label">
                            Arrived radius: <span id="arrived-value">${config.zones.arrived_radius_m}</span>m
                        </label>
                        <input type="range" id="arrived-radius" class="range-input"
                               min="10" max="500" step="10" value="${config.zones.arrived_radius_m}">
                    </div>
                    <button class="password-submit-btn" id="save-zones-btn">Save Zones</button>
                </div>
            </div>

            <!-- Automation Rules -->
            <div class="card settings-item-vertical">
                <div class="settings-item-header">
                    <span class="settings-label">Automation Rules</span>
                    <p class="settings-description">Actions triggered by proximity zone transitions</p>
                </div>
                <div id="rules-list">
                    ${this.renderRulesList(rules)}
                </div>
                <div id="add-rule-form" class="password-form" style="margin-top: 12px; border-top: 1px solid var(--border); padding-top: 12px;">
                    <div class="password-form-group">
                        <label class="password-label">Rule Name</label>
                        <input type="text" id="rule-name" class="password-input" placeholder="e.g., Porch light on arrival" maxlength="100">
                    </div>
                    <div class="password-form-group">
                        <label class="password-label">When zone becomes</label>
                        <select id="rule-trigger" class="password-input">
                            <option value="approaching">Approaching</option>
                            <option value="arrived" selected>Arrived</option>
                            <option value="departed">Departed</option>
                            <option value="away">Away</option>
                        </select>
                    </div>
                    <div class="password-form-group">
                        <label class="password-label">Action</label>
                        <select id="rule-action-type" class="password-input">
                            <option value="light">Light</option>
                            <option value="relay">Relay</option>
                        </select>
                    </div>
                    <div class="password-form-group">
                        <label class="password-label">Target (channel ID)</label>
                        <input type="number" id="rule-target-id" class="password-input" placeholder="e.g., 7" min="1" max="200">
                    </div>
                    <div class="password-form-group">
                        <label class="password-label">State</label>
                        <select id="rule-state" class="password-input">
                            <option value="1">On</option>
                            <option value="0">Off</option>
                        </select>
                    </div>
                    <div id="rule-message" class="api-key-message hidden"></div>
                    <button class="password-submit-btn" id="add-rule-btn">Add Rule</button>
                </div>
            </div>
        `;
    },

    renderDevicesList(devices) {
        if (!devices || devices.length === 0) {
            return '<div class="api-key-empty"><p>No devices registered yet.</p></div>';
        }

        const thisDeviceUuid = LocationService.getDeviceUuid();

        return devices.map(d => `
            <div class="api-key-item">
                <div class="api-key-info">
                    <div class="api-key-name">${d.name} ${d.device_uuid === thisDeviceUuid ? '(this device)' : ''}</div>
                    <div class="api-key-meta">
                        <span class="api-key-date">${d.enabled ? 'Enabled' : 'Disabled'}</span>
                        <span class="api-key-date">Last seen: ${d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : 'Never'}</span>
                    </div>
                </div>
                <div class="api-key-actions">
                    <button class="api-key-delete-btn" data-device-id="${d._id}" title="Remove device">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                            <path d="M3 6h18"></path>
                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');
    },

    renderRulesList(rules) {
        if (!rules || rules.length === 0) {
            return '<div class="api-key-empty"><p>No automation rules yet.</p></div>';
        }

        return rules.map(r => {
            const actionDesc = r.actions.map(a =>
                `${a.type} ${a.target_id} ${a.state ? 'ON' : 'OFF'}`
            ).join(', ');

            return `
                <div class="api-key-item">
                    <div class="api-key-info">
                        <div class="api-key-name">${r.name}</div>
                        <div class="api-key-meta">
                            <span class="api-key-prefix">When: ${r.trigger}</span>
                            <span class="api-key-date">Action: ${actionDesc}</span>
                        </div>
                    </div>
                    <div class="api-key-actions">
                        <button class="toggle-switch ${r.enabled ? 'active' : ''} rule-toggle-btn"
                                data-rule-id="${r._id}" aria-pressed="${r.enabled}" title="Enable/disable rule">
                        </button>
                        <button class="api-key-delete-btn" data-rule-id="${r._id}" title="Delete rule">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                <path d="M3 6h18"></path>
                                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    setupListeners(devices, rules) {
        // Proximity enabled toggle
        const enabledToggle = document.getElementById('proximity-enabled-toggle');
        if (enabledToggle) {
            enabledToggle.addEventListener('click', async () => {
                const newEnabled = !proximityConfig.enabled;
                try {
                    proximityConfig = await API.setProximityConfig({ enabled: newEnabled });
                    enabledToggle.classList.toggle('active', proximityConfig.enabled);
                    enabledToggle.setAttribute('aria-pressed', proximityConfig.enabled);
                } catch (err) {
                    console.error('Failed to toggle proximity:', err);
                }
            });
        }

        // Register device
        const registerBtn = document.getElementById('register-device-btn');
        if (registerBtn) {
            registerBtn.addEventListener('click', async () => {
                const nameInput = document.getElementById('device-name-input');
                const name = nameInput?.value?.trim();
                if (!name) {
                    this.showMessage('device-message', 'Please enter a device name', 'error');
                    return;
                }
                try {
                    const uuid = LocationService.generateDeviceUuid();
                    await API.registerProximityDevice(uuid, name);
                    this.showMessage('device-message', 'Device registered! Enable location sharing below.', 'success');
                    // Re-render
                    const updatedDevices = await API.getProximityDevices();
                    document.getElementById('proximity-container').innerHTML =
                        this.renderContent(proximityConfig, updatedDevices, rules);
                    this.setupListeners(updatedDevices, rules);
                } catch (err) {
                    LocationService.clearDeviceUuid();
                    this.showMessage('device-message', err.message || 'Failed to register device', 'error');
                }
            });
        }

        // Location sharing toggle
        const sharingToggle = document.getElementById('location-sharing-toggle');
        if (sharingToggle) {
            sharingToggle.addEventListener('click', () => {
                const newVal = !locationService.enabled;
                locationService.enabled = newVal;
                if (newVal) {
                    locationService.start();
                } else {
                    locationService.stop();
                }
                sharingToggle.classList.toggle('active', newVal);
                sharingToggle.setAttribute('aria-pressed', newVal);
            });
        }

        // Delete device buttons
        document.querySelectorAll('.api-key-delete-btn[data-device-id]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const deviceId = btn.dataset.deviceId;
                if (!confirm('Remove this device?')) return;
                try {
                    await API.deleteProximityDevice(deviceId);
                    // If we deleted our own device, clear local UUID
                    const deletedDevice = devices.find(d => d._id === deviceId);
                    if (deletedDevice && deletedDevice.device_uuid === LocationService.getDeviceUuid()) {
                        locationService.stop();
                        LocationService.clearDeviceUuid();
                    }
                    const updatedDevices = await API.getProximityDevices();
                    const updatedRules = await API.getProximityRules();
                    document.getElementById('proximity-container').innerHTML =
                        this.renderContent(proximityConfig, updatedDevices, updatedRules);
                    this.setupListeners(updatedDevices, updatedRules);
                } catch (err) {
                    console.error('Failed to delete device:', err);
                }
            });
        });

        // Zone sliders
        const approachingSlider = document.getElementById('approaching-radius');
        const arrivedSlider = document.getElementById('arrived-radius');
        if (approachingSlider) {
            approachingSlider.addEventListener('input', () => {
                document.getElementById('approaching-value').textContent = approachingSlider.value;
            });
        }
        if (arrivedSlider) {
            arrivedSlider.addEventListener('input', () => {
                document.getElementById('arrived-value').textContent = arrivedSlider.value;
            });
        }

        // Save zones
        const saveZonesBtn = document.getElementById('save-zones-btn');
        if (saveZonesBtn) {
            saveZonesBtn.addEventListener('click', async () => {
                try {
                    proximityConfig = await API.setProximityConfig({
                        zones: {
                            approaching_radius_m: parseInt(approachingSlider.value),
                            arrived_radius_m: parseInt(arrivedSlider.value)
                        }
                    });
                    saveZonesBtn.textContent = 'Saved!';
                    setTimeout(() => { saveZonesBtn.textContent = 'Save Zones'; }, 2000);
                } catch (err) {
                    console.error('Failed to save zones:', err);
                }
            });
        }

        // Add rule
        const addRuleBtn = document.getElementById('add-rule-btn');
        if (addRuleBtn) {
            addRuleBtn.addEventListener('click', async () => {
                const name = document.getElementById('rule-name')?.value?.trim();
                const trigger = document.getElementById('rule-trigger')?.value;
                const actionType = document.getElementById('rule-action-type')?.value;
                const targetId = parseInt(document.getElementById('rule-target-id')?.value);
                const state = parseInt(document.getElementById('rule-state')?.value);

                if (!name) {
                    this.showMessage('rule-message', 'Please enter a rule name', 'error');
                    return;
                }
                if (!targetId || isNaN(targetId)) {
                    this.showMessage('rule-message', 'Please enter a valid target channel ID', 'error');
                    return;
                }

                try {
                    await API.createProximityRule({
                        name,
                        trigger,
                        actions: [{ type: actionType, target_id: targetId, state }]
                    });
                    const updatedRules = await API.getProximityRules();
                    const updatedDevices = await API.getProximityDevices();
                    document.getElementById('proximity-container').innerHTML =
                        this.renderContent(proximityConfig, updatedDevices, updatedRules);
                    this.setupListeners(updatedDevices, updatedRules);
                } catch (err) {
                    this.showMessage('rule-message', err.message || 'Failed to add rule', 'error');
                }
            });
        }

        // Rule toggle and delete buttons
        document.querySelectorAll('.rule-toggle-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const ruleId = btn.dataset.ruleId;
                const currentlyEnabled = btn.getAttribute('aria-pressed') === 'true';
                try {
                    await API.updateProximityRule(ruleId, { enabled: !currentlyEnabled });
                    btn.classList.toggle('active', !currentlyEnabled);
                    btn.setAttribute('aria-pressed', !currentlyEnabled);
                } catch (err) {
                    console.error('Failed to toggle rule:', err);
                }
            });
        });

        document.querySelectorAll('.api-key-delete-btn[data-rule-id]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const ruleId = btn.dataset.ruleId;
                if (!confirm('Delete this rule?')) return;
                try {
                    await API.deleteProximityRule(ruleId);
                    const updatedRules = await API.getProximityRules();
                    const updatedDevices = await API.getProximityDevices();
                    document.getElementById('proximity-container').innerHTML =
                        this.renderContent(proximityConfig, updatedDevices, updatedRules);
                    this.setupListeners(updatedDevices, updatedRules);
                } catch (err) {
                    console.error('Failed to delete rule:', err);
                }
            });
        });
    },

    setupWebSocket() {
        this._proximityStatusHandler = (data) => {
            const el = document.getElementById('proximity-status');
            if (!el || !data.devices || data.devices.length === 0) return;

            el.innerHTML = data.devices.map(d => `
                <div class="system-stat">
                    <span class="system-stat-label">${d.device_uuid.substring(0, 8)}...</span>
                    <span class="system-stat-value">${d.zone} (${d.distance_m !== null ? d.distance_m + 'm' : '?'})</span>
                </div>
            `).join('');
        };
        wsClient.on('proximity_status', this._proximityStatusHandler);

        this._proximityEventHandler = (data) => {
            const el = document.getElementById('proximity-status');
            if (!el) return;
            // Flash a transition notification
            const note = document.createElement('div');
            note.className = 'settings-description';
            note.style.color = 'var(--primary)';
            note.textContent = `${data.device_name}: ${data.prev_zone} \u2192 ${data.zone} (${data.distance_m}m)`;
            el.prepend(note);
        };
        wsClient.on('proximity_event', this._proximityEventHandler);
    },

    showMessage(elementId, message, type) {
        const el = document.getElementById(elementId);
        if (el) {
            el.textContent = message;
            el.classList.remove('hidden', 'success', 'error');
            el.classList.add(type);
        }
    },

    cleanup() {
        proximityConfig = null;
        if (this._proximityStatusHandler) {
            wsClient.off('proximity_status', this._proximityStatusHandler);
            this._proximityStatusHandler = null;
        }
        if (this._proximityEventHandler) {
            wsClient.off('proximity_event', this._proximityEventHandler);
            this._proximityEventHandler = null;
        }
    }
};
