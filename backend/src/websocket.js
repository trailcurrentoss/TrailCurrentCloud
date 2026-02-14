const WebSocket = require('ws');

function setupWebSocket(server, db) {
    const wss = new WebSocket.Server({ server, path: '/ws' });

    const clients = new Set();

    wss.on('connection', (ws) => {
        console.log('WebSocket client connected');
        clients.add(ws);

        ws.on('close', () => {
            console.log('WebSocket client disconnected');
            clients.delete(ws);
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
            clients.delete(ws);
        });
    });

    // Broadcast function
    function broadcast(type, data) {
        const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
        clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    // Note: thermostat, energy, and airquality data now come from MQTT
    // No simulation needed - data flows via MQTT handlers in mqtt.js

    // Simulate trailer level slight movements (no MQTT source)
    setInterval(async () => {
        if (clients.size === 0) return;

        try {
            const trailerLevelCollection = db.collection('trailer_level');
            const level = await trailerLevelCollection.findOne({ _id: 'main' });
            if (!level) return;

            // Small random movements to simulate wind/settling
            const frontBackChange = (Math.random() - 0.5) * 0.2;
            const sideChange = (Math.random() - 0.5) * 0.2;

            let newFrontBack = Math.max(-15, Math.min(15, level.front_back + frontBackChange));
            let newSideToSide = Math.max(-15, Math.min(15, level.side_to_side + sideChange));

            newFrontBack = Math.round(newFrontBack * 10) / 10;
            newSideToSide = Math.round(newSideToSide * 10) / 10;

            await trailerLevelCollection.updateOne(
                { _id: 'main' },
                { $set: {
                    front_back: newFrontBack,
                    side_to_side: newSideToSide,
                    updated_at: new Date()
                } }
            );

            broadcast('level', {
                ...level,
                front_back: newFrontBack,
                side_to_side: newSideToSide
            });
        } catch (error) {
            console.error('Error updating trailer level simulation:', error);
        }
    }, 2000);

    // Simulate water tank level changes (no MQTT source)
    setInterval(async () => {
        if (clients.size === 0) return;

        try {
            const waterCollection = db.collection('water');
            const water = await waterCollection.findOne({ _id: 'main' });
            if (!water) return;

            // Fresh water slowly decreases (usage)
            const freshChange = -Math.random() * 0.3;
            let newFresh = Math.max(0, Math.min(100, water.fresh + freshChange));
            newFresh = Math.round(newFresh * 10) / 10;

            // Grey water slowly increases (from usage)
            const greyChange = Math.random() * 0.2;
            let newGrey = Math.max(0, Math.min(100, water.grey + greyChange));
            newGrey = Math.round(newGrey * 10) / 10;

            // Black water increases very slowly
            const blackChange = Math.random() * 0.05;
            let newBlack = Math.max(0, Math.min(100, water.black + blackChange));
            newBlack = Math.round(newBlack * 10) / 10;

            await waterCollection.updateOne(
                { _id: 'main' },
                { $set: {
                    fresh: newFresh,
                    grey: newGrey,
                    black: newBlack,
                    updated_at: new Date()
                } }
            );

            broadcast('water', {
                ...water,
                fresh: newFresh,
                grey: newGrey,
                black: newBlack
            });
        } catch (error) {
            console.error('Error updating water simulation:', error);
        }
    }, 10000);

    return { broadcast };
}

module.exports = setupWebSocket;
