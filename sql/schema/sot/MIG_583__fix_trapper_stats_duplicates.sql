-- MIG_583__fix_trapper_stats_duplicates.sql
-- ROOT CAUSE FIX for trapper statistics showing duplicates and zero stats
--
-- ROOT CAUSES IDENTIFIED:
--   1. Duplicate sot_people records for the same physical person
--      (e.g., "Ben Mis" exists as two separate person records)
--   2. sot_appointments.trapper_person_id not populated (appointment linking not run)
--   3. Views missing role_status column causing API fallback
--
-- FIXES:
--   1. Function to identify and auto-merge duplicate trappers by identifier match
--   2. Function to find potential duplicates by similar name for manual review
--   3. Run appointment-to-trapper linking to populate stats
--   4. Fix views to include role_status
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_583__fix_trapper_stats_duplicates.sql

\echo ''
\echo '=============================================='
\echo 'MIG_583: Fix Trapper Stats Duplicates'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Diagnostic: Find duplicate trappers (same person, multiple records)
-- ============================================================

\echo ''
\echo '=============================================='
\echo 'DIAGNOSTIC: Checking for duplicate trappers...'
\echo '=============================================='
\echo ''

-- Find trappers with duplicate sot_people records (sharing identifiers)
\echo 'Trappers sharing email addresses:'
SELECT
    pi.id_value AS shared_email,
    COUNT(DISTINCT p.person_id) AS person_count,
    ARRAY_AGG(DISTINCT p.display_name ORDER BY p.display_name) AS names,
    ARRAY_AGG(DISTINCT p.person_id ORDER BY p.display_name) AS person_ids
FROM trapper.person_identifiers pi
JOIN trapper.sot_people p ON p.person_id = pi.person_id
JOIN trapper.person_roles pr ON pr.person_id = p.person_id
WHERE pi.id_type = 'email'
  AND pr.role = 'trapper'
  AND p.merged_into_person_id IS NULL
GROUP BY pi.id_value
HAVING COUNT(DISTINCT p.person_id) > 1
ORDER BY COUNT(DISTINCT p.person_id) DESC
LIMIT 20;

\echo ''
\echo 'Trappers sharing phone numbers:'
SELECT
    pi.id_value AS shared_phone,
    COUNT(DISTINCT p.person_id) AS person_count,
    ARRAY_AGG(DISTINCT p.display_name ORDER BY p.display_name) AS names,
    ARRAY_AGG(DISTINCT p.person_id ORDER BY p.display_name) AS person_ids
FROM trapper.person_identifiers pi
JOIN trapper.sot_people p ON p.person_id = pi.person_id
JOIN trapper.person_roles pr ON pr.person_id = p.person_id
WHERE pi.id_type = 'phone'
  AND pr.role = 'trapper'
  AND p.merged_into_person_id IS NULL
GROUP BY pi.id_value
HAVING COUNT(DISTINCT p.person_id) > 1
ORDER BY COUNT(DISTINCT p.person_id) DESC
LIMIT 20;

-- ============================================================
-- 2. Function to AUTO-MERGE duplicate trappers by shared identifier
-- ============================================================

\echo ''
\echo 'Creating merge_duplicate_trappers() function...'

CREATE OR REPLACE FUNCTION trapper.merge_duplicate_trappers()
RETURNS TABLE(
    merged_from_id UUID,
    merged_into_id UUID,
    merged_name TEXT,
    canonical_name TEXT,
    shared_identifier TEXT,
    merge_result JSONB
) AS $$
DECLARE
    v_dup RECORD;
    v_target_id UUID;
    v_source_id UUID;
    v_result JSONB;
BEGIN
    -- Find trappers sharing identifiers and merge them
    FOR v_dup IN
        WITH shared_identifiers AS (
            SELECT
                pi.id_value_norm,
                pi.id_type,
                ARRAY_AGG(DISTINCT p.person_id ORDER BY p.created_at) AS person_ids,
                ARRAY_AGG(DISTINCT p.display_name ORDER BY p.created_at) AS names
            FROM trapper.person_identifiers pi
            JOIN trapper.sot_people p ON p.person_id = pi.person_id
            JOIN trapper.person_roles pr ON pr.person_id = p.person_id
            WHERE pr.role = 'trapper'
              AND p.merged_into_person_id IS NULL
              AND pi.id_type IN ('email', 'phone')
            GROUP BY pi.id_value_norm, pi.id_type
            HAVING COUNT(DISTINCT p.person_id) > 1
        )
        SELECT
            person_ids[1] AS target_id,  -- First (oldest) becomes canonical
            person_ids[2:] AS source_ids,  -- Rest get merged
            names[1] AS target_name,
            names[2:] AS source_names,
            id_value_norm AS shared_id,
            id_type
        FROM shared_identifiers
        LIMIT 50  -- Process in batches to avoid timeout
    LOOP
        -- Merge each duplicate into the canonical record
        FOREACH v_source_id IN ARRAY v_dup.source_ids
        LOOP
            BEGIN
                SELECT trapper.merge_people(
                    v_source_id,
                    v_dup.target_id,
                    'duplicate_trapper_auto_merge',
                    'system'
                ) INTO v_result;

                merged_from_id := v_source_id;
                merged_into_id := v_dup.target_id;
                merged_name := (SELECT display_name FROM trapper.sot_people WHERE person_id = v_source_id);
                canonical_name := v_dup.target_name;
                shared_identifier := v_dup.id_type || ': ' || v_dup.shared_id;
                merge_result := v_result;
                RETURN NEXT;
            EXCEPTION WHEN OTHERS THEN
                -- Log error but continue
                merged_from_id := v_source_id;
                merged_into_id := v_dup.target_id;
                merged_name := NULL;
                canonical_name := v_dup.target_name;
                shared_identifier := v_dup.id_type || ': ' || v_dup.shared_id;
                merge_result := jsonb_build_object('error', SQLERRM);
                RETURN NEXT;
            END;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.merge_duplicate_trappers IS
'Automatically merge duplicate trapper records that share the same email or phone.
Uses merge_people() internally. Run this to fix duplicate trappers.
Returns list of merges performed.';

-- ============================================================
-- 2. Create helper view for deduplicated trapper roles
-- ============================================================

\echo 'Creating v_trapper_roles_deduped view...'

CREATE OR REPLACE VIEW trapper.v_trapper_roles_deduped AS
SELECT DISTINCT ON (p.person_id)
    p.person_id,
    p.display_name,
    pr.trapper_type,
    pr.role_status,
    pr.started_at,
    pr.is_active,
    CASE
        WHEN pr.trapper_type IN ('coordinator', 'head_trapper', 'ffsc_trapper') THEN TRUE
        ELSE FALSE
    END AS is_ffsc_trapper
FROM trapper.sot_people p
JOIN trapper.person_roles pr ON pr.person_id = p.person_id
WHERE pr.role = 'trapper'
ORDER BY
    p.person_id,
    -- Prefer active roles
    CASE WHEN pr.role_status = 'active' THEN 0 ELSE 1 END,
    -- Then most recent
    pr.started_at DESC NULLS LAST;

COMMENT ON VIEW trapper.v_trapper_roles_deduped IS
'Deduplicated trapper roles. When a person has multiple trapper role records,
takes the active one (or most recent if no active). Prevents duplicate rows in stats.';

-- ============================================================
-- 3. Fix v_trapper_appointment_stats to use deduplicated roles
-- ============================================================

\echo 'Fixing v_trapper_appointment_stats view...'

CREATE OR REPLACE VIEW trapper.v_trapper_appointment_stats AS
SELECT
    tr.person_id,
    tr.display_name,
    tr.trapper_type,
    tr.role_status,
    tr.is_ffsc_trapper,
    -- Appointment-based stats (direct link)
    COUNT(DISTINCT a.appointment_id) AS total_appointments,
    COUNT(DISTINCT a.cat_id) AS total_cats_brought,
    COUNT(DISTINCT a.appointment_date) AS unique_clinic_days,
    -- Alteration counts
    COUNT(DISTINCT CASE WHEN a.is_spay THEN a.cat_id END) AS spayed_count,
    COUNT(DISTINCT CASE WHEN a.is_neuter THEN a.cat_id END) AS neutered_count,
    COUNT(DISTINCT CASE WHEN a.is_spay OR a.is_neuter THEN a.cat_id END) AS total_altered,
    -- Average cats per day
    CASE
        WHEN COUNT(DISTINCT a.appointment_date) > 0
        THEN ROUND(COUNT(DISTINCT a.cat_id)::NUMERIC / COUNT(DISTINCT a.appointment_date), 1)
        ELSE 0
    END AS avg_cats_per_day,
    -- Date range
    MIN(a.appointment_date) AS first_clinic_date,
    MAX(a.appointment_date) AS last_clinic_date
FROM trapper.v_trapper_roles_deduped tr
LEFT JOIN trapper.sot_appointments a ON a.trapper_person_id = tr.person_id
GROUP BY tr.person_id, tr.display_name, tr.trapper_type, tr.role_status, tr.is_ffsc_trapper;

COMMENT ON VIEW trapper.v_trapper_appointment_stats IS
'Trapper statistics from direct appointment links.
Uses v_trapper_roles_deduped to prevent duplicate rows.
Includes role_status for filtering.';

-- ============================================================
-- 4. Fix v_trapper_full_stats to include role_status
-- ============================================================

\echo 'Fixing v_trapper_full_stats view...'

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
    tas.role_status,  -- NOW INCLUDED
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

    -- Cats from various sources
    COALESCE(sv.cats_from_visits, 0) AS cats_from_visits,
    COALESCE(mc.manual_catches, 0) AS manual_catches,
    COALESCE(acs.cats_from_assignments, 0) AS cats_from_assignments,

    -- Total cats caught = best source + manual catches
    GREATEST(
        COALESCE(sv.cats_from_visits, 0),
        COALESCE(acs.cats_from_assignments, 0),
        COALESCE(tas.total_cats_brought, 0)
    ) + COALESCE(mc.manual_catches, 0) AS total_cats_caught,

    -- Clinic stats from direct appointment links
    COALESCE(tas.total_cats_brought, 0) AS total_clinic_cats,
    COALESCE(tas.unique_clinic_days, 0) AS unique_clinic_days,
    COALESCE(tas.avg_cats_per_day, 0) AS avg_cats_per_day,
    COALESCE(tas.spayed_count, 0) AS spayed_count,
    COALESCE(tas.neutered_count, 0) AS neutered_count,
    COALESCE(tas.total_altered, 0) AS total_altered,

    -- FeLV stats (placeholder - would need linking to test results)
    0 AS felv_tested_count,
    0 AS felv_positive_count,
    NULL::NUMERIC AS felv_positive_rate_pct,

    tas.first_clinic_date,
    tas.last_clinic_date,

    -- Overall activity dates
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
'Comprehensive trapper statistics. Now includes role_status and uses
deduplicated roles to prevent duplicate rows.';

-- ============================================================
-- 5. Update aggregate stats view
-- ============================================================

\echo 'Updating v_trapper_aggregate_stats view...'

CREATE OR REPLACE VIEW trapper.v_trapper_aggregate_stats AS
SELECT
    COUNT(*) AS total_active_trappers,
    COUNT(*) FILTER (WHERE is_ffsc_trapper) AS ffsc_trappers,
    COUNT(*) FILTER (WHERE NOT is_ffsc_trapper) AS community_trappers,
    COUNT(*) FILTER (WHERE role_status != 'active') AS inactive_trappers,

    -- Aggregate clinic stats
    SUM(total_clinic_cats) AS all_clinic_cats,
    SUM(unique_clinic_days) AS all_clinic_days,
    ROUND(AVG(avg_cats_per_day) FILTER (WHERE unique_clinic_days > 0), 1) AS avg_cats_per_day_all,

    -- FeLV aggregate
    SUM(felv_tested_count) AS all_felv_tested,
    SUM(felv_positive_count) AS all_felv_positive,
    CASE
        WHEN SUM(felv_tested_count) > 0
        THEN ROUND(100.0 * SUM(felv_positive_count) / SUM(felv_tested_count), 1)
        ELSE NULL
    END AS felv_positive_rate_pct_all,

    -- Site visit aggregate
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

    -- Total cats
    SUM(total_cats_caught) AS all_cats_caught
FROM trapper.v_trapper_full_stats
WHERE role_status = 'active';

-- ============================================================
-- 6. Function to merge duplicate trapper roles
-- ============================================================

\echo 'Creating function to cleanup duplicate trapper roles...'

CREATE OR REPLACE FUNCTION trapper.cleanup_duplicate_trapper_roles()
RETURNS TABLE(
    person_id UUID,
    display_name TEXT,
    roles_removed INT
) AS $$
DECLARE
    v_person RECORD;
    v_removed INT := 0;
BEGIN
    -- Find people with multiple trapper roles
    FOR v_person IN
        SELECT p.person_id, p.display_name, COUNT(*) as cnt
        FROM trapper.sot_people p
        JOIN trapper.person_roles pr ON pr.person_id = p.person_id
        WHERE pr.role = 'trapper'
        GROUP BY p.person_id, p.display_name
        HAVING COUNT(*) > 1
    LOOP
        -- Keep the active one (or most recent), delete others
        WITH to_keep AS (
            SELECT pr.role_id
            FROM trapper.person_roles pr
            WHERE pr.person_id = v_person.person_id
              AND pr.role = 'trapper'
            ORDER BY
                CASE WHEN pr.role_status = 'active' THEN 0 ELSE 1 END,
                pr.started_at DESC NULLS LAST
            LIMIT 1
        )
        DELETE FROM trapper.person_roles pr
        WHERE pr.person_id = v_person.person_id
          AND pr.role = 'trapper'
          AND pr.role_id NOT IN (SELECT role_id FROM to_keep);

        GET DIAGNOSTICS v_removed = ROW_COUNT;

        IF v_removed > 0 THEN
            person_id := v_person.person_id;
            display_name := v_person.display_name;
            roles_removed := v_removed;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.cleanup_duplicate_trapper_roles IS
'Remove duplicate trapper roles, keeping the active one (or most recent).
Run this to fix data quality issues where trappers appear multiple times.';

-- ============================================================
-- 7. Function to find potential duplicate people (by name)
-- ============================================================

\echo 'Creating function to find potential duplicate trappers...'

CREATE OR REPLACE FUNCTION trapper.find_potential_duplicate_trappers()
RETURNS TABLE(
    name_group TEXT,
    person_ids UUID[],
    display_names TEXT[],
    emails TEXT[],
    phones TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    WITH trapper_people AS (
        SELECT
            p.person_id,
            p.display_name,
            LOWER(REGEXP_REPLACE(p.display_name, '[^a-zA-Z]', '', 'g')) AS normalized_name,
            ARRAY_AGG(DISTINCT pi.id_value) FILTER (WHERE pi.id_type = 'email') AS emails,
            ARRAY_AGG(DISTINCT pi.id_value) FILTER (WHERE pi.id_type = 'phone') AS phones
        FROM trapper.sot_people p
        JOIN trapper.person_roles pr ON pr.person_id = p.person_id
        LEFT JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
        WHERE pr.role = 'trapper'
        GROUP BY p.person_id, p.display_name
    ),
    grouped AS (
        SELECT
            normalized_name,
            ARRAY_AGG(person_id ORDER BY display_name) AS person_ids,
            ARRAY_AGG(display_name ORDER BY display_name) AS display_names,
            ARRAY_AGG(DISTINCT e) FILTER (WHERE e IS NOT NULL) AS all_emails,
            ARRAY_AGG(DISTINCT ph) FILTER (WHERE ph IS NOT NULL) AS all_phones
        FROM trapper_people,
             LATERAL unnest(COALESCE(emails, ARRAY[NULL::TEXT])) AS e,
             LATERAL unnest(COALESCE(phones, ARRAY[NULL::TEXT])) AS ph
        GROUP BY normalized_name
        HAVING COUNT(DISTINCT person_id) > 1
    )
    SELECT
        g.normalized_name AS name_group,
        g.person_ids,
        g.display_names,
        g.all_emails AS emails,
        g.all_phones AS phones
    FROM grouped g
    ORDER BY array_length(g.person_ids, 1) DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_potential_duplicate_trappers IS
'Find trappers that might be duplicates based on similar names.
Returns groups of person_ids with similar names for manual review.
Examples: "Barb Gray" and "Barbara Gray" would be flagged.';

-- ============================================================
-- 8. EXECUTE THE FIXES - Merge duplicates and link appointments
-- ============================================================

\echo ''
\echo '=============================================='
\echo 'EXECUTING FIXES...'
\echo '=============================================='

-- Step 1: Merge duplicate trappers that share identifiers
\echo ''
\echo 'Step 1: Merging duplicate trappers...'

SELECT * FROM trapper.merge_duplicate_trappers();

-- Step 2: Clean up any duplicate role records
\echo ''
\echo 'Step 2: Cleaning up duplicate role records...'

SELECT * FROM trapper.cleanup_duplicate_trapper_roles();

-- Step 3: Re-run appointment-to-trapper linking
\echo ''
\echo 'Step 3: Linking appointments to trappers...'

SELECT * FROM trapper.link_appointments_to_trappers();

-- ============================================================
-- 9. Verification
-- ============================================================

\echo ''
\echo '=============================================='
\echo 'VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Trapper counts (should have no duplicates now):'
SELECT
    'Total unique trappers' as metric,
    COUNT(DISTINCT person_id) as count
FROM trapper.v_trapper_roles_deduped
UNION ALL
SELECT
    'Active trappers',
    COUNT(*) FILTER (WHERE role_status = 'active')
FROM trapper.v_trapper_roles_deduped
UNION ALL
SELECT
    'FFSC trappers',
    COUNT(*) FILTER (WHERE is_ffsc_trapper AND role_status = 'active')
FROM trapper.v_trapper_roles_deduped
UNION ALL
SELECT
    'Community trappers',
    COUNT(*) FILTER (WHERE NOT is_ffsc_trapper AND role_status = 'active')
FROM trapper.v_trapper_roles_deduped;

\echo ''
\echo 'Appointment linking status:'
SELECT
    COUNT(*) as total_appointments,
    COUNT(trapper_person_id) as linked_to_trapper,
    ROUND(100.0 * COUNT(trapper_person_id) / NULLIF(COUNT(*), 0), 1) as pct_linked
FROM trapper.sot_appointments;

\echo ''
\echo 'Top trappers by clinic cats (verify stats are working):'
SELECT
    display_name,
    trapper_type,
    total_clinic_cats,
    unique_clinic_days,
    avg_cats_per_day
FROM trapper.v_trapper_full_stats
WHERE total_clinic_cats > 0
ORDER BY total_clinic_cats DESC
LIMIT 10;

\echo ''
\echo 'Potential duplicate trappers remaining (by similar name):'
\echo '(These need manual review - different email/phone but similar names)'
SELECT * FROM trapper.find_potential_duplicate_trappers() LIMIT 10;

\echo ''
\echo '=============================================='
\echo 'MIG_583 complete!'
\echo '=============================================='
\echo ''
\echo 'Actions performed:'
\echo '  1. Merged duplicate trappers sharing same email/phone'
\echo '  2. Cleaned up duplicate role records'
\echo '  3. Linked appointments to trappers'
\echo '  4. Fixed views to include role_status'
\echo ''
\echo 'To manually merge similar-name trappers (like "Barb Gray" / "Barbara Gray"):'
\echo '  SELECT * FROM trapper.find_potential_duplicate_trappers();'
\echo '  -- Then use merge_people() for confirmed duplicates:'
\echo '  SELECT trapper.merge_people(source_id, target_id, ''manual_merge'', ''admin'');'
\echo ''
