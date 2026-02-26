\echo '=== MIG_2511: Journal archive audit enhancements ==='
\echo 'Adding dedicated archive tracking columns for accountability'

-- ============================================================
-- Problem: Journal entries use is_archived and store reason in
-- meta JSONB, but lack proper audit trail columns like other
-- archived entities (request_media, etc.)
--
-- Solution: Add dedicated columns for consistent audit trail
-- ============================================================

-- 1. Add archive tracking columns
ALTER TABLE ops.journal_entries
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS archived_by_staff_id UUID REFERENCES ops.staff(staff_id),
ADD COLUMN IF NOT EXISTS archive_reason TEXT,
ADD COLUMN IF NOT EXISTS archive_notes TEXT;

\echo 'Added archive tracking columns'

-- 2. Backfill archived_at from existing archived entries
UPDATE ops.journal_entries
SET archived_at = updated_at
WHERE is_archived = TRUE AND archived_at IS NULL;

\echo 'Backfilled archived_at from updated_at for existing archived entries'

-- 3. Backfill archive_reason from meta JSONB if exists
UPDATE ops.journal_entries
SET archive_reason = meta->>'archive_reason'
WHERE is_archived = TRUE
  AND archive_reason IS NULL
  AND meta->>'archive_reason' IS NOT NULL;

\echo 'Backfilled archive_reason from meta JSONB'

-- 4. Create index for archived entries queries
CREATE INDEX IF NOT EXISTS idx_journal_archived_at
ON ops.journal_entries(archived_at DESC)
WHERE is_archived = TRUE;

CREATE INDEX IF NOT EXISTS idx_journal_archive_reason
ON ops.journal_entries(archive_reason)
WHERE is_archived = TRUE;

\echo 'Created indexes for archived entries'

-- 5. Create CHECK constraint for valid archive reasons
-- Using a function to allow adding new reasons without migration
CREATE OR REPLACE FUNCTION ops.is_valid_journal_archive_reason(reason TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN reason IS NULL OR reason IN (
        'duplicate',      -- Entry duplicates another journal note
        'error',          -- Data entry error (requires notes)
        'irrelevant',     -- No longer relevant
        'wrong_entity',   -- Attached to wrong cat/person/place (requires notes)
        'test_data',      -- Created for testing
        'merged',         -- Entity was merged, entry redundant
        'other'           -- Other reason (requires notes)
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Add constraint (soft - doesn't break existing data)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'ops'
        AND table_name = 'journal_entries'
        AND constraint_name = 'chk_journal_archive_reason'
    ) THEN
        ALTER TABLE ops.journal_entries
        ADD CONSTRAINT chk_journal_archive_reason
        CHECK (ops.is_valid_journal_archive_reason(archive_reason));
        RAISE NOTICE 'Added archive_reason CHECK constraint';
    END IF;
END;
$$;

\echo 'Created archive reason validation function'

-- 6. Create helper function to check if archive reason requires notes
CREATE OR REPLACE FUNCTION ops.journal_archive_reason_requires_notes(reason TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN reason IN ('error', 'wrong_entity', 'other');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

\echo 'Created archive notes requirement function'

-- 7. Verify columns exist
DO $$
DECLARE
    missing_cols TEXT[];
BEGIN
    SELECT array_agg(col) INTO missing_cols
    FROM unnest(ARRAY['archived_at', 'archived_by_staff_id', 'archive_reason', 'archive_notes']) AS col
    WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'ops' AND table_name = 'journal_entries' AND column_name = col
    );

    IF missing_cols IS NOT NULL AND array_length(missing_cols, 1) > 0 THEN
        RAISE WARNING 'Missing columns: %', array_to_string(missing_cols, ', ');
    ELSE
        RAISE NOTICE 'All archive audit columns present';
    END IF;
END;
$$;

\echo ''
\echo '=== MIG_2511 complete ==='
\echo 'Journal entries now have proper archive audit trail:'
\echo '  - archived_at: When entry was archived'
\echo '  - archived_by_staff_id: Who archived it (links to staff)'
\echo '  - archive_reason: Required reason code'
\echo '  - archive_notes: Optional context notes'
