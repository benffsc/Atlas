-- MIG_2845: Fix person dedup candidates schema
--
-- Problem: sot.person_dedup_candidates table CHECK constraint is missing
-- 'kept_separate' and 'dismissed' status values. Also reviewed_by is a UUID FK
-- to ops.staff, but the API passes text values (matching address/request dedup
-- tables which use TEXT for resolved_by).
--
-- Fixes FFS-242

BEGIN;

-- =============================================================================
-- 1. Add missing status values to CHECK constraint
-- =============================================================================

ALTER TABLE sot.person_dedup_candidates
    DROP CONSTRAINT IF EXISTS person_dedup_candidates_status_check;

ALTER TABLE sot.person_dedup_candidates
    ADD CONSTRAINT person_dedup_candidates_status_check
    CHECK (status IN ('pending', 'confirmed', 'rejected', 'merged', 'kept_separate', 'dismissed'));

-- =============================================================================
-- 2. Change reviewed_by from UUID FK to TEXT to match other dedup tables
-- (address_dedup_candidates and request_dedup_candidates use TEXT for resolved_by)
-- =============================================================================

-- Drop the FK constraint on reviewed_by
ALTER TABLE sot.person_dedup_candidates
    DROP CONSTRAINT IF EXISTS person_dedup_candidates_reviewed_by_fkey;

-- Change column type to TEXT
ALTER TABLE sot.person_dedup_candidates
    ALTER COLUMN reviewed_by TYPE TEXT USING reviewed_by::TEXT;

COMMIT;
