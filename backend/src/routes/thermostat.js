const express = require('express');
const router = express.Router();
const mqttService = require('../mqtt');

module.exports = (db) => {
    const thermostat = db.collection('thermostat');

    // GET /api/thermostat
    router.get('/', async (req, res) => {
        try {
            const data = await thermostat.findOne({ _id: 'main' });
            res.json(data);
        } catch (error) {
            console.error('Error fetching thermostat:', error);
            res.status(500).json({ error: 'Failed to fetch thermostat data' });
        }
    });

    // PUT /api/thermostat - Publish command to MQTT
    router.put('/', async (req, res) => {
        try {
            const { target_temp, mode } = req.body;

            if (target_temp !== undefined) {
                if (target_temp < 50 || target_temp > 90) {
                    return res.status(400).json({ error: 'Temperature must be between 50 and 90°F' });
                }
            }

            if (mode !== undefined) {
                if (!['heat', 'cool', 'auto', 'off'].includes(mode)) {
                    return res.status(400).json({ error: 'Invalid mode' });
                }
            }

            if (target_temp === undefined && mode === undefined) {
                return res.status(400).json({ error: 'No valid fields to update' });
            }

            // Publish command to MQTT - status update comes back via MQTT
            mqttService.publishThermostatCommand(target_temp, mode);

            // Return acknowledgment (actual state will be updated via WebSocket when MQTT status arrives)
            res.json({ success: true, target_temp, mode });
        } catch (error) {
            console.error('Error sending thermostat command:', error);
            res.status(500).json({ error: 'Failed to send thermostat command' });
        }
    });

    return router;
};
