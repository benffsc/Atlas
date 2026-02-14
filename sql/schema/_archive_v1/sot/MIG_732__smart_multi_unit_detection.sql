\echo '=== MIG_732: Smart Multi-Unit Detection for Linking ==='
\echo 'Prevent auto-linking entries to apartment/mobile home units'
\echo ''

-- ============================================================================
-- PROBLEM:
-- Auto-linking by coordinates can incorrectly merge entries that are near
-- apartment units or mobile home spaces. These are distinct locations even
-- though they're physically close.
--
-- SOLUTION:
-- 1. Detect multi-unit places by place_kind and address patterns
-- 2. Prevent auto-linking to multi-unit places
-- 3. Flag these for manual review instead
-- ============================================================================

-- ============================================================================
-- PART 1: Add mobile_home_space to place_kind enum
-- ============================================================================

\echo 'Adding mobile_home_space to place_kind enum...'

ALTER TYPE trapper.place_kind ADD VALUE IF NOT EXISTS 'mobile_home_space';

-- ============================================================================
-- PART 2: Function to detect if a place is a multi-unit location
-- ============================================================================

\echo 'Creating is_multi_unit_place function...'

CREATE OR REPLACE FUNCTION trapper.is_multi_unit_place(p_place_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM trapper.places p
    WHERE p.place_id = p_place_id
      AND (
        -- Explicit place_kind indicates multi-unit
        p.place_kind IN ('apartment_unit', 'apartment_building', 'mobile_home_space')
        -- Has unit number
        OR p.unit_number IS NOT NULL
        -- Address patterns indicating multi-unit
        OR p.formatted_address ~* '(apt|apartment|unit|#|space|lot|trailer)\\s*[a-z0-9]+'
        OR p.formatted_address ~* 'mobile\\s*(home)?\\s*(park|mhp)'
        OR p.formatted_address ~* 'trailer\\s*(park|ct|court)'
      )
  )
$$;

COMMENT ON FUNCTION trapper.is_multi_unit_place IS
'Returns true if place is an apartment, mobile home, or other multi-unit location';

-- ============================================================================
-- PART 3: Update coordinate linking to exclude multi-unit places
-- ============================================================================

\echo 'Updating link_google_entries_by_coordinates to exclude multi-unit places...'

CREATE OR REPLACE FUNCTION trapper.link_google_entries_by_coordinates(
  p_distance_threshold_m NUMERIC DEFAULT 25,
  p_limit INT DEFAULT 5000,
  p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  within_threshold INT,
  multi_unit_excluded INT,
  linked_count INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_within_threshold INT := 0;
  v_multi_unit_excluded INT := 0;
  v_linked_count INT := 0;
BEGIN
  -- Count ALL entries within threshold (including multi-unit)
  SELECT COUNT(*) INTO v_within_threshold
  FROM trapper.google_map_entries e
  WHERE e.place_id IS NULL
    AND e.linked_place_id IS NULL
    AND e.lat IS NOT NULL
    AND e.nearest_place_id IS NOT NULL
    AND e.nearest_place_distance_m <= p_distance_threshold_m;

  -- Count multi-unit places that will be excluded
  SELECT COUNT(*) INTO v_multi_unit_excluded
  FROM trapper.google_map_entries e
  JOIN trapper.places p ON p.place_id = e.nearest_place_id
  WHERE e.place_id IS NULL
    AND e.linked_place_id IS NULL
    AND e.lat IS NOT NULL
    AND e.nearest_place_id IS NOT NULL
    AND e.nearest_place_distance_m <= p_distance_threshold_m
    AND trapper.is_multi_unit_place(e.nearest_place_id);

  -- Auto-link if not dry run (excluding multi-unit places)
  IF NOT p_dry_run THEN
    WITH entries_to_link AS (
      SELECT e.entry_id, e.nearest_place_id
      FROM trapper.google_map_entries e
      WHERE e.place_id IS NULL
        AND e.linked_place_id IS NULL
        AND e.lat IS NOT NULL
        AND e.nearest_place_id IS NOT NULL
        AND e.nearest_place_distance_m <= p_distance_threshold_m
        -- Exclude multi-unit places
        AND NOT trapper.is_multi_unit_place(e.nearest_place_id)
      LIMIT p_limit
    )
    UPDATE trapper.google_map_entries g
    SET linked_place_id = e.nearest_place_id
    FROM entries_to_link e
    WHERE g.entry_id = e.entry_id;

    GET DIAGNOSTICS v_linked_count = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT v_within_threshold, v_multi_unit_excluded, v_linked_count;
END;
$$;

COMMENT ON FUNCTION trapper.link_google_entries_by_coordinates IS
'Auto-links Google Maps entries to places when within distance threshold, excluding multi-unit places';

-- ============================================================================
-- PART 4: Update place_kind for mobile home spaces
-- ============================================================================

\echo 'Detecting and tagging mobile home spaces...'

UPDATE trapper.places
SET place_kind = 'mobile_home_space'
WHERE place_kind = 'unknown'
  AND merged_into_place_id IS NULL
  AND (
    formatted_address ~* '(mobile|mhp|trailer)\\s*(home)?\\s*(park|ct|court)?'
    OR formatted_address ~* 'space\\s*[a-z0-9]+'
    OR formatted_address ~* 'lot\\s*#?\\s*[0-9]+'
  );

\echo 'Tagged mobile home spaces:'
SELECT COUNT(*) as mobile_home_spaces_tagged
FROM trapper.places
WHERE place_kind = 'mobile_home_space';

-- ============================================================================
-- PART 5: Unlink entries that were incorrectly auto-linked to multi-unit
-- ============================================================================

\echo ''
\echo 'Checking for entries incorrectly linked to multi-unit places...'

WITH incorrectly_linked AS (
  SELECT e.entry_id, e.kml_name, p.formatted_address
  FROM trapper.google_map_entries e
  JOIN trapper.places p ON p.place_id = e.linked_place_id
  WHERE e.linked_place_id IS NOT NULL
    AND e.place_id IS NULL  -- Only check auto-linked, not original
    AND trapper.is_multi_unit_place(e.linked_place_id)
)
SELECT COUNT(*) as incorrectly_linked_to_multiunit FROM incorrectly_linked;

-- Unlink them
\echo 'Unlinking entries incorrectly linked to multi-unit places...'

UPDATE trapper.google_map_entries e
SET linked_place_id = NULL
FROM trapper.places p
WHERE p.place_id = e.linked_place_id
  AND e.linked_place_id IS NOT NULL
  AND e.place_id IS NULL  -- Only auto-linked
  AND trapper.is_multi_unit_place(e.linked_place_id);

-- ============================================================================
-- PART 6: Summary
-- ============================================================================

\echo ''
\echo 'Current linking status:'
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
\echo 'Place kinds in system:'
SELECT place_kind, COUNT(*) as count
FROM trapper.places
WHERE merged_into_place_id IS NULL
GROUP BY 1
ORDER BY 2 DESC;

\echo ''
\echo '=== MIG_732 Summary ==='
\echo 'Added smart multi-unit detection:'
\echo '  - is_multi_unit_place(place_id) function'
\echo '  - mobile_home_space place_kind'
\echo '  - Auto-linking now excludes multi-unit places'
\echo '  - Multi-unit entries require manual linking'
\echo '=== MIG_732 Complete ==='
