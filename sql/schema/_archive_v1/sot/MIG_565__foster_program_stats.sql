-- MIG_565: Foster Program Statistics Views
--
-- Creates views to answer "How many fosters did we fix this year?"
--
-- Dependencies: MIG_560-562 (appointment categorization)

\echo ''
\echo '========================================================'
\echo 'MIG_565: Foster Program Statistics Views'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Monthly Foster Program Stats
-- ============================================================

\echo 'Creating v_foster_program_stats view...'

CREATE OR REPLACE VIEW trapper.v_foster_program_stats AS
WITH foster_appointments AS (
  SELECT
    a.appointment_id,
    a.cat_id,
    a.appointment_date,
    a.is_spay,
    a.is_neuter,
    EXTRACT(YEAR FROM a.appointment_date)::INT as year,
    EXTRACT(MONTH FROM a.appointment_date)::INT as month
  FROM trapper.sot_appointments a
  WHERE a.appointment_source_category = 'foster_program'
),
foster_relationships AS (
  SELECT DISTINCT
    pcr.cat_id,
    pcr.person_id,
    sp.display_name as foster_parent_name
  FROM trapper.person_cat_relationships pcr
  JOIN trapper.sot_people sp ON sp.person_id = pcr.person_id
    AND sp.merged_into_person_id IS NULL
  WHERE pcr.relationship_type = 'foster'
)
SELECT
  fa.year,
  fa.month,
  TO_CHAR(MAKE_DATE(fa.year, fa.month, 1), 'Mon YYYY') as month_name,
  COUNT(DISTINCT fa.cat_id) as unique_cats,
  COUNT(*) as total_appointments,
  COUNT(*) FILTER (WHERE fa.is_spay OR fa.is_neuter) as alteration_appointments,
  COUNT(*) FILTER (WHERE fa.is_spay) as spays,
  COUNT(*) FILTER (WHERE fa.is_neuter) as neuters,
  COUNT(DISTINCT fr.person_id) as active_foster_parents,
  COUNT(DISTINCT fa.cat_id) FILTER (WHERE fr.cat_id IS NOT NULL) as cats_with_foster_link
FROM foster_appointments fa
LEFT JOIN foster_relationships fr ON fr.cat_id = fa.cat_id
GROUP BY fa.year, fa.month
ORDER BY fa.year DESC, fa.month DESC;

COMMENT ON VIEW trapper.v_foster_program_stats IS
'Monthly statistics for the foster program.
Answers: "How many fosters did we fix this month/year?"

Columns:
- unique_cats: Distinct cats seen from foster program
- total_appointments: All appointments (including non-alteration)
- alteration_appointments: Spay/neuter appointments only
- spays/neuters: Breakdown by procedure
- active_foster_parents: Foster parents with cats that month
- cats_with_foster_link: Cats linked to a foster parent record';

-- ============================================================
-- PART 2: Year-to-Date Summary
-- ============================================================

\echo 'Creating v_foster_program_ytd view...'

CREATE OR REPLACE VIEW trapper.v_foster_program_ytd AS
SELECT
  year,
  SUM(unique_cats) as total_cats,
  SUM(total_appointments) as total_appointments,
  SUM(alteration_appointments) as total_alterations,
  SUM(spays) as total_spays,
  SUM(neuters) as total_neuters,
  MAX(active_foster_parents) as peak_active_fosters,
  SUM(cats_with_foster_link) as cats_linked_to_fosters
FROM trapper.v_foster_program_stats
GROUP BY year
ORDER BY year DESC;

COMMENT ON VIEW trapper.v_foster_program_ytd IS
'Year-to-date foster program totals.
Quick answer to "How many fosters did we fix in 2025?"';

-- ============================================================
-- PART 3: Foster Parent Activity View
-- ============================================================

\echo 'Creating v_foster_parent_activity view...'

CREATE OR REPLACE VIEW trapper.v_foster_parent_activity AS
SELECT
  sp.person_id,
  sp.display_name as foster_parent_name,
  COUNT(DISTINCT pcr.cat_id) as total_cats,
  COUNT(DISTINCT a.appointment_id) as total_appointments,
  MIN(a.appointment_date) as first_appointment,
  MAX(a.appointment_date) as last_appointment,
  COUNT(DISTINCT EXTRACT(YEAR FROM a.appointment_date)) as years_active
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_people sp ON sp.person_id = pcr.person_id
  AND sp.merged_into_person_id IS NULL
JOIN trapper.sot_appointments a ON a.cat_id = pcr.cat_id
  AND a.appointment_source_category = 'foster_program'
WHERE pcr.relationship_type = 'foster'
GROUP BY sp.person_id, sp.display_name
ORDER BY total_cats DESC;

COMMENT ON VIEW trapper.v_foster_parent_activity IS
'Activity summary for each foster parent.
Shows total cats fostered, appointments, and active years.';

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Foster Program YTD Stats:'

SELECT * FROM trapper.v_foster_program_ytd;

\echo ''
\echo 'Recent Monthly Stats:'

SELECT * FROM trapper.v_foster_program_stats LIMIT 12;

\echo ''
\echo 'Top Foster Parents:'

SELECT * FROM trapper.v_foster_parent_activity LIMIT 10;

\echo ''
\echo '========================================================'
\echo 'MIG_565 Complete!'
\echo '========================================================'
\echo ''
