'use strict';

const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const proximityEngine = require('../services/proximity-engine');

// Per-device rate limiting for location reports (1 per second)
const locationLastSent = new Map();

module.exports = (db) => {
    const devices = db.collection('proximity_devices');
    const config = db.collection('proximity_config');

    // ── Device Registration ────────────────────────────────────────────

    // GET /api/proximity/devices — list registered devices
    router.get('/devices', async (req, res) => {
        try {
            const list = await devices.find().sort({ created_at: 1 }).toArray();
            res.json(list);
        } catch (error) {
            console.error('Error fetching proximity devices:', error);
            res.status(500).json({ error: 'Failed to fetch devices' });
        }
    });

    // POST /api/proximity/devices — register a new device
    router.post('/devices', async (req, res) => {
        try {
            const { device_uuid, name } = req.body;

            if (!device_uuid || !name) {
                return res.status(400).json({ error: 'device_uuid and name are required' });
            }

            // Check for duplicate UUID
            const existing = await devices.findOne({ device_uuid });
            if (existing) {
                return res.status(409).json({ error: 'Device already registered' });
            }

            const doc = {
                device_uuid,
                name: name.trim(),
                enabled: true,
                user_id: req.user?.username || 'unknown',
                created_at: new Date(),
                last_seen_at: null,
                last_location: null
            };

            const result = await devices.insertOne(doc);
            doc._id = result.insertedId;
            res.status(201).json(doc);
        } catch (error) {
            console.error('Error registering proximity device:', error);
            res.status(500).json({ error: 'Failed to register device' });
        }
    });

    // DELETE /api/proximity/devices/:id — remove a registered device
    router.delete('/devices/:id', async (req, res) => {
        try {
            const result = await devices.deleteOne({ _id: new ObjectId(req.params.id) });
            if (result.deletedCount === 0) {
                return res.status(404).json({ error: 'Device not found' });
            }
            res.json({ success: true });
        } catch (error) {
            console.error('Error deleting proximity device:', error);
            res.status(500).json({ error: 'Failed to delete device' });
        }
    });

    // ── Location Reporting ─────────────────────────────────────────────

    // POST /api/proximity/location — phone reports its GPS position
    router.post('/location', async (req, res) => {
        try {
            const { device_uuid, latitude, longitude, accuracy } = req.body;

            if (!device_uuid || latitude == null || longitude == null) {
                return res.status(400).json({ error: 'device_uuid, latitude, and longitude are required' });
            }

            // Rate limit: 1 report per second per device
            const now = Date.now();
            const lastSent = locationLastSent.get(device_uuid) || 0;
            if (now - lastSent < 1000) {
                return res.status(429).json({ error: 'Rate limited' });
            }
            locationLastSent.set(device_uuid, now);

            // Verify device is registered and enabled
            const device = await devices.findOne({ device_uuid, enabled: true });
            if (!device) {
                return res.status(403).json({ error: 'Device not registered or disabled' });
            }

            // Update last seen and location
            await devices.updateOne(
                { device_uuid },
                { $set: {
                    last_seen_at: new Date(),
                    last_location: {
                        latitude,
                        longitude,
                        accuracy: accuracy || null,
                        timestamp: new Date()
                    }
                }}
            );

            // Feed into proximity engine
            await proximityEngine.processLocation(device_uuid, latitude, longitude, accuracy || 0);

            res.json({ success: true });
        } catch (error) {
            console.error('Error processing proximity location:', error);
            res.status(500).json({ error: 'Failed to process location' });
        }
    });

    // ── Zone Configuration ─────────────────────────────────────────────

    // GET /api/proximity/config — get zone configuration
    router.get('/config', async (req, res) => {
        try {
            const data = await config.findOne({ _id: 'main' });
            res.json(data);
        } catch (error) {
            console.error('Error fetching proximity config:', error);
            res.status(500).json({ error: 'Failed to fetch config' });
        }
    });

    // PUT /api/proximity/config — update zone configuration
    router.put('/config', async (req, res) => {
        try {
            const { enabled, zones, hysteresis_m, debounce_ms } = req.body;
            const updates = {};

            if (enabled !== undefined) updates.enabled = !!enabled;
            if (zones) {
                if (zones.approaching_radius_m !== undefined) {
                    updates['zones.approaching_radius_m'] = Math.max(50, Math.min(5000, Number(zones.approaching_radius_m)));
                }
                if (zones.arrived_radius_m !== undefined) {
                    updates['zones.arrived_radius_m'] = Math.max(10, Math.min(500, Number(zones.arrived_radius_m)));
                }
            }
            if (hysteresis_m !== undefined) {
                updates.hysteresis_m = Math.max(5, Math.min(100, Number(hysteresis_m)));
            }
            if (debounce_ms !== undefined) {
                updates.debounce_ms = Math.max(1000, Math.min(30000, Number(debounce_ms)));
            }

            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ error: 'No valid fields to update' });
            }

            updates.updated_at = new Date();

            await config.updateOne(
                { _id: 'main' },
                { $set: updates }
            );

            // Reload config in proximity engine
            await proximityEngine.reloadConfig();

            const data = await config.findOne({ _id: 'main' });
            res.json(data);
        } catch (error) {
            console.error('Error updating proximity config:', error);
            res.status(500).json({ error: 'Failed to update config' });
        }
    });

    // ── Status ─────────────────────────────────────────────────────────

    // GET /api/proximity/status — current proximity state for all devices
    router.get('/status', (req, res) => {
        res.json(proximityEngine.getStatus());
    });

    // ── Automation Rules ───────────────────────────────────────────────

    const rules = db.collection('proximity_rules');

    // GET /api/proximity/rules — list all automation rules
    router.get('/rules', async (req, res) => {
        try {
            const list = await rules.find().sort({ created_at: 1 }).toArray();
            res.json(list);
        } catch (error) {
            console.error('Error fetching proximity rules:', error);
            res.status(500).json({ error: 'Failed to fetch rules' });
        }
    });

    // POST /api/proximity/rules — create a new automation rule
    router.post('/rules', async (req, res) => {
        try {
            const { name, trigger, actions } = req.body;

            if (!name || !trigger || !actions || !Array.isArray(actions) || actions.length === 0) {
                return res.status(400).json({ error: 'name, trigger, and actions[] are required' });
            }

            const validTriggers = ['approaching', 'arrived', 'departed', 'away'];
            if (!validTriggers.includes(trigger)) {
                return res.status(400).json({ error: `trigger must be one of: ${validTriggers.join(', ')}` });
            }

            // Validate actions
            for (const action of actions) {
                if (!action.type || !['light', 'relay'].includes(action.type)) {
                    return res.status(400).json({ error: 'Each action must have type "light" or "relay"' });
                }
                if (!action.target_id || typeof action.target_id !== 'number') {
                    return res.status(400).json({ error: 'Each action must have a numeric target_id' });
                }
                if (action.state === undefined) {
                    return res.status(400).json({ error: 'Each action must have a state (0 or 1)' });
                }
            }

            const doc = {
                name: name.trim(),
                enabled: true,
                trigger,
                actions,
                created_at: new Date(),
                updated_at: new Date()
            };

            const result = await rules.insertOne(doc);
            doc._id = result.insertedId;
            res.status(201).json(doc);
        } catch (error) {
            console.error('Error creating proximity rule:', error);
            res.status(500).json({ error: 'Failed to create rule' });
        }
    });

    // PUT /api/proximity/rules/:id — update an automation rule
    router.put('/rules/:id', async (req, res) => {
        try {
            const { name, enabled, trigger, actions } = req.body;
            const updates = {};

            if (name !== undefined) updates.name = name.trim();
            if (enabled !== undefined) updates.enabled = !!enabled;
            if (trigger !== undefined) {
                const validTriggers = ['approaching', 'arrived', 'departed', 'away'];
                if (!validTriggers.includes(trigger)) {
                    return res.status(400).json({ error: `trigger must be one of: ${validTriggers.join(', ')}` });
                }
                updates.trigger = trigger;
            }
            if (actions !== undefined) updates.actions = actions;

            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ error: 'No valid fields to update' });
            }

            updates.updated_at = new Date();

            const result = await rules.updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: updates }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({ error: 'Rule not found' });
            }

            const updated = await rules.findOne({ _id: new ObjectId(req.params.id) });
            res.json(updated);
        } catch (error) {
            console.error('Error updating proximity rule:', error);
            res.status(500).json({ error: 'Failed to update rule' });
        }
    });

    // DELETE /api/proximity/rules/:id — delete an automation rule
    router.delete('/rules/:id', async (req, res) => {
        try {
            const result = await rules.deleteOne({ _id: new ObjectId(req.params.id) });
            if (result.deletedCount === 0) {
                return res.status(404).json({ error: 'Rule not found' });
            }
            res.json({ success: true });
        } catch (error) {
            console.error('Error deleting proximity rule:', error);
            res.status(500).json({ error: 'Failed to delete rule' });
        }
    });

    return router;
};
