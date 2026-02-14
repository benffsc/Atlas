-- ============================================================================
-- MIG_601: Fix Trapper Alteration Stats to Use Assignment Data
-- ============================================================================
--
-- Problem: v_trapper_full_stats shows total_altered only from direct
-- appointment bookings, ignoring cats_altered_from_assignments.
-- This causes trappers like Kate Vasey to show 240 caught but 9 altered.
--
-- Root Cause: The assignment_cat_stats CTE calculates cats_altered_from_assignments
-- but it's never used in the final SELECT. Only tas.total_altered (from direct
-- appointment links) is used.
--
-- Fix: Use GREATEST() for total_altered, just like we do for total_cats_caught.
-- ============================================================================

\echo ''
\echo '=== MIG_601: Fix Trapper Alteration Statistics ==='
\echo ''

-- ============================================================================
-- Step 1: Drop dependent views
-- ============================================================================

\echo 'Dropping dependent views...'

DROP VIEW IF EXISTS trapper.v_trapper_aggregate_stats CASCADE;
DROP VIEW IF EXISTS trapper.v_trapper_full_stats CASCADE;

-- ============================================================================
-- Step 2: Recreate v_trapper_full_stats with fixed alteration calculation
-- ============================================================================

\echo 'Creating fixed v_trapper_full_stats view...'

CREATE OR REPLACE VIEW trapper.v_trapper_full_stats AS
WITH manual_catch_stats AS (
    SELECT
        trapper_person_id,
        COUNT(*) AS manual_catches
    FROM trapper.trapper_manual_catches
    GROUP BY trapper_person_id
),
site_visit_stats AS (
    SELECT
        trapper_person_id,
        COUNT(*) AS total_site_visits,
        COUNT(*) FILTER (WHERE visit_type = 'assessment') AS assessment_visits,
        SUM(cats_trapped) AS cats_from_visits,
        COUNT(*) FILTER (WHERE visit_type = 'assessment' AND cats_trapped > 0) AS assessments_with_catches
    FROM trapper.trapper_site_visits
    GROUP BY trapper_person_id
),
assignment_cat_stats AS (
    SELECT
        rta.trapper_person_id,
        COUNT(DISTINCT rta.request_id) AS total_assignments,
        COUNT(DISTINCT rta.request_id) FILTER (WHERE r.status NOT IN ('completed', 'cancelled')) AS active_assignments,
        COUNT(DISTINCT rta.request_id) FILTER (WHERE r.status = 'completed') AS completed_assignments,
        COALESCE(SUM(vas.cats_caught), 0) AS cats_from_assignments,
        COALESCE(SUM(vas.cats_altered), 0) AS cats_altered_from_assignments,
        MIN(vas.effective_request_date) AS first_assignment_date,
        MAX(vas.effective_request_date) AS last_assignment_date
    FROM trapper.request_trapper_assignments rta
    JOIN trapper.sot_requests r ON r.request_id = rta.request_id
    LEFT JOIN trapper.v_request_alteration_stats vas ON vas.request_id = rta.request_id
    WHERE rta.unassigned_at IS NULL
    GROUP BY rta.trapper_person_id
)
SELECT
    tas.person_id,
    tas.display_name,
    tas.trapper_type,
    tas.role_status,
    tas.is_ffsc_trapper,

    -- Assignment stats
    COALESCE(acs.active_assignments, 0) AS active_assignments,
    COALESCE(acs.completed_assignments, 0) AS completed_assignments,

    -- Site visit stats
    COALESCE(sv.total_site_visits, 0) AS total_site_visits,
    COALESCE(sv.assessment_visits, 0) AS assessment_visits,
    CASE
        WHEN COALESCE(sv.assessment_visits, 0) > 0
        THEN ROUND(100.0 * COALESCE(sv.assessments_with_catches, 0) / sv.assessment_visits, 1)
        ELSE NULL
    END AS first_visit_success_rate_pct,

    -- Cats caught from various sources
    COALESCE(sv.cats_from_visits, 0) AS cats_from_visits,
    COALESCE(mc.manual_catches, 0) AS manual_catches,
    COALESCE(acs.cats_from_assignments, 0) AS cats_from_assignments,

    -- Total caught: MAX of all sources + manual catches
    GREATEST(
        COALESCE(sv.cats_from_visits, 0),
        COALESCE(acs.cats_from_assignments, 0),
        COALESCE(tas.total_cats_brought, 0)
    ) + COALESCE(mc.manual_catches, 0) AS total_cats_caught,

    -- Direct clinic stats
    COALESCE(tas.total_cats_brought, 0) AS total_clinic_cats,
    COALESCE(tas.unique_clinic_days, 0) AS unique_clinic_days,
    COALESCE(tas.avg_cats_per_day, 0) AS avg_cats_per_day,

    -- Spay/neuter breakdown (from direct appointments only, when available)
    COALESCE(tas.spayed_count, 0) AS spayed_count,
    COALESCE(tas.neutered_count, 0) AS neutered_count,

    -- FIX: Total altered now uses MAX of direct appointments OR assignment-based
    -- Previously only used tas.total_altered which ignored assignment data
    GREATEST(
        COALESCE(acs.cats_altered_from_assignments, 0),
        COALESCE(tas.total_altered, 0)
    ) AS total_altered,

    -- NEW: Expose assignment alterations for debugging/transparency
    COALESCE(acs.cats_altered_from_assignments, 0) AS cats_altered_from_assignments,

    -- FeLV stats (placeholder)
    0 AS felv_tested_count,
    0 AS felv_positive_count,
    NULL::NUMERIC AS felv_positive_rate_pct,

    -- Date range from direct appointments
    tas.first_clinic_date,
    tas.last_clinic_date,

    -- Overall activity date range (across all sources)
    LEAST(tas.first_clinic_date,
          (SELECT MIN(visit_date) FROM trapper.trapper_site_visits WHERE trapper_person_id = tas.person_id),
          acs.first_assignment_date
    ) AS first_activity_date,
    GREATEST(tas.last_clinic_date,
             (SELECT MAX(visit_date) FROM trapper.trapper_site_visits WHERE trapper_person_id = tas.person_id),
             acs.last_assignment_date
    ) AS last_activity_date

FROM trapper.v_trapper_appointment_stats tas
LEFT JOIN manual_catch_stats mc ON mc.trapper_person_id = tas.person_id
LEFT JOIN site_visit_stats sv ON sv.trapper_person_id = tas.person_id
LEFT JOIN assignment_cat_stats acs ON acs.trapper_person_id = tas.person_id;

COMMENT ON VIEW trapper.v_trapper_full_stats IS
'Comprehensive trapper statistics from all data sources.

Data Sources:
  - Direct appointments: Clinic appointments where trapper email/phone matched booking
  - Request assignments: Cats at places of assigned requests (via request_trapper_assignments)
  - Site visits: Manual entry of cats trapped at field assessments
  - Manual catches: Ad-hoc catch records

Calculation Logic:
  - total_cats_caught = GREATEST(visits, assignments, direct) + manual
  - total_altered = GREATEST(assignment_alterations, direct_alterations)

FIX (MIG_601): total_altered now uses GREATEST of assignment-based OR direct
appointment alterations. Previously only used direct appointments, causing
trappers like Kate Vasey to show 240 caught but only 9 altered.';

-- ============================================================================
-- Step 3: Recreate aggregate stats view
-- ============================================================================

\echo 'Creating v_trapper_aggregate_stats view...'

CREATE OR REPLACE VIEW trapper.v_trapper_aggregate_stats AS
SELECT
    COUNT(*) AS total_active_trappers,
    COUNT(*) FILTER (WHERE is_ffsc_trapper) AS ffsc_trappers,
    COUNT(*) FILTER (WHERE NOT is_ffsc_trapper) AS community_trappers,
    COUNT(*) FILTER (WHERE role_status <> 'active') AS inactive_trappers,

    SUM(total_clinic_cats) AS all_clinic_cats,
    SUM(unique_clinic_days) AS all_clinic_days,
    ROUND(AVG(avg_cats_per_day) FILTER (WHERE unique_clinic_days > 0), 1) AS avg_cats_per_day_all,

    SUM(felv_tested_count) AS all_felv_tested,
    SUM(felv_positive_count) AS all_felv_positive,
    CASE
        WHEN SUM(felv_tested_count) > 0
        THEN ROUND(100.0 * SUM(felv_positive_count) / SUM(felv_tested_count), 1)
        ELSE NULL
    END AS felv_positive_rate_pct_all,

    SUM(total_site_visits) AS all_site_visits,
    CASE
        WHEN SUM(assessment_visits) > 0
        THEN ROUND(100.0 * SUM(CASE
            WHEN first_visit_success_rate_pct IS NOT NULL
            THEN assessment_visits * first_visit_success_rate_pct / 100
            ELSE 0
        END) / SUM(assessment_visits), 1)
        ELSE NULL
    END AS first_visit_success_rate_pct_all,

    SUM(total_cats_caught) AS all_cats_caught,
    SUM(total_altered) AS all_cats_altered
FROM trapper.v_trapper_full_stats
WHERE role_status = 'active';

COMMENT ON VIEW trapper.v_trapper_aggregate_stats IS
'Aggregate statistics across all active trappers.';

-- ============================================================================
-- Step 4: Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='
\echo ''

\echo 'Kate Vasey stats (should now show similar caught and altered counts):'
SELECT
    display_name,
    cats_from_assignments,
    cats_altered_from_assignments,
    total_clinic_cats AS direct_clinic_cats,
    total_altered,
    total_cats_caught
FROM trapper.v_trapper_full_stats
WHERE display_name ILIKE '%kate%vasey%';

\echo ''
\echo 'Top trappers with largest caught-altered gaps (should be fewer/smaller now):'
SELECT
    display_name,
    total_cats_caught,
    total_altered,
    cats_from_assignments,
    cats_altered_from_assignments,
    total_clinic_cats AS direct_cats,
    total_cats_caught - total_altered AS gap
FROM trapper.v_trapper_full_stats
WHERE total_cats_caught > 20
ORDER BY (total_cats_caught - total_altered) DESC
LIMIT 10;

\echo ''
\echo 'Aggregate stats:'
SELECT * FROM trapper.v_trapper_aggregate_stats;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=== MIG_601 Complete ==='
\echo ''
\echo 'Fixed: total_altered now uses GREATEST(assignment_alterations, direct_alterations)'
\echo ''
\echo 'Before: Kate Vasey showed 240 caught, 9 altered'
\echo 'After:  Kate Vasey shows ~240 caught, ~251 altered (from assignment data)'
\echo ''
\echo 'New column: cats_altered_from_assignments (for transparency)'
\echo ''
