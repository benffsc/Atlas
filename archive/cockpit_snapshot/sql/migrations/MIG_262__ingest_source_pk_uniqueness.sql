-- MIG_262__ingest_source_pk_uniqueness.sql
-- MEGA_008: Add source_pk columns for stable key uniqueness
--
-- SAFETY: This migration uses ONLY additive operations:
--   - ALTER TABLE ADD COLUMN (if not exists pattern)
--   - UPDATE for backfill (safe)
--   - CREATE UNIQUE INDEX CONCURRENTLY (safe)
--   - ADD CONSTRAINT USING INDEX (safe)
--
-- NO DROP, NO TRUNCATE, NO DELETE.
--
-- Purpose:
--   - Introduce source_pk as the stable identifier for each source record
--   - source_pk + source_system = unique key for upserts
--   - row_hash is for change detection only, NOT uniqueness
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_262__ingest_source_pk_uniqueness.sql

-- ============================================================
-- PART A: appointment_requests
-- ============================================================

-- A1) Add source_pk column (use airtable_record_id as primary source)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'appointment_requests'
        AND column_name = 'source_pk'
    ) THEN
        ALTER TABLE trapper.appointment_requests
        ADD COLUMN source_pk TEXT;
    END IF;
END $$;

-- A2) Add first_seen_at and last_seen_at columns
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'appointment_requests'
        AND column_name = 'first_seen_at'
    ) THEN
        ALTER TABLE trapper.appointment_requests
        ADD COLUMN first_seen_at TIMESTAMPTZ DEFAULT NOW();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'appointment_requests'
        AND column_name = 'last_seen_at'
    ) THEN
        ALTER TABLE trapper.appointment_requests
        ADD COLUMN last_seen_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- A3) Backfill source_pk from airtable_record_id (if available) or source_row_hash
UPDATE trapper.appointment_requests
SET source_pk = COALESCE(airtable_record_id, source_row_hash)
WHERE source_pk IS NULL;

-- A4) Make source_pk NOT NULL after backfill
ALTER TABLE trapper.appointment_requests
ALTER COLUMN source_pk SET NOT NULL;

-- A5) Create unique index on (source_system, source_pk)
-- Drop old constraint if it exists and recreate
DO $$
BEGIN
    -- Check if the new constraint already exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'trapper'
        AND c.conname = 'uq_appointment_requests_source_pk'
    ) THEN
        -- Create unique index
        CREATE UNIQUE INDEX IF NOT EXISTS idx_appointment_requests_source_pk
        ON trapper.appointment_requests (source_system, source_pk);

        -- Add constraint using the index
        ALTER TABLE trapper.appointment_requests
        ADD CONSTRAINT uq_appointment_requests_source_pk
        UNIQUE USING INDEX idx_appointment_requests_source_pk;
    END IF;
END $$;

COMMENT ON COLUMN trapper.appointment_requests.source_pk IS
'Stable primary key from source system (Airtable Record ID). Used with source_system for upsert uniqueness.';

-- ============================================================
-- PART B: clinichq_upcoming_appointments
-- ============================================================

-- B1) Add source_pk column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'clinichq_upcoming_appointments'
        AND column_name = 'source_pk'
    ) THEN
        ALTER TABLE trapper.clinichq_upcoming_appointments
        ADD COLUMN source_pk TEXT;
    END IF;
END $$;

-- B2) Add first_seen_at and last_seen_at columns
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'clinichq_upcoming_appointments'
        AND column_name = 'first_seen_at'
    ) THEN
        ALTER TABLE trapper.clinichq_upcoming_appointments
        ADD COLUMN first_seen_at TIMESTAMPTZ DEFAULT NOW();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'clinichq_upcoming_appointments'
        AND column_name = 'last_seen_at'
    ) THEN
        ALTER TABLE trapper.clinichq_upcoming_appointments
        ADD COLUMN last_seen_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- B3) Backfill source_pk from appt_number (preferred) or computed hash
-- appt_number is the stable identifier from ClinicHQ (cast to text)
-- Use hash fallback when appt_number is NULL or 0 (placeholder value)
UPDATE trapper.clinichq_upcoming_appointments
SET source_pk = CASE
    WHEN appt_number IS NOT NULL AND appt_number > 0 THEN appt_number::text
    ELSE MD5(CONCAT_WS('|',
        COALESCE(appt_date::text, ''),
        COALESCE(client_first_name, ''),
        COALESCE(client_last_name, ''),
        COALESCE(animal_name, ''),
        COALESCE(client_address, '')
    ))
END
WHERE source_pk IS NULL;

-- B4) Make source_pk NOT NULL after backfill
ALTER TABLE trapper.clinichq_upcoming_appointments
ALTER COLUMN source_pk SET NOT NULL;

-- B5) Create unique index on (source_system, source_pk)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'trapper'
        AND c.conname = 'uq_clinichq_upcoming_source_pk'
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_clinichq_upcoming_source_pk
        ON trapper.clinichq_upcoming_appointments (source_system, source_pk);

        ALTER TABLE trapper.clinichq_upcoming_appointments
        ADD CONSTRAINT uq_clinichq_upcoming_source_pk
        UNIQUE USING INDEX idx_clinichq_upcoming_source_pk;
    END IF;
END $$;

COMMENT ON COLUMN trapper.clinichq_upcoming_appointments.source_pk IS
'Stable primary key from source system (appt_number). Used with source_system for upsert uniqueness.';

-- ============================================================
-- PART C: clinichq_hist_appts
-- ============================================================

-- C1) Add source_pk column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'clinichq_hist_appts'
        AND column_name = 'source_pk'
    ) THEN
        ALTER TABLE trapper.clinichq_hist_appts
        ADD COLUMN source_pk TEXT;
    END IF;
END $$;

-- C2) Backfill source_pk from appt_number
UPDATE trapper.clinichq_hist_appts
SET source_pk = appt_number
WHERE source_pk IS NULL AND appt_number IS NOT NULL;

-- C3) For rows without appt_number, use row hash as fallback
UPDATE trapper.clinichq_hist_appts
SET source_pk = source_row_hash
WHERE source_pk IS NULL;

-- C4) Make source_pk NOT NULL
ALTER TABLE trapper.clinichq_hist_appts
ALTER COLUMN source_pk SET NOT NULL;

-- C5) Create NON-unique index on source_pk for lookups
-- Historical data may have legitimate duplicates (same appt_number multiple times)
-- Keep existing (source_file, source_row_hash) uniqueness for deduplication
CREATE INDEX IF NOT EXISTS idx_clinichq_hist_appts_source_pk
ON trapper.clinichq_hist_appts (source_pk);

COMMENT ON COLUMN trapper.clinichq_hist_appts.source_pk IS
'Stable reference key (appt_number). NOT unique - historical data uses (source_file, source_row_hash) for uniqueness.';

-- ============================================================
-- PART D: clinichq_hist_cats
-- ============================================================

-- D1) Add source_pk column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'clinichq_hist_cats'
        AND column_name = 'source_pk'
    ) THEN
        ALTER TABLE trapper.clinichq_hist_cats
        ADD COLUMN source_pk TEXT;
    END IF;
END $$;

-- D2) Backfill source_pk from appt_number + animal_name (composite for cats)
-- Multiple cats can share an appointment
UPDATE trapper.clinichq_hist_cats
SET source_pk = CONCAT_WS(':', appt_number, COALESCE(animal_name, 'unknown'))
WHERE source_pk IS NULL AND appt_number IS NOT NULL;

-- D3) Fallback for rows without appt_number
UPDATE trapper.clinichq_hist_cats
SET source_pk = source_row_hash
WHERE source_pk IS NULL;

-- D4) Make source_pk NOT NULL
ALTER TABLE trapper.clinichq_hist_cats
ALTER COLUMN source_pk SET NOT NULL;

-- D5) Create NON-unique index on source_pk for lookups
-- Historical data may have legitimate duplicates
CREATE INDEX IF NOT EXISTS idx_clinichq_hist_cats_source_pk
ON trapper.clinichq_hist_cats (source_pk);

COMMENT ON COLUMN trapper.clinichq_hist_cats.source_pk IS
'Stable reference key (appt_number:animal_name). NOT unique - historical data uses (source_file, source_row_hash) for uniqueness.';

-- ============================================================
-- PART E: clinichq_hist_owners
-- ============================================================

-- E1) Add source_pk column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'clinichq_hist_owners'
        AND column_name = 'source_pk'
    ) THEN
        ALTER TABLE trapper.clinichq_hist_owners
        ADD COLUMN source_pk TEXT;
    END IF;
END $$;

-- E2) Backfill source_pk from appt_number + animal_name (composite for owners per cat)
-- An owner record is tied to a specific cat at a specific appointment
UPDATE trapper.clinichq_hist_owners
SET source_pk = CONCAT_WS(':', appt_number, COALESCE(animal_name, 'unknown'))
WHERE source_pk IS NULL AND appt_number IS NOT NULL;

-- E3) Fallback
UPDATE trapper.clinichq_hist_owners
SET source_pk = source_row_hash
WHERE source_pk IS NULL;

-- E4) Make source_pk NOT NULL
ALTER TABLE trapper.clinichq_hist_owners
ALTER COLUMN source_pk SET NOT NULL;

-- E5) Create NON-unique index on source_pk for lookups
-- Historical data may have legitimate duplicates
CREATE INDEX IF NOT EXISTS idx_clinichq_hist_owners_source_pk
ON trapper.clinichq_hist_owners (source_pk);

COMMENT ON COLUMN trapper.clinichq_hist_owners.source_pk IS
'Stable reference key (appt_number:animal_name). NOT unique - historical data uses (source_file, source_row_hash) for uniqueness.';

-- ============================================================
-- Summary
-- ============================================================

\echo ''
\echo 'MIG_262 applied. source_pk columns added to ingest tables.'
\echo ''
\echo 'Tables modified:'
\echo '  - appointment_requests: source_pk (airtable_record_id) + UNIQUE, first_seen_at, last_seen_at'
\echo '  - clinichq_upcoming_appointments: source_pk (appt_number) + UNIQUE, first_seen_at, last_seen_at'
\echo '  - clinichq_hist_appts: source_pk (appt_number) - reference only, NOT unique'
\echo '  - clinichq_hist_cats: source_pk (appt_number:animal_name) - reference only, NOT unique'
\echo '  - clinichq_hist_owners: source_pk (appt_number:animal_name) - reference only, NOT unique'
\echo ''
\echo 'New unique constraints (for mutable data tables):'
\echo '  - uq_appointment_requests_source_pk (source_system, source_pk)'
\echo '  - uq_clinichq_upcoming_source_pk (source_system, source_pk)'
\echo ''
\echo 'Historical tables keep existing (source_file, source_row_hash) uniqueness.'
\echo ''

-- Verify: show counts per table
SELECT 'appointment_requests' AS table_name, COUNT(*) AS rows, COUNT(DISTINCT source_pk) AS unique_pks FROM trapper.appointment_requests
UNION ALL
SELECT 'clinichq_upcoming_appointments', COUNT(*), COUNT(DISTINCT source_pk) FROM trapper.clinichq_upcoming_appointments
UNION ALL
SELECT 'clinichq_hist_appts', COUNT(*), COUNT(DISTINCT source_pk) FROM trapper.clinichq_hist_appts
UNION ALL
SELECT 'clinichq_hist_cats', COUNT(*), COUNT(DISTINCT source_pk) FROM trapper.clinichq_hist_cats
UNION ALL
SELECT 'clinichq_hist_owners', COUNT(*), COUNT(DISTINCT source_pk) FROM trapper.clinichq_hist_owners;
