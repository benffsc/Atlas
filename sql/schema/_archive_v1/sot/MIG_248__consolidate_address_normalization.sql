-- MIG_248: Consolidate Address Normalization
--
-- Problem: Two incompatible normalize_address functions exist:
-- - MIG_189: Expands abbreviations ("st" → "street")
-- - MIG_214: Abbreviates full words ("Street" → "St")
--
-- This causes deduplication failures when addresses are normalized
-- inconsistently.
--
-- Fix: Consolidate to ONE approach (abbreviation) and re-normalize
-- all existing places.

\echo ''
\echo '=============================================='
\echo 'MIG_248: Consolidate Address Normalization'
\echo '=============================================='
\echo ''

-- Drop and recreate with the definitive implementation
-- Using ABBREVIATION approach (standard for geocoding/deduplication)
DROP FUNCTION IF EXISTS trapper.normalize_address(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION trapper.normalize_address(p_address TEXT)
RETURNS TEXT AS $$
DECLARE
    v_result TEXT;
BEGIN
    IF p_address IS NULL OR TRIM(p_address) = '' THEN
        RETURN NULL;
    END IF;

    v_result := TRIM(p_address);

    -- Step 1: Lowercase
    v_result := LOWER(v_result);

    -- Step 2: Remove country suffixes
    v_result := REGEXP_REPLACE(v_result, ',?\s*(usa|united states|us)\s*$', '', 'i');

    -- Step 3: Remove periods from abbreviations (e.g., "St." → "St")
    v_result := REGEXP_REPLACE(v_result, '\.(?=\s|$|,)', '', 'g');

    -- Step 4: Normalize street type FULL NAMES to abbreviations
    -- This is the standard approach for deduplication
    -- Note: PostgreSQL doesn't support \b word boundaries, using (^|[^a-z]) pattern instead
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])street([^a-z]|$)', '\1st\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])avenue([^a-z]|$)', '\1ave\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])drive([^a-z]|$)', '\1dr\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])road([^a-z]|$)', '\1rd\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])boulevard([^a-z]|$)', '\1blvd\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])lane([^a-z]|$)', '\1ln\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])court([^a-z]|$)', '\1ct\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])circle([^a-z]|$)', '\1cir\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])highway([^a-z]|$)', '\1hwy\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])parkway([^a-z]|$)', '\1pkwy\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])place([^a-z]|$)', '\1pl\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])terrace([^a-z]|$)', '\1ter\2', 'gi');

    -- Step 5: Normalize directional prefixes/suffixes
    -- Convert full names to abbreviations
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])north([^a-z]|$)', '\1n\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])south([^a-z]|$)', '\1s\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])east([^a-z]|$)', '\1e\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])west([^a-z]|$)', '\1w\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])northeast([^a-z]|$)', '\1ne\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])northwest([^a-z]|$)', '\1nw\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])southeast([^a-z]|$)', '\1se\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])southwest([^a-z]|$)', '\1sw\2', 'gi');

    -- Step 6: Normalize unit/apartment prefixes
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])apartment([^a-z]|$)', '\1apt\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])suite([^a-z]|$)', '\1ste\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '(^|[^a-z])unit([^a-z]|$)', '\1#\2', 'gi');
    v_result := REGEXP_REPLACE(v_result, '#\s*', '# ', 'g'); -- Normalize "# 123" spacing

    -- Step 7: Normalize whitespace
    v_result := REGEXP_REPLACE(v_result, '\s+', ' ', 'g');
    v_result := TRIM(v_result);

    -- Step 8: Remove trailing commas
    v_result := REGEXP_REPLACE(v_result, ',+\s*$', '');

    RETURN v_result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.normalize_address IS
'Normalizes addresses for deduplication by:
- Lowercasing
- Removing country suffixes (USA, US, United States)
- Abbreviating street types (Street→St, Avenue→Ave, etc.)
- Abbreviating directions (North→N, etc.)
- Normalizing unit prefixes (Apartment→Apt, etc.)
- Normalizing whitespace

Uses ABBREVIATION approach (industry standard for geocoding).';

-- ============================================
-- Re-normalize all existing places
-- ============================================

\echo ''
\echo 'Re-normalizing all existing places...'

-- Count before
SELECT COUNT(*) as total_places,
       COUNT(DISTINCT normalized_address) as unique_normalized
FROM trapper.places
WHERE merged_into_place_id IS NULL;

-- Update all places with new normalization
UPDATE trapper.places
SET normalized_address = trapper.normalize_address(formatted_address),
    updated_at = NOW()
WHERE formatted_address IS NOT NULL;

-- Count after
\echo ''
\echo 'After re-normalization:'
SELECT COUNT(*) as total_places,
       COUNT(DISTINCT normalized_address) as unique_normalized
FROM trapper.places
WHERE merged_into_place_id IS NULL;

-- ============================================
-- Find potential duplicates after normalization
-- ============================================

\echo ''
\echo 'Potential duplicates (same normalized_address):'

SELECT normalized_address,
       COUNT(*) as count,
       ARRAY_AGG(place_id) as place_ids
FROM trapper.places
WHERE merged_into_place_id IS NULL
  AND normalized_address IS NOT NULL
GROUP BY normalized_address
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 20;

-- ============================================
-- Test cases
-- ============================================

\echo ''
\echo 'Testing normalization consistency:'

SELECT
    'Full names' as test,
    trapper.normalize_address('123 Main Street, Santa Rosa, CA 95401') = trapper.normalize_address('123 Main St, Santa Rosa, CA 95401') as passes
UNION ALL
SELECT
    'With USA suffix',
    trapper.normalize_address('123 Main St, Santa Rosa, CA, USA') = trapper.normalize_address('123 Main St, Santa Rosa, CA')
UNION ALL
SELECT
    'Mixed case',
    trapper.normalize_address('123 MAIN ST') = trapper.normalize_address('123 main st')
UNION ALL
SELECT
    'Unit variations',
    trapper.normalize_address('123 Main St Apt 4') = trapper.normalize_address('123 Main St Apartment 4');

\echo ''
\echo '=== MIG_248 Complete ==='
\echo ''
\echo 'Changes:'
\echo '  - Consolidated normalize_address to use ABBREVIATION approach'
\echo '  - Re-normalized all existing places'
\echo '  - Street/Avenue/Drive → St/Ave/Dr'
\echo '  - North/South/East/West → N/S/E/W'
\echo '  - Apartment/Suite/Unit → Apt/Ste/#'
\echo ''
\echo 'Run place deduplication merge if duplicates found above.'
\echo ''
