-- MIG_2061: Create ops.cat_procedures table for V2
-- Date: 2026-02-13
--
-- Recreates cat_procedures in ops schema for V2 compatibility.
-- Backfills from V1 trapper.cat_procedures.
--
-- This tracks surgical procedures, complications, and post-op care.

\echo ''
\echo '=============================================='
\echo '  MIG_2061: ops.cat_procedures'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE ENUM (if not exists)
-- ============================================================================

\echo '1. Creating procedure_status enum...'

DO $$ BEGIN
    CREATE TYPE ops.procedure_status AS ENUM ('completed', 'attempted', 'deferred', 'not_needed');
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'ops.procedure_status enum already exists';
END $$;

-- ============================================================================
-- 2. CREATE TABLE
-- ============================================================================

\echo ''
\echo '2. Creating ops.cat_procedures table...'

CREATE TABLE IF NOT EXISTS ops.cat_procedures (
    procedure_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES sot.cats(cat_id),
    appointment_id UUID REFERENCES ops.appointments(appointment_id),

    -- Procedure details
    procedure_type TEXT NOT NULL,  -- spay, neuter, dental_cleaning, microchip, ear_tip, etc.
    procedure_date DATE NOT NULL,
    status ops.procedure_status NOT NULL DEFAULT 'completed',

    -- Surgical details
    performed_by TEXT,             -- Vet name
    technician TEXT,

    -- Complications/notes
    complications TEXT[],          -- Array: cryptorchid, hernia, pyometra, hemorrhage, etc.
    post_op_notes TEXT,            -- Bruising expected, cold compress, etc.
    staples_used BOOLEAN DEFAULT FALSE,

    -- For spay/neuter specifically
    is_spay BOOLEAN DEFAULT FALSE,
    is_neuter BOOLEAN DEFAULT FALSE,
    is_cryptorchid BOOLEAN DEFAULT FALSE,
    is_pre_scrotal BOOLEAN DEFAULT FALSE,

    -- Source tracking
    source_system TEXT NOT NULL,
    source_record_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ops_cat_procedures_cat ON ops.cat_procedures(cat_id);
CREATE INDEX IF NOT EXISTS idx_ops_cat_procedures_type ON ops.cat_procedures(procedure_type);
CREATE INDEX IF NOT EXISTS idx_ops_cat_procedures_date ON ops.cat_procedures(procedure_date);
CREATE INDEX IF NOT EXISTS idx_ops_cat_procedures_spay ON ops.cat_procedures(cat_id) WHERE is_spay = TRUE;
CREATE INDEX IF NOT EXISTS idx_ops_cat_procedures_neuter ON ops.cat_procedures(cat_id) WHERE is_neuter = TRUE;

\echo '   Created ops.cat_procedures'

-- ============================================================================
-- 3. BACKFILL FROM V1 (if V1 table exists)
-- ============================================================================

\echo ''
\echo '3. Backfilling from V1 trapper.cat_procedures...'

DO $$
DECLARE
    v_count INT;
BEGIN
    -- Check if V1 table exists
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'trapper' AND table_name = 'cat_procedures'
    ) THEN
        INSERT INTO ops.cat_procedures (
            procedure_id, cat_id, appointment_id,
            procedure_type, procedure_date, status,
            performed_by, technician,
            complications, post_op_notes, staples_used,
            is_spay, is_neuter, is_cryptorchid, is_pre_scrotal,
            source_system, source_record_id, created_at
        )
        SELECT
            v1.procedure_id,
            COALESCE(c.cat_id, v1.cat_id),
            NULL,  -- appointment_id needs separate mapping
            v1.procedure_type,
            v1.procedure_date,
            v1.status::text::ops.procedure_status,
            v1.performed_by,
            v1.technician,
            v1.complications,
            v1.post_op_notes,
            COALESCE(v1.staples_used, FALSE),
            COALESCE(v1.is_spay, FALSE),
            COALESCE(v1.is_neuter, FALSE),
            COALESCE(v1.is_cryptorchid, FALSE),
            COALESCE(v1.is_pre_scrotal, FALSE),
            v1.source_system,
            v1.source_record_id,
            v1.created_at
        FROM trapper.cat_procedures v1
        LEFT JOIN sot.cats c ON c.microchip = (
            SELECT microchip FROM trapper.sot_cats WHERE cat_id = v1.cat_id
        )
        WHERE NOT EXISTS (
            SELECT 1 FROM ops.cat_procedures o WHERE o.procedure_id = v1.procedure_id
        );

        GET DIAGNOSTICS v_count = ROW_COUNT;
        RAISE NOTICE 'Backfilled % procedures from V1', v_count;
    ELSE
        RAISE NOTICE 'V1 trapper.cat_procedures does not exist - skipping backfill';
    END IF;
END $$;

-- ============================================================================
-- 4. ALSO EXTRACT FROM ops.appointments (where procedure data is denormalized)
-- ============================================================================

\echo ''
\echo '4. Extracting procedures from ops.appointments...'

INSERT INTO ops.cat_procedures (
    cat_id, appointment_id,
    procedure_type, procedure_date, status,
    is_spay, is_neuter,
    source_system, created_at
)
SELECT
    a.cat_id,
    a.appointment_id,
    CASE
        WHEN a.is_spay THEN 'spay'
        WHEN a.is_neuter THEN 'neuter'
        ELSE 'alteration'
    END,
    a.appointment_date,
    'completed'::ops.procedure_status,
    COALESCE(a.is_spay, FALSE),
    COALESCE(a.is_neuter, FALSE),
    'clinichq',
    a.created_at
FROM ops.appointments a
WHERE a.cat_id IS NOT NULL
  AND (a.is_spay = TRUE OR a.is_neuter = TRUE OR a.is_alteration = TRUE)
  AND NOT EXISTS (
      SELECT 1 FROM ops.cat_procedures p
      WHERE p.cat_id = a.cat_id
        AND p.appointment_id = a.appointment_id
  );

-- ============================================================================
-- 5. CREATE HELPER VIEW
-- ============================================================================

\echo ''
\echo '5. Creating v_cat_alteration_history view...'

CREATE OR REPLACE VIEW ops.v_cat_alteration_history AS
SELECT
    c.cat_id,
    c.name AS cat_name,
    c.microchip,
    c.sex,
    c.altered_status,
    -- Most recent spay/neuter
    (
        SELECT p.procedure_date
        FROM ops.cat_procedures p
        WHERE p.cat_id = c.cat_id
          AND (p.is_spay OR p.is_neuter)
          AND p.status = 'completed'
        ORDER BY p.procedure_date DESC
        LIMIT 1
    ) AS alteration_date,
    -- Had complications?
    EXISTS (
        SELECT 1 FROM ops.cat_procedures p
        WHERE p.cat_id = c.cat_id
          AND p.complications IS NOT NULL
          AND array_length(p.complications, 1) > 0
    ) AS had_complications,
    -- Total procedures
    (
        SELECT COUNT(*) FROM ops.cat_procedures p WHERE p.cat_id = c.cat_id
    ) AS total_procedures
FROM sot.cats c
WHERE c.merged_into_cat_id IS NULL;

-- ============================================================================
-- 6. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Table row count:'
SELECT COUNT(*) as procedures_count FROM ops.cat_procedures;

\echo ''
\echo 'Procedure types:'
SELECT procedure_type, COUNT(*) as count
FROM ops.cat_procedures
GROUP BY procedure_type
ORDER BY count DESC;

\echo ''
\echo 'Complications found:'
SELECT unnest(complications) as complication, COUNT(*) as count
FROM ops.cat_procedures
WHERE complications IS NOT NULL
GROUP BY unnest(complications)
ORDER BY count DESC
LIMIT 10;

\echo ''
\echo '=============================================='
\echo '  MIG_2061 Complete!'
\echo '=============================================='
\echo ''
