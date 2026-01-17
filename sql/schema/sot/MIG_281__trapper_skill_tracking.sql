-- MIG_252: Trapper Skill Tracking
--
-- Adds ability to track a person's trapping skill/experience level
-- separate from their formal trapper role. This allows:
--   1. Tracking potential trappers who could help in an area
--   2. Managing active/inactive status for trappers
--   3. Demoting community trappers or changing trapper types
--
-- MANUAL APPLY:
--   source .env.local && psql "$DATABASE_URL" -f sql/schema/sot/MIG_252__trapper_skill_tracking.sql

\echo ''
\echo '=============================================='
\echo 'MIG_252: Trapper Skill Tracking'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Add trapping_skill to sot_people
-- ============================================================

\echo '1. Adding trapping_skill column to sot_people...'

ALTER TABLE trapper.sot_people
ADD COLUMN IF NOT EXISTS trapping_skill TEXT CHECK (trapping_skill IN ('none', 'basic', 'intermediate', 'experienced', 'expert'));

ALTER TABLE trapper.sot_people
ADD COLUMN IF NOT EXISTS trapping_skill_notes TEXT;

ALTER TABLE trapper.sot_people
ADD COLUMN IF NOT EXISTS trapping_skill_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN trapper.sot_people.trapping_skill IS
'Person''s trapping skill level, independent of formal trapper role.
Used to find people in an area who might know how to trap.
Values: none, basic, intermediate, experienced, expert';

COMMENT ON COLUMN trapper.sot_people.trapping_skill_notes IS
'Notes about trapping experience, equipment owned, areas familiar with, etc.';

-- ============================================================
-- 2. Create function to update trapper status
-- ============================================================

\echo '2. Creating update_trapper_status function...'

CREATE OR REPLACE FUNCTION trapper.update_trapper_status(
    p_person_id UUID,
    p_role_status TEXT,  -- 'active', 'inactive', 'suspended', 'revoked'
    p_reason TEXT DEFAULT NULL,
    p_updated_by TEXT DEFAULT 'staff'
) RETURNS BOOLEAN AS $$
DECLARE
    v_old_status TEXT;
BEGIN
    -- Get current status
    SELECT role_status INTO v_old_status
    FROM trapper.person_roles
    WHERE person_id = p_person_id AND role = 'trapper';

    IF v_old_status IS NULL THEN
        RAISE EXCEPTION 'Person % is not a trapper', p_person_id;
    END IF;

    -- Update status
    UPDATE trapper.person_roles
    SET
        role_status = p_role_status,
        ended_at = CASE WHEN p_role_status IN ('revoked', 'inactive') THEN NOW() ELSE NULL END,
        updated_at = NOW()
    WHERE person_id = p_person_id AND role = 'trapper';

    -- Log the change
    INSERT INTO trapper.entity_edits (
        entity_type, entity_id, field_name, old_value, new_value, edit_reason, edited_by
    ) VALUES (
        'person_role', p_person_id, 'role_status', v_old_status, p_role_status, p_reason, p_updated_by
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.update_trapper_status IS
'Updates a trapper''s status (active/inactive/suspended/revoked).
Logs the change to entity_edits for audit trail.';

-- ============================================================
-- 3. Create function to change trapper type
-- ============================================================

\echo '3. Creating change_trapper_type function...'

CREATE OR REPLACE FUNCTION trapper.change_trapper_type(
    p_person_id UUID,
    p_new_type TEXT,  -- 'coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper'
    p_reason TEXT DEFAULT NULL,
    p_updated_by TEXT DEFAULT 'staff'
) RETURNS BOOLEAN AS $$
DECLARE
    v_old_type TEXT;
BEGIN
    -- Validate new type
    IF p_new_type NOT IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper') THEN
        RAISE EXCEPTION 'Invalid trapper type: %. Must be coordinator, head_trapper, ffsc_trapper, or community_trapper', p_new_type;
    END IF;

    -- Get current type
    SELECT trapper_type INTO v_old_type
    FROM trapper.person_roles
    WHERE person_id = p_person_id AND role = 'trapper';

    IF v_old_type IS NULL THEN
        RAISE EXCEPTION 'Person % is not a trapper', p_person_id;
    END IF;

    -- Update type
    UPDATE trapper.person_roles
    SET
        trapper_type = p_new_type,
        updated_at = NOW()
    WHERE person_id = p_person_id AND role = 'trapper';

    -- Log the change
    INSERT INTO trapper.entity_edits (
        entity_type, entity_id, field_name, old_value, new_value, edit_reason, edited_by
    ) VALUES (
        'person_role', p_person_id, 'trapper_type', v_old_type, p_new_type, p_reason, p_updated_by
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.change_trapper_type IS
'Changes a trapper''s type (ffsc_trapper, community_trapper, etc.).
Use this to promote/demote trappers. Logs change for audit trail.';

-- ============================================================
-- 4. Create function to add trapper role to person
-- ============================================================

\echo '4. Creating add_trapper_role function...'

CREATE OR REPLACE FUNCTION trapper.add_trapper_role(
    p_person_id UUID,
    p_trapper_type TEXT DEFAULT 'community_trapper',
    p_reason TEXT DEFAULT NULL,
    p_added_by TEXT DEFAULT 'staff'
) RETURNS BOOLEAN AS $$
BEGIN
    -- Validate type
    IF p_trapper_type NOT IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper') THEN
        RAISE EXCEPTION 'Invalid trapper type: %', p_trapper_type;
    END IF;

    -- Check if already a trapper
    IF EXISTS (SELECT 1 FROM trapper.person_roles WHERE person_id = p_person_id AND role = 'trapper') THEN
        RAISE EXCEPTION 'Person % is already a trapper', p_person_id;
    END IF;

    -- Add role
    INSERT INTO trapper.person_roles (
        person_id, role, trapper_type, role_status, started_at, source_system
    ) VALUES (
        p_person_id, 'trapper', p_trapper_type, 'active', CURRENT_DATE, 'atlas_ui'
    );

    -- Log
    INSERT INTO trapper.entity_edits (
        entity_type, entity_id, field_name, old_value, new_value, edit_reason, edited_by
    ) VALUES (
        'person_role', p_person_id, 'role', NULL, 'trapper', p_reason, p_added_by
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. Create function to remove trapper role
-- ============================================================

\echo '5. Creating remove_trapper_role function...'

CREATE OR REPLACE FUNCTION trapper.remove_trapper_role(
    p_person_id UUID,
    p_reason TEXT DEFAULT NULL,
    p_removed_by TEXT DEFAULT 'staff'
) RETURNS BOOLEAN AS $$
DECLARE
    v_old_type TEXT;
BEGIN
    -- Get current type for logging
    SELECT trapper_type INTO v_old_type
    FROM trapper.person_roles
    WHERE person_id = p_person_id AND role = 'trapper';

    IF v_old_type IS NULL THEN
        RAISE EXCEPTION 'Person % is not a trapper', p_person_id;
    END IF;

    -- Remove role (soft delete - set status to revoked)
    UPDATE trapper.person_roles
    SET
        role_status = 'revoked',
        ended_at = NOW(),
        updated_at = NOW()
    WHERE person_id = p_person_id AND role = 'trapper';

    -- Log
    INSERT INTO trapper.entity_edits (
        entity_type, entity_id, field_name, old_value, new_value, edit_reason, edited_by
    ) VALUES (
        'person_role', p_person_id, 'role_status', 'active', 'revoked', p_reason, p_removed_by
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 6. Update v_trapper_full_stats to include inactive with flag
-- ============================================================

\echo '6. Updating v_trapper_clinic_stats to include inactive trappers...'

-- First drop and recreate to include inactive trappers
DROP VIEW IF EXISTS trapper.v_trapper_full_stats CASCADE;
DROP VIEW IF EXISTS trapper.v_trapper_clinic_stats CASCADE;

CREATE OR REPLACE VIEW trapper.v_trapper_clinic_stats AS
WITH trapper_identifiers AS (
    SELECT
        pr.person_id AS trapper_id,
        pr.trapper_type,
        pr.role_status,
        pi.id_type,
        pi.id_value_norm
    FROM trapper.person_roles pr
    JOIN trapper.person_identifiers pi ON pi.person_id = pr.person_id
    WHERE pr.role = 'trapper'
      AND pi.id_type IN ('email', 'phone')
),
clinic_bookings AS (
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
        COUNT(DISTINCT cb.microchip) AS total_clinic_cats,
        COUNT(DISTINCT cb.visit_date) AS unique_clinic_days,
        COUNT(DISTINCT CASE WHEN cb.is_spay THEN cb.microchip END) AS spayed_count,
        COUNT(DISTINCT CASE WHEN cb.is_neuter THEN cb.microchip END) AS neutered_count,
        COUNT(DISTINCT CASE WHEN cb.felv_fiv_result IS NOT NULL THEN cb.microchip END) AS felv_tested_count,
        COUNT(DISTINCT CASE WHEN cb.felv_fiv_result ILIKE '%positive%' THEN cb.microchip END) AS felv_positive_count,
        MIN(cb.visit_date) AS first_clinic_date,
        MAX(cb.visit_date) AS last_clinic_date
    FROM clinic_bookings cb
    GROUP BY cb.trapper_id
)
SELECT
    p.person_id,
    p.display_name,
    pr.trapper_type,
    pr.role_status,
    CASE
        WHEN pr.trapper_type IN ('coordinator', 'head_trapper', 'ffsc_trapper') THEN TRUE
        ELSE FALSE
    END AS is_ffsc_trapper,
    COALESCE(ts.total_clinic_cats, 0) AS total_clinic_cats,
    COALESCE(ts.unique_clinic_days, 0) AS unique_clinic_days,
    COALESCE(ts.spayed_count, 0) AS spayed_count,
    COALESCE(ts.neutered_count, 0) AS neutered_count,
    COALESCE(ts.spayed_count, 0) + COALESCE(ts.neutered_count, 0) AS total_altered,
    CASE
        WHEN COALESCE(ts.unique_clinic_days, 0) > 0
        THEN ROUND(COALESCE(ts.total_clinic_cats, 0)::NUMERIC / ts.unique_clinic_days, 1)
        ELSE 0
    END AS avg_cats_per_day,
    COALESCE(ts.felv_tested_count, 0) AS felv_tested_count,
    COALESCE(ts.felv_positive_count, 0) AS felv_positive_count,
    CASE
        WHEN COALESCE(ts.felv_tested_count, 0) > 0
        THEN ROUND(100.0 * COALESCE(ts.felv_positive_count, 0) / ts.felv_tested_count, 1)
        ELSE NULL
    END AS felv_positive_rate_pct,
    ts.first_clinic_date,
    ts.last_clinic_date
FROM trapper.sot_people p
JOIN trapper.person_roles pr ON pr.person_id = p.person_id AND pr.role = 'trapper'
LEFT JOIN trapper_stats ts ON ts.trapper_id = p.person_id;

-- Recreate full stats view
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
    cs.person_id,
    cs.display_name,
    cs.trapper_type,
    cs.role_status,
    cs.is_ffsc_trapper,
    COALESCE(acs.active_assignments, 0) AS active_assignments,
    COALESCE(acs.completed_assignments, 0) AS completed_assignments,
    COALESCE(sv.total_site_visits, 0) AS total_site_visits,
    COALESCE(sv.assessment_visits, 0) AS assessment_visits,
    CASE
        WHEN COALESCE(sv.assessment_visits, 0) > 0
        THEN ROUND(100.0 * COALESCE(sv.assessments_with_catches, 0) / sv.assessment_visits, 1)
        ELSE NULL
    END AS first_visit_success_rate_pct,
    COALESCE(sv.cats_from_visits, 0) AS cats_from_visits,
    COALESCE(mc.manual_catches, 0) AS manual_catches,
    COALESCE(acs.cats_from_assignments, 0) AS cats_from_assignments,
    GREATEST(COALESCE(sv.cats_from_visits, 0), COALESCE(acs.cats_from_assignments, 0))
        + COALESCE(mc.manual_catches, 0) AS total_cats_caught,
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

-- Recreate aggregate stats
CREATE OR REPLACE VIEW trapper.v_trapper_aggregate_stats AS
SELECT
    COUNT(*) FILTER (WHERE role_status = 'active') AS total_active_trappers,
    COUNT(*) FILTER (WHERE is_ffsc_trapper AND role_status = 'active') AS ffsc_trappers,
    COUNT(*) FILTER (WHERE NOT is_ffsc_trapper AND role_status = 'active') AS community_trappers,
    COUNT(*) FILTER (WHERE role_status != 'active') AS inactive_trappers,
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
    SUM(total_cats_caught) AS all_cats_caught
FROM trapper.v_trapper_full_stats;

-- ============================================================
-- Summary
-- ============================================================

\echo ''
\echo 'MIG_252 Complete!'
\echo ''
\echo 'What changed:'
\echo '  - sot_people: Added trapping_skill, trapping_skill_notes columns'
\echo '  - update_trapper_status(): Change active/inactive status'
\echo '  - change_trapper_type(): Promote/demote trapper types'
\echo '  - add_trapper_role(): Make someone a trapper'
\echo '  - remove_trapper_role(): Remove trapper role (soft delete)'
\echo '  - Views updated to include role_status and inactive count'
\echo ''
\echo 'Trapper types (in order of authority):'
\echo '  - coordinator: FFSC staff coordinator'
\echo '  - head_trapper: FFSC head trapper'
\echo '  - ffsc_trapper: FFSC trained volunteer'
\echo '  - community_trapper: Contract only, not FFSC rep'
\echo ''
\echo 'Trapping skill levels (on sot_people):'
\echo '  - none: No trapping experience'
\echo '  - basic: Has done simple trapping'
\echo '  - intermediate: Regular trapping experience'
\echo '  - experienced: Many successful trappings'
\echo '  - expert: Difficult/complex trapping situations'
\echo ''
