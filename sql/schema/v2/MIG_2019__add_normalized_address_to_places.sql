-- MIG_2019: Add normalized_address column to sot.places
--
-- The find_or_create_place_deduped() function expects normalized_address
-- but V2's sot.places doesn't have it. This adds the column and creates
-- a trigger to auto-populate it from formatted_address.
--
-- Created: 2026-02-12

\echo ''
\echo '=============================================='
\echo '  MIG_2019: Add normalized_address to places'
\echo '=============================================='
\echo ''

-- Add normalized_address column
ALTER TABLE sot.places ADD COLUMN IF NOT EXISTS normalized_address TEXT;

-- Create index for lookups
CREATE INDEX IF NOT EXISTS idx_places_normalized_address
ON sot.places(normalized_address)
WHERE merged_into_place_id IS NULL;

-- Backfill existing places
UPDATE sot.places
SET normalized_address = sot.normalize_address(formatted_address)
WHERE normalized_address IS NULL
  AND formatted_address IS NOT NULL;

-- Create trigger to auto-populate on insert/update
CREATE OR REPLACE FUNCTION sot.trg_places_normalize_address()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.formatted_address IS NOT NULL THEN
        NEW.normalized_address := sot.normalize_address(NEW.formatted_address);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_places_auto_normalize ON sot.places;
CREATE TRIGGER trg_places_auto_normalize
    BEFORE INSERT OR UPDATE OF formatted_address ON sot.places
    FOR EACH ROW
    EXECUTE FUNCTION sot.trg_places_normalize_address();

\echo 'Added normalized_address column to sot.places with auto-populate trigger'
\echo ''

-- Verify
SELECT COUNT(*) as places_with_normalized FROM sot.places WHERE normalized_address IS NOT NULL;
