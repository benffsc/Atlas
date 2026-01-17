\echo '=== MIG_238: Fix Trapper-Appointment Linking ==='
\echo 'Links appointments to trappers via booking email/phone for accurate stats'

-- The issue: v_trapper_clinic_stats matches trappers to clinichq_visits by email/phone,
-- but this can fail if the email/phone normalization doesn't match.
-- This migration adds a direct trapper_person_id column to sot_appointments.

-- ============================================================
-- 1. Add trapper_person_id column to sot_appointments
-- ============================================================

\echo 'Adding trapper_person_id column to sot_appointments...'

ALTER TABLE trapper.sot_appointments
ADD COLUMN IF NOT EXISTS trapper_person_id UUID REFERENCES trapper.sot_people(person_id);

ALTER TABLE trapper.sot_appointments
ADD COLUMN IF NOT EXISTS owner_email TEXT;

ALTER TABLE trapper.sot_appointments
ADD COLUMN IF NOT EXISTS owner_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_trapper_person
    ON trapper.sot_appointments(trapper_person_id) WHERE trapper_person_id IS NOT NULL;

COMMENT ON COLUMN trapper.sot_appointments.trapper_person_id IS
'The trapper/person who brought this cat to the appointment. Matched from booking info.';

-- ============================================================
-- 2. Backfill owner info from clinichq_visits
-- ============================================================

\echo 'Backfilling owner email/phone from clinichq_visits...'

UPDATE trapper.sot_appointments a
SET
    owner_email = cv.client_email,
    owner_phone = COALESCE(cv.client_cell_phone, cv.client_phone)
FROM trapper.clinichq_visits cv
WHERE cv.appointment_number = a.appointment_number
  AND cv.visit_date = a.appointment_date
  AND (a.owner_email IS NULL OR a.owner_phone IS NULL);

-- ============================================================
-- 3. Function to link appointments to trappers
-- ============================================================

\echo 'Creating function to link appointments to trappers...'

CREATE OR REPLACE FUNCTION trapper.link_appointments_to_trappers()
RETURNS TABLE(
    appointments_linked INT,
    trappers_found INT
) AS $$
DECLARE
    v_appointments_linked INT := 0;
    v_trappers_found INT := 0;
BEGIN
    -- Link appointments to trappers via email/phone matching
    -- Uses person_identifiers which has normalized email/phone
    WITH matched_trappers AS (
        SELECT DISTINCT
            a.appointment_id,
            pi.person_id AS trapper_id
        FROM trapper.sot_appointments a
        JOIN trapper.person_identifiers pi ON (
            (pi.id_type = 'email' AND a.owner_email IS NOT NULL
             AND pi.id_value_norm = LOWER(TRIM(a.owner_email)))
            OR
            (pi.id_type = 'phone' AND a.owner_phone IS NOT NULL
             AND pi.id_value_norm = RIGHT(REGEXP_REPLACE(a.owner_phone, '[^0-9]', '', 'g'), 10))
        )
        -- Only match to people who are trappers
        JOIN trapper.person_roles pr ON pr.person_id = pi.person_id
            AND pr.role = 'trapper'
        WHERE a.trapper_person_id IS NULL
    ),
    updated AS (
        UPDATE trapper.sot_appointments a
        SET trapper_person_id = mt.trapper_id
        FROM matched_trappers mt
        WHERE a.appointment_id = mt.appointment_id
        RETURNING a.appointment_id, a.trapper_person_id
    )
    SELECT
        COUNT(DISTINCT appointment_id),
        COUNT(DISTINCT trapper_person_id)
    INTO v_appointments_linked, v_trappers_found
    FROM updated;

    RAISE NOTICE 'Linked % appointments to % trappers', v_appointments_linked, v_trappers_found;

    RETURN QUERY SELECT v_appointments_linked, v_trappers_found;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 4. Run the linking function
-- ============================================================

\echo 'Running initial appointment-trapper linking...'
SELECT * FROM trapper.link_appointments_to_trappers();

-- ============================================================
-- 5. Create improved trapper stats view using direct links
-- ============================================================

\echo 'Creating v_trapper_appointment_stats view...'

CREATE OR REPLACE VIEW trapper.v_trapper_appointment_stats AS
SELECT
    p.person_id,
    p.display_name,
    pr.trapper_type,
    CASE
        WHEN pr.trapper_type IN ('coordinator', 'head_trapper', 'ffsc_trapper') THEN TRUE
        ELSE FALSE
    END AS is_ffsc_trapper,
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
FROM trapper.sot_people p
JOIN trapper.person_roles pr ON pr.person_id = p.person_id AND pr.role = 'trapper'
LEFT JOIN trapper.sot_appointments a ON a.trapper_person_id = p.person_id
WHERE pr.role_status = 'active'
GROUP BY p.person_id, p.display_name, pr.trapper_type;

COMMENT ON VIEW trapper.v_trapper_appointment_stats IS
'Trapper statistics from direct appointment links (more accurate than email matching).
Use this view for trapper stats instead of v_trapper_clinic_stats.';

-- ============================================================
-- 6. Update v_trapper_full_stats to use both sources
-- ============================================================

\echo 'Updating v_trapper_full_stats to use appointment links...'

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
        COALESCE(tas.total_cats_brought, 0)  -- NEW: from direct appointment links
    ) + COALESCE(mc.manual_catches, 0) AS total_cats_caught,

    -- Clinic stats from direct appointment links (NEW - more accurate)
    COALESCE(tas.total_cats_brought, 0) AS total_clinic_cats,
    COALESCE(tas.unique_clinic_days, 0) AS unique_clinic_days,
    COALESCE(tas.avg_cats_per_day, 0) AS avg_cats_per_day,
    COALESCE(tas.spayed_count, 0) AS spayed_count,
    COALESCE(tas.neutered_count, 0) AS neutered_count,
    COALESCE(tas.total_altered, 0) AS total_altered,

    -- FeLV stats (still from clinichq_visits for now)
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

-- ============================================================
-- 7. Verification
-- ============================================================

\echo ''
\echo 'Appointment linking results:'
SELECT
    COUNT(*) as total_appointments,
    COUNT(trapper_person_id) as linked_to_trapper,
    COUNT(cat_id) as linked_to_cat,
    ROUND(100.0 * COUNT(trapper_person_id) / NULLIF(COUNT(*), 0), 1) as pct_linked
FROM trapper.sot_appointments;

\echo ''
\echo 'Top trappers by cats brought to clinic (from direct links):'
SELECT
    display_name,
    total_cats_brought,
    unique_clinic_days,
    total_altered,
    first_clinic_date,
    last_clinic_date
FROM trapper.v_trapper_appointment_stats
WHERE total_cats_brought > 0
ORDER BY total_cats_brought DESC
LIMIT 10;

\echo ''
\echo 'MIG_238 complete!'
\echo 'Run SELECT * FROM trapper.link_appointments_to_trappers(); to relink if needed'
