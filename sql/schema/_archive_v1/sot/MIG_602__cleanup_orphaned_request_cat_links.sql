-- ============================================================================
-- MIG_602: Cleanup Orphaned Request-Cat Links
-- ============================================================================
--
-- Problem: MIG_258 created request_cat_links based on cat_place_relationships.
-- Later, MIG_590 cleaned up polluted cat_place_relationships, but the
-- request_cat_links that depended on them were not cleaned up.
--
-- Result: Requests show inflated cat counts. Example:
--   - Comstock Middle School request shows 228 cats
--   - Only 55 actually have place relationship to that address
--   - 240 orphaned links exist (cats no longer at that place)
--
-- Fix: Remove MIG_258 backfill links where the cat no longer has a
-- cat_place_relationship to the request's place.
-- ============================================================================

\echo ''
\echo '=== MIG_602: Cleanup Orphaned Request-Cat Links ==='
\echo ''

-- ============================================================================
-- Step 1: Identify orphaned links
-- ============================================================================

\echo 'Step 1: Identifying orphaned request_cat_links...'

CREATE TEMP TABLE orphaned_links AS
SELECT
  rcl.link_id,
  rcl.request_id,
  rcl.cat_id,
  rcl.link_purpose,
  rcl.linked_by,
  rcl.linked_at,
  r.place_id as request_place_id,
  p.formatted_address as request_address
FROM trapper.request_cat_links rcl
JOIN trapper.sot_requests r ON r.request_id = rcl.request_id
JOIN trapper.places p ON p.place_id = r.place_id
WHERE rcl.linked_by = 'mig_258_backfill'
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_place_relationships cpr
    WHERE cpr.cat_id = rcl.cat_id
      AND cpr.place_id = r.place_id
  );

\echo ''
\echo 'Orphaned links found:'
SELECT
  request_address,
  COUNT(*) as orphaned_count
FROM orphaned_links
GROUP BY request_address
ORDER BY orphaned_count DESC
LIMIT 15;

\echo ''
\echo 'Total orphaned links:'
SELECT COUNT(*) as total_orphaned FROM orphaned_links;

-- ============================================================================
-- Step 2: Log what we're about to delete
-- ============================================================================

\echo ''
\echo 'Step 2: Logging deletions to entity_edits...'

INSERT INTO trapper.entity_edits (
  entity_type,
  entity_id,
  edit_type,
  field_name,
  old_value,
  reason,
  edited_by
)
SELECT
  'request_cat_links',
  ol.link_id,
  'delete',
  'link',
  jsonb_build_object(
    'request_id', ol.request_id,
    'cat_id', ol.cat_id,
    'link_purpose', ol.link_purpose,
    'linked_by', ol.linked_by,
    'linked_at', ol.linked_at,
    'request_address', ol.request_address
  ),
  'Orphaned link: cat no longer has place relationship to request location. Original link created by mig_258_backfill.',
  'mig_602_cleanup'
FROM orphaned_links ol;

-- ============================================================================
-- Step 3: Delete orphaned links
-- ============================================================================

\echo ''
\echo 'Step 3: Deleting orphaned links...'

DELETE FROM trapper.request_cat_links
WHERE link_id IN (SELECT link_id FROM orphaned_links);

\echo 'Deleted orphaned links:'
SELECT COUNT(*) as deleted FROM orphaned_links;

-- ============================================================================
-- Step 4: Create function for ongoing cleanup
-- ============================================================================

\echo ''
\echo 'Step 4: Creating cleanup function for future use...'

CREATE OR REPLACE FUNCTION trapper.cleanup_orphaned_request_cat_links(
  p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  links_found INT,
  links_deleted INT,
  affected_requests INT
) AS $$
DECLARE
  v_found INT;
  v_deleted INT := 0;
  v_requests INT;
BEGIN
  -- Find orphaned MIG_258 backfill links
  CREATE TEMP TABLE IF NOT EXISTS _orphaned_links ON COMMIT DROP AS
  SELECT
    rcl.link_id,
    rcl.request_id,
    rcl.cat_id,
    r.place_id
  FROM trapper.request_cat_links rcl
  JOIN trapper.sot_requests r ON r.request_id = rcl.request_id
  WHERE rcl.linked_by = 'mig_258_backfill'
    AND NOT EXISTS (
      SELECT 1 FROM trapper.cat_place_relationships cpr
      WHERE cpr.cat_id = rcl.cat_id
        AND cpr.place_id = r.place_id
    );

  SELECT COUNT(*), COUNT(DISTINCT request_id)
  INTO v_found, v_requests
  FROM _orphaned_links;

  IF NOT p_dry_run AND v_found > 0 THEN
    -- Log to entity_edits
    INSERT INTO trapper.entity_edits (
      entity_type, entity_id, edit_type, field_name, old_value, reason, edited_by
    )
    SELECT
      'request_cat_links', ol.link_id, 'delete', 'link',
      jsonb_build_object('request_id', ol.request_id, 'cat_id', ol.cat_id),
      'Orphaned link cleanup - cat no longer has place relationship to request location',
      'cleanup_orphaned_request_cat_links'
    FROM _orphaned_links ol;

    -- Delete orphaned links
    DELETE FROM trapper.request_cat_links
    WHERE link_id IN (SELECT link_id FROM _orphaned_links);

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT v_found, v_deleted, v_requests;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.cleanup_orphaned_request_cat_links IS
'Finds and optionally deletes orphaned request_cat_links where the cat
no longer has a cat_place_relationship to the request location.

Usage:
  -- Dry run (see what would be deleted)
  SELECT * FROM trapper.cleanup_orphaned_request_cat_links(TRUE);

  -- Actually delete
  SELECT * FROM trapper.cleanup_orphaned_request_cat_links(FALSE);

Only affects links created by mig_258_backfill. Explicit links are preserved.';

-- ============================================================================
-- Step 5: Also cleanup entity_linking_audit links that are orphaned
-- ============================================================================

\echo ''
\echo 'Step 5: Checking entity_linking_audit links...'

SELECT
  linked_by,
  COUNT(*) as total_links,
  COUNT(*) FILTER (WHERE NOT EXISTS (
    SELECT 1 FROM trapper.cat_place_relationships cpr
    JOIN trapper.sot_requests r ON r.place_id = cpr.place_id AND r.request_id = rcl.request_id
    WHERE cpr.cat_id = rcl.cat_id
  )) as potentially_orphaned
FROM trapper.request_cat_links rcl
GROUP BY linked_by
ORDER BY total_links DESC;

-- ============================================================================
-- Step 6: Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='

\echo ''
\echo 'Request cat link summary after cleanup:'
SELECT
  linked_by,
  link_purpose::text,
  COUNT(*) as count
FROM trapper.request_cat_links
GROUP BY linked_by, link_purpose
ORDER BY count DESC;

\echo ''
\echo 'Top requests by linked cats (should be more reasonable now):'
SELECT
  p.formatted_address,
  r.status,
  r.estimated_cat_count,
  COUNT(rcl.cat_id) as linked_cats
FROM trapper.sot_requests r
JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.request_cat_links rcl ON rcl.request_id = r.request_id
GROUP BY r.request_id, p.formatted_address, r.status, r.estimated_cat_count
HAVING COUNT(rcl.cat_id) > 10
ORDER BY COUNT(rcl.cat_id) DESC
LIMIT 10;

\echo ''
\echo 'Kate Vasey stats after cleanup:'
SELECT
  p.display_name,
  SUM(vas.cats_caught) as cats_from_assignments,
  SUM(vas.cats_altered) as cats_altered_from_assignments
FROM trapper.sot_people p
JOIN trapper.request_trapper_assignments rta ON rta.trapper_person_id = p.person_id
JOIN trapper.v_request_alteration_stats vas ON vas.request_id = rta.request_id
WHERE p.display_name ILIKE '%kate%vasey%'
  AND rta.unassigned_at IS NULL
GROUP BY p.display_name;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=== MIG_602 Complete ==='
\echo ''
\echo 'Actions taken:'
\echo '  1. Identified orphaned request_cat_links (where cat no longer at request location)'
\echo '  2. Logged deletions to entity_edits for audit trail'
\echo '  3. Deleted orphaned links'
\echo '  4. Created cleanup_orphaned_request_cat_links() function for future use'
\echo ''
\echo 'To run periodic cleanup:'
\echo '  SELECT * FROM trapper.cleanup_orphaned_request_cat_links(FALSE);'
\echo ''

DROP TABLE IF EXISTS orphaned_links;
