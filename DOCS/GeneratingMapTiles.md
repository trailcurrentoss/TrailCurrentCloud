## Tile Server Setup

**New files in `tileserver/`:**

- `tileserver/Dockerfile` - Uses `maptiler/tileserver-gl-light` to serve vector tiles
- `tileserver/config.json` - Configuration for the tile server
- `tileserver/styles/basic.json` - Light theme map style
- `tileserver/styles/dark.json` - Dark theme map style
- `tileserver/generate-tiles.sh` - Script to convert your PBF file to mbtiles using Planetiler

**Docker compose changes:**

- Added `tileserver` service to `docker-compose.yml`
- Added `/tiles/` proxy route to `frontend/nginx.conf`

## Map Screen

**New frontend files:**

- `frontend/public/js/pages/map.js` - Map page module
- `frontend/public/js/components/map-display.js` - Leaflet-based map component with geolocation

**Updated files:**

- `frontend/public/js/app.js` - Added map page registration and navigation button
- `frontend/public/js/router.js` - Added map to overflow pages
- `frontend/public/js/components/nav-bar.js` - Updated overflow pages list
- `frontend/public/css/main.css` - Added map page styles

## To Use

1. **Generate tiles from your PBF file:**

   ```bash
   cd tileserver
   ./generate-tiles.sh
   ```

   This requires Java 21+ and will create `tileserver/data/map.mbtiles`.

2. **Start the services:**

   ```bash
   docker-compose up --build
   ```

3. **Access the map:** Navigate to the Map page in the app's navigation menu.

The map currently uses OpenStreetMap tiles as a fallback while local tiles are being generated. Once tiles are generated, you can switch to local tiles by updating the tile URL in `frontend/public/js/components/map-display.js` to use `/tiles/styles/dark/{z}/{x}/{y}.png`.
