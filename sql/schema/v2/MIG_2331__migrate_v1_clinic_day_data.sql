-- MIG_2331__migrate_v1_clinic_day_data.sql
-- Migrate clinic day numbers and master list entries from V1 to V2
--
-- V1 had:
-- - clinic_day_number on trapper.sot_appointments (manually assigned)
-- - clinic_day_entries with parsed master list data
--
-- This migration copies both to V2 via dblink

-- ============================================================================
-- STEP 1: Migrate clinic_day_numbers from V1 appointments to V2
-- ============================================================================

-- Update V2 appointments with V1 clinic_day_numbers (matched by appointment_number)
WITH v1_numbers AS (
  SELECT
    appointment_number,
    clinic_day_number
  FROM dblink(
      'dbname=postgres host=aws-1-us-east-2.pooler.supabase.com port=5432 user=postgres.tpjllrfpdlkenbapvpko password=''vfh0xba!ujx!gwz!UGJ'' sslmode=require',
      'SELECT appointment_number, clinic_day_number
       FROM trapper.sot_appointments
       WHERE clinic_day_number IS NOT NULL'
  ) AS v1(appointment_number TEXT, clinic_day_number SMALLINT)
)
UPDATE ops.appointments a
SET clinic_day_number = v1.clinic_day_number
FROM v1_numbers v1
WHERE a.appointment_number = v1.appointment_number
  AND a.clinic_day_number IS NULL;

-- ============================================================================
-- STEP 2: Ensure clinic_days exist for V1 dates
-- ============================================================================

INSERT INTO ops.clinic_days (clinic_date)
SELECT DISTINCT clinic_date
FROM dblink(
    'dbname=postgres host=aws-1-us-east-2.pooler.supabase.com port=5432 user=postgres.tpjllrfpdlkenbapvpko password=''vfh0xba!ujx!gwz!UGJ'' sslmode=require',
    'SELECT DISTINCT cd.clinic_date
     FROM trapper.clinic_day_entries e
     JOIN trapper.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
     WHERE cd.clinic_date >= ''2026-01-01'''
) AS v1(clinic_date DATE)
ON CONFLICT (clinic_date) DO NOTHING;

-- ============================================================================
-- STEP 3: Migrate clinic_day_entries from V1 to V2
-- ============================================================================

-- Map V1 status 'completed' -> V2 status 'released'
-- Map matched_appointment_id via appointment_number
INSERT INTO ops.clinic_day_entries (
    entry_id,
    clinic_day_id,
    line_number,
    raw_client_name,
    parsed_owner_name,
    parsed_cat_name,
    parsed_trapper_alias,
    cat_count,
    female_count,
    male_count,
    unknown_sex_count,
    was_altered,
    is_walkin,
    is_already_altered,
    fee_code,
    notes,
    status,
    source_system,
    matched_appointment_id,
    match_confidence,
    match_reason,
    is_foster,
    foster_parent_name,
    is_shelter,
    org_code,
    shelter_animal_id,
    org_name,
    is_address,
    parsed_address,
    parsed_cat_color,
    contact_phone,
    alt_contact_name,
    alt_contact_phone,
    created_at
)
SELECT
    v1.entry_id,
    cd.clinic_day_id,
    v1.line_number,
    v1.raw_client_name,
    v1.parsed_owner_name,
    v1.parsed_cat_name,
    v1.parsed_trapper_alias,
    v1.cat_count,
    v1.female_count,
    v1.male_count,
    v1.unknown_sex_count,
    v1.was_altered,
    v1.is_walkin,
    v1.is_already_altered,
    v1.fee_code,
    v1.notes,
    CASE WHEN v1.status = 'completed' THEN 'released' ELSE v1.status END,
    'master_list',
    a2.appointment_id,
    v1.match_confidence,
    v1.match_reason,
    v1.is_foster,
    v1.foster_parent_name,
    v1.is_shelter,
    v1.org_code,
    v1.shelter_animal_id,
    v1.org_name,
    v1.is_address,
    v1.parsed_address,
    v1.parsed_cat_color,
    v1.contact_phone,
    v1.alt_contact_name,
    v1.alt_contact_phone,
    v1.created_at
FROM dblink(
    'dbname=postgres host=aws-1-us-east-2.pooler.supabase.com port=5432 user=postgres.tpjllrfpdlkenbapvpko password=''vfh0xba!ujx!gwz!UGJ'' sslmode=require',
    'SELECT
        e.entry_id, cd.clinic_date, e.line_number, e.raw_client_name,
        e.parsed_owner_name, e.parsed_cat_name, e.parsed_trapper_alias,
        e.cat_count, e.female_count, e.male_count, e.unknown_sex_count,
        e.was_altered, e.is_walkin, e.is_already_altered, e.fee_code,
        e.notes, e.status, a.appointment_number, e.match_confidence, e.match_reason,
        e.is_foster, e.foster_parent_name, e.is_shelter, e.org_code,
        e.shelter_animal_id, e.org_name, e.is_address, e.parsed_address,
        e.parsed_cat_color, e.contact_phone, e.alt_contact_name, e.alt_contact_phone,
        e.created_at
     FROM trapper.clinic_day_entries e
     JOIN trapper.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
     LEFT JOIN trapper.sot_appointments a ON a.appointment_id = e.matched_appointment_id
     WHERE cd.clinic_date >= ''2026-01-01'''
) AS v1(
    entry_id UUID, clinic_date DATE, line_number INT, raw_client_name TEXT,
    parsed_owner_name TEXT, parsed_cat_name TEXT, parsed_trapper_alias TEXT,
    cat_count INT, female_count INT, male_count INT, unknown_sex_count INT,
    was_altered BOOLEAN, is_walkin BOOLEAN, is_already_altered BOOLEAN, fee_code TEXT,
    notes TEXT, status TEXT, v1_appointment_number TEXT, match_confidence TEXT, match_reason TEXT,
    is_foster BOOLEAN, foster_parent_name TEXT, is_shelter BOOLEAN, org_code TEXT,
    shelter_animal_id TEXT, org_name TEXT, is_address BOOLEAN, parsed_address TEXT,
    parsed_cat_color TEXT, contact_phone TEXT, alt_contact_name TEXT, alt_contact_phone TEXT,
    created_at TIMESTAMPTZ
)
JOIN ops.clinic_days cd ON cd.clinic_date = v1.clinic_date
LEFT JOIN ops.appointments a2 ON a2.appointment_number = v1.v1_appointment_number
ON CONFLICT (entry_id) DO NOTHING;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Show migrated clinic_day_numbers
SELECT 'Clinic day numbers migrated:' AS info;
SELECT
  appointment_date,
  COUNT(*) as total_appointments,
  COUNT(clinic_day_number) as with_clinic_number
FROM ops.appointments
WHERE appointment_date >= '2026-01-26'
  AND clinic_day_number IS NOT NULL
GROUP BY appointment_date
ORDER BY appointment_date;

-- Show migrated master list entries
SELECT 'Master list entries migrated:' AS info;
SELECT
  cd.clinic_date,
  COUNT(*) as total_entries,
  COUNT(e.matched_appointment_id) as matched_entries
FROM ops.clinic_day_entries e
JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
WHERE cd.clinic_date >= '2026-01-01'
GROUP BY cd.clinic_date
ORDER BY cd.clinic_date;
