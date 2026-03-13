-- MIG_2919: Expand property_type options on ops.requests
--
-- Problem: property_type CHECK constraint only allows 8 values.
-- Staff needs more options to describe diverse address types
-- (condos, duplexes, rural areas, schools, churches, vacant lots, etc.)
--
-- Fixes FFS-484

BEGIN;

-- 1. Drop the old constraint
ALTER TABLE ops.requests
DROP CONSTRAINT IF EXISTS chk_requests_property_type;

-- 2. Add expanded constraint with new values
ALTER TABLE ops.requests
ADD CONSTRAINT chk_requests_property_type CHECK (
  property_type IS NULL OR property_type IN (
    -- Residential
    'private_home',
    'condo_townhome',
    'duplex_multiplex',
    'apartment_complex',
    'mobile_home_park',
    'farm_ranch',
    'rural_unincorporated',
    -- Commercial/Institutional
    'business',
    'industrial',
    'school_campus',
    'church_religious',
    'government_municipal',
    -- Outdoor/Other
    'public_park',
    'vacant_lot',
    'other'
  )
);

COMMIT;

-- Verification
SELECT
  'Constraint updated' as status,
  conname,
  pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conname = 'chk_requests_property_type';
