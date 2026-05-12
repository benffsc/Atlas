#!/usr/bin/env bash
#
# Load Sonoma County city boundaries from OpenStreetMap Nominatim into sot.city_boundaries
#
# Uses Nominatim's polygon_geojson output to get official administrative boundaries
# for all 9 incorporated cities in Sonoma County.
#
# Requires: curl, psql, jq
# Target table: sot.city_boundaries (created by MIG_3133)
#
# Usage:
#   DATABASE_URL="postgresql://..." ./scripts/geo/load-city-boundaries.sh
#
# Safe to re-run: uses ON CONFLICT to upsert.

set -euo pipefail

DB_URL="${DATABASE_URL:?DATABASE_URL must be set}"

# All 9 incorporated cities in Sonoma County
CITIES=(
  "Santa Rosa"
  "Petaluma"
  "Rohnert Park"
  "Windsor"
  "Healdsburg"
  "Sonoma"
  "Cotati"
  "Sebastopol"
  "Cloverdale"
)

NOMINATIM_BASE="https://nominatim.openstreetmap.org/search"
USER_AGENT="Atlas-FFSC/1.0 (ben@forgottenfelines.org)"

loaded=0
failed=0

echo "Loading city boundaries for ${#CITIES[@]} Sonoma County cities..."
echo ""

for city in "${CITIES[@]}"; do
  echo -n "  $city... "

  # Query Nominatim for the city boundary polygon
  # polygon_geojson=1 returns the administrative boundary
  # county=Sonoma&state=California disambiguates
  response=$(curl -s -G "$NOMINATIM_BASE" \
    --data-urlencode "q=$city, Sonoma County, California" \
    --data-urlencode "format=json" \
    --data-urlencode "polygon_geojson=1" \
    --data-urlencode "limit=1" \
    --data-urlencode "addressdetails=1" \
    -H "User-Agent: $USER_AGENT" \
    -H "Accept: application/json" \
    2>/dev/null || echo "[]")

  # Extract the first result's geojson
  geojson=$(echo "$response" | jq -r '.[0].geojson // empty' 2>/dev/null)

  if [ -z "$geojson" ] || [ "$geojson" = "null" ]; then
    echo "FAILED (no boundary found)"
    failed=$((failed + 1))
    sleep 1  # Rate limiting
    continue
  fi

  # Get the geometry type
  geom_type=$(echo "$geojson" | jq -r '.type' 2>/dev/null)

  # Nominatim returns Polygon or MultiPolygon; we store as MultiPolygon
  if [ "$geom_type" = "Polygon" ]; then
    # Wrap Polygon in MultiPolygon
    geojson=$(echo "$geojson" | jq '{type: "MultiPolygon", coordinates: [.coordinates]}')
  elif [ "$geom_type" != "MultiPolygon" ]; then
    echo "FAILED (unexpected geometry type: $geom_type)"
    failed=$((failed + 1))
    sleep 1
    continue
  fi

  # Escape for SQL (single quotes)
  geojson_escaped=$(echo "$geojson" | sed "s/'/''/g")

  # Upsert into sot.city_boundaries
  psql "$DB_URL" -q -c "
    INSERT INTO sot.city_boundaries (city_name, state, county, geom, source, imported_at)
    VALUES (
      '$city',
      'California',
      'Sonoma',
      ST_SetSRID(ST_GeomFromGeoJSON('$geojson_escaped'), 4326),
      'openstreetmap_nominatim',
      NOW()
    )
    ON CONFLICT (city_name, state, county) DO UPDATE SET
      geom = ST_SetSRID(ST_GeomFromGeoJSON('$geojson_escaped'), 4326),
      source = 'openstreetmap_nominatim',
      imported_at = NOW();
  " 2>/dev/null

  if [ $? -eq 0 ]; then
    echo "OK"
    loaded=$((loaded + 1))
  else
    echo "FAILED (SQL insert error)"
    failed=$((failed + 1))
  fi

  # Nominatim rate limit: 1 request/second
  sleep 1.1
done

echo ""
echo "Done: $loaded loaded, $failed failed"
echo ""

# Verify
echo "Verification:"
psql "$DB_URL" -c "
  SELECT city_name, ST_AsText(ST_Centroid(geom)) AS centroid,
         ROUND(ST_Area(geom::geography) / 1000000, 1) AS area_km2
  FROM sot.city_boundaries
  ORDER BY city_name;
"
