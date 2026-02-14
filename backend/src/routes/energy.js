const express = require('express');
const router = express.Router();

module.exports = (db) => {
    const energy = db.collection('energy');

    // GET /api/energy
    router.get('/', async (req, res) => {
        try {
            const data = await energy.findOne({ _id: 'main' });
            res.json(data);
        } catch (error) {
            console.error('Error fetching energy:', error);
            res.status(500).json({ error: 'Failed to fetch energy data' });
        }
    });

    return router;
};
