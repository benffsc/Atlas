\echo '=== MIG_364: Identity Resolution Health Checks ==='
\echo 'Creates monitoring views for ongoing identity resolution health'
\echo ''

-- ============================================================================
-- STEP 1: Main health dashboard view
-- ============================================================================

\echo 'Step 1: Creating identity resolution health view...'

DROP VIEW IF EXISTS trapper.v_identity_resolution_health;

CREATE VIEW trapper.v_identity_resolution_health AS
SELECT
    -- Overall stats
    (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL) as total_active_people,
    (SELECT COUNT(DISTINCT display_name) FROM trapper.sot_people WHERE merged_into_person_id IS NULL) as unique_names,
    ROUND(
        (SELECT COUNT(*)::numeric FROM trapper.sot_people WHERE merged_into_person_id IS NULL) /
        NULLIF((SELECT COUNT(DISTINCT display_name) FROM trapper.sot_people WHERE merged_into_person_id IS NULL), 0),
    2) as duplication_ratio,

    -- Problem indicators
    (SELECT COUNT(*) FROM trapper.sot_people p
     LEFT JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
     WHERE pi.person_id IS NULL AND p.merged_into_person_id IS NULL) as people_without_identifiers,
    (SELECT COUNT(*) FROM trapper.sot_people WHERE display_name ~ '^(.+) \1$' AND merged_into_person_id IS NULL) as doubled_names,
    (SELECT COUNT(*) FROM trapper.v_duplicate_merge_candidates) as pending_merge_candidates,

    -- Entity types
    (SELECT COUNT(*) FROM trapper.sot_people WHERE entity_type = 'person' AND merged_into_person_id IS NULL) as person_count,
    (SELECT COUNT(*) FROM trapper.sot_people WHERE entity_type = 'organization' AND merged_into_person_id IS NULL) as organization_count,

    -- 24h activity
    (SELECT COUNT(*) FROM trapper.data_engine_match_decisions
     WHERE decision_type = 'auto_match' AND processed_at > NOW() - INTERVAL '24 hours') as auto_matches_24h,
    (SELECT COUNT(*) FROM trapper.data_engine_match_decisions
     WHERE decision_type = 'new_entity' AND processed_at > NOW() - INTERVAL '24 hours') as new_entities_24h,
    (SELECT COUNT(*) FROM trapper.data_engine_match_decisions
     WHERE decision_type = 'review_pending' AND processed_at > NOW() - INTERVAL '24 hours') as reviews_pending_24h,

    -- Auto-match rate
    ROUND(
        (SELECT COUNT(*)::numeric FROM trapper.data_engine_match_decisions
         WHERE decision_type = 'auto_match' AND processed_at > NOW() - INTERVAL '24 hours') /
        NULLIF((SELECT COUNT(*) FROM trapper.data_engine_match_decisions
         WHERE processed_at > NOW() - INTERVAL '24 hours'), 0) * 100,
    1) as auto_match_rate_24h_pct,

    -- Timestamp
    NOW() as checked_at;

COMMENT ON VIEW trapper.v_identity_resolution_health IS
'Dashboard view for monitoring identity resolution health.
Key metrics:
- duplication_ratio: Should be close to 1.0 (was 3.0 before fix)
- people_without_identifiers: Should be < 1000 (was 14,931 before fix)
- doubled_names: Should be 0 (was 1,289 before fix)
- auto_match_rate_24h_pct: Should be 30-50% (was 1% before fix)';

\echo 'Created v_identity_resolution_health view'

-- ============================================================================
-- STEP 2: Decision breakdown view
-- ============================================================================

\echo ''
\echo 'Step 2: Creating decision breakdown view...'

DROP VIEW IF EXISTS trapper.v_identity_decision_breakdown;

CREATE VIEW trapper.v_identity_decision_breakdown AS
SELECT
    source_system,
    decision_type,
    COUNT(*) as total_decisions,
    COUNT(*) FILTER (WHERE processed_at > NOW() - INTERVAL '24 hours') as last_24h,
    COUNT(*) FILTER (WHERE processed_at > NOW() - INTERVAL '7 days') as last_7d,
    ROUND(AVG(processing_duration_ms), 0) as avg_duration_ms
FROM trapper.data_engine_match_decisions
GROUP BY source_system, decision_type
ORDER BY source_system, total_decisions DESC;

COMMENT ON VIEW trapper.v_identity_decision_breakdown IS
'Breakdown of identity resolution decisions by source and type.
Use to monitor auto_match vs new_entity rates over time.';

\echo 'Created v_identity_decision_breakdown view'

-- ============================================================================
-- STEP 3: People needing attention view
-- ============================================================================

\echo ''
\echo 'Step 3: Creating people needing attention view...'

DROP VIEW IF EXISTS trapper.v_people_needing_attention;

CREATE VIEW trapper.v_people_needing_attention AS
SELECT
    p.person_id,
    p.display_name,
    p.primary_email,
    p.primary_phone,
    p.data_source,
    p.entity_type,
    p.created_at,
    CASE
        WHEN NOT EXISTS (SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id)
        THEN 'no_identifiers'
        WHEN p.display_name ~ '^(.+) \1$'
        THEN 'doubled_name'
        WHEN trapper.is_business_name(p.display_name) AND p.entity_type = 'person'
        THEN 'untagged_business'
        WHEN EXISTS (
            SELECT 1 FROM trapper.v_duplicate_merge_candidates mc
            WHERE mc.duplicate_person_id = p.person_id OR mc.canonical_person_id = p.person_id
        )
        THEN 'has_duplicates'
        ELSE 'ok'
    END as issue_type,
    (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.person_id = p.person_id) as appointment_count
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND (
    -- No identifiers
    NOT EXISTS (SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id)
    -- Doubled name
    OR p.display_name ~ '^(.+) \1$'
    -- Untagged business
    OR (trapper.is_business_name(p.display_name) AND p.entity_type = 'person')
    -- Has duplicates
    OR EXISTS (
        SELECT 1 FROM trapper.v_duplicate_merge_candidates mc
        WHERE mc.duplicate_person_id = p.person_id OR mc.canonical_person_id = p.person_id
    )
  )
ORDER BY appointment_count DESC, created_at DESC;

COMMENT ON VIEW trapper.v_people_needing_attention IS
'Shows people with data quality issues that need attention:
- no_identifiers: No searchable email/phone
- doubled_name: Name like "X X"
- untagged_business: Looks like org but marked as person
- has_duplicates: Involved in potential duplicate set';

\echo 'Created v_people_needing_attention view'

-- ============================================================================
-- STEP 4: Health check function
-- ============================================================================

\echo ''
\echo 'Step 4: Creating health check function...'

CREATE OR REPLACE FUNCTION trapper.check_identity_health()
RETURNS JSONB AS $$
DECLARE
    v_health RECORD;
    v_status TEXT := 'healthy';
    v_issues JSONB := '[]'::JSONB;
BEGIN
    SELECT * INTO v_health FROM trapper.v_identity_resolution_health;

    -- Check duplication ratio
    IF v_health.duplication_ratio > 1.5 THEN
        v_status := 'warning';
        v_issues := v_issues || jsonb_build_object(
            'issue', 'high_duplication',
            'value', v_health.duplication_ratio,
            'threshold', 1.5
        );
    END IF;

    -- Check people without identifiers
    IF v_health.people_without_identifiers > 1000 THEN
        v_status := 'critical';
        v_issues := v_issues || jsonb_build_object(
            'issue', 'many_without_identifiers',
            'value', v_health.people_without_identifiers,
            'threshold', 1000
        );
    END IF;

    -- Check doubled names
    IF v_health.doubled_names > 0 THEN
        v_status := CASE WHEN v_status = 'critical' THEN 'critical' ELSE 'warning' END;
        v_issues := v_issues || jsonb_build_object(
            'issue', 'doubled_names_exist',
            'value', v_health.doubled_names,
            'threshold', 0
        );
    END IF;

    -- Check auto-match rate
    IF v_health.auto_match_rate_24h_pct IS NOT NULL AND v_health.auto_match_rate_24h_pct < 20 THEN
        v_status := CASE WHEN v_status = 'critical' THEN 'critical' ELSE 'warning' END;
        v_issues := v_issues || jsonb_build_object(
            'issue', 'low_auto_match_rate',
            'value', v_health.auto_match_rate_24h_pct,
            'threshold', 20
        );
    END IF;

    RETURN jsonb_build_object(
        'status', v_status,
        'checked_at', NOW(),
        'metrics', row_to_json(v_health),
        'issues', v_issues
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.check_identity_health IS
'Returns a health check JSON object with status (healthy/warning/critical)
and any detected issues.';

\echo 'Created check_identity_health function'

-- ============================================================================
-- RUN INITIAL HEALTH CHECK
-- ============================================================================

\echo ''
\echo '=== Current Identity Health ==='
SELECT * FROM trapper.v_identity_resolution_health;

\echo ''
SELECT trapper.check_identity_health();

\echo ''
\echo '=== MIG_364 Complete ==='
\echo 'Created monitoring infrastructure:'
\echo '  1. v_identity_resolution_health - main dashboard view'
\echo '  2. v_identity_decision_breakdown - by source/type breakdown'
\echo '  3. v_people_needing_attention - records with issues'
\echo '  4. check_identity_health() - health check function'
\echo ''
