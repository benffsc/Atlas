\echo '=== MIG_823: Fix distant GM entry mislinks ==='
\echo 'MIG_820 linked GM entries to nearest Atlas place within 50m.'
\echo 'In urban areas, 30-50m often means a DIFFERENT building/address.'
\echo 'This migration re-links entries >30m to coordinate-only places at their actual location,'
\echo 'then queues them for reverse geocoding to resolve the correct address.'
\echo ''

-- ============================================================================
-- Step 1: Show what we're fixing
-- ============================================================================

\echo 'Entries to re-link (>30m from linked place):'
SELECT
  COUNT(*) AS total,
  ROUND(AVG(dist)::numeric, 1) AS avg_dist_m,
  ROUND(MIN(dist)::numeric, 1) AS min_dist_m,
  ROUND(MAX(dist)::numeric, 1) AS max_dist_m
FROM (
  SELECT
    ST_Distance(
      ST_SetSRID(ST_MakePoint(gme.lng, gme.lat), 4326)::geography,
      p.location
    ) AS dist
  FROM trapper.google_map_entries gme
  JOIN trapper.places p ON p.place_id = gme.linked_place_id
  WHERE gme.linked_place_id IS NOT NULL
    AND gme.lat IS NOT NULL
    AND ST_Distance(
      ST_SetSRID(ST_MakePoint(gme.lng, gme.lat), 4326)::geography,
      p.location
    ) > 30
) d;

-- ============================================================================
-- Step 2: Create coordinate-only places at actual entry coordinates
--
-- Uses a temp table to batch the work. Groups entries by approximate
-- coordinates (within 10m) to avoid creating duplicate places for
-- entries at the same location.
-- ============================================================================

\echo ''
\echo 'Creating coordinate-only places for mislinked entries...'

-- Collect entries that need fixing
CREATE TEMP TABLE _mislinked_entries AS
SELECT
  gme.entry_id,
  gme.kml_name,
  gme.lat,
  gme.lng,
  gme.linked_place_id AS old_linked_place_id,
  ST_Distance(
    ST_SetSRID(ST_MakePoint(gme.lng, gme.lat), 4326)::geography,
    p.location
  ) AS dist_from_link
FROM trapper.google_map_entries gme
JOIN trapper.places p ON p.place_id = gme.linked_place_id
WHERE gme.linked_place_id IS NOT NULL
  AND gme.lat IS NOT NULL
  AND ST_Distance(
    ST_SetSRID(ST_MakePoint(gme.lng, gme.lat), 4326)::geography,
    p.location
  ) > 30;

\echo 'Collected mislinked entries'

-- Get distinct coordinate groups (round to ~10m precision ≈ 4 decimal places)
-- Each group gets one place
CREATE TEMP TABLE _new_places AS
SELECT
  ROUND(lat::numeric, 4) AS group_lat,
  ROUND(lng::numeric, 4) AS group_lng,
  -- Use the first entry's kml_name as display name
  (ARRAY_AGG(kml_name ORDER BY kml_name NULLS LAST))[1] AS display_name,
  -- Average coordinates for the group
  AVG(lat) AS avg_lat,
  AVG(lng) AS avg_lng,
  COUNT(*) AS entry_count
FROM _mislinked_entries
GROUP BY ROUND(lat::numeric, 4), ROUND(lng::numeric, 4);

-- Check if places already exist at these coordinates (from MIG_821 or reverse geocoding)
ALTER TABLE _new_places ADD COLUMN place_id UUID;

UPDATE _new_places np
SET place_id = p.place_id
FROM trapper.places p
WHERE p.merged_into_place_id IS NULL
  AND p.location IS NOT NULL
  AND ST_DWithin(
    p.location,
    ST_SetSRID(ST_MakePoint(np.avg_lng, np.avg_lat), 4326)::geography,
    10
  );

\echo 'Checked existing places at entry coordinates'

-- Disable auto-match trigger during bulk insert
ALTER TABLE trapper.places DISABLE TRIGGER trg_match_google_map_entries;

-- Create places only where none exist
INSERT INTO trapper.places (
  place_id, display_name, location,
  place_kind, is_address_backed, place_origin, data_source,
  location_type, quality_tier, geocode_attempts, geocode_next_attempt, geocode_failed
)
SELECT
  gen_random_uuid(),
  np.display_name,
  ST_SetSRID(ST_MakePoint(np.avg_lng, np.avg_lat), 4326)::geography,
  'unknown', FALSE, 'google_maps', 'google_maps',
  'approximate', 'D', 0, NOW(), FALSE
FROM _new_places np
WHERE np.place_id IS NULL;

-- Re-enable trigger
ALTER TABLE trapper.places ENABLE TRIGGER trg_match_google_map_entries;

-- Fill in the place_ids for newly created places
UPDATE _new_places np
SET place_id = p.place_id
FROM trapper.places p
WHERE np.place_id IS NULL
  AND p.merged_into_place_id IS NULL
  AND p.location IS NOT NULL
  AND ST_DWithin(
    p.location,
    ST_SetSRID(ST_MakePoint(np.avg_lng, np.avg_lat), 4326)::geography,
    10
  );

\echo 'Created/found coordinate-only places'

-- ============================================================================
-- Step 3: Re-link entries to the correct coordinate-only places
-- ============================================================================

\echo ''
\echo 'Re-linking entries to correct places...'

UPDATE trapper.google_map_entries gme
SET linked_place_id = np.place_id
FROM _mislinked_entries me
JOIN _new_places np ON
  ROUND(me.lat::numeric, 4) = np.group_lat
  AND ROUND(me.lng::numeric, 4) = np.group_lng
WHERE gme.entry_id = me.entry_id
  AND np.place_id IS NOT NULL;

-- ============================================================================
-- Step 4: Clean up and verify
-- ============================================================================

\echo ''
\echo '=== Verification ==='

\echo 'Re-linked entries:'
SELECT
  COUNT(*) AS entries_fixed,
  COUNT(DISTINCT np.place_id) AS places_used,
  COUNT(*) FILTER (WHERE np.entry_count > 1) AS shared_place_entries
FROM _mislinked_entries me
JOIN _new_places np ON
  ROUND(me.lat::numeric, 4) = np.group_lat
  AND ROUND(me.lng::numeric, 4) = np.group_lng;

\echo ''
\echo 'New places queued for reverse geocoding:'
SELECT COUNT(*) AS pending_reverse
FROM trapper.places
WHERE is_address_backed = FALSE
  AND formatted_address IS NULL
  AND geocode_failed = FALSE
  AND merged_into_place_id IS NULL
  AND geocode_next_attempt <= NOW();

\echo ''
\echo 'Campos entry check:'
SELECT
  gme.kml_name,
  gme.linked_place_id,
  p.formatted_address,
  p.display_name,
  ROUND(ST_Distance(
    ST_SetSRID(ST_MakePoint(gme.lng, gme.lat), 4326)::geography,
    p.location
  )::numeric, 1) AS dist_m
FROM trapper.google_map_entries gme
JOIN trapper.places p ON p.place_id = gme.linked_place_id
WHERE gme.kml_name ILIKE '%Hector%Esbeida%';

DROP TABLE _mislinked_entries;
DROP TABLE _new_places;

\echo ''
\echo '=== MIG_823 Complete ==='
\echo 'Run reverse_geocode_batch.mjs or wait for cron to resolve new places.'
