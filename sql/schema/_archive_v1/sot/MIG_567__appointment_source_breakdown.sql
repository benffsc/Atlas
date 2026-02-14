-- MIG_567: Unified Appointment Source Breakdown View
--
-- Provides a single view showing all appointment categories for comparison.
--
-- Dependencies: MIG_560-562 (appointment categorization)

\echo ''
\echo '========================================================'
\echo 'MIG_567: Unified Appointment Source Breakdown'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Main Breakdown View
-- ============================================================

\echo 'Creating v_appointment_source_breakdown view...'

CREATE OR REPLACE VIEW trapper.v_appointment_source_breakdown AS
SELECT
  EXTRACT(YEAR FROM a.appointment_date)::INT as year,
  COALESCE(a.appointment_source_category, 'uncategorized') as source_category,
  COUNT(*) as total_appointments,
  COUNT(DISTINCT a.cat_id) as unique_cats,
  COUNT(*) FILTER (WHERE a.is_spay OR a.is_neuter) as alterations,
  COUNT(*) FILTER (WHERE a.is_spay) as spays,
  COUNT(*) FILTER (WHERE a.is_neuter) as neuters
FROM trapper.sot_appointments a
GROUP BY 1, 2
ORDER BY 1 DESC, total_appointments DESC;

COMMENT ON VIEW trapper.v_appointment_source_breakdown IS
'Breakdown of all appointments by year and source category.
Shows: regular, foster_program, county_scas, lmfm, other_internal

Useful for comparing volume across programs.';

-- ============================================================
-- PART 2: Category Totals View (All Time)
-- ============================================================

\echo 'Creating v_appointment_category_totals view...'

CREATE OR REPLACE VIEW trapper.v_appointment_category_totals AS
SELECT
  COALESCE(appointment_source_category, 'uncategorized') as category,
  COUNT(*) as total_appointments,
  COUNT(DISTINCT cat_id) as unique_cats,
  COUNT(*) FILTER (WHERE is_spay OR is_neuter) as alterations,
  MIN(appointment_date) as first_appointment,
  MAX(appointment_date) as last_appointment
FROM trapper.sot_appointments
GROUP BY 1
ORDER BY total_appointments DESC;

COMMENT ON VIEW trapper.v_appointment_category_totals IS
'All-time totals by appointment source category.';

-- ============================================================
-- PART 3: LMFM Statistics View
-- ============================================================

\echo 'Creating v_lmfm_stats view...'

CREATE OR REPLACE VIEW trapper.v_lmfm_stats AS
SELECT
  EXTRACT(YEAR FROM a.appointment_date)::INT as year,
  EXTRACT(MONTH FROM a.appointment_date)::INT as month,
  TO_CHAR(MAKE_DATE(
    EXTRACT(YEAR FROM a.appointment_date)::INT,
    EXTRACT(MONTH FROM a.appointment_date)::INT,
    1
  ), 'Mon YYYY') as month_name,
  COUNT(DISTINCT a.cat_id) as unique_cats,
  COUNT(*) as total_appointments,
  COUNT(*) FILTER (WHERE a.is_spay OR a.is_neuter) as alterations,
  COUNT(*) FILTER (WHERE a.is_spay) as spays,
  COUNT(*) FILTER (WHERE a.is_neuter) as neuters
FROM trapper.sot_appointments a
WHERE a.appointment_source_category = 'lmfm'
GROUP BY 1, 2
ORDER BY 1 DESC, 2 DESC;

COMMENT ON VIEW trapper.v_lmfm_stats IS
'Monthly statistics for Love Me Fix Me waiver program.';

-- ============================================================
-- PART 4: YTD Comparison View
-- ============================================================

\echo 'Creating v_program_comparison_ytd view...'

CREATE OR REPLACE VIEW trapper.v_program_comparison_ytd AS
SELECT
  year,
  SUM(CASE WHEN source_category = 'regular' THEN alterations END) as regular_alterations,
  SUM(CASE WHEN source_category = 'foster_program' THEN alterations END) as foster_alterations,
  SUM(CASE WHEN source_category = 'county_scas' THEN alterations END) as county_alterations,
  SUM(CASE WHEN source_category = 'lmfm' THEN alterations END) as lmfm_alterations,
  SUM(alterations) as total_alterations,
  ROUND(100.0 * SUM(CASE WHEN source_category = 'foster_program' THEN alterations END) /
    NULLIF(SUM(alterations), 0), 1) as foster_pct,
  ROUND(100.0 * SUM(CASE WHEN source_category = 'county_scas' THEN alterations END) /
    NULLIF(SUM(alterations), 0), 1) as county_pct,
  ROUND(100.0 * SUM(CASE WHEN source_category = 'lmfm' THEN alterations END) /
    NULLIF(SUM(alterations), 0), 1) as lmfm_pct
FROM trapper.v_appointment_source_breakdown
GROUP BY year
ORDER BY year DESC;

COMMENT ON VIEW trapper.v_program_comparison_ytd IS
'Year-over-year comparison of alterations by program.
Shows raw counts and percentages for each category.';

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Category Totals (All Time):'

SELECT * FROM trapper.v_appointment_category_totals;

\echo ''
\echo 'Year Breakdown:'

SELECT * FROM trapper.v_appointment_source_breakdown
WHERE year >= EXTRACT(YEAR FROM CURRENT_DATE) - 2;

\echo ''
\echo 'Program Comparison YTD:'

SELECT * FROM trapper.v_program_comparison_ytd;

\echo ''
\echo '========================================================'
\echo 'MIG_567 Complete!'
\echo '========================================================'
\echo ''
