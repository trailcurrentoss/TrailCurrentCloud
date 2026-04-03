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
            icon: 'lightbulb',
            type: 'light',
            updated_at: new Date()
        }));
        await lights.insertMany(lightDocs);
        console.log('Seeded lights');
    } else {
        // Migration: add icon and type to existing lights that lack them
        const lightsWithoutIcon = await lights.countDocuments({ icon: { $exists: false } });
        if (lightsWithoutIcon > 0) {
            await lights.updateMany(
                { icon: { $exists: false } },
                { $set: { icon: 'lightbulb', type: 'light' } }
            );
            console.log(`Migrated ${lightsWithoutIcon} lights with default icon/type`);
        }
    }

    // Seed settings (user preferences - persisted)
    const settings = db.collection('settings');
    const existingSettings = await settings.findOne({ _id: 'main' });
    if (!existingSettings) {
        await settings.insertOne({
            _id: 'main',
            theme: 'dark',
            updated_at: new Date()
        });
        console.log('Seeded settings');
    }

    // Note: energy, airquality, thermostat, water, and level data come from MQTT only
    // No database seeding needed for these - data flows via WebSocket

    // Seed proximity config (singleton)
    const proximityConfig = db.collection('proximity_config');
    const existingProximityConfig = await proximityConfig.findOne({ _id: 'main' });
    if (!existingProximityConfig) {
        await proximityConfig.insertOne({
            _id: 'main',
            enabled: false,
            zones: {
                approaching_radius_m: 500,
                arrived_radius_m: 50,
            },
            hysteresis_m: 20,
            debounce_ms: 5000,
            updated_at: new Date()
        });
        console.log('Seeded proximity config');
    }

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
