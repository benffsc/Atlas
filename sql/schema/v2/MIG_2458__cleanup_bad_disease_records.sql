-- MIG_2458: Cleanup Bad Disease Records
--
-- PURPOSE: Remove disease records from places that should never have them:
--   1. Blacklisted places (FFSC clinic, commercial sites)
--   2. Garbage/unknown places
--
-- BACKGROUND:
--   Disease records were created BEFORE soft_blacklist was in place.
--   should_compute_disease_for_place() now correctly returns FALSE for these,
--   but existing records need cleanup.
--
-- AUDIT FINDINGS:
--   - 119 active disease records total
--   - 9 records on blacklisted/garbage places (to be archived)
--   - 110 records after cleanup

BEGIN;

-- 1. Archive disease records for blacklisted places
INSERT INTO archive.invalid_places (
    place_id, display_name, formatted_address, archived_at,
    archive_reason, source_system
)
SELECT DISTINCT
    p.place_id,
    p.display_name,
    p.formatted_address,
    NOW(),
    'disease_on_blacklisted_place',
    'MIG_2458'
FROM ops.place_disease_status pds
JOIN sot.places p ON p.place_id = pds.place_id
WHERE pds.place_id IN (
    SELECT place_id FROM sot.place_soft_blacklist
    WHERE place_id IS NOT NULL AND is_active = TRUE
)
ON CONFLICT (place_id) DO NOTHING;

-- Delete disease records for blacklisted places
DELETE FROM ops.place_disease_status pds
WHERE pds.place_id IN (
    SELECT place_id FROM sot.place_soft_blacklist
    WHERE place_id IS NOT NULL AND is_active = TRUE
);

-- 2. Mark "unknown" garbage place with quality_tier = 'D' (lowest quality)
-- Note: quality_tier constraint allows only 'A', 'B', 'C', 'D'
UPDATE sot.places
SET quality_tier = 'D'
WHERE (display_name ILIKE '%unknown%' OR formatted_address ILIKE '%unknown%unknown%')
  AND quality_tier IS NULL;

-- Archive disease records for garbage/unknown places (identified by name, not tier)
INSERT INTO archive.invalid_places (
    place_id, display_name, formatted_address, archived_at,
    archive_reason, source_system
)
SELECT DISTINCT
    p.place_id,
    p.display_name,
    p.formatted_address,
    NOW(),
    'disease_on_garbage_place',
    'MIG_2458'
FROM ops.place_disease_status pds
JOIN sot.places p ON p.place_id = pds.place_id
WHERE p.display_name ILIKE '%unknown%' OR p.formatted_address ILIKE '%unknown%unknown%'
ON CONFLICT (place_id) DO NOTHING;

-- Delete disease records for garbage/unknown places
DELETE FROM ops.place_disease_status pds
WHERE pds.place_id IN (
    SELECT place_id FROM sot.places
    WHERE display_name ILIKE '%unknown%' OR formatted_address ILIKE '%unknown%unknown%'
);

COMMIT;

-- Verification
\echo ''
\echo '=============================================='
\echo '  MIG_2458: Disease Cleanup Verification'
\echo '=============================================='
\echo ''

\echo 'Disease records remaining (should be ~110):'
SELECT COUNT(*) as active_records
FROM ops.place_disease_status
WHERE status IN ('confirmed_active', 'perpetual');

\echo ''
\echo 'Unique disease places remaining:'
SELECT COUNT(DISTINCT place_id) as unique_places
FROM ops.place_disease_status
WHERE status IN ('confirmed_active', 'perpetual');

\echo ''
\echo 'Archived places from this migration:'
SELECT archive_reason, COUNT(*) as count
FROM archive.invalid_places
WHERE source_system = 'MIG_2458'
GROUP BY archive_reason;

\echo ''
\echo 'Verify no disease on blacklisted places:'
SELECT COUNT(*) as should_be_zero
FROM ops.place_disease_status pds
WHERE pds.place_id IN (
    SELECT place_id FROM sot.place_soft_blacklist
    WHERE place_id IS NOT NULL AND is_active = TRUE
);

\echo ''
\echo '=============================================='
\echo '  MIG_2458 Complete!'
\echo '=============================================='
