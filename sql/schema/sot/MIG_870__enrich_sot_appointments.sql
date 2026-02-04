\echo '=== MIG_870: Enrich sot_appointments as the gold standard for clinic data ==='
\echo ''
\echo 'Adds health screening, vitals, client snapshot, financial, and surgery detail'
\echo 'columns to sot_appointments. Backfills from all 3 ClinicHQ staged_records'
\echo 'exports (appointment_info, cat_info, owner_info).'
\echo ''

-- ==============================================================
-- Step 1: Add columns to sot_appointments
-- ==============================================================

-- Health screening (booleans)
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS has_uri BOOLEAN DEFAULT FALSE;
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS has_dental_disease BOOLEAN DEFAULT FALSE;
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS has_ear_issue BOOLEAN DEFAULT FALSE;
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS has_eye_issue BOOLEAN DEFAULT FALSE;
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS has_skin_issue BOOLEAN DEFAULT FALSE;
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS has_mouth_issue BOOLEAN DEFAULT FALSE;
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS has_fleas BOOLEAN DEFAULT FALSE;
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS has_ticks BOOLEAN DEFAULT FALSE;
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS has_tapeworms BOOLEAN DEFAULT FALSE;
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS has_ear_mites BOOLEAN DEFAULT FALSE;
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS has_ringworm BOOLEAN DEFAULT FALSE;

-- Tests & surgery detail
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS felv_fiv_result TEXT;
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS body_composition_score TEXT;
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS no_surgery_reason TEXT;

-- Vitals at appointment
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS cat_weight_lbs NUMERIC(5,2);
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS cat_age_years INT;
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS cat_age_months INT;

-- Client snapshot
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS client_name TEXT;
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS client_address TEXT;
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS ownership_type TEXT;

-- Financial
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS total_invoiced NUMERIC(10,2);
ALTER TABLE trapper.sot_appointments ADD COLUMN IF NOT EXISTS subsidy_value NUMERIC(10,2);

\echo 'Columns added.'

-- ==============================================================
-- Step 2: Backfill from appointment_info staged_records
-- ==============================================================

\echo 'Backfilling health screening, tests, financial from appointment_info...'

WITH backfill AS (
  UPDATE trapper.sot_appointments a
  SET
    has_uri = COALESCE(appt.payload->>'URI', appt.payload->>'Upper Respiratory Issue', '') IN ('Yes', 'TRUE', 'true'),
    has_dental_disease = COALESCE(appt.payload->>'Dental Disease', '') IN ('Yes', 'TRUE', 'true'),
    has_ear_issue = COALESCE(appt.payload->>'Ear Issue', appt.payload->>'Ear infections', '') IN ('Yes', 'TRUE', 'true'),
    has_eye_issue = COALESCE(appt.payload->>'Eye Issue', '') IN ('Yes', 'TRUE', 'true'),
    has_skin_issue = COALESCE(appt.payload->>'Skin Issue', '') IN ('Yes', 'TRUE', 'true'),
    has_mouth_issue = COALESCE(appt.payload->>'Mouth Issue', '') IN ('Yes', 'TRUE', 'true'),
    has_fleas = COALESCE(appt.payload->>'Fleas', appt.payload->>'Fleas_1', appt.payload->>'Fleas_2', appt.payload->>'Fleas/Ticks', '') IN ('Yes', 'TRUE', 'true'),
    has_ticks = COALESCE(appt.payload->>'Ticks', appt.payload->>'Ticks_1', appt.payload->>'Ticks_2', '') IN ('Yes', 'TRUE', 'true'),
    has_tapeworms = COALESCE(appt.payload->>'Tapeworms', appt.payload->>'Tapeworms_1', appt.payload->>'Tapeworms_2', '') IN ('Yes', 'TRUE', 'true'),
    has_ear_mites = COALESCE(appt.payload->>'Ear mites', '') IN ('Yes', 'TRUE', 'true'),
    has_ringworm = COALESCE(appt.payload->>'Wood''s Lamp Ringworm Test', '') IN ('Positive', 'Yes', 'TRUE', 'true'),
    felv_fiv_result = NULLIF(TRIM(appt.payload->>'FeLV/FIV (SNAP test, in-house)'), ''),
    body_composition_score = NULLIF(TRIM(appt.payload->>'Body Composition Score'), ''),
    no_surgery_reason = NULLIF(TRIM(appt.payload->>'No Surgery Reason'), ''),
    total_invoiced = CASE
      WHEN appt.payload->>'Total Invoiced' ~ '^\$?[0-9]+\.?[0-9]*$'
      THEN REPLACE(appt.payload->>'Total Invoiced', '$', '')::NUMERIC(10,2)
      ELSE NULL
    END,
    subsidy_value = CASE
      WHEN appt.payload->>'Sub Value' ~ '^\$?[0-9]+\.?[0-9]*$'
      THEN REPLACE(appt.payload->>'Sub Value', '$', '')::NUMERIC(10,2)
      ELSE NULL
    END
  FROM trapper.staged_records appt
  WHERE appt.source_system = 'clinichq'
    AND appt.source_table = 'appointment_info'
    AND appt.payload->>'Number' = a.appointment_number
    AND TO_DATE(appt.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
  RETURNING a.appointment_id
)
SELECT COUNT(*) AS appointment_info_backfilled FROM backfill;

-- ==============================================================
-- Step 3: Backfill weight/age from cat_info staged_records
-- ==============================================================

\echo 'Backfilling weight and age from cat_info...'

WITH backfill AS (
  UPDATE trapper.sot_appointments a
  SET
    cat_weight_lbs = CASE
      WHEN cat_sr.payload->>'Weight' ~ '^[0-9]+\.?[0-9]*$'
        AND (cat_sr.payload->>'Weight')::NUMERIC > 0
      THEN (cat_sr.payload->>'Weight')::NUMERIC(5,2)
      ELSE NULL
    END,
    cat_age_years = CASE
      WHEN cat_sr.payload->>'Age Years' ~ '^[0-9]+$'
      THEN (cat_sr.payload->>'Age Years')::INT
      ELSE NULL
    END,
    cat_age_months = CASE
      WHEN cat_sr.payload->>'Age Months' ~ '^[0-9]+$'
      THEN (cat_sr.payload->>'Age Months')::INT
      ELSE NULL
    END
  FROM trapper.staged_records appt
  JOIN trapper.staged_records cat_sr
    ON cat_sr.source_system = 'clinichq'
    AND cat_sr.source_table = 'cat_info'
    AND cat_sr.payload->>'Microchip Number' = appt.payload->>'Microchip Number'
    AND cat_sr.payload->>'Microchip Number' IS NOT NULL
    AND TRIM(cat_sr.payload->>'Microchip Number') != ''
  WHERE appt.source_system = 'clinichq'
    AND appt.source_table = 'appointment_info'
    AND appt.payload->>'Number' = a.appointment_number
    AND TO_DATE(appt.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
    AND a.cat_weight_lbs IS NULL
  RETURNING a.appointment_id
)
SELECT COUNT(*) AS cat_info_backfilled FROM backfill;

-- ==============================================================
-- Step 4: Backfill client snapshot from owner_info staged_records
-- ==============================================================

\echo 'Backfilling client name, address, ownership from owner_info...'

WITH backfill AS (
  UPDATE trapper.sot_appointments a
  SET
    client_name = NULLIF(TRIM(
      COALESCE(NULLIF(TRIM(own_sr.payload->>'Owner First Name'), ''), '') || ' ' ||
      COALESCE(NULLIF(TRIM(own_sr.payload->>'Owner Last Name'), ''), '')
    ), ''),
    client_address = NULLIF(TRIM(own_sr.payload->>'Owner Address'), ''),
    ownership_type = NULLIF(TRIM(own_sr.payload->>'Ownership'), '')
  FROM trapper.staged_records appt
  JOIN trapper.staged_records own_sr
    ON own_sr.source_system = 'clinichq'
    AND own_sr.source_table = 'owner_info'
    AND own_sr.payload->>'Number' = appt.payload->>'Number'
  WHERE appt.source_system = 'clinichq'
    AND appt.source_table = 'appointment_info'
    AND appt.payload->>'Number' = a.appointment_number
    AND TO_DATE(appt.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
    AND a.client_name IS NULL
  RETURNING a.appointment_id
)
SELECT COUNT(*) AS owner_info_backfilled FROM backfill;

-- ==============================================================
-- Step 5: Create v_appointment_detail view
-- ==============================================================

\echo 'Creating v_appointment_detail view...'

CREATE OR REPLACE VIEW trapper.v_appointment_detail AS
SELECT
  a.appointment_id,
  a.cat_id,
  a.person_id,
  a.place_id,
  a.appointment_date,
  a.appointment_number,
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
  -- New enriched columns
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
MIG_870.';

\echo ''
\echo '=== MIG_870 complete ==='
\echo 'Added 22 columns to sot_appointments.'
\echo 'Backfilled health screening, tests, vitals, client, financial data.'
\echo 'Created v_appointment_detail view as the canonical appointment view.'
