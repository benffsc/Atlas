\echo '=== MIG_2336: Fix journal_entries for communications ==='
\echo 'Adding columns needed by /api/intake/[id]/communications'

-- ============================================================
-- Problem: The communications API expects these columns:
--   - submission_id (link to intake submissions)
--   - contact_method (phone, email, text, etc.)
--   - contact_result (answered, no_answer, etc.)
--   - created_by (staff name text)
--   - created_by_staff_id (UUID link to ops.staff)
--   - person_id (for entity linking)
--   - request_id (for entity linking)
--
-- But the V2 ops.journal_entries table was created with a different
-- schema focused on place observations, not communications.
-- ============================================================

-- Add missing columns for intake communications
ALTER TABLE ops.journal_entries
ADD COLUMN IF NOT EXISTS submission_id UUID,
ADD COLUMN IF NOT EXISTS contact_method TEXT,
ADD COLUMN IF NOT EXISTS contact_result TEXT,
ADD COLUMN IF NOT EXISTS created_by TEXT,
ADD COLUMN IF NOT EXISTS created_by_staff_id UUID REFERENCES ops.staff(staff_id),
ADD COLUMN IF NOT EXISTS person_id UUID,
ADD COLUMN IF NOT EXISTS request_id UUID;

\echo 'Added columns: submission_id, contact_method, contact_result, created_by, created_by_staff_id, person_id, request_id'

-- Update entry_type CHECK constraint to allow communication types
-- First drop the old constraint if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
        WHERE table_schema = 'ops' AND table_name = 'journal_entries'
          AND column_name = 'entry_type'
    ) THEN
        ALTER TABLE ops.journal_entries DROP CONSTRAINT IF EXISTS journal_entries_entry_type_check;
    END IF;
END;
$$;

-- Add new constraint that includes communication types
ALTER TABLE ops.journal_entries
ADD CONSTRAINT journal_entries_entry_type_check CHECK (
    entry_type IN (
        -- Original place observation types
        'visit', 'observation', 'feeding', 'trap_attempt', 'note', 'followup',
        -- Communication/contact types
        'contact_attempt', 'communication', 'system',
        -- Medical/intake types
        'medical', 'intake', 'status_change'
    )
);

\echo 'Updated entry_type CHECK constraint to allow communication types'

-- Make place_id nullable (was NOT NULL but communications don't always have a place)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'ops' AND table_name = 'journal_entries'
          AND column_name = 'place_id' AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE ops.journal_entries ALTER COLUMN place_id DROP NOT NULL;
        RAISE NOTICE 'Made place_id nullable';
    END IF;
END;
$$;

-- Create indexes for new query patterns
CREATE INDEX IF NOT EXISTS idx_journal_submission
    ON ops.journal_entries(submission_id) WHERE submission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_staff
    ON ops.journal_entries(created_by_staff_id) WHERE created_by_staff_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_person
    ON ops.journal_entries(person_id) WHERE person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_request
    ON ops.journal_entries(request_id) WHERE request_id IS NOT NULL;

\echo 'Created indexes for submission_id, created_by_staff_id, person_id, request_id'

-- Also ensure communication_logs exists for legacy compatibility
-- (The API reads from both tables and merges)
CREATE TABLE IF NOT EXISTS ops.communication_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL,
    contact_method TEXT NOT NULL,
    contact_result TEXT NOT NULL,
    notes TEXT,
    contacted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    contacted_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comm_logs_submission
    ON ops.communication_logs(submission_id);

\echo 'Ensured ops.communication_logs exists for legacy data'

\echo ''
\echo '=== MIG_2336 complete ==='
\echo 'journal_entries now supports:'
\echo '  - Intake communications (via submission_id)'
\echo '  - Contact tracking (contact_method, contact_result)'
\echo '  - Staff attribution (created_by, created_by_staff_id)'
\echo '  - Entity linking (person_id, request_id)'
\echo ''
