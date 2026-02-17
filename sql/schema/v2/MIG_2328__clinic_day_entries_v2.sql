-- MIG_2328__clinic_day_entries_v2.sql
-- Expand ops.clinic_day_entries to support master list parsing and matching
-- Part of clinic day ground truth workflow

-- Add missing columns to ops.clinic_day_entries for master list import
-- These columns were in V1 but missing from V2 MIG_2206

-- Basic entry info
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS line_number INT;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS raw_client_name TEXT;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS source_description TEXT;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS source_system TEXT DEFAULT 'master_list';
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS entered_by UUID;

-- Parsed fields from master list
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS parsed_owner_name TEXT;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS parsed_cat_name TEXT;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS parsed_trapper_alias TEXT;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS trapper_person_id UUID REFERENCES sot.people(person_id);

-- Counts
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS cat_count INT DEFAULT 1;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS female_count INT DEFAULT 0;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS male_count INT DEFAULT 0;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS unknown_sex_count INT DEFAULT 0;

-- Status flags
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS was_altered BOOLEAN DEFAULT TRUE;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS is_walkin BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS is_already_altered BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS fee_code TEXT;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS test_requested TEXT;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS test_result TEXT;

-- Matching columns
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS matched_appointment_id UUID REFERENCES ops.appointments(appointment_id);
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS match_confidence TEXT CHECK (match_confidence IN ('high', 'medium', 'low', 'manual', 'unmatched'));
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS match_reason TEXT;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ;

-- Extended parsing (from V1 MIG_900)
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS is_foster BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS foster_parent_name TEXT;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS is_shelter BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS org_code TEXT;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS shelter_animal_id TEXT;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS org_name TEXT;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS is_address BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS parsed_address TEXT;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS parsed_cat_color TEXT;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS alt_contact_name TEXT;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS alt_contact_phone TEXT;

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_clinic_day_entries_matched ON ops.clinic_day_entries(matched_appointment_id);
CREATE INDEX IF NOT EXISTS idx_clinic_day_entries_confidence ON ops.clinic_day_entries(match_confidence);
CREATE INDEX IF NOT EXISTS idx_clinic_day_entries_trapper ON ops.clinic_day_entries(trapper_person_id);
CREATE INDEX IF NOT EXISTS idx_clinic_day_entries_source ON ops.clinic_day_entries(source_system);

-- Create view for clinic day entries with joined data
CREATE OR REPLACE VIEW ops.v_clinic_day_entries AS
SELECT
  e.entry_id,
  e.clinic_day_id,
  cd.clinic_date,
  e.cat_id,
  e.appointment_id,
  e.line_number,
  e.raw_client_name,
  e.source_description,
  e.source_system,
  e.parsed_owner_name,
  e.parsed_cat_name,
  e.parsed_trapper_alias,
  e.trapper_person_id,
  trapper.display_name AS trapper_name,
  e.cat_count,
  e.female_count,
  e.male_count,
  e.unknown_sex_count,
  e.was_altered,
  e.is_walkin,
  e.is_already_altered,
  e.fee_code,
  e.matched_appointment_id,
  e.match_confidence,
  e.match_reason,
  e.matched_at,
  e.is_foster,
  e.foster_parent_name,
  e.is_shelter,
  e.org_code,
  e.shelter_animal_id,
  e.org_name,
  e.is_address,
  e.parsed_address,
  e.parsed_cat_color,
  e.contact_phone,
  e.alt_contact_name,
  e.alt_contact_phone,
  e.trap_number,
  e.cage_number,
  e.status,
  e.notes,
  e.created_at,
  -- Joined appointment info
  a.appointment_number,
  a.service_type,
  a.is_spay,
  a.is_neuter,
  a.clinic_day_number,
  -- Joined cat info
  c.name AS cat_name,
  c.sex AS cat_sex,
  c.microchip,
  -- Joined place info
  pl.formatted_address AS place_address,
  -- Staff who entered
  staff.display_name AS entered_by_name
FROM ops.clinic_day_entries e
LEFT JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
LEFT JOIN ops.appointments a ON a.appointment_id = e.matched_appointment_id
LEFT JOIN sot.cats c ON c.cat_id = e.cat_id
LEFT JOIN sot.people trapper ON trapper.person_id = e.trapper_person_id
LEFT JOIN sot.places pl ON pl.place_id = a.inferred_place_id OR pl.place_id = a.place_id
LEFT JOIN ops.staff staff ON staff.person_id = e.entered_by;

COMMENT ON TABLE ops.clinic_day_entries IS 'Master list entries for clinic days - supports parsing and matching workflow';
COMMENT ON VIEW ops.v_clinic_day_entries IS 'Clinic day entries with joined appointment, cat, and trapper data';
