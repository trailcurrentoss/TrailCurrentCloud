#!/bin/bash
# Script to generate mbtiles from the north-america-latest.osm.pbf file
# This uses Planetiler which is the recommended modern tool for tile generation.
#
# Prerequisites:
# - Java 21+ installed
# - At least 32GB RAM recommended for North America
# - Sufficient disk space (output will be ~10-15GB)
#
# Usage: ./generate-tiles.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PBF_FILE="$PROJECT_ROOT/north-america-latest.osm.pbf"
OUTPUT_DIR="$PROJECT_ROOT/data/tileserver"
OUTPUT_FILE="$OUTPUT_DIR/north-america.mbtiles"
PLANETILER_VERSION="0.9.3"
PLANETILER_JAR="planetiler.jar"
PLANETILER_URL="https://github.com/onthegomap/planetiler/releases/download/v${PLANETILER_VERSION}/${PLANETILER_JAR}"

echo "=== TrailCurrent Tile Generator ==="
echo ""

# Check if PBF file exists
if [ ! -f "$PBF_FILE" ]; then
    echo "ERROR: PBF file not found at: $PBF_FILE"
    echo "Please download the North America OSM extract first."
    echo "You can get it from: https://download.geofabrik.de/north-america-latest.osm.pbf"
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Check if mbtiles already exists
if [ -f "$OUTPUT_FILE" ]; then
    echo "WARNING: Output file already exists: $OUTPUT_FILE"
    read -p "Do you want to overwrite it? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
    rm -f "$OUTPUT_FILE"
fi

# Download Planetiler if not present or if file is too small (corrupt)
if [ ! -f "$SCRIPT_DIR/$PLANETILER_JAR" ] || [ $(stat -c%s "$SCRIPT_DIR/$PLANETILER_JAR" 2>/dev/null || echo 0) -lt 1000000 ]; then
    echo "Downloading Planetiler v${PLANETILER_VERSION}..."
    rm -f "$SCRIPT_DIR/$PLANETILER_JAR"
    curl -L --fail --progress-bar -o "$SCRIPT_DIR/$PLANETILER_JAR" "$PLANETILER_URL"

    # Verify download
    if [ ! -f "$SCRIPT_DIR/$PLANETILER_JAR" ] || [ $(stat -c%s "$SCRIPT_DIR/$PLANETILER_JAR") -lt 1000000 ]; then
        echo "ERROR: Failed to download Planetiler. Please download manually from:"
        echo "$PLANETILER_URL"
        exit 1
    fi
    echo "Download complete."
fi

echo ""
echo "Starting tile generation..."
echo "Input:  $PBF_FILE"
echo "Output: $OUTPUT_FILE"
echo ""
echo "This will take a significant amount of time (potentially hours) depending on your hardware."
echo ""

# Run Planetiler with OpenMapTiles profile
java -Xmx24g \
    -jar "$SCRIPT_DIR/$PLANETILER_JAR" \
    --osm-path="$PBF_FILE" \
    --output="$OUTPUT_FILE" \
    --download \
    --fetch-wikidata \
    --nodemap-type=array \
    --storage=mmap

echo ""
echo "=== Tile generation complete! ==="
echo "Output file: $OUTPUT_FILE"
echo ""
echo "You can now start the tile server with: docker compose up tileserver"
