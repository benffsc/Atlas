-- ============================================================================
-- MIG_901: Appointment Data Quality Dashboard Views
-- ============================================================================
-- Problem: No unified view of appointment data quality status across the system.
--
-- Solution: Create comprehensive monitoring views for:
--   1. v_appointment_data_quality - Year-by-year linking rates and health flags
--   2. v_clinichq_boolean_values - Discover unexpected boolean values in raw data
--   3. v_appointment_linking_gaps - Detailed breakdown of unlinked appointments
-- ============================================================================

\echo '=== MIG_901: Appointment Data Quality Dashboard Views ==='
\echo ''

-- ============================================================================
-- View 1: Appointment Data Quality (Year-by-Year)
-- ============================================================================

\echo 'Creating v_appointment_data_quality view...'

CREATE OR REPLACE VIEW trapper.v_appointment_data_quality AS
SELECT
  EXTRACT(YEAR FROM appointment_date)::INT as year,
  -- Total counts
  COUNT(*) as total_appointments,

  -- Linking coverage
  COUNT(cat_id) as linked_cats,
  COUNT(person_id) as linked_persons,
  COUNT(COALESCE(place_id, inferred_place_id)) as linked_places,
  COUNT(trapper_person_id) as linked_trappers,

  -- Linking rates (percentage)
  ROUND(100.0 * COUNT(cat_id) / NULLIF(COUNT(*), 0), 1) as cat_link_pct,
  ROUND(100.0 * COUNT(person_id) / NULLIF(COUNT(*), 0), 1) as person_link_pct,
  ROUND(100.0 * COUNT(COALESCE(place_id, inferred_place_id)) / NULLIF(COUNT(*), 0), 1) as place_link_pct,
  ROUND(100.0 * COUNT(trapper_person_id) / NULLIF(COUNT(*), 0), 1) as trapper_link_pct,

  -- Service breakdown
  COUNT(*) FILTER (WHERE is_spay) as spay_count,
  COUNT(*) FILTER (WHERE is_neuter) as neuter_count,
  COUNT(*) FILTER (WHERE is_spay OR is_neuter) as tnr_count,

  -- Health flag counts (positive)
  COUNT(*) FILTER (WHERE has_uri) as uri_positive,
  COUNT(*) FILTER (WHERE has_fleas) as fleas_positive,
  COUNT(*) FILTER (WHERE has_dental_disease) as dental_positive,
  COUNT(*) FILTER (WHERE has_ear_issue) as ear_issue_positive,
  COUNT(*) FILTER (WHERE has_eye_issue) as eye_issue_positive,
  COUNT(*) FILTER (WHERE has_skin_issue) as skin_issue_positive,
  COUNT(*) FILTER (WHERE has_ringworm) as ringworm_positive,

  -- Misc flags (MIG_899)
  COUNT(*) FILTER (WHERE has_polydactyl) as polydactyl_positive,
  COUNT(*) FILTER (WHERE has_bradycardia) as bradycardia_positive,
  COUNT(*) FILTER (WHERE has_too_young_for_rabies) as too_young_rabies_positive,
  COUNT(*) FILTER (WHERE has_cryptorchid) as cryptorchid_positive,
  COUNT(*) FILTER (WHERE has_pyometra) as pyometra_positive,

  -- Contact info availability
  COUNT(*) FILTER (WHERE owner_email IS NOT NULL AND owner_email != '') as has_email,
  COUNT(*) FILTER (WHERE owner_phone IS NOT NULL AND owner_phone != '') as has_phone,
  COUNT(*) FILTER (WHERE (owner_email IS NULL OR owner_email = '') AND (owner_phone IS NULL OR owner_phone = '')) as no_contact_info

FROM trapper.sot_appointments
WHERE appointment_date IS NOT NULL
GROUP BY EXTRACT(YEAR FROM appointment_date)
ORDER BY year DESC;

COMMENT ON VIEW trapper.v_appointment_data_quality IS
'Year-by-year dashboard of appointment data quality metrics.
Shows linking coverage (cat, person, place, trapper), health flag counts,
and contact info availability. Use for annual trend analysis.

Key metrics to monitor:
  - cat_link_pct: Target >90%, current ~70%
  - person_link_pct: Target >95%, current ~98%
  - place_link_pct: Target >85%, current ~90%
  - no_contact_info: Lower is better, indicates data gaps';

-- ============================================================================
-- View 2: ClinicHQ Boolean Values (Discover Unexpected Patterns)
-- ============================================================================

\echo ''
\echo 'Creating v_clinichq_boolean_values view...'

CREATE OR REPLACE VIEW trapper.v_clinichq_boolean_values AS
WITH all_fields AS (
  -- Health flags
  SELECT 'URI' as field_name, payload->>'URI' as raw_value
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'URI' IS NOT NULL AND payload->>'URI' != ''

  UNION ALL
  SELECT 'Fleas', payload->>'Fleas'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Fleas' IS NOT NULL AND payload->>'Fleas' != ''

  UNION ALL
  SELECT 'Dental Disease', payload->>'Dental Disease'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Dental Disease' IS NOT NULL AND payload->>'Dental Disease' != ''

  UNION ALL
  SELECT 'Ear Issue', payload->>'Ear Issue'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Ear Issue' IS NOT NULL AND payload->>'Ear Issue' != ''

  UNION ALL
  SELECT 'Eye Issue', payload->>'Eye Issue'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Eye Issue' IS NOT NULL AND payload->>'Eye Issue' != ''

  UNION ALL
  SELECT 'Skin Issue', payload->>'Skin Issue'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Skin Issue' IS NOT NULL AND payload->>'Skin Issue' != ''

  UNION ALL
  SELECT 'Mouth Issue', payload->>'Mouth Issue'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Mouth Issue' IS NOT NULL AND payload->>'Mouth Issue' != ''

  UNION ALL
  SELECT 'Ticks', payload->>'Ticks'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Ticks' IS NOT NULL AND payload->>'Ticks' != ''

  UNION ALL
  SELECT 'Tapeworms', payload->>'Tapeworms'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Tapeworms' IS NOT NULL AND payload->>'Tapeworms' != ''

  UNION ALL
  SELECT 'Ear mites', payload->>'Ear mites'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Ear mites' IS NOT NULL AND payload->>'Ear mites' != ''

  UNION ALL
  SELECT 'Wood''s Lamp Ringworm Test', payload->>'Wood''s Lamp Ringworm Test'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Wood''s Lamp Ringworm Test' IS NOT NULL AND payload->>'Wood''s Lamp Ringworm Test' != ''

  -- Misc flags
  UNION ALL
  SELECT 'Polydactyl', payload->>'Polydactyl'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Polydactyl' IS NOT NULL AND payload->>'Polydactyl' != ''

  UNION ALL
  SELECT 'Bradycardia Intra-Op', payload->>'Bradycardia Intra-Op'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Bradycardia Intra-Op' IS NOT NULL AND payload->>'Bradycardia Intra-Op' != ''

  UNION ALL
  SELECT 'Too young for rabies', payload->>'Too young for rabies'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Too young for rabies' IS NOT NULL AND payload->>'Too young for rabies' != ''

  UNION ALL
  SELECT 'Cryptorchid', payload->>'Cryptorchid'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Cryptorchid' IS NOT NULL AND payload->>'Cryptorchid' != ''

  UNION ALL
  SELECT 'Hernia', payload->>'Hernia'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Hernia' IS NOT NULL AND payload->>'Hernia' != ''

  UNION ALL
  SELECT 'Pyometra', payload->>'Pyometra'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Pyometra' IS NOT NULL AND payload->>'Pyometra' != ''

  -- Core status flags
  UNION ALL
  SELECT 'Spay', payload->>'Spay'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Spay' IS NOT NULL AND payload->>'Spay' != ''

  UNION ALL
  SELECT 'Neuter', payload->>'Neuter'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Neuter' IS NOT NULL AND payload->>'Neuter' != ''

  UNION ALL
  SELECT 'Lactating', payload->>'Lactating'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Lactating' IS NOT NULL AND payload->>'Lactating' != ''

  UNION ALL
  SELECT 'Pregnant', payload->>'Pregnant'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'Pregnant' IS NOT NULL AND payload->>'Pregnant' != ''

  UNION ALL
  SELECT 'In Heat', payload->>'In Heat'
  FROM trapper.staged_records
  WHERE source_system = 'clinichq' AND source_table = 'appointment_info'
    AND payload->>'In Heat' IS NOT NULL AND payload->>'In Heat' != ''
),
aggregated AS (
  SELECT
    field_name,
    raw_value,
    COUNT(*) as occurrences
  FROM all_fields
  GROUP BY field_name, raw_value
)
SELECT
  field_name,
  raw_value,
  occurrences,
  trapper.is_positive_value(raw_value) as detected_as_positive,
  CASE
    WHEN trapper.is_positive_value(raw_value) THEN 'positive'
    WHEN LOWER(TRIM(raw_value)) IN ('no', 'false', 'n', '0', 'negative', 'unchecked') THEN 'negative'
    ELSE 'unexpected'
  END as value_category
FROM aggregated
ORDER BY field_name, occurrences DESC;

COMMENT ON VIEW trapper.v_clinichq_boolean_values IS
'Analyzes raw boolean field values from ClinicHQ appointment data.
Use this to discover unexpected values that may not be handled correctly.

Key columns:
  - detected_as_positive: TRUE if is_positive_value() would capture it
  - value_category: positive/negative/unexpected

To find uncaptured values:
  SELECT * FROM trapper.v_clinichq_boolean_values
  WHERE value_category = ''unexpected'' AND occurrences > 5;

If you find unexpected values that should be positive, update is_positive_value().';

-- ============================================================================
-- View 3: Appointment Linking Gaps (Detailed Breakdown)
-- ============================================================================

\echo ''
\echo 'Creating v_appointment_linking_gaps view...'

CREATE OR REPLACE VIEW trapper.v_appointment_linking_gaps AS
WITH gap_analysis AS (
  SELECT
    a.appointment_id,
    a.appointment_number,
    a.appointment_date,
    EXTRACT(YEAR FROM a.appointment_date)::INT as year,

    -- What's missing?
    CASE WHEN a.cat_id IS NULL THEN TRUE ELSE FALSE END as missing_cat,
    CASE WHEN a.person_id IS NULL THEN TRUE ELSE FALSE END as missing_person,
    CASE WHEN a.place_id IS NULL AND a.inferred_place_id IS NULL THEN TRUE ELSE FALSE END as missing_place,

    -- Why might cat be missing?
    CASE
      WHEN a.cat_id IS NOT NULL THEN 'linked'
      WHEN sr.payload->>'Microchip Number' IS NULL OR TRIM(sr.payload->>'Microchip Number') = '' THEN 'no_microchip_in_source'
      WHEN NOT EXISTS (
        SELECT 1 FROM trapper.cat_identifiers ci
        WHERE ci.id_type = 'microchip'
          AND ci.id_value = TRIM(sr.payload->>'Microchip Number')
      ) THEN 'microchip_not_in_database'
      ELSE 'unknown_cat_gap'
    END as cat_gap_reason,

    -- Why might person be missing?
    CASE
      WHEN a.person_id IS NOT NULL THEN 'linked'
      WHEN (a.owner_email IS NULL OR a.owner_email = '') AND (a.owner_phone IS NULL OR a.owner_phone = '') THEN 'no_contact_info'
      WHEN a.owner_email IS NOT NULL AND a.owner_email != '' AND a.owner_phone IS NULL THEN 'email_only'
      WHEN a.owner_phone IS NOT NULL AND a.owner_phone != '' AND a.owner_email IS NULL THEN 'phone_only'
      ELSE 'unknown_person_gap'
    END as person_gap_reason,

    -- Raw data for debugging
    TRIM(sr.payload->>'Microchip Number') as raw_microchip,
    a.owner_email,
    a.owner_phone

  FROM trapper.sot_appointments a
  LEFT JOIN trapper.staged_records sr ON
    sr.source_system = 'clinichq'
    AND sr.source_table = 'appointment_info'
    AND sr.payload->>'Number' = a.appointment_number
    AND TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
)
SELECT
  year,
  -- Cat gaps
  COUNT(*) FILTER (WHERE cat_gap_reason = 'no_microchip_in_source') as cat_no_microchip,
  COUNT(*) FILTER (WHERE cat_gap_reason = 'microchip_not_in_database') as cat_microchip_missing,
  COUNT(*) FILTER (WHERE cat_gap_reason = 'unknown_cat_gap') as cat_unknown_gap,
  COUNT(*) FILTER (WHERE cat_gap_reason = 'linked') as cat_linked,

  -- Person gaps
  COUNT(*) FILTER (WHERE person_gap_reason = 'no_contact_info') as person_no_contact,
  COUNT(*) FILTER (WHERE person_gap_reason = 'email_only') as person_email_only,
  COUNT(*) FILTER (WHERE person_gap_reason = 'phone_only') as person_phone_only,
  COUNT(*) FILTER (WHERE person_gap_reason = 'unknown_person_gap') as person_unknown_gap,
  COUNT(*) FILTER (WHERE person_gap_reason = 'linked') as person_linked,

  -- Place gaps
  COUNT(*) FILTER (WHERE missing_place) as place_missing,
  COUNT(*) FILTER (WHERE NOT missing_place) as place_linked,

  -- Total
  COUNT(*) as total_appointments

FROM gap_analysis
GROUP BY year
ORDER BY year DESC;

COMMENT ON VIEW trapper.v_appointment_linking_gaps IS
'Breakdown of WHY appointments are not linked to cats/persons/places.
Use for root cause analysis and targeted data quality improvements.

Cat gap reasons:
  - no_microchip_in_source: ClinicHQ field empty/missing
  - microchip_not_in_database: Microchip exists in source but not in cat_identifiers

Person gap reasons:
  - no_contact_info: Neither email nor phone available
  - email_only: Has email but person not linked (may need soft-blacklist check)
  - phone_only: Has phone but person not linked (INV-15 gap, fixed by MIG_902)

To find specific unlinked appointments:
  SELECT * FROM trapper.sot_appointments
  WHERE cat_id IS NULL AND appointment_date > ''2024-01-01''
  LIMIT 20;';

-- ============================================================================
-- View 4: Quick Health Check
-- ============================================================================

\echo ''
\echo 'Creating v_data_quality_health view...'

CREATE OR REPLACE VIEW trapper.v_data_quality_health AS
SELECT
  -- Overall counts
  (SELECT COUNT(*) FROM trapper.sot_appointments) as total_appointments,
  (SELECT COUNT(*) FROM trapper.sot_cats WHERE merged_into_cat_id IS NULL) as total_cats,
  (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL) as total_people,
  (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL) as total_places,

  -- Linking rates
  (SELECT ROUND(100.0 * COUNT(cat_id) / NULLIF(COUNT(*), 0), 1) FROM trapper.sot_appointments) as cat_link_pct,
  (SELECT ROUND(100.0 * COUNT(person_id) / NULLIF(COUNT(*), 0), 1) FROM trapper.sot_appointments) as person_link_pct,
  (SELECT ROUND(100.0 * COUNT(COALESCE(place_id, inferred_place_id)) / NULLIF(COUNT(*), 0), 1) FROM trapper.sot_appointments) as place_link_pct,

  -- Recent data (last 30 days)
  (SELECT COUNT(*) FROM trapper.sot_appointments WHERE created_at > NOW() - INTERVAL '30 days') as appointments_last_30d,
  (SELECT COUNT(*) FROM trapper.sot_appointments WHERE created_at > NOW() - INTERVAL '30 days' AND cat_id IS NOT NULL)::FLOAT /
    NULLIF((SELECT COUNT(*) FROM trapper.sot_appointments WHERE created_at > NOW() - INTERVAL '30 days'), 0) * 100 as recent_cat_link_pct,

  -- Stale data (retroactive changes)
  (SELECT COUNT(*) FROM trapper.sot_appointments WHERE has_stale_source = TRUE) as stale_appointments,

  -- Data Engine review queue
  (SELECT COUNT(*) FROM trapper.data_engine_match_decisions WHERE decision_type = 'review_pending') as pending_reviews;

COMMENT ON VIEW trapper.v_data_quality_health IS
'Quick health check for data quality metrics.
Single-row view with key indicators for monitoring.

Red flags to watch:
  - cat_link_pct < 60%: Investigate microchip issues
  - person_link_pct < 90%: Check contact info coverage
  - stale_appointments > 100: Run reconcile_retroactive_changes()
  - pending_reviews > 50: Review Data Engine queue';

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_901 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created views:'
\echo '  1. v_appointment_data_quality - Year-by-year linking rates & health flags'
\echo '  2. v_clinichq_boolean_values - Discover unexpected boolean values'
\echo '  3. v_appointment_linking_gaps - Root cause analysis for unlinked data'
\echo '  4. v_data_quality_health - Quick single-row health check'
\echo ''
\echo 'Usage examples:'
\echo '  -- Annual data quality report'
\echo '  SELECT * FROM trapper.v_appointment_data_quality;'
\echo ''
\echo '  -- Find unexpected boolean values'
\echo '  SELECT * FROM trapper.v_clinichq_boolean_values WHERE value_category = ''unexpected'';'
\echo ''
\echo '  -- See why appointments are not linked'
\echo '  SELECT * FROM trapper.v_appointment_linking_gaps;'
\echo ''
\echo '  -- Quick health check'
\echo '  SELECT * FROM trapper.v_data_quality_health;'
\echo ''
