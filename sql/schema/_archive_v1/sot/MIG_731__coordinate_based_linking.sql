\echo '=== MIG_731: Coordinate-Based Auto-Linking ==='
\echo 'Auto-link Google Maps entries within 25m of Atlas places'
\echo ''

-- ============================================================================
-- PROBLEM:
-- Google Maps entries have imprecise KMZ coordinates (often 100-500m off)
-- but some entries ARE at the same location as Atlas places.
--
-- SOLUTION:
-- 1. Strict auto-linking: Only auto-link entries within 25m (same property)
-- 2. Entries >25m away stay as separate historical dots
-- 3. Manual linking available via API for staff to link manually
-- ============================================================================

-- ============================================================================
-- PART 1: Function to auto-link by strict coordinate match
-- ============================================================================

\echo 'Creating link_google_entries_by_coordinates function...'

CREATE OR REPLACE FUNCTION trapper.link_google_entries_by_coordinates(
  p_distance_threshold_m NUMERIC DEFAULT 25,
  p_limit INT DEFAULT 5000,
  p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  within_threshold INT,
  linked_count INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_within_threshold INT := 0;
  v_linked_count INT := 0;
BEGIN
  -- Count entries within threshold
  SELECT COUNT(*) INTO v_within_threshold
  FROM trapper.google_map_entries
  WHERE place_id IS NULL
    AND linked_place_id IS NULL
    AND lat IS NOT NULL
    AND nearest_place_id IS NOT NULL
    AND nearest_place_distance_m <= p_distance_threshold_m
  LIMIT p_limit;

  -- Auto-link if not dry run
  IF NOT p_dry_run THEN
    WITH entries_to_link AS (
      SELECT entry_id, nearest_place_id
      FROM trapper.google_map_entries
      WHERE place_id IS NULL
        AND linked_place_id IS NULL
        AND lat IS NOT NULL
        AND nearest_place_id IS NOT NULL
        AND nearest_place_distance_m <= p_distance_threshold_m
      LIMIT p_limit
    )
    UPDATE trapper.google_map_entries g
    SET linked_place_id = e.nearest_place_id
    FROM entries_to_link e
    WHERE g.entry_id = e.entry_id;

    GET DIAGNOSTICS v_linked_count = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT v_within_threshold, v_linked_count;
END;
$$;

COMMENT ON FUNCTION trapper.link_google_entries_by_coordinates IS
'Auto-links Google Maps entries to places when within distance threshold (default 25m = same property)';

-- ============================================================================
-- PART 2: Function to manually link an entry to a place
-- ============================================================================

\echo 'Creating manual_link_google_entry function...'

CREATE OR REPLACE FUNCTION trapper.manual_link_google_entry(
  p_entry_id UUID,
  p_place_id UUID,
  p_linked_by TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry RECORD;
  v_place RECORD;
BEGIN
  -- Validate entry exists
  SELECT entry_id, kml_name, linked_place_id
  INTO v_entry
  FROM trapper.google_map_entries
  WHERE entry_id = p_entry_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Entry not found';
    RETURN;
  END IF;

  -- Validate place exists and is not merged
  SELECT place_id, formatted_address, merged_into_place_id
  INTO v_place
  FROM trapper.places
  WHERE place_id = p_place_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Place not found';
    RETURN;
  END IF;

  IF v_place.merged_into_place_id IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 'Place has been merged - use the merged place instead';
    RETURN;
  END IF;

  -- Link the entry
  UPDATE trapper.google_map_entries
  SET
    linked_place_id = p_place_id,
    updated_at = NOW()
  WHERE entry_id = p_entry_id;

  RETURN QUERY SELECT TRUE,
    format('Linked "%s" to "%s"', v_entry.kml_name, v_place.formatted_address);
END;
$$;

COMMENT ON FUNCTION trapper.manual_link_google_entry IS
'Manually link a Google Maps entry to an Atlas place';

-- ============================================================================
-- PART 3: Function to unlink an entry (fix incorrect merges)
-- ============================================================================

\echo 'Creating unlink_google_entry function...'

CREATE OR REPLACE FUNCTION trapper.unlink_google_entry(
  p_entry_id UUID,
  p_unlinked_by TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry RECORD;
BEGIN
  -- Get entry
  SELECT entry_id, kml_name, place_id, linked_place_id
  INTO v_entry
  FROM trapper.google_map_entries
  WHERE entry_id = p_entry_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Entry not found';
    RETURN;
  END IF;

  IF v_entry.place_id IS NULL AND v_entry.linked_place_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Entry is not linked to any place';
    RETURN;
  END IF;

  -- Cannot unlink entries with place_id (those are from original import)
  IF v_entry.place_id IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 'Cannot unlink entries with original place_id - only linked_place_id can be removed';
    RETURN;
  END IF;

  -- Unlink
  UPDATE trapper.google_map_entries
  SET
    linked_place_id = NULL,
    linked_person_id = NULL,
    updated_at = NOW()
  WHERE entry_id = p_entry_id;

  RETURN QUERY SELECT TRUE, format('Unlinked "%s"', v_entry.kml_name);
END;
$$;

COMMENT ON FUNCTION trapper.unlink_google_entry IS
'Unlink a Google Maps entry from its place (fixes incorrect merges)';

-- ============================================================================
-- PART 4: Run strict auto-linking
-- ============================================================================

\echo ''
\echo 'Running strict coordinate-based auto-linking (25m threshold)...'

-- Dry run first
\echo 'Dry run:'
SELECT * FROM trapper.link_google_entries_by_coordinates(25, 5000, TRUE);

-- Actual run
\echo 'Actual linking:'
SELECT * FROM trapper.link_google_entries_by_coordinates(25, 5000, FALSE);

-- ============================================================================
-- PART 5: Summary stats
-- ============================================================================

\echo ''
\echo 'Current linking status after coordinate-based auto-linking:'
SELECT
  CASE
    WHEN place_id IS NOT NULL OR linked_place_id IS NOT NULL THEN 'Linked to place'
    ELSE 'Unlinked (historical dot)'
  END as status,
  COUNT(*) as count
FROM trapper.google_map_entries
WHERE lat IS NOT NULL
GROUP BY 1;

\echo ''
\echo 'Distance breakdown of remaining unlinked entries:'
SELECT
  CASE
    WHEN nearest_place_distance_m IS NULL THEN 'No nearby place'
    WHEN nearest_place_distance_m <= 50 THEN 'Within 50m (consider manual link)'
    WHEN nearest_place_distance_m <= 100 THEN 'Within 100m'
    WHEN nearest_place_distance_m <= 200 THEN 'Within 200m'
    ELSE 'Over 200m away'
  END as distance_bucket,
  COUNT(*) as count
FROM trapper.google_map_entries
WHERE lat IS NOT NULL
  AND place_id IS NULL
  AND linked_place_id IS NULL
GROUP BY 1
ORDER BY 1;

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=== MIG_731 Summary ==='
\echo 'Created functions for coordinate-based linking:'
\echo '  - link_google_entries_by_coordinates(threshold_m, limit, dry_run)'
\echo '  - manual_link_google_entry(entry_id, place_id)'
\echo '  - unlink_google_entry(entry_id)'
\echo ''
\echo 'Auto-linked entries within 25m of places.'
\echo 'Remaining entries show as historical dots.'
\echo 'Use manual_link_google_entry() to link specific entries via API.'
\echo '=== MIG_731 Complete ==='
