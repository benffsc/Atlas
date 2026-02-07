-- ============================================================================
-- MIG_934: Quarterly Aggregation Views (DATA_GAP_025)
-- ============================================================================
-- Problem: Staff frequently ask quarterly questions but views only have
--          monthly granularity. Tippy must manually aggregate.
--
-- Fix: Add quarterly views for foster, county, and LMFM programs
-- ============================================================================

\echo '=== MIG_934: Quarterly Aggregation Views ==='
\echo ''

-- ============================================================================
-- Part 1: Foster Program Quarterly View
-- ============================================================================

\echo 'Creating v_foster_program_quarterly...'

CREATE OR REPLACE VIEW trapper.v_foster_program_quarterly AS
WITH quarterly AS (
  SELECT
    year,
    CASE
      WHEN month BETWEEN 1 AND 3 THEN 1
      WHEN month BETWEEN 4 AND 6 THEN 2
      WHEN month BETWEEN 7 AND 9 THEN 3
      ELSE 4
    END as quarter,
    unique_cats,
    total_appointments,
    alteration_appointments,
    spays,
    neuters,
    active_foster_parents
  FROM trapper.v_foster_program_stats
)
SELECT
  year,
  quarter,
  'Q' || quarter || ' ' || year::TEXT as quarter_label,
  SUM(unique_cats) as total_cats,
  SUM(total_appointments) as total_appointments,
  SUM(alteration_appointments) as total_alterations,
  SUM(spays) as total_spays,
  SUM(neuters) as total_neuters,
  MAX(active_foster_parents) as peak_active_fosters
FROM quarterly
GROUP BY year, quarter
ORDER BY year DESC, quarter DESC;

COMMENT ON VIEW trapper.v_foster_program_quarterly IS
'Quarterly foster program statistics.
Aggregates v_foster_program_stats by quarter for questions like
"Compare Q1 vs Q3 2025 foster program"

Columns:
- quarter: 1-4
- quarter_label: "Q1 2025", "Q3 2024", etc.
- total_cats, total_appointments, total_alterations
- total_spays, total_neuters
- peak_active_fosters: Max active foster parents in quarter';

-- ============================================================================
-- Part 2: County Cat Quarterly View
-- ============================================================================

\echo 'Creating v_county_cat_quarterly...'

CREATE OR REPLACE VIEW trapper.v_county_cat_quarterly AS
WITH quarterly AS (
  SELECT
    year,
    CASE
      WHEN month BETWEEN 1 AND 3 THEN 1
      WHEN month BETWEEN 4 AND 6 THEN 2
      WHEN month BETWEEN 7 AND 9 THEN 3
      ELSE 4
    END as quarter,
    unique_cats,
    total_appointments,
    alteration_appointments,
    spays,
    neuters,
    unique_scas_ids,
    with_shelterluv_id
  FROM trapper.v_county_cat_stats
)
SELECT
  year,
  quarter,
  'Q' || quarter || ' ' || year::TEXT as quarter_label,
  SUM(unique_cats) as total_cats,
  SUM(total_appointments) as total_appointments,
  SUM(alteration_appointments) as total_alterations,
  SUM(spays) as total_spays,
  SUM(neuters) as total_neuters,
  SUM(unique_scas_ids) as total_scas_ids,
  SUM(with_shelterluv_id) as total_with_shelterluv
FROM quarterly
GROUP BY year, quarter
ORDER BY year DESC, quarter DESC;

COMMENT ON VIEW trapper.v_county_cat_quarterly IS
'Quarterly county/SCAS cat statistics.
Aggregates v_county_cat_stats by quarter.';

-- ============================================================================
-- Part 3: LMFM Quarterly View
-- ============================================================================

\echo 'Creating v_lmfm_quarterly...'

CREATE OR REPLACE VIEW trapper.v_lmfm_quarterly AS
WITH quarterly AS (
  SELECT
    year,
    CASE
      WHEN month BETWEEN 1 AND 3 THEN 1
      WHEN month BETWEEN 4 AND 6 THEN 2
      WHEN month BETWEEN 7 AND 9 THEN 3
      ELSE 4
    END as quarter,
    unique_cats,
    total_appointments,
    alterations,
    spays,
    neuters
  FROM trapper.v_lmfm_stats
)
SELECT
  year,
  quarter,
  'Q' || quarter || ' ' || year::TEXT as quarter_label,
  SUM(unique_cats) as total_cats,
  SUM(total_appointments) as total_appointments,
  SUM(alterations) as total_alterations,
  SUM(spays) as total_spays,
  SUM(neuters) as total_neuters
FROM quarterly
GROUP BY year, quarter
ORDER BY year DESC, quarter DESC;

COMMENT ON VIEW trapper.v_lmfm_quarterly IS
'Quarterly LMFM (Love Me Fix Me) waiver program statistics.
Aggregates v_lmfm_stats by quarter.';

-- ============================================================================
-- Part 4: Unified Program Comparison Quarterly
-- ============================================================================

\echo 'Creating v_program_comparison_quarterly...'

CREATE OR REPLACE VIEW trapper.v_program_comparison_quarterly AS
WITH quarterly_data AS (
  SELECT
    EXTRACT(YEAR FROM a.appointment_date)::INT as year,
    CASE
      WHEN EXTRACT(MONTH FROM a.appointment_date) BETWEEN 1 AND 3 THEN 1
      WHEN EXTRACT(MONTH FROM a.appointment_date) BETWEEN 4 AND 6 THEN 2
      WHEN EXTRACT(MONTH FROM a.appointment_date) BETWEEN 7 AND 9 THEN 3
      ELSE 4
    END as quarter,
    appointment_source_category,
    COUNT(*) FILTER (WHERE is_spay OR is_neuter) as alterations
  FROM trapper.sot_appointments a
  GROUP BY 1, 2, appointment_source_category
)
SELECT
  year,
  quarter,
  'Q' || quarter || ' ' || year::TEXT as quarter_label,
  SUM(CASE WHEN appointment_source_category = 'regular' THEN alterations END) as regular_alterations,
  SUM(CASE WHEN appointment_source_category = 'foster_program' THEN alterations END) as foster_alterations,
  SUM(CASE WHEN appointment_source_category = 'county_scas' THEN alterations END) as county_alterations,
  SUM(CASE WHEN appointment_source_category = 'lmfm' THEN alterations END) as lmfm_alterations,
  SUM(CASE WHEN appointment_source_category = 'other_internal' THEN alterations END) as other_internal_alterations,
  SUM(alterations) as total_alterations,
  ROUND(100.0 * SUM(CASE WHEN appointment_source_category = 'foster_program' THEN alterations END) /
    NULLIF(SUM(alterations), 0), 1) as foster_pct,
  ROUND(100.0 * SUM(CASE WHEN appointment_source_category = 'county_scas' THEN alterations END) /
    NULLIF(SUM(alterations), 0), 1) as county_pct,
  ROUND(100.0 * SUM(CASE WHEN appointment_source_category = 'lmfm' THEN alterations END) /
    NULLIF(SUM(alterations), 0), 1) as lmfm_pct
FROM quarterly_data
GROUP BY year, quarter
ORDER BY year DESC, quarter DESC;

COMMENT ON VIEW trapper.v_program_comparison_quarterly IS
'Quarterly comparison of all appointment source categories.
Shows raw counts and percentages for foster, county, LMFM programs by quarter.';

-- ============================================================================
-- Part 5: Add views to Tippy catalog
-- ============================================================================

\echo ''
\echo 'Adding quarterly views to Tippy catalog...'

INSERT INTO trapper.tippy_view_catalog (
  view_name, category, description, key_columns, filter_columns, example_questions
) VALUES
  (
    'v_foster_program_quarterly',
    'stats',
    'Quarterly foster program statistics for comparing Q1 vs Q3, etc.',
    ARRAY['year', 'quarter', 'quarter_label', 'total_cats', 'total_alterations'],
    ARRAY['year', 'quarter'],
    ARRAY[
      'Compare Q1 vs Q3 2025 foster program',
      'Foster cats by quarter',
      'Which quarter had the most foster cats?',
      'Q2 2025 foster stats'
    ]
  ),
  (
    'v_county_cat_quarterly',
    'stats',
    'Quarterly county/SCAS cat statistics',
    ARRAY['year', 'quarter', 'quarter_label', 'total_cats', 'total_alterations'],
    ARRAY['year', 'quarter'],
    ARRAY[
      'County cats by quarter',
      'SCAS quarterly breakdown',
      'Q1 2025 county cats'
    ]
  ),
  (
    'v_lmfm_quarterly',
    'stats',
    'Quarterly LMFM waiver program statistics',
    ARRAY['year', 'quarter', 'quarter_label', 'total_cats', 'total_alterations'],
    ARRAY['year', 'quarter'],
    ARRAY[
      'LMFM quarterly stats',
      'Love Me Fix Me by quarter'
    ]
  ),
  (
    'v_program_comparison_quarterly',
    'stats',
    'Compare all programs (foster, county, LMFM) by quarter with percentages',
    ARRAY['year', 'quarter', 'quarter_label', 'foster_alterations', 'county_alterations', 'foster_pct'],
    ARRAY['year', 'quarter'],
    ARRAY[
      'Compare programs by quarter',
      'What percentage are fosters in Q1?',
      'Program breakdown Q3 2025'
    ]
  )
ON CONFLICT (view_name) DO UPDATE SET
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  key_columns = EXCLUDED.key_columns,
  filter_columns = EXCLUDED.filter_columns,
  example_questions = EXCLUDED.example_questions;

-- ============================================================================
-- Verification
-- ============================================================================

\echo ''
\echo 'Verification - Foster Program Quarterly 2025:'
SELECT * FROM trapper.v_foster_program_quarterly WHERE year = 2025;

\echo ''
\echo 'Verification - Program Comparison Quarterly 2025:'
SELECT quarter_label, foster_alterations, county_alterations, lmfm_alterations, total_alterations
FROM trapper.v_program_comparison_quarterly
WHERE year = 2025;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_934 Complete!'
\echo '=============================================='
\echo ''
\echo 'DATA_GAP_025: Quarterly Aggregation - FIXED'
\echo ''
\echo 'New views created:'
\echo '  - v_foster_program_quarterly'
\echo '  - v_county_cat_quarterly'
\echo '  - v_lmfm_quarterly'
\echo '  - v_program_comparison_quarterly'
\echo ''
\echo 'Tippy can now answer questions like:'
\echo '  "Compare Q1 vs Q3 2025 foster program"'
\echo '  "Which quarter had the most county cats?"'
\echo ''
