-- MIG_2943: Foster agreements table
-- Tracks signed foster agreements (imported from Airtable).

CREATE TABLE IF NOT EXISTS ops.foster_agreements (
  agreement_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id      UUID NOT NULL REFERENCES sot.people(person_id),
  agreement_type TEXT NOT NULL DEFAULT 'foster'
    CHECK (agreement_type IN ('foster', 'forever_foster')),
  signed_at      TIMESTAMPTZ,
  source_system  TEXT NOT NULL DEFAULT 'airtable',
  source_record_id TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_foster_agreements_person
  ON ops.foster_agreements(person_id);

CREATE INDEX IF NOT EXISTS idx_foster_agreements_type
  ON ops.foster_agreements(agreement_type);

-- Prevent duplicate imports from same source record
CREATE UNIQUE INDEX IF NOT EXISTS idx_foster_agreements_source_unique
  ON ops.foster_agreements(source_system, source_record_id)
  WHERE source_record_id IS NOT NULL;

COMMENT ON TABLE ops.foster_agreements IS
  'Tracks signed foster agreements. Source of truth for agreement status is Airtable imports.';
