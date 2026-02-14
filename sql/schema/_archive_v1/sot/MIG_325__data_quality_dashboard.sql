\echo '=== MIG_325: Data Quality Dashboard Views ==='
\echo 'Creates comprehensive monitoring views for data quality'
\echo ''

-- ============================================================================
-- COMPREHENSIVE DATA QUALITY DASHBOARD VIEW
-- Single view for all key metrics
-- ============================================================================

\echo 'Step 1: Creating main data quality dashboard view...'

CREATE OR REPLACE VIEW trapper.v_data_quality_dashboard AS
SELECT
    -- ==========================================
    -- CAT-PLACE COVERAGE (CRITICAL FOR BEACON)
    -- ==========================================
    (SELECT COUNT(*) FROM trapper.sot_cats WHERE merged_into_cat_id IS NULL) as total_cats,

    (SELECT COUNT(DISTINCT cpr.cat_id)
     FROM trapper.cat_place_relationships cpr
     JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
     WHERE c.merged_into_cat_id IS NULL) as cats_with_places,

    ROUND(100.0 *
        (SELECT COUNT(DISTINCT cpr.cat_id)
         FROM trapper.cat_place_relationships cpr
         JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
         WHERE c.merged_into_cat_id IS NULL) /
        NULLIF((SELECT COUNT(*) FROM trapper.sot_cats WHERE merged_into_cat_id IS NULL), 0), 1
    ) as cat_place_coverage_pct,

    -- ==========================================
    -- PEOPLE QUALITY
    -- ==========================================
    (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL) as total_people,

    (SELECT COUNT(*) FROM trapper.sot_people
     WHERE merged_into_person_id IS NULL
     AND trapper.is_valid_person_name(display_name)) as valid_people,

    (SELECT COUNT(*) FROM trapper.sot_people
     WHERE merged_into_person_id IS NULL
     AND NOT trapper.is_valid_person_name(display_name)) as invalid_people,

    (SELECT COUNT(*) FROM trapper.sot_people
     WHERE merged_into_person_id IS NULL
     AND trapper.is_organization_name(display_name)) as orgs_as_people,

    (SELECT COUNT(*) FROM trapper.sot_people
     WHERE merged_into_person_id IS NULL
     AND data_quality = 'garbage') as garbage_people,

    (SELECT COUNT(*) FROM trapper.sot_people
     WHERE merged_into_person_id IS NULL
     AND is_canonical = FALSE) as non_canonical_people,

    -- ==========================================
    -- EXTERNAL ORGANIZATIONS
    -- ==========================================
    (SELECT COUNT(*) FROM trapper.external_organizations WHERE merged_into_org_id IS NULL) as total_external_organizations,

    (SELECT COUNT(*) FROM trapper.v_people_needing_org_conversion) as people_needing_org_conversion,

    -- ==========================================
    -- DATA ENGINE HEALTH
    -- ==========================================
    (SELECT COUNT(*) FROM trapper.data_engine_match_decisions) as total_de_decisions,

    (SELECT COUNT(*) FROM trapper.data_engine_match_decisions
     WHERE processed_at > NOW() - INTERVAL '24 hours') as de_decisions_24h,

    (SELECT COUNT(*) FROM trapper.data_engine_match_decisions
     WHERE review_status = 'pending') as pending_reviews,

    (SELECT COUNT(*) FROM trapper.data_engine_match_decisions
     WHERE decision_type = 'auto_match') as auto_matches,

    (SELECT COUNT(*) FROM trapper.data_engine_match_decisions
     WHERE decision_type = 'new_entity') as new_entities,

    -- ==========================================
    -- HOUSEHOLD COVERAGE
    -- ==========================================
    (SELECT COUNT(*) FROM trapper.households) as total_households,

    (SELECT COUNT(DISTINCT hm.person_id)
     FROM trapper.household_members hm
     WHERE hm.valid_to IS NULL) as people_in_households,

    ROUND(100.0 *
        (SELECT COUNT(DISTINCT hm.person_id) FROM trapper.household_members hm WHERE hm.valid_to IS NULL) /
        NULLIF((SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL), 0), 1
    ) as household_coverage_pct,

    -- ==========================================
    -- GEOCODING STATUS
    -- ==========================================
    (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL) as total_places,

    (SELECT COUNT(*) FROM trapper.places
     WHERE merged_into_place_id IS NULL AND latitude IS NOT NULL) as geocoded_places,

    (SELECT COUNT(*) FROM trapper.places
     WHERE merged_into_place_id IS NULL AND latitude IS NULL) as geocoding_queue,

    ROUND(100.0 *
        (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL AND latitude IS NOT NULL) /
        NULLIF((SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL), 0), 1
    ) as geocoding_coverage_pct,

    -- ==========================================
    -- APPOINTMENT LINKING
    -- ==========================================
    (SELECT COUNT(*) FROM trapper.sot_appointments) as total_appointments,

    (SELECT COUNT(*) FROM trapper.sot_appointments WHERE person_id IS NOT NULL) as appointments_with_person,

    (SELECT COUNT(*) FROM trapper.sot_appointments WHERE trapper_person_id IS NOT NULL) as appointments_with_trapper,

    ROUND(100.0 *
        (SELECT COUNT(*) FROM trapper.sot_appointments WHERE person_id IS NOT NULL) /
        NULLIF((SELECT COUNT(*) FROM trapper.sot_appointments), 0), 1
    ) as appointment_person_pct,

    -- ==========================================
    -- IDENTITY COVERAGE
    -- ==========================================
    (SELECT COUNT(DISTINCT person_id) FROM trapper.person_identifiers) as people_with_identifiers,

    ROUND(100.0 *
        (SELECT COUNT(DISTINCT person_id) FROM trapper.person_identifiers) /
        NULLIF((SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL), 0), 1
    ) as identity_coverage_pct,

    -- ==========================================
    -- RECENT ACTIVITY (24h)
    -- ==========================================
    (SELECT COUNT(*) FROM trapper.sot_people
     WHERE created_at > NOW() - INTERVAL '24 hours') as people_created_24h,

    (SELECT COUNT(*) FROM trapper.sot_people
     WHERE created_at > NOW() - INTERVAL '24 hours'
     AND NOT trapper.is_valid_person_name(display_name)) as invalid_people_created_24h,

    (SELECT COUNT(*) FROM trapper.sot_cats
     WHERE created_at > NOW() - INTERVAL '24 hours') as cats_created_24h,

    (SELECT COUNT(*) FROM trapper.staged_records
     WHERE staged_at > NOW() - INTERVAL '24 hours') as records_staged_24h,

    -- ==========================================
    -- SOFT BLACKLIST
    -- ==========================================
    (SELECT COUNT(*) FROM trapper.data_engine_soft_blacklist) as soft_blacklist_count,

    -- ==========================================
    -- TIMESTAMP
    -- ==========================================
    NOW() as checked_at;

COMMENT ON VIEW trapper.v_data_quality_dashboard IS
'Comprehensive data quality dashboard with all key metrics for monitoring.
Critical for Beacon analytics: cat_place_coverage_pct should be 95%+.';

-- ============================================================================
-- DATA QUALITY TRENDS VIEW
-- For tracking improvement over time
-- ============================================================================

\echo ''
\echo 'Step 2: Creating data quality trends table...'

CREATE TABLE IF NOT EXISTS trapper.data_quality_snapshots (
    snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_time TIMESTAMPTZ DEFAULT NOW(),

    -- Key metrics
    total_cats INT,
    cats_with_places INT,
    cat_place_coverage_pct NUMERIC(5,2),

    total_people INT,
    valid_people INT,
    invalid_people INT,
    orgs_as_people INT,

    total_de_decisions INT,
    pending_reviews INT,

    total_households INT,
    people_in_households INT,
    household_coverage_pct NUMERIC(5,2),

    total_places INT,
    geocoded_places INT,
    geocoding_queue INT,

    -- Additional context
    snapshot_source TEXT DEFAULT 'cron'
);

CREATE INDEX IF NOT EXISTS idx_quality_snapshots_time
ON trapper.data_quality_snapshots(snapshot_time DESC);

COMMENT ON TABLE trapper.data_quality_snapshots IS
'Historical snapshots of data quality metrics for trend analysis.';

-- ============================================================================
-- FUNCTION: Take a quality snapshot
-- ============================================================================

\echo ''
\echo 'Step 3: Creating snapshot function...'

CREATE OR REPLACE FUNCTION trapper.take_quality_snapshot(
    p_source TEXT DEFAULT 'manual'
)
RETURNS UUID AS $$
DECLARE
    v_snapshot_id UUID;
    v_dashboard RECORD;
BEGIN
    SELECT * INTO v_dashboard FROM trapper.v_data_quality_dashboard;

    INSERT INTO trapper.data_quality_snapshots (
        total_cats, cats_with_places, cat_place_coverage_pct,
        total_people, valid_people, invalid_people, orgs_as_people,
        total_de_decisions, pending_reviews,
        total_households, people_in_households, household_coverage_pct,
        total_places, geocoded_places, geocoding_queue,
        snapshot_source
    ) VALUES (
        v_dashboard.total_cats, v_dashboard.cats_with_places, v_dashboard.cat_place_coverage_pct,
        v_dashboard.total_people, v_dashboard.valid_people, v_dashboard.invalid_people, v_dashboard.orgs_as_people,
        v_dashboard.total_de_decisions, v_dashboard.pending_reviews,
        v_dashboard.total_households, v_dashboard.people_in_households, v_dashboard.household_coverage_pct,
        v_dashboard.total_places, v_dashboard.geocoded_places, v_dashboard.geocoding_queue,
        p_source
    ) RETURNING snapshot_id INTO v_snapshot_id;

    RETURN v_snapshot_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.take_quality_snapshot IS
'Takes a snapshot of current data quality metrics for trend tracking.';

-- ============================================================================
-- QUALITY TREND VIEW
-- Shows week-over-week changes
-- ============================================================================

\echo ''
\echo 'Step 4: Creating quality trends view...'

CREATE OR REPLACE VIEW trapper.v_data_quality_trends AS
WITH latest AS (
    SELECT * FROM trapper.data_quality_snapshots
    ORDER BY snapshot_time DESC LIMIT 1
),
week_ago AS (
    SELECT * FROM trapper.data_quality_snapshots
    WHERE snapshot_time <= NOW() - INTERVAL '7 days'
    ORDER BY snapshot_time DESC LIMIT 1
),
month_ago AS (
    SELECT * FROM trapper.data_quality_snapshots
    WHERE snapshot_time <= NOW() - INTERVAL '30 days'
    ORDER BY snapshot_time DESC LIMIT 1
)
SELECT
    -- Current values
    l.cat_place_coverage_pct as current_cat_coverage,
    l.invalid_people as current_invalid_people,
    l.pending_reviews as current_pending_reviews,
    l.household_coverage_pct as current_household_coverage,
    l.geocoding_queue as current_geocoding_queue,

    -- Week-over-week change
    l.cat_place_coverage_pct - COALESCE(w.cat_place_coverage_pct, l.cat_place_coverage_pct) as cat_coverage_wow,
    l.invalid_people - COALESCE(w.invalid_people, l.invalid_people) as invalid_people_wow,
    l.pending_reviews - COALESCE(w.pending_reviews, l.pending_reviews) as pending_reviews_wow,
    l.household_coverage_pct - COALESCE(w.household_coverage_pct, l.household_coverage_pct) as household_wow,

    -- Month-over-month change
    l.cat_place_coverage_pct - COALESCE(m.cat_place_coverage_pct, l.cat_place_coverage_pct) as cat_coverage_mom,
    l.invalid_people - COALESCE(m.invalid_people, l.invalid_people) as invalid_people_mom,

    -- Timestamps
    l.snapshot_time as latest_snapshot,
    w.snapshot_time as week_ago_snapshot,
    m.snapshot_time as month_ago_snapshot
FROM latest l
LEFT JOIN week_ago w ON TRUE
LEFT JOIN month_ago m ON TRUE;

COMMENT ON VIEW trapper.v_data_quality_trends IS
'Shows week-over-week and month-over-month changes in key quality metrics.';

-- ============================================================================
-- PROBLEM AREAS VIEW
-- Identifies specific issues needing attention
-- ============================================================================

\echo ''
\echo 'Step 5: Creating problem areas view...'

CREATE OR REPLACE VIEW trapper.v_data_quality_problems AS
-- Cats without places
SELECT
    'cats_without_places' as problem_type,
    'critical' as severity,
    COUNT(*)::TEXT as count,
    'Cats missing place links - needed for Beacon analytics' as description
FROM trapper.sot_cats c
WHERE c.merged_into_cat_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.cat_id = c.cat_id
  )
HAVING COUNT(*) > 0

UNION ALL

-- Invalid people still active
SELECT
    'invalid_people_active' as problem_type,
    'warning' as severity,
    COUNT(*)::TEXT as count,
    'People with garbage names still marked canonical' as description
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND p.is_canonical = TRUE
  AND NOT trapper.is_valid_person_name(p.display_name)
HAVING COUNT(*) > 0

UNION ALL

-- Organizations as people
SELECT
    'orgs_as_people' as problem_type,
    'warning' as severity,
    COUNT(*)::TEXT as count,
    'Organizations stored in people table need conversion' as description
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND trapper.is_organization_name(p.display_name)
HAVING COUNT(*) > 0

UNION ALL

-- Pending reviews backlog
SELECT
    'pending_reviews_backlog' as problem_type,
    CASE WHEN COUNT(*) > 500 THEN 'critical' ELSE 'warning' END as severity,
    COUNT(*)::TEXT as count,
    'Identity matches pending human review' as description
FROM trapper.data_engine_match_decisions
WHERE review_status = 'pending'
HAVING COUNT(*) > 100

UNION ALL

-- Geocoding backlog
SELECT
    'geocoding_backlog' as problem_type,
    CASE WHEN COUNT(*) > 500 THEN 'critical' ELSE 'warning' END as severity,
    COUNT(*)::TEXT as count,
    'Places waiting for geocoding' as description
FROM trapper.places
WHERE merged_into_place_id IS NULL AND latitude IS NULL
HAVING COUNT(*) > 100

UNION ALL

-- Recent invalid people creation
SELECT
    'invalid_people_24h' as problem_type,
    'warning' as severity,
    COUNT(*)::TEXT as count,
    'Invalid people created in last 24 hours - check ingestion' as description
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
  AND created_at > NOW() - INTERVAL '24 hours'
  AND NOT trapper.is_valid_person_name(display_name)
HAVING COUNT(*) > 10

ORDER BY
    CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
    count::INT DESC;

COMMENT ON VIEW trapper.v_data_quality_problems IS
'Identifies specific data quality issues needing attention, ordered by severity.';

-- ============================================================================
-- TAKE INITIAL SNAPSHOT
-- ============================================================================

\echo ''
\echo 'Step 6: Taking initial quality snapshot...'

SELECT trapper.take_quality_snapshot('mig325_initial');

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=== Current Data Quality Status ==='

SELECT * FROM trapper.v_data_quality_dashboard;

\echo ''
\echo 'Current Problems:'
SELECT * FROM trapper.v_data_quality_problems;

\echo ''
\echo '=== MIG_325 Complete ==='
\echo 'Created views:'
\echo '  - v_data_quality_dashboard (comprehensive metrics)'
\echo '  - v_data_quality_trends (week/month changes)'
\echo '  - v_data_quality_problems (issues needing attention)'
\echo ''
\echo 'Created functions:'
\echo '  - take_quality_snapshot() (for trend tracking)'
\echo ''
\echo 'Usage:'
\echo '  SELECT * FROM trapper.v_data_quality_dashboard;'
\echo '  SELECT * FROM trapper.v_data_quality_problems;'
\echo '  SELECT trapper.take_quality_snapshot(''cron'');'
\echo ''
