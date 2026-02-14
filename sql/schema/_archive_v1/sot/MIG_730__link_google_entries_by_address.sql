\echo '=== MIG_730: Link Google Maps Entries by Address Match ==='
\echo 'Automatically link entries when kml_name matches a place address'
\echo ''

-- ============================================================================
-- PROBLEM:
-- Google Maps entries have addresses in kml_name (e.g., "2151 W Steele Ln")
-- Places exist with those addresses but entries aren't linked because:
-- 1. KMZ coordinates are imprecise (often 100-500m off)
-- 2. No automatic linking was done during import
--
-- SOLUTION:
-- Match entries to places by address similarity, not coordinates.
-- ============================================================================

-- ============================================================================
-- PART 1: Create function to link entries by address
-- ============================================================================

\echo 'Creating link_google_entries_by_address function...'

CREATE OR REPLACE FUNCTION trapper.link_google_entries_by_address(
  p_limit INT DEFAULT 1000,
  p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  total_candidates INT,
  exact_matches INT,
  linked_count INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_candidates INT := 0;
  v_exact_matches INT := 0;
  v_linked_count INT := 0;
BEGIN
  -- Find entries that look like addresses and match places
  WITH address_like_entries AS (
    -- Entries where kml_name looks like an address (has numbers and street words)
    SELECT
      e.entry_id,
      e.kml_name,
      -- Normalize the address for matching
      UPPER(TRIM(REGEXP_REPLACE(e.kml_name, '\s+', ' ', 'g'))) as normalized_name
    FROM trapper.google_map_entries e
    WHERE e.linked_place_id IS NULL
      AND e.place_id IS NULL
      -- Looks like an address (has digits and common street suffixes)
      AND e.kml_name ~ '^\d+\s+\w'
      AND e.kml_name ~* '(st|street|rd|road|ave|avenue|ln|lane|dr|drive|way|blvd|boulevard|ct|court|pl|place|cir|circle)\b'
    LIMIT p_limit
  ),
  place_addresses AS (
    SELECT
      p.place_id,
      p.formatted_address,
      UPPER(TRIM(REGEXP_REPLACE(p.formatted_address, '\s+', ' ', 'g'))) as normalized_address,
      -- Also create a short version (just street address, no city/state)
      UPPER(TRIM(SPLIT_PART(p.formatted_address, ',', 1))) as short_address
    FROM trapper.places p
    WHERE p.merged_into_place_id IS NULL
  ),
  matches AS (
    SELECT DISTINCT ON (e.entry_id)
      e.entry_id,
      e.kml_name,
      p.place_id,
      p.formatted_address,
      -- Score the match quality
      CASE
        WHEN e.normalized_name = p.normalized_address THEN 100
        WHEN e.normalized_name = p.short_address THEN 90
        WHEN p.short_address LIKE e.normalized_name || '%' THEN 80
        WHEN e.normalized_name LIKE p.short_address || '%' THEN 80
        -- Fuzzy match using similarity
        WHEN similarity(e.normalized_name, p.short_address) > 0.6 THEN
          (similarity(e.normalized_name, p.short_address) * 100)::int
        ELSE 0
      END as match_score
    FROM address_like_entries e
    CROSS JOIN place_addresses p
    WHERE
      -- Exact or near-exact match
      e.normalized_name = p.normalized_address
      OR e.normalized_name = p.short_address
      OR p.short_address LIKE e.normalized_name || '%'
      OR e.normalized_name LIKE p.short_address || '%'
      OR similarity(e.normalized_name, p.short_address) > 0.6
    ORDER BY e.entry_id,
      CASE
        WHEN e.normalized_name = p.normalized_address THEN 1
        WHEN e.normalized_name = p.short_address THEN 2
        ELSE 3
      END,
      similarity(e.normalized_name, p.short_address) DESC
  )
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE match_score >= 80)::int
  INTO v_total_candidates, v_exact_matches
  FROM matches
  WHERE match_score >= 60;

  -- Actually link if not dry run
  IF NOT p_dry_run THEN
    WITH matches AS (
      SELECT DISTINCT ON (e.entry_id)
        e.entry_id,
        p.place_id
      FROM (
        SELECT
          entry_id,
          UPPER(TRIM(REGEXP_REPLACE(kml_name, '\s+', ' ', 'g'))) as normalized_name,
          kml_name
        FROM trapper.google_map_entries
        WHERE linked_place_id IS NULL
          AND place_id IS NULL
          AND kml_name ~ '^\d+\s+\w'
          AND kml_name ~* '(st|street|rd|road|ave|avenue|ln|lane|dr|drive|way|blvd|boulevard|ct|court|pl|place|cir|circle)\b'
        LIMIT p_limit
      ) e
      CROSS JOIN (
        SELECT
          place_id,
          UPPER(TRIM(SPLIT_PART(formatted_address, ',', 1))) as short_address
        FROM trapper.places
        WHERE merged_into_place_id IS NULL
      ) p
      WHERE
        e.normalized_name = p.short_address
        OR p.short_address LIKE e.normalized_name || '%'
        OR similarity(e.normalized_name, p.short_address) > 0.7
      ORDER BY e.entry_id, similarity(e.normalized_name, p.short_address) DESC
    )
    UPDATE trapper.google_map_entries g
    SET linked_place_id = m.place_id
    FROM matches m
    WHERE g.entry_id = m.entry_id;

    GET DIAGNOSTICS v_linked_count = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT v_total_candidates, v_exact_matches, v_linked_count;
END;
$$;

COMMENT ON FUNCTION trapper.link_google_entries_by_address IS
'Links Google Maps entries to places by matching kml_name addresses to place addresses';

-- ============================================================================
-- PART 2: Create function to link entries by person name
-- ============================================================================

\echo 'Creating link_google_entries_by_person function...'

CREATE OR REPLACE FUNCTION trapper.link_google_entries_by_person(
  p_limit INT DEFAULT 1000,
  p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  total_candidates INT,
  linked_count INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_candidates INT := 0;
  v_linked_count INT := 0;
BEGIN
  -- Find entries that match person names, then use person's place
  WITH person_entries AS (
    SELECT
      e.entry_id,
      e.kml_name,
      p.person_id,
      p.display_name,
      ppr.place_id
    FROM trapper.google_map_entries e
    JOIN trapper.sot_people p ON
      UPPER(TRIM(e.kml_name)) = UPPER(TRIM(p.display_name))
      AND p.merged_into_person_id IS NULL
    JOIN trapper.person_place_relationships ppr ON ppr.person_id = p.person_id
    WHERE e.linked_place_id IS NULL
      AND e.place_id IS NULL
      AND e.linked_person_id IS NULL
      -- Doesn't look like an address
      AND e.kml_name !~ '^\d+\s+\w.*(st|street|rd|road|ave|avenue|ln|lane|dr|drive)\b'
    LIMIT p_limit
  )
  SELECT COUNT(*)::int INTO v_total_candidates FROM person_entries;

  IF NOT p_dry_run THEN
    WITH person_entries AS (
      SELECT DISTINCT ON (e.entry_id)
        e.entry_id,
        p.person_id,
        ppr.place_id
      FROM trapper.google_map_entries e
      JOIN trapper.sot_people p ON
        UPPER(TRIM(e.kml_name)) = UPPER(TRIM(p.display_name))
        AND p.merged_into_person_id IS NULL
      JOIN trapper.person_place_relationships ppr ON ppr.person_id = p.person_id
      WHERE e.linked_place_id IS NULL
        AND e.place_id IS NULL
        AND e.linked_person_id IS NULL
        AND e.kml_name !~ '^\d+\s+\w.*(st|street|rd|road|ave|avenue|ln|lane|dr|drive)\b'
      ORDER BY e.entry_id, ppr.is_primary DESC NULLS LAST, ppr.created_at ASC
      LIMIT p_limit
    )
    UPDATE trapper.google_map_entries g
    SET
      linked_place_id = pe.place_id,
      linked_person_id = pe.person_id
    FROM person_entries pe
    WHERE g.entry_id = pe.entry_id;

    GET DIAGNOSTICS v_linked_count = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT v_total_candidates, v_linked_count;
END;
$$;

COMMENT ON FUNCTION trapper.link_google_entries_by_person IS
'Links Google Maps entries to places when kml_name matches a person name who has a place';

-- ============================================================================
-- PART 3: Run the linking functions
-- ============================================================================

\echo 'Running address-based linking (dry run first)...'
SELECT * FROM trapper.link_google_entries_by_address(5000, TRUE);

\echo 'Running address-based linking (actual)...'
SELECT * FROM trapper.link_google_entries_by_address(5000, FALSE);

\echo 'Running person-based linking (dry run first)...'
SELECT * FROM trapper.link_google_entries_by_person(5000, TRUE);

\echo 'Running person-based linking (actual)...'
SELECT * FROM trapper.link_google_entries_by_person(5000, FALSE);

-- ============================================================================
-- PART 4: Summary stats
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

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=== MIG_730 Summary ==='
\echo 'Created functions:'
\echo '  - link_google_entries_by_address(limit, dry_run)'
\echo '  - link_google_entries_by_person(limit, dry_run)'
\echo ''
\echo 'These can be run periodically to link new entries to existing places.'
\echo '=== MIG_730 Complete ==='
