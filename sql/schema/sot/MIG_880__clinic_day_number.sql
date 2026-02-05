\echo '=== MIG_880: Add clinic_day_number to sot_appointments ==='
\echo 'Daily sequential number (1..N) assigned to each cat on a clinic day.'
\echo 'Recycled each day. Useful for cross-referencing waiver forms by date + number.'

ALTER TABLE trapper.sot_appointments
  ADD COLUMN IF NOT EXISTS clinic_day_number SMALLINT;

COMMENT ON COLUMN trapper.sot_appointments.clinic_day_number IS
  'Daily sequential number (1-N) for each cat on a given clinic day. Recycled each day. Used to cross-reference waiver forms against master list CSVs.';

-- Index for lookups by date + number
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_day_lookup
  ON trapper.sot_appointments (appointment_date, clinic_day_number)
  WHERE clinic_day_number IS NOT NULL;

-- Drop and recreate v_appointment_detail to include the new column
-- (CREATE OR REPLACE can't insert columns mid-list without renaming conflicts)
DROP VIEW IF EXISTS trapper.v_appointment_detail;
CREATE VIEW trapper.v_appointment_detail AS
SELECT
  a.appointment_id,
  a.cat_id,
  a.person_id,
  a.place_id,
  a.appointment_date,
  a.appointment_number,
  a.clinic_day_number,
  a.service_type,
  a.appointment_category,
  a.is_spay,
  a.is_neuter,
  a.vet_name,
  a.technician,
  a.temperature,
  a.medical_notes,
  a.is_lactating,
  a.is_pregnant,
  a.is_in_heat,
  a.trapper_person_id,
  a.owner_email,
  a.owner_phone,
  a.partner_org_id,
  -- Enriched columns
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
  a.cat_weight_lbs,
  a.cat_age_years,
  a.cat_age_months,
  a.client_name,
  a.client_address,
  a.ownership_type,
  a.total_invoiced,
  a.subsidy_value,
  -- Joined fields
  c.display_name AS cat_name,
  c.sex AS cat_sex,
  c.breed AS cat_breed,
  c.primary_color AS cat_color,
  c.secondary_color AS cat_secondary_color,
  ci.id_value AS cat_microchip,
  p.display_name AS person_name,
  COALESCE(a.owner_email, p.primary_email) AS contact_email,
  COALESCE(a.owner_phone, p.primary_phone) AS contact_phone,
  pl.formatted_address AS place_address,
  a.source_system,
  a.source_record_id,
  a.created_at,
  a.updated_at
FROM trapper.sot_appointments a
LEFT JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = a.cat_id AND ci.id_type = 'microchip'
LEFT JOIN trapper.sot_people p ON p.person_id = a.person_id
LEFT JOIN trapper.places pl ON pl.place_id = a.place_id;

COMMENT ON VIEW trapper.v_appointment_detail IS
'Gold-standard appointment detail view. Joins sot_appointments (enriched with health screening,
vitals, client, financial data from all 3 ClinicHQ exports) with cat, person, and place info.
MIG_870, updated MIG_880 to add clinic_day_number.';

\echo '=== MIG_880 complete ==='
