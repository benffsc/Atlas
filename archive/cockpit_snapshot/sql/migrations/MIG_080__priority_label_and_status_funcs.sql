-- MIG_080__priority_label_and_status_funcs.sql
-- Adds priority_label column and SQL helper functions for status/priority normalization
--
-- Purpose:
--   1. priority_label preserves the original text (Low/Medium/High) alongside numeric priority
--   2. SQL functions provide reference implementations for status/priority mapping
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_080__priority_label_and_status_funcs.sql

-- ============================================
-- 1) ADD priority_label COLUMN (if not exist)
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'trapper'
                   AND table_name = 'requests'
                   AND column_name = 'priority_label') THEN
        ALTER TABLE trapper.requests ADD COLUMN priority_label text;
        RAISE NOTICE 'Added column: requests.priority_label';
    ELSE
        RAISE NOTICE 'Column requests.priority_label already exists';
    END IF;
END $$;

COMMENT ON COLUMN trapper.requests.priority_label IS
'Original priority label from source (e.g., Low, Medium, High). Companion to numeric priority column.';

-- ============================================
-- 2) SQL FUNCTION: normalize_request_status
-- ============================================
-- Reference implementation matching Python coerce_request_status()
-- Can be used in queries or triggers

CREATE OR REPLACE FUNCTION trapper.normalize_request_status(raw_status text)
RETURNS text AS $$
DECLARE
    s text;
BEGIN
    IF raw_status IS NULL OR trim(raw_status) = '' THEN
        RETURN NULL;
    END IF;

    s := lower(regexp_replace(trim(raw_status), '\s+', ' ', 'g'));

    RETURN CASE s
        -- Core status mappings
        WHEN 'new' THEN 'new'
        WHEN 'requested' THEN 'new'
        WHEN 'needs attention' THEN 'needs_review'
        WHEN 'need to re-book' THEN 'needs_review'
        WHEN 'need to re book' THEN 'needs_review'
        WHEN 'in progress' THEN 'in_progress'
        WHEN 'partially complete' THEN 'in_progress'
        WHEN 'revisit' THEN 'active'
        WHEN 'complete/closed' THEN 'closed'
        WHEN 'complete / closed' THEN 'closed'
        WHEN 'complete' THEN 'closed'
        WHEN 'closed' THEN 'closed'
        WHEN 'hold' THEN 'paused'
        WHEN 'referred elsewhere' THEN 'resolved'
        -- Archived statuses -> terminal states
        WHEN 'duplicate request' THEN 'closed'
        WHEN 'duplicate' THEN 'closed'
        WHEN 'denied' THEN 'closed'
        ELSE NULL
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.normalize_request_status(text) IS
'Maps Airtable Case Status strings to trapper.request_status enum values. Returns NULL for unknown.';

-- ============================================
-- 3) SQL FUNCTION: normalize_priority
-- ============================================
-- Reference implementation matching Python coerce_priority_smallint()

CREATE OR REPLACE FUNCTION trapper.normalize_priority(raw_priority text)
RETURNS smallint AS $$
DECLARE
    s text;
    digits text;
BEGIN
    IF raw_priority IS NULL OR trim(raw_priority) = '' THEN
        RETURN NULL;
    END IF;

    -- Try to extract digits first (e.g., "2 - Medium" -> 2)
    digits := (regexp_match(raw_priority, '\d+'))[1];
    IF digits IS NOT NULL THEN
        RETURN digits::smallint;
    END IF;

    -- Word-based mapping
    s := lower(regexp_replace(trim(raw_priority), '\s+', ' ', 'g'));

    RETURN CASE s
        WHEN 'low' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'med' THEN 2
        WHEN 'high' THEN 3
        WHEN 'urgent' THEN 4
        WHEN 'critical' THEN 5
        ELSE NULL
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.normalize_priority(text) IS
'Maps priority strings (Low/Medium/High or "2 - Medium") to smallint (1-5). Returns NULL for unknown.';

-- ============================================
-- 4) SQL FUNCTION: extract_archive_reason
-- ============================================
-- Reference implementation matching Python coerce_archive_reason()

CREATE OR REPLACE FUNCTION trapper.extract_archive_reason(raw_status text)
RETURNS text AS $$
DECLARE
    s text;
BEGIN
    IF raw_status IS NULL OR trim(raw_status) = '' THEN
        RETURN NULL;
    END IF;

    s := lower(regexp_replace(trim(raw_status), '\s+', ' ', 'g'));

    RETURN CASE
        WHEN s IN ('duplicate request', 'duplicate', 'dup') THEN 'duplicate'
        WHEN s = 'denied' THEN 'denied'
        WHEN s IN ('referred elsewhere', 'referred', 'refer elsewhere') THEN 'referred_elsewhere'
        ELSE NULL
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.extract_archive_reason(text) IS
'Extracts archive_reason from Airtable Case Status. Returns: duplicate, denied, referred_elsewhere, or NULL.';

-- ============================================
-- 5) VERIFICATION
-- ============================================
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'trapper'
  AND table_name = 'requests'
  AND column_name IN ('priority', 'priority_label')
ORDER BY column_name;

-- Test the functions
SELECT
    trapper.normalize_request_status('In progress') AS status_in_progress,
    trapper.normalize_request_status('Duplicate Request') AS status_duplicate,
    trapper.normalize_request_status('Needs Attention') AS status_needs_attn,
    trapper.normalize_priority('High') AS priority_high,
    trapper.normalize_priority('2 - Medium') AS priority_2_medium,
    trapper.extract_archive_reason('Duplicate Request') AS archive_duplicate;
