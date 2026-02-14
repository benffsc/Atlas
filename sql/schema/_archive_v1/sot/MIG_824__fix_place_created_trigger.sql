\echo '=== MIG_824: Fix on_place_created_check_google_entries trigger ==='
\echo 'Bugs fixed:'
\echo '  1. batch_id column does not exist (correct: trigger_id, UUID type)'
\echo '  2. trigger_type "new_place_proximity" violates check constraint (correct: auto_queue)'
\echo '  3. EXCEPTION handler too narrow (only caught undefined_table, not column/constraint errors)'
\echo ''

-- ============================================================================
-- Fix the trigger function
--
-- Three bugs in the original:
--   1. Used batch_id (doesn't exist) instead of trigger_id
--   2. Used TEXT cast for trigger_id which is UUID
--   3. Used 'new_place_proximity' trigger_type which violates check constraint
--   4. EXCEPTION only caught undefined_table, missing column/constraint errors
--
-- This trigger fires AFTER INSERT on trapper.places. When a new place is
-- created with coordinates, it updates nearest_place on nearby GM entries
-- and queues a processing job for incremental linking.
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.on_place_created_check_google_entries()
RETURNS trigger AS $$
DECLARE
  v_updated INT := 0;
BEGIN
  IF NEW.location IS NULL THEN
    RETURN NEW;
  END IF;

  IF trapper.is_multi_unit_place(NEW.place_id) THEN
    RETURN NEW;
  END IF;

  SELECT trapper.update_nearest_place_for_location(NEW.place_id, 50) INTO v_updated;

  IF v_updated > 0 THEN
    BEGIN
      INSERT INTO trapper.processing_jobs (
        source_system, source_table, trigger_type, trigger_id, priority, status
      ) VALUES (
        'google_maps', 'linking', 'auto_queue',
        NEW.place_id,  -- UUID column, no cast needed
        5, 'pending'
      );
    EXCEPTION WHEN OTHERS THEN
      -- Don't let queueing failure block place creation
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

\echo 'Fixed on_place_created_check_google_entries trigger function'

-- ============================================================================
-- Fix orphaned GM entries (46 entries with no place_id and no linked_place_id)
-- These lost their links during the MIG_823 place_id mislink cleanup.
-- Create coordinate-only places at their actual coordinates and link them.
-- ============================================================================

\echo ''
\echo 'Orphaned GM entries to fix:'
SELECT COUNT(*) AS orphaned
FROM trapper.google_map_entries
WHERE place_id IS NULL
  AND linked_place_id IS NULL
  AND lat IS NOT NULL;

-- Collect orphaned entries
CREATE TEMP TABLE _orphaned_entries AS
SELECT
  entry_id,
  kml_name,
  lat,
  lng,
  ROUND(lat::numeric, 4) AS group_lat,
  ROUND(lng::numeric, 4) AS group_lng
FROM trapper.google_map_entries
WHERE place_id IS NULL
  AND linked_place_id IS NULL
  AND lat IS NOT NULL;

-- Group by approximate coordinates (~10m precision)
CREATE TEMP TABLE _orphan_places AS
SELECT
  group_lat,
  group_lng,
  AVG(lat) AS avg_lat,
  AVG(lng) AS avg_lng,
  (ARRAY_AGG(kml_name ORDER BY kml_name NULLS LAST))[1] AS display_name,
  COUNT(*) AS entry_count
FROM _orphaned_entries
GROUP BY group_lat, group_lng;

-- Check if places already exist at these coordinates
ALTER TABLE _orphan_places ADD COLUMN place_id UUID;

UPDATE _orphan_places op
SET place_id = p.place_id
FROM trapper.places p
WHERE p.merged_into_place_id IS NULL
  AND p.location IS NOT NULL
  AND ST_DWithin(
    p.location,
    ST_SetSRID(ST_MakePoint(op.avg_lng, op.avg_lat), 4326)::geography,
    10
  );

\echo 'Existing places found at orphan coordinates:'
SELECT COUNT(*) FILTER (WHERE place_id IS NOT NULL) AS existing,
       COUNT(*) FILTER (WHERE place_id IS NULL) AS need_creation
FROM _orphan_places;

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
  op.display_name,
  ST_SetSRID(ST_MakePoint(op.avg_lng, op.avg_lat), 4326)::geography,
  'unknown', FALSE, 'google_maps', 'google_maps',
  'approximate', 'D', 0, NOW(), FALSE
FROM _orphan_places op
WHERE op.place_id IS NULL;

-- Re-enable trigger
ALTER TABLE trapper.places ENABLE TRIGGER trg_match_google_map_entries;

-- Fill in place_ids for newly created places
UPDATE _orphan_places op
SET place_id = p.place_id
FROM trapper.places p
WHERE op.place_id IS NULL
  AND p.merged_into_place_id IS NULL
  AND p.location IS NOT NULL
  AND ST_DWithin(
    p.location,
    ST_SetSRID(ST_MakePoint(op.avg_lng, op.avg_lat), 4326)::geography,
    10
  );

-- Link orphaned entries to their places
UPDATE trapper.google_map_entries gme
SET linked_place_id = op.place_id
FROM _orphaned_entries oe
JOIN _orphan_places op ON oe.group_lat = op.group_lat AND oe.group_lng = op.group_lng
WHERE gme.entry_id = oe.entry_id
  AND op.place_id IS NOT NULL;

\echo ''
\echo '=== Verification ==='

\echo 'Entries linked:'
SELECT COUNT(*) AS linked
FROM trapper.google_map_entries
WHERE linked_place_id IS NOT NULL
  AND entry_id IN (SELECT entry_id FROM _orphaned_entries);

\echo 'Remaining orphaned entries:'
SELECT COUNT(*) AS still_orphaned
FROM trapper.google_map_entries
WHERE place_id IS NULL
  AND linked_place_id IS NULL
  AND lat IS NOT NULL;

\echo 'New places queued for reverse geocoding:'
SELECT COUNT(*) AS pending
FROM trapper.places
WHERE is_address_backed = FALSE
  AND formatted_address IS NULL
  AND geocode_failed = FALSE
  AND merged_into_place_id IS NULL
  AND geocode_next_attempt <= NOW();

DROP TABLE _orphaned_entries;
DROP TABLE _orphan_places;

\echo ''
\echo '=== MIG_824 Complete ==='
\echo 'Run reverse_geocode_batch.mjs to resolve new coordinate-only places.'
