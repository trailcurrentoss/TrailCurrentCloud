# TrailCurrent Cloud

Cloud-hosted Progressive Web App (PWA) for remote monitoring and control of TrailCurrent trailer systems. Provides a responsive web interface accessible from any browser.

## Architecture

Dockerized microservices stack:

- **Frontend** - Nginx serving a vanilla JS PWA with HTTPS
- **Backend** - Node.js REST API with WebSocket support
- **MongoDB** - Document database for settings and state
- **Mosquitto** - MQTT broker (TLS) bridging cloud to vehicle
- **Tileserver** - Vector tile server for offline-capable maps

## Features

- **Thermostat Control** - Set temperature, view interior/exterior readings
- **Lighting** - Toggle 8 PDM-controlled devices with brightness adjustment
- **Energy Dashboard** - Battery voltage, SOC, solar input, shunt data
- **Water Tanks** - Fresh, grey, and black tank levels
- **Air Quality** - Temperature, humidity, IAQ index, CO2
- **Trailer Level** - Pitch and roll indicators
- **GPS/Map** - Real-time location with vector tile maps (MapLibre)
- **Settings** - Theme switching, screen timeout, user preferences
- **PWA** - Installable, works offline with service worker

## Quick Start

### Prerequisites

- Docker and Docker Compose
- OpenSSL (for certificate generation)

### Setup

1. **Clone and configure:**

   ```bash
   cp .env.example .env
   # Edit .env with your passwords and hostname
   ```

2. **Generate SSL certificates:**

   ```bash
   ./scripts/generate-certs.sh
   # Select (1) for development (localhost) or (2) for production
   ```

3. **Start services:**

   ```bash
   docker compose up -d
   ```

4. **Access the app:**

   ```
   https://localhost:8443
   ```

   Accept the self-signed certificate warning on first visit.

### Development Mode

Enables hot-reload for frontend changes and debug ports:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

## SSL Certificate Generation

The `scripts/generate-certs.sh` script generates self-signed certificates with proper Subject Alternative Names:

- **Development mode**: Includes `localhost`, `127.0.0.1`, `::1`, and your configured hostname
- **Production mode**: Includes your hostname, `127.0.0.1`, and `::1`

Certificates are generated to `data/keys/` and are gitignored. All services (nginx, mosquitto, backend) share the same certificate set.

## Map Tile Setup

The tileserver requires pre-generated `.mbtiles` vector tiles:

1. Download an OSM extract (e.g., from [Geofabrik](https://download.geofabrik.de/))
2. Run the tile generator:

   ```bash
   cd tileserver
   ./generate-tiles.sh
   ```

3. Generated tiles go to `data/tileserver/north-america.mbtiles`

See [DOCS/GeneratingMapTiles.md](DOCS/GeneratingMapTiles.md) for details.

## MQTT Integration

The Mosquitto broker uses TLS (port 8883) with credentials from `.env`. The MQTT password is automatically generated at container startup from environment variables - no manual password file management needed.

The backend subscribes to MQTT topics from the vehicle's CAN-to-MQTT gateway and pushes real-time updates to connected browsers via WebSocket.

## Project Structure

```
├── backend/                    # Node.js API server
│   ├── src/
│   │   ├── index.js            # Express server entry point
│   │   ├── mqtt.js             # MQTT client and message handling
│   │   ├── websocket.js        # WebSocket server
│   │   └── routes/             # REST API endpoints
│   └── Dockerfile
├── frontend/                   # Nginx + vanilla JS PWA
│   ├── public/
│   │   ├── js/
│   │   │   ├── pages/          # Page modules (home, energy, map, etc.)
│   │   │   └── components/     # Reusable UI components
│   │   └── css/
│   ├── nginx.conf              # Reverse proxy configuration
│   └── Dockerfile
├── mosquitto/                  # MQTT broker
│   ├── Dockerfile              # Custom image with entrypoint
│   ├── entrypoint.sh           # Generates passwd from env vars
│   └── mosquitto.conf          # Broker configuration
├── tileserver/                 # Map tile server
│   ├── config.json             # Tileserver configuration
│   ├── styles/                 # Map styles (basic, dark)
│   └── generate-tiles.sh       # OSM PBF to mbtiles converter
├── scripts/
│   ├── generate-certs.sh       # SSL certificate generator
│   └── openssl.cnf             # OpenSSL configuration template
├── DOCS/                       # Additional documentation
├── docker-compose.yml          # Production configuration
├── docker-compose.dev.yml      # Development overrides
└── .env.example                # Environment variable template
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | User authentication |
| `/api/auth/logout` | POST | End session |
| `/api/auth/check` | GET | Verify auth status |
| `/api/thermostat` | GET/PUT | Thermostat state |
| `/api/lights` | GET | List all lights |
| `/api/lights/:id` | PUT | Update light (state + brightness) |
| `/api/trailer/level` | GET | Trailer level data |
| `/api/energy` | GET | Energy/battery status |
| `/api/water` | GET | Water tank levels |
| `/api/airquality` | GET | Air quality data |
| `/api/settings` | GET/PUT | User settings |

## License

MIT License - See LICENSE file for details.

## Contributing

Improvements and contributions are welcome! Please submit issues or pull requests.
