-- MIG_2415: Add property_type to ops.requests
--
-- Problem: raw_property_type is captured at intake but not promoted to requests
-- This prevents UI from showing residence/business/farm distinction
--
-- Valid values (from raw_intake_request):
-- private_home, apartment_complex, mobile_home_park, business,
-- farm_ranch, public_park, industrial, other

BEGIN;

-- 1. Add property_type column to ops.requests
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS property_type TEXT;

-- 2. Add check constraint for valid values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_requests_property_type'
  ) THEN
    ALTER TABLE ops.requests
    ADD CONSTRAINT chk_requests_property_type CHECK (
      property_type IS NULL OR property_type IN (
        'private_home', 'apartment_complex', 'mobile_home_park',
        'business', 'farm_ranch', 'public_park', 'industrial', 'other'
      )
    );
  END IF;
END $$;

-- 3. Backfill from intake_submissions if property type data exists
-- Note: V2 schema uses ops.intake_submissions, not ops.raw_intake_request
-- The property_type field needs to be captured in the intake form going forward
DO $$
BEGIN
  -- Check if intake_submissions has a property_type-like column
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'ops'
    AND table_name = 'intake_submissions'
    AND column_name = 'property_type'
  ) THEN
    EXECUTE '
      UPDATE ops.requests r
      SET property_type = i.property_type
      FROM ops.intake_submissions i
      WHERE r.intake_submission_id = i.id
      AND r.property_type IS NULL
      AND i.property_type IS NOT NULL
    ';
    RAISE NOTICE 'MIG_2415: Backfilled property_type from intake_submissions';
  ELSE
    RAISE NOTICE 'MIG_2415: No property_type column in intake_submissions - skip backfill';
    RAISE NOTICE 'MIG_2415: property_type should be captured from UI going forward';
  END IF;
END $$;

COMMIT;

-- Verification
SELECT
  'Total requests' as metric,
  COUNT(*) as count
FROM ops.requests

UNION ALL

SELECT
  'With property_type' as metric,
  COUNT(*) as count
FROM ops.requests
WHERE property_type IS NOT NULL

UNION ALL

SELECT
  property_type as metric,
  COUNT(*) as count
FROM ops.requests
WHERE property_type IS NOT NULL
GROUP BY property_type
ORDER BY metric;
