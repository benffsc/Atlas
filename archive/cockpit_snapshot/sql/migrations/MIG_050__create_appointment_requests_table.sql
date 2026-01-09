-- MIG_050__create_appointment_requests_table
-- Creates table for Airtable appointment request submissions (demand intake)
BEGIN;

CREATE TABLE IF NOT EXISTS trapper.appointment_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Source traceability
    source_file text NOT NULL,
    source_row_hash text NOT NULL,
    source_system text NOT NULL DEFAULT 'airtable',
    airtable_record_id text,
    -- Timestamps
    submitted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- Contact info
    requester_name text,
    first_name text,
    last_name text,
    email text,
    phone text,
    -- Address fields (text only, no registry linking yet)
    requester_address text,
    requester_city text,
    requester_zip text,
    cats_address text,
    cats_address_clean text,
    county text,
    -- Request details
    cat_count_estimate int,
    situation_description text,
    notes text,
    -- Status tracking
    submission_status text,
    appointment_date date,
    -- Constraints
    CONSTRAINT appointment_requests_source_row_hash_key UNIQUE (source_row_hash)
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_appointment_requests_submitted_at
    ON trapper.appointment_requests (submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointment_requests_status
    ON trapper.appointment_requests (submission_status);

COMMIT;
