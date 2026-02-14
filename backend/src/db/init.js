const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;

let client = null;
let db = null;

async function connect() {
    if (db) return db;

    client = new MongoClient(uri);
    await client.connect();
    db = client.db();

    console.log('Connected to MongoDB');

    await seedDatabase();

    return db;
}

async function seedDatabase() {
    // Seed lights (metadata only - state comes from MQTT)
    const lights = db.collection('lights');
    const existingLights = await lights.countDocuments();
    if (existingLights === 0) {
        const lightNames = [
            'Living Room', 'Kitchen', 'Bedroom', 'Bathroom',
            'Exterior', 'Awning', 'Porch', 'Storage'
        ];
        const lightDocs = lightNames.map((name, index) => ({
            _id: index + 1,
            name,
            updated_at: new Date()
        }));
        await lights.insertMany(lightDocs);
        console.log('Seeded lights');
    }

    // Seed trailer level (simulated - no MQTT source)
    const trailerLevel = db.collection('trailer_level');
    const existingLevel = await trailerLevel.findOne({ _id: 'main' });
    if (!existingLevel) {
        await trailerLevel.insertOne({
            _id: 'main',
            front_back: 0.0,
            side_to_side: 0.0,
            updated_at: new Date()
        });
        console.log('Seeded trailer level');
    }

    // Seed settings (user preferences - persisted)
    const settings = db.collection('settings');
    const existingSettings = await settings.findOne({ _id: 'main' });
    if (!existingSettings) {
        await settings.insertOne({
            _id: 'main',
            theme: 'dark',
            timezone: 'America/New_York',
            clock_format: '12h',
            updated_at: new Date()
        });
        console.log('Seeded settings');
    }

    // Seed water tanks (simulated - no MQTT source)
    const water = db.collection('water');
    const existingWater = await water.findOne({ _id: 'main' });
    if (!existingWater) {
        await water.insertOne({
            _id: 'main',
            fresh: 75.0,
            grey: 30.0,
            black: 15.0,
            updated_at: new Date()
        });
        console.log('Seeded water tanks');
    }

    // Note: energy, airquality, and thermostat data now come from MQTT only
    // No database seeding needed for these - data flows via WebSocket

    console.log('Database seeding complete');
}

function getDb() {
    if (!db) {
        throw new Error('Database not connected. Call connect() first.');
    }
    return db;
}

async function close() {
    if (client) {
        await client.close();
        client = null;
        db = null;
        console.log('MongoDB connection closed');
    }
}

module.exports = { connect, getDb, close };
