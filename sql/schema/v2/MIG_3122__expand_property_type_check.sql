-- MIG_3122: Expand property_type CHECK to match form-options.ts
-- BUG: form-options.ts has 15 property types but DB CHECK only allows 8.
-- Jami hit this trying to submit a request with "Condo/Townhome" (condo_townhome).

ALTER TABLE ops.requests DROP CONSTRAINT IF EXISTS chk_requests_property_type;

ALTER TABLE ops.requests ADD CONSTRAINT chk_requests_property_type CHECK (
  property_type IS NULL OR property_type IN (
    -- Residential
    'private_home',
    'condo_townhome',
    'duplex_multiplex',
    'apartment_complex',
    'mobile_home_park',
    'farm_ranch',
    'rural_unincorporated',
    -- Commercial / Institutional
    'business',
    'industrial',
    'school_campus',
    'church_religious',
    'government_municipal',
    -- Outdoor / Other
    'public_park',
    'vacant_lot',
    'other'
  )
);

-- Verify
DO $$
BEGIN
  RAISE NOTICE 'MIG_3122: property_type CHECK updated — 15 values (was 8)';
END $$;
