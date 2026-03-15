-- MIG_2947: Create ops.potential_trappers table (FFS-558)
--
-- Staging table for the VolunteerHub → Airtable → Atlas trapper onboarding pipeline.
-- Tracks applicants from signup through orientation to contract signing.
-- Populated by scripts/ingest/airtable_potential_trappers_sync.mjs.

BEGIN;

CREATE TABLE IF NOT EXISTS ops.potential_trappers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT,
  email TEXT,
  phone TEXT,
  person_id UUID REFERENCES sot.people(person_id),
  orientation_completed BOOLEAN DEFAULT FALSE,
  contract_sent BOOLEAN DEFAULT FALSE,
  contract_submitted BOOLEAN DEFAULT FALSE,
  pipeline_status TEXT DEFAULT 'new',
  notes TEXT,
  airtable_fields JSONB,
  source_system TEXT DEFAULT 'airtable',
  source_record_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_system, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_potential_trappers_person ON ops.potential_trappers(person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_potential_trappers_status ON ops.potential_trappers(pipeline_status);

COMMENT ON TABLE ops.potential_trappers IS 'Staging table for trapper applicants from VolunteerHub/Airtable onboarding pipeline (FFS-558)';

COMMIT;
