BEGIN;

-- MIG_2853: Potential Trappers Pipeline
-- Tracks VolunteerHub signups going through orientation → contract → approval pipeline.
-- Synced from Airtable "Potential Trappers" table.

CREATE TABLE IF NOT EXISTS ops.potential_trappers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID REFERENCES sot.people(person_id),
    display_name TEXT,
    email TEXT,
    phone TEXT,
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

CREATE INDEX IF NOT EXISTS idx_potential_trappers_person ON ops.potential_trappers(person_id);
CREATE INDEX IF NOT EXISTS idx_potential_trappers_status ON ops.potential_trappers(pipeline_status);
CREATE INDEX IF NOT EXISTS idx_potential_trappers_email ON ops.potential_trappers(email) WHERE email IS NOT NULL;

COMMIT;
