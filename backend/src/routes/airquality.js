const express = require('express');
const router = express.Router();

module.exports = (db) => {
    const airquality = db.collection('airquality');

    // GET /api/airquality
    router.get('/', async (req, res) => {
        try {
            const data = await airquality.findOne({ _id: 'main' });
            res.json(data);
        } catch (error) {
            console.error('Error fetching air quality:', error);
            res.status(500).json({ error: 'Failed to fetch air quality data' });
        }
    });

    return router;
};
