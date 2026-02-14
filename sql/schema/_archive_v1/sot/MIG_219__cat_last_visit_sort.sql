-- MIG_219__cat_last_visit_sort.sql
-- Add last_visit_date to v_cat_list for sorting by most recent visit
--
-- Purpose:
--   - Allow sorting cat list by most recent clinic visit
--   - Useful for finding recently active cats vs inactive ones
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_219__cat_last_visit_sort.sql

\echo ''
\echo 'MIG_219: Cat Last Visit Sort'
\echo '============================'
\echo ''

-- ============================================================
-- 1. Update v_cat_list view to include last_visit_date
-- ============================================================

\echo 'Updating v_cat_list view...'

CREATE OR REPLACE VIEW trapper.v_cat_list AS
SELECT
    c.cat_id,
    c.display_name,
    c.sex,
    c.altered_status,
    c.breed,
    c.primary_color AS color,
    cq.microchip,
    cq.quality_tier,
    cq.quality_reason,
    cq.has_microchip,
    (SELECT COUNT(DISTINCT trapper.canonical_person_id(pcr.person_id))
     FROM trapper.person_cat_relationships pcr
     WHERE pcr.cat_id = c.cat_id) AS owner_count,
    (SELECT string_agg(DISTINCT p.display_name, ', ' ORDER BY p.display_name)
     FROM trapper.person_cat_relationships pcr
     JOIN trapper.sot_people p ON p.person_id = trapper.canonical_person_id(pcr.person_id)
     WHERE pcr.cat_id = c.cat_id) AS owner_names,
    cpp.place_id AS primary_place_id,
    cpp.place_name AS primary_place_label,
    pl.place_kind,
    (cpp.place_id IS NOT NULL) AS has_place,
    c.created_at,
    c.updated_at,
    -- Last visit date from appointments
    (SELECT MAX(a.appointment_date)
     FROM trapper.sot_appointments a
     WHERE a.cat_id = c.cat_id) AS last_visit_date,
    -- Total visit count
    (SELECT COUNT(*)
     FROM trapper.sot_appointments a
     WHERE a.cat_id = c.cat_id) AS visit_count
FROM trapper.sot_cats c
LEFT JOIN trapper.v_cat_quality cq ON cq.cat_id = c.cat_id
LEFT JOIN trapper.v_cat_primary_place cpp ON cpp.cat_id = c.cat_id
LEFT JOIN trapper.places pl ON pl.place_id = cpp.place_id;

COMMENT ON VIEW trapper.v_cat_list IS
'Cat list view with quality, ownership, place, and visit data for UI display.
Supports sorting by: quality_tier, display_name, last_visit_date, created_at.';

-- ============================================================
-- 2. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Cats with recent visits (last 30 days):'
SELECT COUNT(*) as cats_with_recent_visits
FROM trapper.v_cat_list
WHERE last_visit_date >= CURRENT_DATE - INTERVAL '30 days';

\echo ''
\echo 'Sample cats sorted by last visit:'
SELECT
    display_name,
    microchip,
    last_visit_date,
    visit_count
FROM trapper.v_cat_list
WHERE last_visit_date IS NOT NULL
ORDER BY last_visit_date DESC
LIMIT 10;

\echo ''
\echo 'Cats with no visits:'
SELECT COUNT(*) as cats_without_visits
FROM trapper.v_cat_list
WHERE last_visit_date IS NULL;

SELECT 'MIG_219 Complete' AS status;
