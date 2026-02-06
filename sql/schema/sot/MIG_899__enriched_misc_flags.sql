-- ============================================================================
-- MIG_899: Add Enriched Columns for Misc Appointment Flags
-- ============================================================================
-- Problem: AppointmentDetailModal reads raw ClinicHQ payload directly for
-- flags like polydactyl, bradycardia, too_young_for_rabies. These fields
-- may contain non-boolean values causing false positives in the UI.
--
-- Solution: Add properly enriched boolean columns that do strict Yes/TRUE
-- checking, matching the pattern used for has_uri, has_fleas, etc.
-- ============================================================================

\echo '=== MIG_899: Enriched Misc Appointment Flags ==='
\echo ''

-- ============================================================================
-- Phase 1: Add new enriched columns to sot_appointments
-- ============================================================================

\echo 'Phase 1: Adding enriched columns...'

ALTER TABLE trapper.sot_appointments
ADD COLUMN IF NOT EXISTS has_polydactyl BOOLEAN DEFAULT FALSE;

ALTER TABLE trapper.sot_appointments
ADD COLUMN IF NOT EXISTS has_bradycardia BOOLEAN DEFAULT FALSE;

ALTER TABLE trapper.sot_appointments
ADD COLUMN IF NOT EXISTS has_too_young_for_rabies BOOLEAN DEFAULT FALSE;

ALTER TABLE trapper.sot_appointments
ADD COLUMN IF NOT EXISTS has_cryptorchid BOOLEAN DEFAULT FALSE;

ALTER TABLE trapper.sot_appointments
ADD COLUMN IF NOT EXISTS has_hernia BOOLEAN DEFAULT FALSE;

ALTER TABLE trapper.sot_appointments
ADD COLUMN IF NOT EXISTS has_pyometra BOOLEAN DEFAULT FALSE;

-- ============================================================================
-- Phase 2: Backfill from staged_records with strict boolean checking
-- ============================================================================

\echo ''
\echo 'Phase 2: Backfilling values with strict boolean checking...'

WITH backfill AS (
  UPDATE trapper.sot_appointments a
  SET
    has_polydactyl = COALESCE(appt.payload->>'Polydactyl', '') IN ('Yes', 'TRUE', 'true', 'Y', 'Checked'),
    has_bradycardia = COALESCE(appt.payload->>'Bradycardia Intra-Op', '') IN ('Yes', 'TRUE', 'true', 'Y', 'Checked'),
    has_too_young_for_rabies = COALESCE(appt.payload->>'Too young for rabies', '') IN ('Yes', 'TRUE', 'true', 'Y', 'Checked'),
    has_cryptorchid = COALESCE(appt.payload->>'Cryptorchid', '') IN ('Yes', 'TRUE', 'true', 'Y', 'Checked', 'Left', 'Right', 'Bilateral'),
    has_hernia = COALESCE(appt.payload->>'Hernia', '') IN ('Yes', 'TRUE', 'true', 'Y', 'Checked'),
    has_pyometra = COALESCE(appt.payload->>'Pyometra', '') IN ('Yes', 'TRUE', 'true', 'Y', 'Checked')
  FROM trapper.staged_records appt
  WHERE appt.source_system = 'clinichq'
    AND appt.source_table = 'appointment_info'
    AND appt.payload->>'Number' = a.appointment_number
    AND appt.payload->>'Date' IS NOT NULL
    AND TO_DATE(appt.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
  RETURNING a.appointment_id
)
SELECT COUNT(*) as appointments_updated FROM backfill;

-- ============================================================================
-- Phase 3: Update the v_appointment_detail view to include new columns
-- ============================================================================

\echo ''
\echo 'Phase 3: Updating v_appointment_detail view...'

CREATE OR REPLACE VIEW trapper.v_appointment_detail AS
SELECT
  a.appointment_id,
  a.appointment_date,
  a.appointment_number,
  a.clinic_day_number,
  a.service_type,
  a.is_spay,
  a.is_neuter,
  a.vet_name,
  a.technician,
  a.temperature,
  a.medical_notes,
  a.is_pregnant,
  a.is_lactating,
  a.is_in_heat,
  a.status,
  a.created_at,
  a.updated_at,
  a.source_system,
  a.cat_id,
  a.person_id,
  a.place_id,
  a.request_id,
  a.owner_email,
  a.owner_phone,
  a.partner_org_id,
  -- Enriched health flags
  a.has_uri,
  a.has_dental_disease,
  a.has_ear_issue,
  a.has_eye_issue,
  a.has_skin_issue,
  a.has_mouth_issue,
  a.has_fleas,
  a.has_ticks,
  a.has_tapeworms,
  a.has_ear_mites,
  a.has_ringworm,
  a.felv_fiv_result,
  a.body_composition_score,
  a.no_surgery_reason,
  a.total_invoiced,
  a.subsidy_value,
  -- NEW: Enriched misc flags
  a.has_polydactyl,
  a.has_bradycardia,
  a.has_too_young_for_rabies,
  a.has_cryptorchid,
  a.has_hernia,
  a.has_pyometra,
  -- Vitals
  a.cat_weight_lbs,
  a.cat_age_years,
  a.cat_age_months,
  -- Cat details
  c.display_name as cat_name,
  c.sex as cat_sex,
  c.breed as cat_breed,
  c.primary_color as cat_color,
  c.secondary_color as cat_secondary_color,
  ci.id_value as cat_microchip,
  -- Person details
  p.display_name as person_name,
  pi_email.id_value_norm as contact_email,
  pi_phone.id_value_norm as contact_phone,
  -- Place details
  pl.formatted_address as place_address,
  -- Ownership type
  a.ownership_type,
  -- Client name/address from raw (for display)
  a.owner_name as client_name,
  a.owner_address as client_address
FROM trapper.sot_appointments a
LEFT JOIN trapper.sot_cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
LEFT JOIN LATERAL (
  SELECT id_value FROM trapper.cat_identifiers
  WHERE cat_id = a.cat_id AND id_type = 'microchip'
  LIMIT 1
) ci ON true
LEFT JOIN trapper.sot_people p ON p.person_id = a.person_id AND p.merged_into_person_id IS NULL
LEFT JOIN LATERAL (
  SELECT id_value_norm FROM trapper.person_identifiers
  WHERE person_id = a.person_id AND id_type = 'email'
  LIMIT 1
) pi_email ON true
LEFT JOIN LATERAL (
  SELECT id_value_norm FROM trapper.person_identifiers
  WHERE person_id = a.person_id AND id_type = 'phone'
  LIMIT 1
) pi_phone ON true
LEFT JOIN trapper.places pl ON pl.place_id = a.place_id AND pl.merged_into_place_id IS NULL;

COMMENT ON VIEW trapper.v_appointment_detail IS
'Enriched appointment detail view with health flags, vitals, and linked entity info.
Updated in MIG_899 to include polydactyl, bradycardia, too_young_for_rabies, cryptorchid, hernia, pyometra flags.';

-- ============================================================================
-- Phase 4: Summary
-- ============================================================================

\echo ''
\echo '=== MIG_899 Complete ==='
\echo ''
\echo 'Added enriched columns with strict boolean checking:'
\echo '  - has_polydactyl'
\echo '  - has_bradycardia'
\echo '  - has_too_young_for_rabies'
\echo '  - has_cryptorchid'
\echo '  - has_hernia'
\echo '  - has_pyometra'
\echo ''
\echo 'These columns use IN (''Yes'', ''TRUE'', ''true'', ''Y'', ''Checked'')'
\echo 'matching the pattern used by has_uri, has_fleas, etc.'
\echo ''
\echo 'Next: Update AppointmentDetailModal to use these enriched columns'
\echo 'instead of raw_details for misc flags.'
\echo ''
