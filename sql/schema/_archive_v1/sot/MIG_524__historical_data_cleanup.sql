\echo ''
\echo '=============================================='
\echo 'MIG_524: Historical Data Cleanup'
\echo '=============================================='
\echo ''
\echo 'Cleans up invalid person records created before validation:'
\echo '  1. Marks invalid names as non-canonical (with audit trail)'
\echo '  2. Creates v_invalid_people_report view for monitoring'
\echo '  3. Logs all changes to entity_edits'
\echo ''

-- ============================================================================
-- STEP 1: SNAPSHOT CURRENT STATE (for verification)
-- ============================================================================

\echo 'Creating temporary snapshot of current state...'

CREATE TEMP TABLE _pre_cleanup_stats AS
SELECT
    COUNT(*) AS total_people,
    COUNT(*) FILTER (WHERE is_canonical = TRUE) AS canonical_count,
    COUNT(*) FILTER (WHERE is_canonical = FALSE) AS non_canonical_count,
    COUNT(*) FILTER (
        WHERE merged_into_person_id IS NULL
        AND is_canonical = TRUE
        AND (
            trapper.is_organization_name(display_name) OR
            trapper.is_garbage_name(display_name) OR
            trapper.is_internal_account(display_name)
        )
    ) AS invalid_but_canonical
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL;

SELECT * FROM _pre_cleanup_stats;

-- ============================================================================
-- STEP 2: CREATE REPORTING VIEW (before cleanup, so we can see what will change)
-- ============================================================================

\echo 'Creating v_invalid_people_report view...'

CREATE OR REPLACE VIEW trapper.v_invalid_people_report AS
SELECT
    p.person_id,
    p.display_name,
    p.data_source,
    p.created_at,
    p.is_canonical,
    p.data_quality,
    CASE
        WHEN trapper.is_organization_name(p.display_name) THEN 'Organization'
        WHEN trapper.is_garbage_name(p.display_name) THEN 'Garbage/Placeholder'
        WHEN trapper.is_internal_account(p.display_name) THEN 'Internal Account'
        WHEN EXISTS (
            SELECT 1 FROM trapper.data_fixing_patterns dfp
            WHERE (dfp.is_organization = TRUE OR dfp.is_garbage = TRUE)
              AND dfp.pattern_type = 'name'
              AND (
                  (dfp.pattern_value IS NOT NULL AND LOWER(p.display_name) = LOWER(dfp.pattern_value)) OR
                  (dfp.pattern_ilike IS NOT NULL AND p.display_name ILIKE dfp.pattern_ilike) OR
                  (dfp.pattern_regex IS NOT NULL AND p.display_name ~* dfp.pattern_regex)
              )
        ) THEN 'Bad Pattern Match'
        ELSE 'Other Invalid'
    END AS invalid_reason,
    (SELECT COUNT(*) FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id) AS identifier_count,
    (
        SELECT COUNT(*)
        FROM trapper.cat_place_relationships cpr
        JOIN trapper.person_place_relationships ppr ON ppr.place_id = cpr.place_id
        WHERE ppr.person_id = p.person_id
    ) AS linked_cats,
    (
        SELECT COUNT(*)
        FROM trapper.sot_appointments sa
        WHERE sa.person_id = p.person_id
    ) AS appointment_count
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND (
      trapper.is_organization_name(p.display_name) OR
      trapper.is_garbage_name(p.display_name) OR
      trapper.is_internal_account(p.display_name) OR
      EXISTS (
          SELECT 1 FROM trapper.data_fixing_patterns dfp
          WHERE (dfp.is_organization = TRUE OR dfp.is_garbage = TRUE)
            AND dfp.pattern_type = 'name'
            AND (
                (dfp.pattern_value IS NOT NULL AND LOWER(p.display_name) = LOWER(dfp.pattern_value)) OR
                (dfp.pattern_ilike IS NOT NULL AND p.display_name ILIKE dfp.pattern_ilike) OR
                (dfp.pattern_regex IS NOT NULL AND p.display_name ~* dfp.pattern_regex)
            )
      )
  )
ORDER BY p.created_at DESC;

COMMENT ON VIEW trapper.v_invalid_people_report IS
'Shows all people records with invalid names (organizations, garbage, internal accounts, bad patterns).
Useful for monitoring data quality and identifying records that need cleanup.';

\echo 'View created.'

-- ============================================================================
-- STEP 3: LOG CLEANUP ACTIONS TO entity_edits (BEFORE updating)
-- ============================================================================

\echo 'Logging cleanup actions to entity_edits...'

INSERT INTO trapper.entity_edits (
    entity_type,
    entity_id,
    edit_type,
    field_name,
    old_value,
    new_value,
    edit_source,
    edited_by,
    notes
)
SELECT
    'person',
    p.person_id,
    'data_quality_cleanup',
    'is_canonical',
    '"true"'::jsonb,
    '"false"'::jsonb,
    'MIG_524_cleanup',
    'system',
    'Marked non-canonical: ' ||
        CASE
            WHEN trapper.is_organization_name(p.display_name) THEN 'organization name'
            WHEN trapper.is_garbage_name(p.display_name) THEN 'garbage/placeholder name'
            WHEN trapper.is_internal_account(p.display_name) THEN 'internal account'
            ELSE 'bad pattern match'
        END || ' (' || p.display_name || ')'
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND p.is_canonical = TRUE
  AND (
      trapper.is_organization_name(p.display_name) OR
      trapper.is_garbage_name(p.display_name) OR
      trapper.is_internal_account(p.display_name) OR
      EXISTS (
          SELECT 1 FROM trapper.data_fixing_patterns dfp
          WHERE (dfp.is_organization = TRUE OR dfp.is_garbage = TRUE)
            AND dfp.pattern_type = 'name'
            AND (
                (dfp.pattern_value IS NOT NULL AND LOWER(p.display_name) = LOWER(dfp.pattern_value)) OR
                (dfp.pattern_ilike IS NOT NULL AND p.display_name ILIKE dfp.pattern_ilike) OR
                (dfp.pattern_regex IS NOT NULL AND p.display_name ~* dfp.pattern_regex)
            )
      )
  );

\echo 'Audit trail created.'

-- ============================================================================
-- STEP 4: MARK INVALID NAMES AS NON-CANONICAL
-- ============================================================================

\echo 'Marking invalid names as non-canonical...'

UPDATE trapper.sot_people p
SET
    is_canonical = FALSE,
    data_quality = 'garbage',
    updated_at = NOW()
WHERE p.merged_into_person_id IS NULL
  AND p.is_canonical = TRUE
  AND (
      trapper.is_organization_name(p.display_name) OR
      trapper.is_garbage_name(p.display_name) OR
      trapper.is_internal_account(p.display_name) OR
      EXISTS (
          SELECT 1 FROM trapper.data_fixing_patterns dfp
          WHERE (dfp.is_organization = TRUE OR dfp.is_garbage = TRUE)
            AND dfp.pattern_type = 'name'
            AND (
                (dfp.pattern_value IS NOT NULL AND LOWER(p.display_name) = LOWER(dfp.pattern_value)) OR
                (dfp.pattern_ilike IS NOT NULL AND p.display_name ILIKE dfp.pattern_ilike) OR
                (dfp.pattern_regex IS NOT NULL AND p.display_name ~* dfp.pattern_regex)
            )
      )
  );

\echo 'Invalid names marked as non-canonical.'

-- ============================================================================
-- STEP 5: CREATE MONITORING VIEW FOR RECENT INVALID CREATIONS
-- ============================================================================

\echo 'Creating v_recent_invalid_people view for monitoring...'

CREATE OR REPLACE VIEW trapper.v_recent_invalid_people AS
SELECT * FROM trapper.v_invalid_people_report
WHERE created_at > NOW() - INTERVAL '24 hours';

COMMENT ON VIEW trapper.v_recent_invalid_people IS
'Shows invalid people records created in the last 24 hours.
Use this to monitor for validation bypass or new bad patterns.';

-- ============================================================================
-- STEP 6: CREATE DATA QUALITY DASHBOARD VIEW
-- ============================================================================

\echo 'Creating v_people_data_quality_stats view...'

CREATE OR REPLACE VIEW trapper.v_people_data_quality_stats AS
SELECT
    COUNT(*) AS total_people,
    COUNT(*) FILTER (WHERE merged_into_person_id IS NULL) AS active_people,
    COUNT(*) FILTER (WHERE merged_into_person_id IS NULL AND is_canonical = TRUE) AS canonical_count,
    COUNT(*) FILTER (WHERE merged_into_person_id IS NULL AND is_canonical = FALSE) AS non_canonical_count,
    COUNT(*) FILTER (
        WHERE merged_into_person_id IS NULL
        AND is_canonical = TRUE
        AND (
            trapper.is_organization_name(display_name) OR
            trapper.is_garbage_name(display_name) OR
            trapper.is_internal_account(display_name)
        )
    ) AS invalid_but_canonical,
    COUNT(*) FILTER (
        WHERE merged_into_person_id IS NULL
        AND created_at > NOW() - INTERVAL '7 days'
    ) AS created_last_7_days,
    COUNT(*) FILTER (
        WHERE merged_into_person_id IS NULL
        AND is_canonical = FALSE
        AND created_at > NOW() - INTERVAL '7 days'
    ) AS rejected_last_7_days,
    ROUND(
        COUNT(*) FILTER (WHERE merged_into_person_id IS NULL AND is_canonical = TRUE)::NUMERIC /
        NULLIF(COUNT(*) FILTER (WHERE merged_into_person_id IS NULL), 0) * 100,
        2
    ) AS canonical_rate_pct
FROM trapper.sot_people;

COMMENT ON VIEW trapper.v_people_data_quality_stats IS
'Quick stats on people data quality. Used by monitoring dashboards.
Key metric: invalid_but_canonical should be 0 after cleanup.';

-- ============================================================================
-- STEP 7: VERIFY CLEANUP
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'Cleanup Verification'
\echo '=============================================='

\echo ''
\echo 'Before cleanup:'
SELECT * FROM _pre_cleanup_stats;

\echo ''
\echo 'After cleanup:'
SELECT * FROM trapper.v_people_data_quality_stats;

\echo ''
\echo 'Changes made (entity_edits):'
SELECT COUNT(*) AS cleanup_edits
FROM trapper.entity_edits
WHERE edit_source = 'MIG_524_cleanup';

\echo ''
\echo 'Sample of cleaned records:'
SELECT
    display_name,
    invalid_reason,
    is_canonical,
    created_at
FROM trapper.v_invalid_people_report
LIMIT 10;

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_524 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Created v_invalid_people_report view'
\echo '  2. Logged all cleanup actions to entity_edits'
\echo '  3. Marked invalid names as non-canonical'
\echo '  4. Created v_recent_invalid_people monitoring view'
\echo '  5. Created v_people_data_quality_stats dashboard view'
\echo ''
\echo 'Key verification:'
\echo '  - invalid_but_canonical in v_people_data_quality_stats should be 0'
\echo '  - All changes logged in entity_edits with source MIG_524_cleanup'
\echo ''
\echo 'Ongoing monitoring:'
\echo '  - Check v_recent_invalid_people daily for validation bypass'
\echo '  - Dashboard should show canonical_rate_pct increasing over time'
\echo ''
