-- MIG_051__create_clinichq_upcoming_appointments_table
-- Creates table for ClinicHQ upcoming scheduled appointments (pipeline)
BEGIN;

CREATE TABLE IF NOT EXISTS trapper.clinichq_upcoming_appointments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Source traceability
    source_file text NOT NULL,
    source_row_hash text NOT NULL,
    source_system text NOT NULL DEFAULT 'clinichq',
    -- Timestamps
    appt_date date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- Client info
    client_first_name text,
    client_last_name text,
    client_address text,
    client_cell_phone text,
    client_phone text,
    client_email text,
    client_type text,
    -- Patient/animal info
    animal_name text,
    ownership_type text,
    appt_number int,
    -- Constraints
    CONSTRAINT clinichq_upcoming_source_row_hash_key UNIQUE (source_row_hash)
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_clinichq_upcoming_appt_date
    ON trapper.clinichq_upcoming_appointments (appt_date ASC);

COMMIT;
