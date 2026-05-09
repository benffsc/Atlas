-- MIG_3127: Trapper profile capabilities, onboarding stage, and survey infrastructure
--
-- Adds structured fields to trapper_profiles for:
-- 1. Onboarding pipeline stages (new → certified → field_ready → active → inactive)
-- 2. Capabilities (trapping, transport, recon, colony_care, mentoring)
-- 3. Availability and geographic range
-- 4. Equipment and vehicle info
-- 5. Mentor assignment
-- 6. Survey token for internal capabilities survey
--
-- Part of trapper management overhaul (FFS-1433 follow-up)

BEGIN;

-- New columns on trapper_profiles
ALTER TABLE sot.trapper_profiles
  ADD COLUMN IF NOT EXISTS capabilities TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS availability_notes TEXT,
  ADD COLUMN IF NOT EXISTS geographic_range TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_stage TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS has_own_traps BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_vehicle BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS mentor_person_id UUID REFERENCES sot.people(person_id),
  ADD COLUMN IF NOT EXISTS survey_token TEXT,
  ADD COLUMN IF NOT EXISTS survey_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trapping_experience TEXT;

-- Constraint on onboarding_stage
ALTER TABLE sot.trapper_profiles
  ADD CONSTRAINT trapper_profiles_onboarding_stage_check
  CHECK (onboarding_stage IN ('new', 'interested', 'certified', 'field_ready', 'active', 'inactive'));

-- Unique index on survey_token for lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_trapper_profiles_survey_token
  ON sot.trapper_profiles (survey_token) WHERE survey_token IS NOT NULL;

-- Set existing active trappers to 'active' stage (they're already past onboarding)
-- New trappers from VH "interested" group will get 'interested'
-- Trappers who signed agreement but aren't field-ready yet get 'certified'
UPDATE sot.trapper_profiles SET onboarding_stage = 'active' WHERE is_active = true;
UPDATE sot.trapper_profiles SET onboarding_stage = 'inactive' WHERE is_active = false;

-- Backfill Kathy Maylin's availability from notes into dedicated field
UPDATE sot.trapper_profiles
SET availability_notes = 'Usually most available to trap for Monday clinics, except one out of town.'
WHERE person_id = 'fc9d40a0-f3a5-4d4d-941e-eb3bd24d528d'
  AND availability_notes IS NULL;

-- Backfill Michelle Gleed as recon capability
UPDATE sot.trapper_profiles
SET capabilities = ARRAY['recon'],
    geographic_range = 'Windsor area'
WHERE person_id = 'f559d5d7-53a4-44ef-8127-71a80eeaf9ba';

COMMIT;
