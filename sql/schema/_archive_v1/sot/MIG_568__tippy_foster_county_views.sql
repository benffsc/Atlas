-- MIG_568: Add Foster & County Views to Tippy Catalog
--
-- Registers the new statistics views so Tippy can answer questions like:
-- - "How many fosters did we fix this year?"
-- - "How many county cats have we done?"
--
-- Dependencies: MIG_565-567 (stats views)

\echo ''
\echo '========================================================'
\echo 'MIG_568: Add Foster & County Views to Tippy Catalog'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Add Views to Tippy Catalog
-- ============================================================

\echo 'Adding views to tippy_view_catalog...'

INSERT INTO trapper.tippy_view_catalog (
  view_name, category, description, key_columns, filter_columns, example_questions
) VALUES
  -- Foster program views
  (
    'v_foster_program_stats',
    'stats',
    'Monthly foster program statistics including cats fixed, spays, neuters, and active foster parents',
    ARRAY['year', 'month', 'unique_cats', 'alteration_appointments', 'spays', 'neuters'],
    ARRAY['year', 'month'],
    ARRAY[
      'How many fosters did we fix this year?',
      'Foster program monthly breakdown',
      'How many foster cats in January?',
      'Foster program spay neuter stats'
    ]
  ),
  (
    'v_foster_program_ytd',
    'stats',
    'Year-to-date foster program totals',
    ARRAY['year', 'total_cats', 'total_alterations', 'total_spays', 'total_neuters'],
    ARRAY['year'],
    ARRAY[
      'Foster program year summary',
      'Total foster cats by year',
      'How many fosters in 2025?',
      'Foster cats fixed last year'
    ]
  ),
  (
    'v_foster_parent_activity',
    'stats',
    'Activity summary for each foster parent showing cats fostered and appointments',
    ARRAY['foster_parent_name', 'total_cats', 'total_appointments', 'years_active'],
    ARRAY['foster_parent_name'],
    ARRAY[
      'Top foster parents',
      'Most active fosters',
      'How many cats has this foster done?',
      'Foster parent stats'
    ]
  ),
  -- County/SCAS views
  (
    'v_county_cat_stats',
    'stats',
    'Monthly SCAS/county contract cat statistics',
    ARRAY['year', 'month', 'unique_cats', 'alteration_appointments', 'unique_scas_ids'],
    ARRAY['year', 'month'],
    ARRAY[
      'How many county cats have we done?',
      'SCAS cats this year',
      'County contract monthly breakdown',
      'SCAS spay neuter stats'
    ]
  ),
  (
    'v_county_cat_ytd',
    'stats',
    'Year-to-date county/SCAS cat totals',
    ARRAY['year', 'total_cats', 'total_alterations', 'total_scas_ids'],
    ARRAY['year'],
    ARRAY[
      'County cats by year',
      'SCAS annual totals',
      'How many county cats in 2025?',
      'Total SCAS cats processed'
    ]
  ),
  (
    'v_county_cat_list',
    'entity',
    'Detailed list of county/SCAS cats with their identifiers',
    ARRAY['cat_name', 'scas_animal_id', 'microchip', 'shelterluv_id', 'appointment_date'],
    ARRAY['scas_animal_id', 'appointment_date'],
    ARRAY[
      'Find SCAS cat by ID',
      'County cat lookup',
      'SCAS cat A439019',
      'Recent county cats'
    ]
  ),
  -- LMFM views
  (
    'v_lmfm_stats',
    'stats',
    'Monthly Love Me Fix Me waiver program statistics',
    ARRAY['year', 'month', 'unique_cats', 'alterations', 'spays', 'neuters'],
    ARRAY['year', 'month'],
    ARRAY[
      'LMFM stats this year',
      'Love Me Fix Me monthly',
      'Waiver program numbers',
      'How many LMFM cats?'
    ]
  ),
  -- Comparison views
  (
    'v_appointment_source_breakdown',
    'stats',
    'Appointments broken down by source category (regular, foster, county, LMFM)',
    ARRAY['year', 'source_category', 'total_appointments', 'unique_cats', 'alterations'],
    ARRAY['year', 'source_category'],
    ARRAY[
      'Appointment breakdown by type',
      'Foster vs regular appointments',
      'Compare program volumes',
      'What percentage are fosters?'
    ]
  ),
  (
    'v_program_comparison_ytd',
    'stats',
    'Year-over-year comparison of alterations by program with percentages',
    ARRAY['year', 'regular_alterations', 'foster_alterations', 'county_alterations', 'lmfm_alterations', 'foster_pct'],
    ARRAY['year'],
    ARRAY[
      'Compare programs year over year',
      'Foster percentage of total',
      'Program breakdown by year',
      'What percent are county cats?'
    ]
  ),
  -- Bridge view
  (
    'v_scas_shelterluv_bridge',
    'entity',
    'SCAS cats showing their bridge status to ShelterLuv via microchip',
    ARRAY['cat_name', 'scas_animal_id', 'microchip', 'shelterluv_id', 'bridge_status'],
    ARRAY['bridge_status', 'scas_animal_id'],
    ARRAY[
      'SCAS cats with ShelterLuv',
      'Bridged county cats',
      'SCAS cats missing microchip',
      'County cats in ShelterLuv'
    ]
  )
ON CONFLICT (view_name) DO UPDATE SET
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  key_columns = EXCLUDED.key_columns,
  filter_columns = EXCLUDED.filter_columns,
  example_questions = EXCLUDED.example_questions;

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Views added to Tippy catalog:'

SELECT view_name, category, description
FROM trapper.tippy_view_catalog
WHERE view_name IN (
  'v_foster_program_stats', 'v_foster_program_ytd', 'v_foster_parent_activity',
  'v_county_cat_stats', 'v_county_cat_ytd', 'v_county_cat_list',
  'v_lmfm_stats', 'v_appointment_source_breakdown', 'v_program_comparison_ytd',
  'v_scas_shelterluv_bridge'
)
ORDER BY category, view_name;

\echo ''
\echo 'Example questions Tippy can now answer:'

SELECT unnest(example_questions) as question
FROM trapper.tippy_view_catalog
WHERE view_name IN ('v_foster_program_stats', 'v_county_cat_stats', 'v_program_comparison_ytd');

\echo ''
\echo '========================================================'
\echo 'MIG_568 Complete!'
\echo '========================================================'
\echo ''
\echo 'Tippy can now answer questions like:'
\echo '  - "How many fosters did we fix this year?"'
\echo '  - "How many county cats have we done?"'
\echo '  - "LMFM stats this year"'
\echo '  - "Compare foster vs regular appointments"'
\echo ''
