-- MIG_566: County/SCAS Cat Statistics Views
--
-- Creates views to answer "How many county cats have we done?"
--
-- Dependencies: MIG_560-562 (appointment categorization), MIG_564 (bridge)

\echo ''
\echo '========================================================'
\echo 'MIG_566: County/SCAS Cat Statistics Views'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Monthly County Cat Stats
-- ============================================================

\echo 'Creating v_county_cat_stats view...'

CREATE OR REPLACE VIEW trapper.v_county_cat_stats AS
WITH scas_appointments AS (
  SELECT
    a.appointment_id,
    a.cat_id,
    a.appointment_date,
    a.is_spay,
    a.is_neuter,
    EXTRACT(YEAR FROM a.appointment_date)::INT as year,
    EXTRACT(MONTH FROM a.appointment_date)::INT as month
  FROM trapper.sot_appointments a
  WHERE a.appointment_source_category = 'county_scas'
),
scas_ids AS (
  SELECT cat_id, id_value as scas_animal_id
  FROM trapper.cat_identifiers
  WHERE id_type = 'scas_animal_id'
),
sl_ids AS (
  SELECT cat_id, id_value as shelterluv_id
  FROM trapper.cat_identifiers
  WHERE id_type = 'shelterluv_id'
)
SELECT
  sa.year,
  sa.month,
  TO_CHAR(MAKE_DATE(sa.year, sa.month, 1), 'Mon YYYY') as month_name,
  COUNT(DISTINCT sa.cat_id) as unique_cats,
  COUNT(*) as total_appointments,
  COUNT(*) FILTER (WHERE sa.is_spay OR sa.is_neuter) as alteration_appointments,
  COUNT(*) FILTER (WHERE sa.is_spay) as spays,
  COUNT(*) FILTER (WHERE sa.is_neuter) as neuters,
  COUNT(DISTINCT si.scas_animal_id) as unique_scas_ids,
  COUNT(DISTINCT sl.shelterluv_id) as with_shelterluv_id
FROM scas_appointments sa
LEFT JOIN scas_ids si ON si.cat_id = sa.cat_id
LEFT JOIN sl_ids sl ON sl.cat_id = sa.cat_id
GROUP BY sa.year, sa.month
ORDER BY sa.year DESC, sa.month DESC;

COMMENT ON VIEW trapper.v_county_cat_stats IS
'Monthly statistics for SCAS/county contract cats.
Answers: "How many county cats have we done this month/year?"

Columns:
- unique_cats: Distinct cats from county contract
- total_appointments: All appointments
- alteration_appointments: Spay/neuter only
- unique_scas_ids: SCAS animal IDs processed
- with_shelterluv_id: Cats bridged to ShelterLuv';

-- ============================================================
-- PART 2: Year-to-Date Summary
-- ============================================================

\echo 'Creating v_county_cat_ytd view...'

CREATE OR REPLACE VIEW trapper.v_county_cat_ytd AS
SELECT
  year,
  SUM(unique_cats) as total_cats,
  SUM(total_appointments) as total_appointments,
  SUM(alteration_appointments) as total_alterations,
  SUM(spays) as total_spays,
  SUM(neuters) as total_neuters,
  SUM(unique_scas_ids) as total_scas_ids,
  SUM(with_shelterluv_id) as total_with_shelterluv
FROM trapper.v_county_cat_stats
GROUP BY year
ORDER BY year DESC;

COMMENT ON VIEW trapper.v_county_cat_ytd IS
'Year-to-date county cat totals.
Quick answer to "How many county cats have we done in 2025?"';

-- ============================================================
-- PART 3: County Cat List View
-- ============================================================

\echo 'Creating v_county_cat_list view...'

CREATE OR REPLACE VIEW trapper.v_county_cat_list AS
SELECT
  c.cat_id,
  c.display_name as cat_name,
  scas_ci.id_value as scas_animal_id,
  chip_ci.id_value as microchip,
  sl_ci.id_value as shelterluv_id,
  a.appointment_date,
  a.appointment_number,
  CASE WHEN a.is_spay THEN 'Spay'
       WHEN a.is_neuter THEN 'Neuter'
       ELSE 'Other' END as procedure_type
FROM trapper.sot_appointments a
JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
  AND c.merged_into_cat_id IS NULL
LEFT JOIN trapper.cat_identifiers scas_ci
  ON scas_ci.cat_id = c.cat_id
  AND scas_ci.id_type = 'scas_animal_id'
LEFT JOIN trapper.cat_identifiers chip_ci
  ON chip_ci.cat_id = c.cat_id
  AND chip_ci.id_type = 'microchip'
LEFT JOIN trapper.cat_identifiers sl_ci
  ON sl_ci.cat_id = c.cat_id
  AND sl_ci.id_type = 'shelterluv_id'
WHERE a.appointment_source_category = 'county_scas'
ORDER BY a.appointment_date DESC;

COMMENT ON VIEW trapper.v_county_cat_list IS
'Detailed list of all county/SCAS cats with their identifiers.
Use for lookups and cross-referencing with SCAS records.';

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'County Cat YTD Stats:'

SELECT * FROM trapper.v_county_cat_ytd;

\echo ''
\echo 'Recent Monthly Stats:'

SELECT * FROM trapper.v_county_cat_stats LIMIT 12;

\echo ''
\echo 'Sample County Cats:'

SELECT * FROM trapper.v_county_cat_list LIMIT 10;

\echo ''
\echo '========================================================'
\echo 'MIG_566 Complete!'
\echo '========================================================'
\echo ''
