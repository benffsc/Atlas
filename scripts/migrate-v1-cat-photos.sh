#!/bin/bash
#
# V1 → V2 Cat Photo Migration Script
#
# Purpose: Copy cat photos from V1 Supabase storage to V2 Supabase storage
# matching V1 cat_ids to V2 cat_ids based on microchip.
#
# Prerequisites:
#   - V1 and V2 database access (DATABASE_URL_EAST and DATABASE_URL)
#   - Supabase service role keys for both projects
#
# Usage: ./scripts/migrate-v1-cat-photos.sh

set -e

# Load environment
source .env 2>/dev/null || source .env.local

# Database URLs
V1_DB='postgresql://postgres.tpjllrfpdlkenbapvpko:vfh0xba%21ujx%21gwz%21UGJ@aws-1-us-east-2.pooler.supabase.com:6543/postgres'
V2_DB='postgresql://postgres.afxpboxisgoxttyrbtpw:BfuM42NhYjPfLY%21%40vdBV@aws-0-us-west-2.pooler.supabase.com:6543/postgres'

# Supabase URLs
V1_SUPABASE="https://tpjllrfpdlkenbapvpko.supabase.co"
V2_SUPABASE="https://afxpboxisgoxttyrbtpw.supabase.co"

# Service keys (from .env)
V1_SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY_EAST}"
V2_SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"

echo "=== V1 → V2 Cat Photo Migration ==="
echo ""

# Check keys
if [ -z "$V1_SERVICE_KEY" ] || [ -z "$V2_SERVICE_KEY" ]; then
    echo "Error: Missing service keys. Set SUPABASE_SERVICE_ROLE_KEY_EAST and SUPABASE_SERVICE_ROLE_KEY"
    exit 1
fi

# Create temp directory for downloads
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "1. Building V1→V2 cat mapping..."

# Get V2 cat mapping (microchip → v2_cat_id)
psql "$V2_DB" -t -A -F'|' -c "
SELECT DISTINCT
    c.microchip,
    c.cat_id as v2_cat_id
FROM ops.appointments a
JOIN sot.cats c ON c.cat_id = a.cat_id
WHERE a.appointment_date IN ('2026-02-02', '2026-02-04')
  AND c.microchip IS NOT NULL;
" > "$TEMP_DIR/v2_mapping.csv"

echo "   V2 cats found: $(wc -l < $TEMP_DIR/v2_mapping.csv)"

# Get V1 photos with their paths
psql "$V1_DB" -t -A -F'|' -c "
SELECT
    c.microchip,
    p.name as photo_path
FROM ops.appointments a
JOIN sot.cats c ON c.cat_id = a.cat_id
JOIN storage.objects p ON SPLIT_PART(p.name, '/', 2)::UUID = a.cat_id
  AND p.bucket_id = 'request-media' AND p.name LIKE 'cats/%'
WHERE a.appointment_date IN ('2026-02-02', '2026-02-04')
  AND c.microchip IS NOT NULL
ORDER BY c.microchip;
" > "$TEMP_DIR/v1_photos.csv"

echo "   V1 photos found: $(wc -l < $TEMP_DIR/v1_photos.csv)"

echo ""
echo "2. Migrating photos..."

migrated=0
skipped=0
errors=0

while IFS='|' read -r microchip photo_path; do
    # Look up V2 cat_id
    v2_cat_id=$(grep "^${microchip}|" "$TEMP_DIR/v2_mapping.csv" | cut -d'|' -f2)

    if [ -z "$v2_cat_id" ]; then
        echo "   SKIP: No V2 match for microchip $microchip"
        ((skipped++))
        continue
    fi

    # Extract filename
    filename=$(basename "$photo_path")
    new_path="cats/${v2_cat_id}/${filename}"

    # Download from V1
    download_url="${V1_SUPABASE}/storage/v1/object/request-media/${photo_path}"
    local_file="$TEMP_DIR/$filename"

    http_code=$(curl -s -w "%{http_code}" -o "$local_file" \
        -H "Authorization: Bearer $V1_SERVICE_KEY" \
        "$download_url")

    if [ "$http_code" != "200" ]; then
        echo "   ERROR: Failed to download $photo_path (HTTP $http_code)"
        ((errors++))
        continue
    fi

    # Check if already exists in V2
    check_url="${V2_SUPABASE}/storage/v1/object/info/request-media/${new_path}"
    check_code=$(curl -s -w "%{http_code}" -o /dev/null \
        -H "Authorization: Bearer $V2_SERVICE_KEY" \
        "$check_url")

    if [ "$check_code" == "200" ]; then
        echo "   EXISTS: $new_path"
        ((skipped++))
        continue
    fi

    # Upload to V2
    content_type="image/jpeg"
    [[ "$filename" == *.png ]] && content_type="image/png"

    upload_url="${V2_SUPABASE}/storage/v1/object/request-media/${new_path}"
    upload_code=$(curl -s -w "%{http_code}" -o /dev/null \
        -X POST \
        -H "Authorization: Bearer $V2_SERVICE_KEY" \
        -H "Content-Type: $content_type" \
        --data-binary "@$local_file" \
        "$upload_url")

    if [ "$upload_code" == "200" ] || [ "$upload_code" == "201" ]; then
        echo "   ✓ Migrated: $microchip → $new_path"
        ((migrated++))
    else
        echo "   ERROR: Failed to upload $new_path (HTTP $upload_code)"
        ((errors++))
    fi

    # Clean up
    rm -f "$local_file"

done < "$TEMP_DIR/v1_photos.csv"

echo ""
echo "=== Migration Complete ==="
echo "   Photos migrated: $migrated"
echo "   Already exists/skipped: $skipped"
echo "   Errors: $errors"
