-- ============================================================================
-- MIG_560: Merge Existing Organization Duplicates
-- ============================================================================
-- Runs merge_organization_duplicates() for all known organizations to clean up
-- existing duplicate person records created before the org-aware Data Engine.
-- ============================================================================

\echo '=== MIG_560: Merge Existing Organization Duplicates ==='

-- Show current state before merge
\echo ''
\echo 'Current organization status (before merge):'
SELECT
  ko.canonical_name,
  ko.short_name,
  ko.canonical_person_id IS NOT NULL AS has_canonical,
  (
    SELECT COUNT(*)
    FROM trapper.sot_people p
    WHERE p.merged_into_person_id IS NULL
      AND (
        LOWER(p.display_name) ILIKE '%' || LOWER(ko.canonical_name) || '%'
        OR (ko.short_name IS NOT NULL AND LOWER(p.display_name) ILIKE '%' || LOWER(ko.short_name) || '%')
      )
  ) AS matching_person_count
FROM trapper.known_organizations ko
WHERE ko.is_active
ORDER BY matching_person_count DESC;

-- ============================================================================
-- Merge duplicates for each known organization
-- ============================================================================

\echo ''
\echo 'Merging duplicates for all known organizations...'

DO $$
DECLARE
  v_org RECORD;
  v_result RECORD;
  v_total_merged INT := 0;
BEGIN
  FOR v_org IN
    SELECT org_id, canonical_name
    FROM trapper.known_organizations
    WHERE is_active
    ORDER BY match_priority, canonical_name
  LOOP
    -- Run merge for this org
    FOR v_result IN
      SELECT * FROM trapper.merge_organization_duplicates(v_org.canonical_name, FALSE)
    LOOP
      IF v_result.action = 'merged' THEN
        v_total_merged := v_total_merged + COALESCE((v_result.details->>'merged_count')::INT, 0);
        RAISE NOTICE 'Merged % duplicates for: %',
          v_result.details->>'merged_count',
          v_org.canonical_name;
      ELSIF v_result.action = 'info' THEN
        RAISE NOTICE 'No duplicates for: %', v_org.canonical_name;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE 'Total records merged: %', v_total_merged;
END;
$$;

-- ============================================================================
-- Verify results
-- ============================================================================

\echo ''
\echo 'Organization status after merge:'
SELECT
  ko.canonical_name,
  ko.short_name,
  ko.canonical_person_id IS NOT NULL AS has_canonical,
  p.display_name AS canonical_person_name,
  p.person_type,
  -- Check remaining matches
  (
    SELECT COUNT(*)
    FROM trapper.sot_people sp
    WHERE sp.merged_into_person_id IS NULL
      AND (
        LOWER(sp.display_name) ILIKE '%' || LOWER(ko.canonical_name) || '%'
        OR (ko.short_name IS NOT NULL AND LOWER(sp.display_name) ILIKE '%' || LOWER(ko.short_name) || '%')
      )
  ) AS remaining_matches
FROM trapper.known_organizations ko
LEFT JOIN trapper.sot_people p ON p.person_id = ko.canonical_person_id
WHERE ko.is_active
ORDER BY remaining_matches DESC, ko.canonical_name;

-- Show merged records count
\echo ''
\echo 'Merged person records:'
SELECT
  p.display_name,
  p.merged_into_person_id,
  mp.display_name AS merged_into_name,
  p.source_system
FROM trapper.sot_people p
JOIN trapper.sot_people mp ON mp.person_id = p.merged_into_person_id
WHERE p.merged_into_person_id IS NOT NULL
  AND mp.person_type = 'organization'
ORDER BY p.merged_into_person_id, p.created_at;

\echo ''
\echo '=== MIG_560 Complete ==='
\echo 'All known organization duplicates have been merged into canonical records.'
\echo 'Future imports will automatically link to these canonical records via the Data Engine.'
