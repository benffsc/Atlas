-- MIG_263__upcoming_appts_windowed_snapshot.sql
-- REL_012: Add windowed snapshot tracking for upcoming appointments
--
-- SAFETY: This migration uses ONLY additive operations:
--   - ALTER TABLE ADD COLUMN (if not exists pattern)
--   - CREATE TABLE IF NOT EXISTS
--   - CREATE INDEX IF NOT EXISTS
--
-- NO DROP, NO TRUNCATE, NO DELETE.
--
-- Purpose:
--   - Track which appointments are "current" vs "stale"
--   - Support windowed snapshot semantics: only expire appts within the import's date range
--   - Log ingest runs for debugging/audit
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_263__upcoming_appts_windowed_snapshot.sql

BEGIN;

-- ============================================================
-- PART A: Ingest runs tracking table
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.ingest_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL UNIQUE,  -- The run_id used by ingest scripts
    source_type TEXT NOT NULL,     -- 'clinichq_upcoming', 'airtable_requests', etc.
    source_file TEXT,              -- Filename ingested
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    coverage_start DATE,           -- Earliest date covered by this import
    coverage_end DATE,             -- Latest date covered by this import
    rows_processed INT DEFAULT 0,
    rows_inserted INT DEFAULT 0,
    rows_updated INT DEFAULT 0,
    rows_staled INT DEFAULT 0,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingest_runs_source_type
    ON trapper.ingest_runs (source_type, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingest_runs_run_id
    ON trapper.ingest_runs (run_id);

COMMENT ON TABLE trapper.ingest_runs IS
'Logs each ingest run for debugging and audit. Tracks coverage window for windowed snapshot semantics.';

-- ============================================================
-- PART B: Add windowed snapshot columns to clinichq_upcoming_appointments
-- ============================================================

-- B1) last_seen_run_id: tracks which import last touched this row
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'clinichq_upcoming_appointments'
        AND column_name = 'last_seen_run_id'
    ) THEN
        ALTER TABLE trapper.clinichq_upcoming_appointments
        ADD COLUMN last_seen_run_id UUID;
    END IF;
END $$;

-- B2) is_current: whether this appointment is still in the "current schedule"
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'clinichq_upcoming_appointments'
        AND column_name = 'is_current'
    ) THEN
        ALTER TABLE trapper.clinichq_upcoming_appointments
        ADD COLUMN is_current BOOLEAN NOT NULL DEFAULT true;
    END IF;
END $$;

-- B3) stale_at: when this appointment was marked stale (removed/cancelled)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'clinichq_upcoming_appointments'
        AND column_name = 'stale_at'
    ) THEN
        ALTER TABLE trapper.clinichq_upcoming_appointments
        ADD COLUMN stale_at TIMESTAMPTZ;
    END IF;
END $$;

-- B4) Index for current appointments queries
CREATE INDEX IF NOT EXISTS idx_clinichq_upcoming_is_current
    ON trapper.clinichq_upcoming_appointments (is_current, appt_date)
    WHERE is_current = true;

-- B5) Index for finding appointments by run_id (for stale marking)
CREATE INDEX IF NOT EXISTS idx_clinichq_upcoming_run_id
    ON trapper.clinichq_upcoming_appointments (last_seen_run_id, appt_date);

-- ============================================================
-- PART C: Comments
-- ============================================================

COMMENT ON COLUMN trapper.clinichq_upcoming_appointments.last_seen_run_id IS
'UUID of the ingest run that last saw this appointment. Used for windowed snapshot staleness detection.';

COMMENT ON COLUMN trapper.clinichq_upcoming_appointments.is_current IS
'True if appointment is part of the current schedule. False if cancelled/removed (stale).';

COMMENT ON COLUMN trapper.clinichq_upcoming_appointments.stale_at IS
'Timestamp when this appointment was marked stale. NULL if still current.';

-- ============================================================
-- PART D: Current schedule view
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_clinichq_upcoming_appointments_current AS
SELECT
    id,
    source_file,
    source_row_hash,
    source_system,
    source_pk,
    appt_date,
    appt_number,
    client_first_name,
    client_last_name,
    client_address,
    client_cell_phone,
    client_phone,
    client_email,
    client_type,
    animal_name,
    ownership_type,
    first_seen_at,
    last_seen_at,
    last_seen_run_id,
    created_at,
    updated_at
FROM trapper.clinichq_upcoming_appointments
WHERE is_current = true
  AND appt_date >= (CURRENT_DATE - INTERVAL '1 day');

COMMENT ON VIEW trapper.v_clinichq_upcoming_appointments_current IS
'Current scheduled appointments. Excludes stale (cancelled/removed) appointments and past appointments older than 1 day.';

COMMIT;
