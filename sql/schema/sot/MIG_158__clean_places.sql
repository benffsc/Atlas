-- MIG_158__clean_places.sql
-- Clean up places for reliable Beacon analytics
--
-- Context:
--   Beacon needs accurate cat counts per location to:
--   - Estimate populations
--   - Calculate alteration rates
--   - Project population growth
--   - Prioritize TNR efforts
--
-- Problems:
--   1. Duplicate places split cat counts (15999 Coast Hwy vs 15999 CA-1)
--   2. Non-places (person names, junk data) pollute location data
--   3. Inconsistent address formats make aggregation unreliable
--
-- Solution:
--   1. Create place exclusion patterns (non-places)
--   2. Merge duplicate places (same address/coordinates)
--   3. Maintain all appointment/cat links for historical accuracy
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_158__clean_places.sql

\echo ''
\echo 'MIG_158: Clean Places for Beacon Analytics'
\echo '==========================================='
\echo ''

-- ============================================================
-- 1. Create place exclusion patterns table
-- ============================================================

\echo 'Creating place exclusion patterns...'

CREATE TABLE IF NOT EXISTS trapper.place_exclusion_patterns (
    pattern_id SERIAL PRIMARY KEY,
    pattern_type TEXT NOT NULL, -- 'contains', 'equals', 'regex', 'starts_with'
    pattern_value TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(pattern_type, pattern_value)
);

-- Populate exclusion patterns
INSERT INTO trapper.place_exclusion_patterns (pattern_type, pattern_value, reason) VALUES
-- Junk/placeholder addresses
('equals', 'unknown', 'Placeholder address'),
('equals', 'n/a', 'Placeholder address'),
('equals', 'none', 'Placeholder address'),
('equals', 'tbd', 'Placeholder address'),
('contains', 'somewhere', 'Vague/invalid address'),
('contains', 'placeholder', 'Placeholder'),
('contains', 'test', 'Test data'),
-- FFSC internal codes
('contains', 'ffsc', 'FFSC internal code, not a place'),
('contains', 'forgotten felines', 'FFSC internal, not a place'),
('starts_with', 'fire cat', 'FFSC program code'),
('starts_with', 'barn cat', 'FFSC program code'),
-- Non-address patterns
('regex', '^[a-z]+ [a-z]+$', 'Likely a person name, not address'),
('contains', 'rebooking', 'Booking placeholder'),
('contains', 'duplicate report', 'Duplicate flag')
ON CONFLICT DO NOTHING;

\echo 'Place exclusion patterns:'
SELECT pattern_type, pattern_value, reason FROM trapper.place_exclusion_patterns;

-- ============================================================
-- 2. Function to check if a place name is valid
-- ============================================================

\echo ''
\echo 'Creating is_valid_place function...'

CREATE OR REPLACE FUNCTION trapper.is_valid_place(p_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_name TEXT := LOWER(TRIM(COALESCE(p_name, '')));
    v_pattern RECORD;
BEGIN
    -- Empty is not valid
    IF v_name = '' OR LENGTH(v_name) < 3 THEN
        RETURN FALSE;
    END IF;

    -- Check against exclusion patterns
    FOR v_pattern IN SELECT * FROM trapper.place_exclusion_patterns
    LOOP
        IF v_pattern.pattern_type = 'equals' AND v_name = LOWER(v_pattern.pattern_value) THEN
            RETURN FALSE;
        ELSIF v_pattern.pattern_type = 'contains' AND v_name LIKE '%' || LOWER(v_pattern.pattern_value) || '%' THEN
            RETURN FALSE;
        ELSIF v_pattern.pattern_type = 'starts_with' AND v_name LIKE LOWER(v_pattern.pattern_value) || '%' THEN
            RETURN FALSE;
        ELSIF v_pattern.pattern_type = 'regex' AND v_name ~ v_pattern.pattern_value THEN
            RETURN FALSE;
        END IF;
    END LOOP;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- 3. Backup current places
-- ============================================================

\echo ''
\echo 'Backing up places...'

DROP TABLE IF EXISTS trapper.backup_places_mig158;
CREATE TABLE trapper.backup_places_mig158 AS SELECT * FROM trapper.places;

\echo 'Backed up places:'
SELECT COUNT(*) as place_count FROM trapper.backup_places_mig158;

-- ============================================================
-- 4. Identify invalid places
-- ============================================================

\echo ''
\echo 'Identifying invalid places...'

SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    CASE WHEN trapper.is_valid_place(p.display_name) THEN 'valid' ELSE 'invalid' END as status
FROM trapper.places p
WHERE NOT trapper.is_valid_place(p.display_name)
LIMIT 20;

\echo ''
\echo 'Invalid place count:'
SELECT
    COUNT(*) FILTER (WHERE NOT trapper.is_valid_place(display_name)) as invalid,
    COUNT(*) FILTER (WHERE trapper.is_valid_place(display_name)) as valid,
    COUNT(*) as total
FROM trapper.places;

-- ============================================================
-- 5. Find exact address duplicates
-- ============================================================

\echo ''
\echo 'Finding exact address duplicates...'

CREATE TEMP TABLE address_duplicates AS
SELECT
    LOWER(TRIM(formatted_address)) as norm_address,
    COUNT(*) as dup_count,
    ARRAY_AGG(place_id ORDER BY is_address_backed DESC, location IS NOT NULL DESC, created_at) as place_ids
FROM trapper.places
WHERE formatted_address IS NOT NULL
  AND TRIM(formatted_address) != ''
  AND trapper.is_valid_place(display_name)
GROUP BY LOWER(TRIM(formatted_address))
HAVING COUNT(*) > 1;

\echo 'Exact address duplicate groups:'
SELECT COUNT(*) as duplicate_groups, SUM(dup_count) as total_duplicates FROM address_duplicates;

-- Preview some duplicates
SELECT norm_address, dup_count
FROM address_duplicates
ORDER BY dup_count DESC
LIMIT 10;

-- ============================================================
-- 6. Merge exact address duplicates
-- ============================================================

\echo ''
\echo 'Merging exact address duplicates...'

DO $$
DECLARE
    v_dup RECORD;
    v_keep_id UUID;
    v_remove_id UUID;
    v_merged INT := 0;
    v_place_ids UUID[];
    i INT;
BEGIN
    FOR v_dup IN SELECT * FROM address_duplicates
    LOOP
        v_place_ids := v_dup.place_ids;
        v_keep_id := v_place_ids[1]; -- First one is the "best" (geocoded, has location, oldest)

        -- Merge all others into the first
        FOR i IN 2..array_length(v_place_ids, 1)
        LOOP
            v_remove_id := v_place_ids[i];

            -- Check both still exist
            IF EXISTS (SELECT 1 FROM trapper.places WHERE place_id = v_keep_id)
               AND EXISTS (SELECT 1 FROM trapper.places WHERE place_id = v_remove_id) THEN
                PERFORM trapper.merge_places(v_keep_id, v_remove_id, 'exact_address_duplicate');
                v_merged := v_merged + 1;
            END IF;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Merged % exact address duplicates', v_merged;
END $$;

DROP TABLE address_duplicates;

-- ============================================================
-- 7. Find coordinate-proximity duplicates (within 50m)
-- ============================================================

\echo ''
\echo 'Finding coordinate-proximity duplicates (within 50m)...'

CREATE TEMP TABLE coord_duplicates AS
SELECT
    p1.place_id as place_id_1,
    p2.place_id as place_id_2,
    p1.display_name as name_1,
    p2.display_name as name_2,
    ST_Distance(p1.location, p2.location) as distance_m
FROM trapper.places p1
JOIN trapper.places p2 ON p1.place_id < p2.place_id
WHERE p1.location IS NOT NULL
  AND p2.location IS NOT NULL
  AND ST_DWithin(p1.location, p2.location, 50)
  AND trapper.is_valid_place(p1.display_name)
  AND trapper.is_valid_place(p2.display_name);

\echo 'Coordinate-proximity duplicates:'
SELECT COUNT(*) as pairs FROM coord_duplicates;

-- ============================================================
-- 8. Merge coordinate duplicates
-- ============================================================

\echo ''
\echo 'Merging coordinate-proximity duplicates...'

DO $$
DECLARE
    v_dup RECORD;
    v_keep_id UUID;
    v_remove_id UUID;
    v_merged INT := 0;
BEGIN
    FOR v_dup IN SELECT * FROM coord_duplicates
    LOOP
        -- Check both still exist
        IF EXISTS (SELECT 1 FROM trapper.places WHERE place_id = v_dup.place_id_1)
           AND EXISTS (SELECT 1 FROM trapper.places WHERE place_id = v_dup.place_id_2) THEN

            v_keep_id := trapper.pick_canonical_place(v_dup.place_id_1, v_dup.place_id_2);
            IF v_keep_id = v_dup.place_id_1 THEN
                v_remove_id := v_dup.place_id_2;
            ELSE
                v_remove_id := v_dup.place_id_1;
            END IF;

            PERFORM trapper.merge_places(v_keep_id, v_remove_id, 'coordinate_proximity_duplicate');
            v_merged := v_merged + 1;
        END IF;
    END LOOP;

    RAISE NOTICE 'Merged % coordinate-proximity duplicates', v_merged;
END $$;

DROP TABLE coord_duplicates;

-- ============================================================
-- 9. Handle invalid places (unlink but preserve history)
-- ============================================================

\echo ''
\echo 'Handling invalid places...'

-- Don't delete invalid places yet - just mark them
-- This preserves appointment history while flagging bad data
-- Future: Could create a "place_issues" table for review

\echo 'Invalid places that would need review:'
SELECT
    p.display_name,
    (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.place_id = p.place_id) as appt_count
FROM trapper.places p
WHERE NOT trapper.is_valid_place(p.display_name)
ORDER BY 2 DESC
LIMIT 20;

-- ============================================================
-- 10. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Place count comparison:'
SELECT
    (SELECT COUNT(*) FROM trapper.places) as new_places,
    (SELECT COUNT(*) FROM trapper.backup_places_mig158) as old_places,
    (SELECT COUNT(*) FROM trapper.backup_places_mig158) - (SELECT COUNT(*) FROM trapper.places) as merged;

\echo ''
\echo 'Places by cat activity:'
SELECT
    has_cat_activity,
    COUNT(*) as place_count
FROM trapper.places
GROUP BY 1;

\echo ''
\echo 'Top 10 places by appointment count (for Beacon):'
SELECT
    p.display_name,
    p.formatted_address,
    COUNT(a.appointment_id) as appt_count,
    COUNT(DISTINCT a.cat_id) as unique_cats
FROM trapper.places p
JOIN trapper.sot_appointments a ON a.place_id = p.place_id
GROUP BY p.place_id, p.display_name, p.formatted_address
ORDER BY appt_count DESC
LIMIT 10;

\echo ''
\echo 'Check for remaining duplicates (same normalized address):'
SELECT
    LOWER(TRIM(formatted_address)) as addr,
    COUNT(*) as cnt
FROM trapper.places
WHERE formatted_address IS NOT NULL
GROUP BY 1
HAVING COUNT(*) > 1
LIMIT 10;

SELECT 'MIG_158 Complete' AS status;
