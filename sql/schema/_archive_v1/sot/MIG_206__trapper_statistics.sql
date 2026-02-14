-- MIG_206__trapper_statistics.sql
-- Trapper Statistics: Clinic-derived metrics for trappers
--
-- Creates:
--   1. v_trapper_clinic_stats - Clinic-derived statistics per trapper
--   2. v_trapper_full_stats - Combined workload + clinic stats
--   3. trapper_manual_catches - Manual catch tracking outside requests
--   4. add_trapper_catch() - Function to add catches to trapper counter
--
-- Dependencies:
--   - person_roles (MIG_202)
--   - v_trapper_workload (MIG_204)
--   - clinichq_visits (MIG_175)
--   - cat_test_results (MIG_163)
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_206__trapper_statistics.sql

\echo ''
\echo '=============================================='
\echo 'MIG_206: Trapper Statistics'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Manual catches table (for cats caught outside requests)
-- ============================================================

\echo 'Creating trapper_manual_catches table...'

CREATE TABLE IF NOT EXISTS trapper.trapper_manual_catches (
    catch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Who caught it
    trapper_person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),

    -- The cat (one of these must be set)
    cat_id UUID REFERENCES trapper.sot_cats(cat_id),
    microchip TEXT,

    -- Catch details
    catch_date DATE NOT NULL DEFAULT CURRENT_DATE,
    catch_location TEXT,
    notes TEXT,

    -- Was this cat linked to a sot_cat after the fact?
    linked_at TIMESTAMPTZ,

    -- Provenance
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL DEFAULT 'web_user',

    -- At least one identifier required
    CONSTRAINT require_cat_identifier CHECK (
        cat_id IS NOT NULL OR microchip IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_manual_catches_trapper
    ON trapper.trapper_manual_catches(trapper_person_id);
CREATE INDEX IF NOT EXISTS idx_manual_catches_microchip
    ON trapper.trapper_manual_catches(microchip) WHERE microchip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_manual_catches_cat
    ON trapper.trapper_manual_catches(cat_id) WHERE cat_id IS NOT NULL;

COMMENT ON TABLE trapper.trapper_manual_catches IS
'Tracks cats caught by trappers outside of formal requests.
Used to credit trappers for work not linked to a TNR request.';

-- ============================================================
-- 2. Function to add a catch to a trapper's counter
-- ============================================================

\echo 'Creating add_trapper_catch function...'

CREATE OR REPLACE FUNCTION trapper.add_trapper_catch(
    p_trapper_person_id UUID,
    p_microchip TEXT DEFAULT NULL,
    p_cat_id UUID DEFAULT NULL,
    p_catch_date DATE DEFAULT CURRENT_DATE,
    p_catch_location TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_created_by TEXT DEFAULT 'web_user'
)
RETURNS UUID AS $$
DECLARE
    v_catch_id UUID;
    v_resolved_cat_id UUID;
BEGIN
    -- Validate trapper exists and is a trapper
    IF NOT EXISTS (
        SELECT 1 FROM trapper.person_roles
        WHERE person_id = p_trapper_person_id
          AND role = 'trapper'
          AND role_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Person % is not an active trapper', p_trapper_person_id;
    END IF;

    -- At least one identifier required
    IF p_microchip IS NULL AND p_cat_id IS NULL THEN
        RAISE EXCEPTION 'Either microchip or cat_id must be provided';
    END IF;

    -- Try to resolve cat_id from microchip if not provided
    v_resolved_cat_id := p_cat_id;
    IF v_resolved_cat_id IS NULL AND p_microchip IS NOT NULL THEN
        SELECT ci.cat_id INTO v_resolved_cat_id
        FROM trapper.cat_identifiers ci
        WHERE ci.id_type = 'microchip'
          AND ci.id_value = p_microchip;
    END IF;

    -- Insert the catch
    INSERT INTO trapper.trapper_manual_catches (
        trapper_person_id,
        cat_id,
        microchip,
        catch_date,
        catch_location,
        notes,
        linked_at,
        created_by
    ) VALUES (
        p_trapper_person_id,
        v_resolved_cat_id,
        p_microchip,
        p_catch_date,
        p_catch_location,
        p_notes,
        CASE WHEN v_resolved_cat_id IS NOT NULL THEN NOW() ELSE NULL END,
        p_created_by
    )
    RETURNING catch_id INTO v_catch_id;

    RETURN v_catch_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 3. View: v_trapper_clinic_stats
-- Clinic-derived statistics per trapper
-- ============================================================

\echo 'Creating v_trapper_clinic_stats view...'

CREATE OR REPLACE VIEW trapper.v_trapper_clinic_stats AS
WITH trapper_identifiers AS (
    -- Get all email/phone identifiers for active trappers
    SELECT
        pr.person_id AS trapper_id,
        pr.trapper_type,
        pi.id_type,
        pi.id_value_norm
    FROM trapper.person_roles pr
    JOIN trapper.person_identifiers pi ON pi.person_id = pr.person_id
    WHERE pr.role = 'trapper'
      AND pr.role_status = 'active'
      AND pi.id_type IN ('email', 'phone')
),
clinic_bookings AS (
    -- Find clinic visits where booking person matches trapper (by email or phone)
    SELECT DISTINCT
        ti.trapper_id,
        cv.microchip,
        cv.visit_date,
        cv.appointment_number,
        cv.felv_fiv_result,
        cv.is_spay,
        cv.is_neuter
    FROM trapper_identifiers ti
    JOIN trapper.clinichq_visits cv ON (
        (ti.id_type = 'email' AND LOWER(cv.client_email) = ti.id_value_norm)
        OR
        (ti.id_type = 'phone' AND (
            trapper.norm_phone_us(cv.client_cell_phone) = ti.id_value_norm
            OR trapper.norm_phone_us(cv.client_phone) = ti.id_value_norm
        ))
    )
),
trapper_stats AS (
    SELECT
        cb.trapper_id,
        -- Total unique cats brought to clinic
        COUNT(DISTINCT cb.microchip) AS total_clinic_cats,
        -- Unique clinic days
        COUNT(DISTINCT cb.visit_date) AS unique_clinic_days,
        -- Spay/neuter counts
        COUNT(DISTINCT CASE WHEN cb.is_spay THEN cb.microchip END) AS spayed_count,
        COUNT(DISTINCT CASE WHEN cb.is_neuter THEN cb.microchip END) AS neutered_count,
        -- FeLV stats (from cats that were tested)
        COUNT(DISTINCT CASE WHEN cb.felv_fiv_result IS NOT NULL THEN cb.microchip END) AS felv_tested_count,
        COUNT(DISTINCT CASE
            WHEN cb.felv_fiv_result ILIKE '%positive%' THEN cb.microchip
        END) AS felv_positive_count,
        -- Date range
        MIN(cb.visit_date) AS first_clinic_date,
        MAX(cb.visit_date) AS last_clinic_date
    FROM clinic_bookings cb
    GROUP BY cb.trapper_id
)
SELECT
    p.person_id,
    p.display_name,
    pr.trapper_type,
    -- Is this an FFSC trapper (vs community)?
    CASE
        WHEN pr.trapper_type IN ('coordinator', 'head_trapper', 'ffsc_trapper') THEN TRUE
        ELSE FALSE
    END AS is_ffsc_trapper,
    -- Clinic stats
    COALESCE(ts.total_clinic_cats, 0) AS total_clinic_cats,
    COALESCE(ts.unique_clinic_days, 0) AS unique_clinic_days,
    COALESCE(ts.spayed_count, 0) AS spayed_count,
    COALESCE(ts.neutered_count, 0) AS neutered_count,
    COALESCE(ts.spayed_count, 0) + COALESCE(ts.neutered_count, 0) AS total_altered,
    -- Average cats per clinic day
    CASE
        WHEN COALESCE(ts.unique_clinic_days, 0) > 0
        THEN ROUND(COALESCE(ts.total_clinic_cats, 0)::NUMERIC / ts.unique_clinic_days, 1)
        ELSE 0
    END AS avg_cats_per_day,
    -- FeLV encounter stats
    COALESCE(ts.felv_tested_count, 0) AS felv_tested_count,
    COALESCE(ts.felv_positive_count, 0) AS felv_positive_count,
    CASE
        WHEN COALESCE(ts.felv_tested_count, 0) > 0
        THEN ROUND(100.0 * COALESCE(ts.felv_positive_count, 0) / ts.felv_tested_count, 1)
        ELSE NULL
    END AS felv_positive_rate_pct,
    -- Date range
    ts.first_clinic_date,
    ts.last_clinic_date
FROM trapper.sot_people p
JOIN trapper.person_roles pr ON pr.person_id = p.person_id AND pr.role = 'trapper'
LEFT JOIN trapper_stats ts ON ts.trapper_id = p.person_id
WHERE pr.role_status = 'active';

-- ============================================================
-- 4. View: v_trapper_full_stats
-- Combined workload + clinic + manual catch stats
-- ============================================================

\echo 'Creating v_trapper_full_stats view...'

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
        -- First visit success rate
        COUNT(*) FILTER (WHERE visit_type = 'assessment' AND cats_trapped > 0) AS assessments_with_catches
    FROM trapper.trapper_site_visits
    GROUP BY trapper_person_id
),
-- Cats from assigned requests (via request_trapper_assignments + v_request_alteration_stats)
-- Uses the many-to-many assignments table to credit ALL trappers on a request
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
    WHERE rta.unassigned_at IS NULL  -- Only active assignments
    GROUP BY rta.trapper_person_id
)
SELECT
    cs.person_id,
    cs.display_name,
    cs.trapper_type,
    cs.is_ffsc_trapper,

    -- Assignment stats from actual request counts
    COALESCE(acs.active_assignments, 0) AS active_assignments,
    COALESCE(acs.completed_assignments, 0) AS completed_assignments,

    -- Site visit stats
    COALESCE(sv.total_site_visits, 0) AS total_site_visits,
    COALESCE(sv.assessment_visits, 0) AS assessment_visits,

    -- First visit success rate
    CASE
        WHEN COALESCE(sv.assessment_visits, 0) > 0
        THEN ROUND(100.0 * COALESCE(sv.assessments_with_catches, 0) / sv.assessment_visits, 1)
        ELSE NULL
    END AS first_visit_success_rate_pct,

    -- Cats from various sources
    COALESCE(sv.cats_from_visits, 0) AS cats_from_visits,
    COALESCE(mc.manual_catches, 0) AS manual_catches,
    COALESCE(acs.cats_from_assignments, 0) AS cats_from_assignments,
    -- Total cats caught = best of (site visits, assignment stats) + manual catches
    GREATEST(COALESCE(sv.cats_from_visits, 0), COALESCE(acs.cats_from_assignments, 0))
        + COALESCE(mc.manual_catches, 0) AS total_cats_caught,

    -- Clinic stats (from booking person match - these may undercount)
    cs.total_clinic_cats,
    cs.unique_clinic_days,
    cs.avg_cats_per_day,
    cs.spayed_count,
    cs.neutered_count,
    cs.total_altered,
    cs.felv_tested_count,
    cs.felv_positive_count,
    cs.felv_positive_rate_pct,
    cs.first_clinic_date,
    cs.last_clinic_date,

    -- Overall activity dates (include assignment dates)
    LEAST(cs.first_clinic_date,
          (SELECT MIN(visit_date) FROM trapper.trapper_site_visits WHERE trapper_person_id = cs.person_id),
          acs.first_assignment_date
    ) AS first_activity_date,
    GREATEST(cs.last_clinic_date,
             (SELECT MAX(visit_date) FROM trapper.trapper_site_visits WHERE trapper_person_id = cs.person_id),
             acs.last_assignment_date
    ) AS last_activity_date

FROM trapper.v_trapper_clinic_stats cs
LEFT JOIN manual_catch_stats mc ON mc.trapper_person_id = cs.person_id
LEFT JOIN site_visit_stats sv ON sv.trapper_person_id = cs.person_id
LEFT JOIN assignment_cat_stats acs ON acs.trapper_person_id = cs.person_id;

-- ============================================================
-- 5. Aggregate statistics view
-- ============================================================

\echo 'Creating v_trapper_aggregate_stats view...'

CREATE OR REPLACE VIEW trapper.v_trapper_aggregate_stats AS
SELECT
    COUNT(*) AS total_active_trappers,
    COUNT(*) FILTER (WHERE is_ffsc_trapper) AS ffsc_trappers,
    COUNT(*) FILTER (WHERE NOT is_ffsc_trapper) AS community_trappers,

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
FROM trapper.v_trapper_full_stats;

-- ============================================================
-- 6. Function to get trapper role info for a person
-- ============================================================

\echo 'Creating get_trapper_info function...'

CREATE OR REPLACE FUNCTION trapper.get_trapper_info(p_person_id UUID)
RETURNS TABLE (
    is_trapper BOOLEAN,
    trapper_type TEXT,
    is_ffsc_trapper BOOLEAN,
    role_status TEXT,
    started_at DATE
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        TRUE AS is_trapper,
        pr.trapper_type,
        CASE
            WHEN pr.trapper_type IN ('coordinator', 'head_trapper', 'ffsc_trapper') THEN TRUE
            ELSE FALSE
        END AS is_ffsc_trapper,
        pr.role_status::TEXT,
        pr.started_at
    FROM trapper.person_roles pr
    WHERE pr.person_id = p_person_id
      AND pr.role = 'trapper'
    LIMIT 1;

    -- If no rows returned, return a "not a trapper" row
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, FALSE, NULL::TEXT, NULL::DATE;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 7. Indexes for performance
-- ============================================================

\echo 'Creating indexes...'

-- Index for faster clinic visit matching by email
CREATE INDEX IF NOT EXISTS idx_clinichq_visits_client_email_lower
    ON trapper.clinichq_visits(LOWER(client_email))
    WHERE client_email IS NOT NULL;

-- Index for faster person identifier lookup
CREATE INDEX IF NOT EXISTS idx_person_identifiers_value_type
    ON trapper.person_identifiers(id_value_norm, id_type);

-- ============================================================
-- 8. Documentation
-- ============================================================

COMMENT ON VIEW trapper.v_trapper_clinic_stats IS
'Clinic-derived statistics per trapper. Matches trappers to clinic bookings via email/phone.
Key metrics: cats brought to clinic, clinic days, FeLV encounter rate.';

COMMENT ON VIEW trapper.v_trapper_full_stats IS
'Comprehensive trapper statistics combining:
- Assignment stats (active/completed)
- Site visit stats (with first visit success rate)
- Manual catches
- Clinic stats (from v_trapper_clinic_stats)';

COMMENT ON VIEW trapper.v_trapper_aggregate_stats IS
'Aggregate statistics across all active trappers.
Used for org-wide metrics like overall FeLV rate, avg cats per clinic day.';

COMMENT ON FUNCTION trapper.add_trapper_catch IS
'Add a cat to a trapper''s manual catch counter.
Use for cats caught outside of formal TNR requests.
Accepts either microchip or cat_id (will auto-link if microchip found).';

COMMENT ON FUNCTION trapper.get_trapper_info IS
'Check if a person is a trapper and get their trapper type.
Returns is_trapper=FALSE if person is not a trapper.';

\echo ''
\echo 'MIG_206 complete!'
\echo ''
\echo 'Created:'
\echo '  - trapper_manual_catches table (track catches outside requests)'
\echo '  - add_trapper_catch() function (add to catch counter)'
\echo '  - v_trapper_clinic_stats view (clinic-derived per-trapper stats)'
\echo '  - v_trapper_full_stats view (combined stats)'
\echo '  - v_trapper_aggregate_stats view (org-wide metrics)'
\echo '  - get_trapper_info() function (check if person is trapper)'
\echo ''
\echo 'Trapper types:'
\echo '  - coordinator: FFSC trapping coordinator (staff)'
\echo '  - head_trapper: FFSC head trapper'
\echo '  - ffsc_trapper: FFSC trained volunteer trapper'
\echo '  - community_trapper: Community trapper (contract only, NOT FFSC rep)'
\echo ''
