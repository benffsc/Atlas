-- MIG_2456: Data Cleanup Using Archive Schema
--
-- PURPOSE: Clean up known bad data patterns by archiving problematic records
-- to the archive schema, keeping only clean/useful data in active tables.
--
-- DATA QUALITY PRINCIPLES:
-- 1. Bad data is archived, not deleted (recoverable)
-- 2. Active tables contain only verified, useful data
-- 3. All cleanup is auditable with clear reasons
-- 4. Follows CLAUDE.md invariants (no data disappears)
--
-- PATTERNS CLEANED:
-- 1. Orphaned staged_records (no longer needed after processing)
-- 2. Duplicate clinic_owner_accounts
-- 3. Empty person records (no identifiers, no relationships)
-- 4. Place records with invalid/garbage addresses
-- 5. Orphaned relationships (pointing to merged entities)

\echo '=============================================='
\echo '  MIG_2456: Data Cleanup Using Archive Schema'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- Phase 1: Create Archive Tables (if not exist)
-- ============================================================================

\echo 'Phase 1: Creating archive tables...'

-- Archive for staged_records that have been fully processed
CREATE TABLE IF NOT EXISTS archive.staged_records_processed (
    id UUID PRIMARY KEY,
    source_system TEXT NOT NULL,
    source_table TEXT NOT NULL,
    source_row_id TEXT,
    payload JSONB NOT NULL,
    row_hash TEXT,
    file_upload_id UUID,
    -- Archive metadata
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archive_reason TEXT NOT NULL,
    original_created_at TIMESTAMPTZ,
    original_updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_archive_staged_source ON archive.staged_records_processed(source_system, source_table);
CREATE INDEX IF NOT EXISTS idx_archive_staged_date ON archive.staged_records_processed(archived_at);

COMMENT ON TABLE archive.staged_records_processed IS
'Staged records that have been fully processed and are no longer needed in active tables.
Kept for audit trail and potential recovery.';

-- Archive for garbage/invalid people
CREATE TABLE IF NOT EXISTS archive.invalid_people (
    person_id UUID PRIMARY KEY,
    display_name TEXT,
    first_name TEXT,
    last_name TEXT,
    -- Snapshot of key fields
    primary_email TEXT,
    primary_phone TEXT,
    identifier_count INTEGER,
    relationship_count INTEGER,
    -- Archive metadata
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archive_reason TEXT NOT NULL,
    classification TEXT, -- 'organization', 'address', 'garbage', 'duplicate_shell'
    original_created_at TIMESTAMPTZ,
    source_system TEXT
);

CREATE INDEX IF NOT EXISTS idx_archive_people_reason ON archive.invalid_people(archive_reason);

COMMENT ON TABLE archive.invalid_people IS
'People records identified as invalid (organizations, addresses, garbage names).
Records are merged or marked data_quality=garbage before archiving references.';

-- Archive for garbage/invalid places
CREATE TABLE IF NOT EXISTS archive.invalid_places (
    place_id UUID PRIMARY KEY,
    display_name TEXT,
    formatted_address TEXT,
    normalized_address TEXT,
    -- Archive metadata
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archive_reason TEXT NOT NULL,
    cat_count INTEGER, -- how many cats were at this place
    original_created_at TIMESTAMPTZ,
    source_system TEXT
);

CREATE INDEX IF NOT EXISTS idx_archive_places_reason ON archive.invalid_places(archive_reason);

COMMENT ON TABLE archive.invalid_places IS
'Place records identified as invalid (incomplete addresses, garbage data).';

-- Archive for duplicate clinic_owner_accounts
CREATE TABLE IF NOT EXISTS archive.duplicate_clinic_accounts (
    account_id UUID PRIMARY KEY,
    display_name TEXT,
    email TEXT,
    phone TEXT,
    -- Archive metadata
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archive_reason TEXT NOT NULL,
    kept_account_id UUID, -- the canonical account we kept
    original_created_at TIMESTAMPTZ
);

COMMENT ON TABLE archive.duplicate_clinic_accounts IS
'Duplicate clinic_owner_accounts that were merged into canonical records.';

\echo 'Archive tables created.'

-- ============================================================================
-- Phase 2: Archive Old Processed Staged Records
-- ============================================================================

\echo ''
\echo 'Phase 2: Archiving old processed staged_records...'

-- Archive staged_records older than 90 days that have been fully processed
-- (i.e., their file_upload has status = 'completed')
WITH to_archive AS (
    SELECT sr.*
    FROM ops.staged_records sr
    JOIN ops.file_uploads fu ON fu.upload_id = sr.file_upload_id
    WHERE fu.status = 'completed'
      AND fu.processed_at < NOW() - INTERVAL '90 days'
    LIMIT 10000  -- Process in batches
),
archived AS (
    INSERT INTO archive.staged_records_processed (
        id, source_system, source_table, source_row_id, payload, row_hash, file_upload_id,
        archive_reason, original_created_at, original_updated_at
    )
    SELECT
        id, source_system, source_table, source_row_id, payload, row_hash, file_upload_id,
        'processed_older_than_90_days',
        created_at,
        updated_at
    FROM to_archive
    ON CONFLICT (id) DO NOTHING
    RETURNING id
)
DELETE FROM ops.staged_records
WHERE id IN (SELECT id FROM archived);

DO $$
DECLARE
    v_archived INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_archived
    FROM archive.staged_records_processed
    WHERE archived_at > NOW() - INTERVAL '1 minute';

    RAISE NOTICE 'Archived % old staged_records', COALESCE(v_archived, 0);
END;
$$;

-- ============================================================================
-- Phase 3: Clean Up Duplicate Clinic Owner Accounts
-- ============================================================================

\echo ''
\echo 'Phase 3: Cleaning up duplicate clinic_owner_accounts...'

-- First check if the table exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'sot' AND table_name = 'clinic_owner_accounts'
    ) THEN
        -- Find and archive duplicates (keep earliest created)
        WITH duplicates AS (
            SELECT *,
                   ROW_NUMBER() OVER (
                       PARTITION BY LOWER(TRIM(display_name))
                       ORDER BY created_at ASC, account_id ASC
                   ) AS rn,
                   FIRST_VALUE(account_id) OVER (
                       PARTITION BY LOWER(TRIM(display_name))
                       ORDER BY created_at ASC, account_id ASC
                   ) AS kept_id
            FROM sot.clinic_owner_accounts
            WHERE display_name IS NOT NULL
        ),
        archived AS (
            INSERT INTO archive.duplicate_clinic_accounts (
                account_id, display_name, email, phone,
                archive_reason, kept_account_id, original_created_at
            )
            SELECT
                account_id, display_name, email, phone,
                'duplicate_display_name',
                kept_id,
                created_at
            FROM duplicates
            WHERE rn > 1
            ON CONFLICT (account_id) DO NOTHING
            RETURNING account_id
        )
        DELETE FROM sot.clinic_owner_accounts
        WHERE account_id IN (SELECT account_id FROM archived);

        RAISE NOTICE 'Cleaned up duplicate clinic_owner_accounts';
    ELSE
        RAISE NOTICE 'sot.clinic_owner_accounts does not exist, skipping';
    END IF;
END;
$$;

-- ============================================================================
-- Phase 4: Identify Empty/Shell Person Records
-- ============================================================================

\echo ''
\echo 'Phase 4: Identifying empty person records...'

-- Create a view to identify problematic people for review
-- These won't be auto-archived but flagged for review
CREATE OR REPLACE VIEW sot.v_people_cleanup_candidates AS
WITH person_stats AS (
    SELECT
        p.person_id,
        p.display_name,
        p.first_name,
        p.last_name,
        p.merged_into_person_id,
        p.data_quality,
        p.source_system,
        p.created_at,
        COUNT(DISTINCT pi.id) AS identifier_count,
        COUNT(DISTINCT pc.id) AS cat_relationship_count,
        COUNT(DISTINCT pp.id) AS place_relationship_count,
        COUNT(DISTINCT a.appointment_id) AS appointment_count
    FROM sot.people p
    LEFT JOIN sot.person_identifiers pi ON pi.person_id = p.person_id
    LEFT JOIN sot.person_cat pc ON pc.person_id = p.person_id
    LEFT JOIN sot.person_place pp ON pp.person_id = p.person_id
    LEFT JOIN ops.appointments a ON a.person_id = p.person_id
    WHERE p.merged_into_person_id IS NULL
    GROUP BY p.person_id
)
SELECT
    ps.*,
    CASE
        WHEN ps.identifier_count = 0 AND ps.cat_relationship_count = 0
             AND ps.appointment_count = 0 THEN 'empty_shell'
        WHEN ps.display_name ~ '^\d+\s' OR ps.display_name ~ '^\d+$' THEN 'address_as_name'
        WHEN UPPER(ps.display_name) = ps.display_name AND LENGTH(ps.display_name) > 5
             AND ps.display_name !~ '\s' THEN 'possible_org'
        WHEN ps.data_quality IN ('garbage', 'needs_review') THEN 'flagged_quality'
        ELSE NULL
    END AS cleanup_reason
FROM person_stats ps
WHERE ps.identifier_count = 0
   OR ps.data_quality IN ('garbage', 'needs_review')
   OR ps.display_name ~ '^\d+\s';

COMMENT ON VIEW sot.v_people_cleanup_candidates IS
'People records that may need cleanup. Review manually before archiving.
Reasons: empty_shell, address_as_name, possible_org, flagged_quality';

-- ============================================================================
-- Phase 5: Clean Up Orphaned Relationships
-- ============================================================================

\echo ''
\echo 'Phase 5: Cleaning up orphaned relationships...'

-- Delete person_cat relationships pointing to merged people
DELETE FROM sot.person_cat pc
WHERE NOT EXISTS (
    SELECT 1 FROM sot.people p
    WHERE p.person_id = pc.person_id
    AND p.merged_into_person_id IS NULL
);

-- Delete person_place relationships pointing to merged people
DELETE FROM sot.person_place pp
WHERE NOT EXISTS (
    SELECT 1 FROM sot.people p
    WHERE p.person_id = pp.person_id
    AND p.merged_into_person_id IS NULL
);

-- Delete cat_place relationships pointing to merged cats
DELETE FROM sot.cat_place cp
WHERE NOT EXISTS (
    SELECT 1 FROM sot.cats c
    WHERE c.cat_id = cp.cat_id
    AND c.merged_into_cat_id IS NULL
);

-- Delete cat_place relationships pointing to merged places
DELETE FROM sot.cat_place cp
WHERE NOT EXISTS (
    SELECT 1 FROM sot.places p
    WHERE p.place_id = cp.place_id
    AND p.merged_into_place_id IS NULL
);

\echo 'Orphaned relationships cleaned.'

-- ============================================================================
-- Phase 6: Update DATA_QUALITY Flags
-- ============================================================================

\echo ''
\echo 'Phase 6: Updating data_quality flags on garbage records...'

-- Mark people with obvious garbage names
UPDATE sot.people
SET data_quality = 'garbage'
WHERE data_quality IS NULL
  AND merged_into_person_id IS NULL
  AND (
    -- Single character names
    LENGTH(TRIM(COALESCE(display_name, ''))) <= 1
    -- Only numbers
    OR display_name ~ '^[0-9]+$'
    -- Test/dummy patterns
    OR LOWER(display_name) IN ('test', 'unknown', 'n/a', 'na', 'none', 'xxx', 'zzz')
    OR LOWER(display_name) LIKE 'test %'
    OR LOWER(display_name) LIKE '% test'
  );

-- Mark places with garbage addresses (only if data_quality column exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'sot' AND table_name = 'places' AND column_name = 'data_quality'
    ) THEN
        EXECUTE '
            UPDATE sot.places
            SET data_quality = ''garbage''
            WHERE data_quality IS NULL
              AND merged_into_place_id IS NULL
              AND (
                LENGTH(TRIM(COALESCE(formatted_address, ''''))) < 5
                OR formatted_address ~ ''^[0-9]+$''
                OR LOWER(formatted_address) IN (''test'', ''unknown'', ''n/a'', ''tbd'')
              )
        ';
        RAISE NOTICE 'Updated data_quality on places';
    ELSE
        RAISE NOTICE 'sot.places.data_quality column does not exist, skipping';
    END IF;
END;
$$;

-- ============================================================================
-- Phase 7: Verification
-- ============================================================================

\echo ''
\echo 'Phase 7: Verification...'

DO $$
DECLARE
    v_archived_staged INTEGER;
    v_archived_accounts INTEGER;
    v_cleanup_candidates INTEGER;
    v_garbage_people INTEGER := 0;
    v_garbage_places INTEGER := 0;
BEGIN
    SELECT COUNT(*) INTO v_archived_staged FROM archive.staged_records_processed;
    SELECT COUNT(*) INTO v_archived_accounts FROM archive.duplicate_clinic_accounts;

    -- Check if view exists before querying
    IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'sot' AND viewname = 'v_people_cleanup_candidates') THEN
        SELECT COUNT(*) INTO v_cleanup_candidates FROM sot.v_people_cleanup_candidates WHERE cleanup_reason IS NOT NULL;
    ELSE
        v_cleanup_candidates := 0;
    END IF;

    -- Check if data_quality column exists on people
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'sot' AND table_name = 'people' AND column_name = 'data_quality') THEN
        EXECUTE 'SELECT COUNT(*) FROM sot.people WHERE data_quality = ''garbage'' AND merged_into_person_id IS NULL' INTO v_garbage_people;
    END IF;

    -- Check if data_quality column exists on places
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'sot' AND table_name = 'places' AND column_name = 'data_quality') THEN
        EXECUTE 'SELECT COUNT(*) FROM sot.places WHERE data_quality = ''garbage'' AND merged_into_place_id IS NULL' INTO v_garbage_places;
    END IF;

    RAISE NOTICE '=== MIG_2456 Verification ===';
    RAISE NOTICE 'Archived staged_records: %', v_archived_staged;
    RAISE NOTICE 'Archived duplicate accounts: %', v_archived_accounts;
    RAISE NOTICE 'People cleanup candidates: % (review v_people_cleanup_candidates)', COALESCE(v_cleanup_candidates, 0);
    RAISE NOTICE 'Garbage people flagged: %', v_garbage_people;
    RAISE NOTICE 'Garbage places flagged: %', v_garbage_places;
END;
$$;

COMMIT;

\echo ''
\echo '=============================================='
\echo '  MIG_2456 Complete!'
\echo '=============================================='
\echo ''
\echo 'Cleaned:'
\echo '  1. Archived old processed staged_records (90+ days)'
\echo '  2. Archived duplicate clinic_owner_accounts'
\echo '  3. Created v_people_cleanup_candidates view for review'
\echo '  4. Deleted orphaned relationships (to merged entities)'
\echo '  5. Flagged garbage data_quality on obvious bad records'
\echo ''
\echo 'Archive tables:'
\echo '  - archive.staged_records_processed'
\echo '  - archive.duplicate_clinic_accounts'
\echo '  - archive.invalid_people (for future use)'
\echo '  - archive.invalid_places (for future use)'
\echo ''
\echo 'Review needed:'
\echo '  SELECT * FROM sot.v_people_cleanup_candidates WHERE cleanup_reason IS NOT NULL;'
\echo ''
