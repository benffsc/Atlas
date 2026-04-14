-- MIG_3081: Add verification tracking to clinic_day_entries
-- FFS-1233: CDS matches verified by staff must survive re-runs.
-- Currently clearAutoMatches only protects match_confidence='manual'.
-- 5,300 matches through 03/18 were staff-verified but unprotected.
--
-- Adds verified_at/verified_by columns + bulk-protects historical matches.
-- clearAutoMatches updated in clinic-day-matching.ts to respect these.

-- Step 1: Add verification columns
ALTER TABLE ops.clinic_day_entries
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by TEXT;

COMMENT ON COLUMN ops.clinic_day_entries.verified_at IS
  'When this match was reviewed and confirmed by staff. '
  'Protected from clearAutoMatches — CDS will not overwrite.';

COMMENT ON COLUMN ops.clinic_day_entries.verified_by IS
  'Who verified: user email or "bulk_verification" for batch ops.';

-- Step 2: Protect all matched entries through 2026-03-18
-- These were CDS-generated on 04/08 and reviewed by Ben.
-- Preserves original match_confidence/match_reason for provenance.
UPDATE ops.clinic_day_entries e
SET verified_at = NOW(),
    verified_by = 'bulk_verification'
FROM ops.clinic_days cd
WHERE cd.clinic_day_id = e.clinic_day_id
  AND cd.clinic_date <= '2026-03-18'
  AND e.matched_appointment_id IS NOT NULL
  AND e.verified_at IS NULL;

-- Step 3: Index for clearAutoMatches performance
CREATE INDEX IF NOT EXISTS idx_clinic_day_entries_verified
  ON ops.clinic_day_entries (verified_at)
  WHERE verified_at IS NOT NULL;

-- Verification
DO $$
DECLARE
  v_verified INT;
  v_total INT;
BEGIN
  SELECT COUNT(*) INTO v_verified
  FROM ops.clinic_day_entries WHERE verified_at IS NOT NULL;

  SELECT COUNT(*) INTO v_total
  FROM ops.clinic_day_entries e
  JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
  WHERE cd.clinic_date <= '2026-03-18' AND e.matched_appointment_id IS NOT NULL;

  RAISE NOTICE 'MIG_3081: % entries verified (of % matched through 03/18)', v_verified, v_total;
END $$;
