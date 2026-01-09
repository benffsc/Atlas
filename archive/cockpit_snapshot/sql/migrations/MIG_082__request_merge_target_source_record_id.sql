-- MIG_082__request_merge_target_source_record_id.sql
-- Adds merged_into_source_record_id to requests for robust merge link tracking
--
-- Purpose:
--   When Airtable provides "LookupRecordIDPrimaryReq", we store the Airtable record ID
--   of the canonical request this duplicate merged into. This is more stable than
--   case_number alone (which requires resolution).
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_082__request_merge_target_source_record_id.sql

-- ============================================
-- 1) ADD merged_into_source_record_id COLUMN (if not exist)
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'trapper'
                   AND table_name = 'requests'
                   AND column_name = 'merged_into_source_record_id') THEN
        ALTER TABLE trapper.requests ADD COLUMN merged_into_source_record_id text;
        RAISE NOTICE 'Added column: requests.merged_into_source_record_id';
    ELSE
        RAISE NOTICE 'Column requests.merged_into_source_record_id already exists';
    END IF;
END $$;

COMMENT ON COLUMN trapper.requests.merged_into_source_record_id IS
'Airtable record ID of the canonical request this request merged into (from LookupRecordIDPrimaryReq field). Null if not a merged duplicate.';

-- ============================================
-- 2) CREATE PARTIAL INDEX ON merged_into_case_number (where not null)
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                   WHERE schemaname = 'trapper'
                   AND tablename = 'requests'
                   AND indexname = 'idx_requests_merged_into_case_number') THEN
        CREATE INDEX idx_requests_merged_into_case_number
        ON trapper.requests(merged_into_case_number)
        WHERE merged_into_case_number IS NOT NULL;
        RAISE NOTICE 'Created partial index: idx_requests_merged_into_case_number';
    ELSE
        RAISE NOTICE 'Index idx_requests_merged_into_case_number already exists';
    END IF;
END $$;

-- ============================================
-- 3) CREATE PARTIAL INDEX ON merged_into_source_record_id (where not null)
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                   WHERE schemaname = 'trapper'
                   AND tablename = 'requests'
                   AND indexname = 'idx_requests_merged_into_source_record_id') THEN
        CREATE INDEX idx_requests_merged_into_source_record_id
        ON trapper.requests(merged_into_source_record_id)
        WHERE merged_into_source_record_id IS NOT NULL;
        RAISE NOTICE 'Created partial index: idx_requests_merged_into_source_record_id';
    ELSE
        RAISE NOTICE 'Index idx_requests_merged_into_source_record_id already exists';
    END IF;
END $$;

-- ============================================
-- 4) CREATE INDEX ON source_record_id FOR LOOKUPS
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                   WHERE schemaname = 'trapper'
                   AND tablename = 'requests'
                   AND indexname = 'idx_requests_source_record_id') THEN
        CREATE INDEX idx_requests_source_record_id
        ON trapper.requests(source_record_id)
        WHERE source_record_id IS NOT NULL;
        RAISE NOTICE 'Created partial index: idx_requests_source_record_id';
    ELSE
        RAISE NOTICE 'Index idx_requests_source_record_id already exists';
    END IF;
END $$;

-- ============================================
-- 5) VERIFICATION
-- ============================================
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'trapper'
  AND table_name = 'requests'
  AND column_name IN ('merged_into_case_number', 'merged_into_source_record_id', 'archive_reason', 'archived_at')
ORDER BY column_name;

-- Show indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'trapper'
  AND tablename = 'requests'
  AND indexname LIKE '%merged%' OR indexname LIKE '%source_record%'
ORDER BY indexname;
