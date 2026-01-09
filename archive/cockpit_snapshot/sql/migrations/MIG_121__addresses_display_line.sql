-- MIG_121__addresses_display_line.sql
-- Fix missing columns referenced by /focus and /requests pages
--
-- Problem:
--   Code references addr.display_line and addr.raw_input which don't exist
--   Existing columns: raw_text, raw_address, formatted_address
--
-- Solution:
--   1. Add display_line column (human-readable address for UI)
--   2. Add raw_input column (original input before geocoding)
--   3. Backfill both from existing data (only where NULL)
--
-- Safe:
--   - Uses ADD COLUMN IF NOT EXISTS (idempotent)
--   - Backfill uses COALESCE to preserve existing values
--   - No destructive operations
--   - No extension dependencies (no trigram index)

-- ============================================================
-- 1. Add columns
-- ============================================================

ALTER TABLE trapper.addresses
  ADD COLUMN IF NOT EXISTS display_line text,
  ADD COLUMN IF NOT EXISTS raw_input text;

-- ============================================================
-- 2. Backfill display_line and raw_input
-- Only updates rows where the column is NULL
-- Uses NULLIF to skip empty strings
-- ============================================================

UPDATE trapper.addresses
SET
  display_line = COALESCE(
    display_line,
    NULLIF(formatted_address, ''),
    NULLIF(raw_address, ''),
    NULLIF(raw_text, '')
  ),
  raw_input = COALESCE(
    raw_input,
    NULLIF(raw_address, ''),
    NULLIF(raw_text, ''),
    NULLIF(formatted_address, '')
  )
WHERE display_line IS NULL
   OR raw_input IS NULL;

-- ============================================================
-- 3. Add comments for documentation
-- ============================================================

COMMENT ON COLUMN trapper.addresses.display_line IS
  'Human-readable address line for UI display';

COMMENT ON COLUMN trapper.addresses.raw_input IS
  'Original address input before geocoding';

-- ============================================================
-- Verification (run after migration):
--   SELECT COUNT(*) AS total,
--          COUNT(display_line) AS with_display_line,
--          COUNT(raw_input) AS with_raw_input
--   FROM trapper.addresses;
-- ============================================================
