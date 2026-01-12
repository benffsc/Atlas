-- MIG_156__deduplicate_places.sql
-- Consolidate duplicate places into canonical versions
--
-- Problem:
--   Multiple place records exist for the same physical location:
--   - "15999 Hwy 1" vs "15999 Coast Hwy" vs "15999 Coast Hwy, Valley Ford, CA 94972"
--   - Created from different data sources with different address formats
--
-- Solution:
--   1. Identify duplicates by geocoded coordinates (high confidence)
--   2. Pick canonical place (prefer geocoded, most complete)
--   3. Migrate all relationships to canonical
--   4. Delete duplicates
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_156__deduplicate_places.sql

\echo ''
\echo 'MIG_156: Deduplicate Places'
\echo '============================================'

-- ============================================================
-- 1. Function to merge places
-- ============================================================

\echo ''
\echo 'Creating merge_places function...'

CREATE OR REPLACE FUNCTION trapper.merge_places(
    p_keep_place_id UUID,
    p_remove_place_id UUID,
    p_reason TEXT DEFAULT 'duplicate'
)
RETURNS BOOLEAN AS $$
DECLARE
    v_keep_name TEXT;
    v_remove_name TEXT;
BEGIN
    -- Get names for logging
    SELECT display_name INTO v_keep_name FROM trapper.places WHERE place_id = p_keep_place_id;
    SELECT display_name INTO v_remove_name FROM trapper.places WHERE place_id = p_remove_place_id;

    IF v_keep_name IS NULL OR v_remove_name IS NULL THEN
        RAISE NOTICE 'One or both places not found';
        RETURN FALSE;
    END IF;

    RAISE NOTICE 'Merging "%" into "%"', v_remove_name, v_keep_name;

    -- 1. Update sot_appointments
    UPDATE trapper.sot_appointments
    SET place_id = p_keep_place_id
    WHERE place_id = p_remove_place_id;

    -- 2. Update person_place_relationships
    UPDATE trapper.person_place_relationships
    SET place_id = p_keep_place_id
    WHERE place_id = p_remove_place_id
      AND NOT EXISTS (
          SELECT 1 FROM trapper.person_place_relationships ppr2
          WHERE ppr2.person_id = person_place_relationships.person_id
            AND ppr2.place_id = p_keep_place_id
      );

    -- Delete duplicate person-place links
    DELETE FROM trapper.person_place_relationships
    WHERE place_id = p_remove_place_id;

    -- 3. Update sot_requests
    UPDATE trapper.sot_requests
    SET place_id = p_keep_place_id
    WHERE place_id = p_remove_place_id;

    -- 4. Update place_place_edges (both sides)
    UPDATE trapper.place_place_edges
    SET place_id_a = p_keep_place_id
    WHERE place_id_a = p_remove_place_id
      AND place_id_b != p_keep_place_id;

    UPDATE trapper.place_place_edges
    SET place_id_b = p_keep_place_id
    WHERE place_id_b = p_remove_place_id
      AND place_id_a != p_keep_place_id;

    -- Delete self-referential edges
    DELETE FROM trapper.place_place_edges
    WHERE place_id_a = place_id_b;

    -- 5. Update sot_people primary_address_id
    UPDATE trapper.sot_people
    SET primary_address_id = p_keep_place_id
    WHERE primary_address_id = p_remove_place_id;

    -- 6. Update cat_place_relationships
    UPDATE trapper.cat_place_relationships
    SET place_id = p_keep_place_id
    WHERE place_id = p_remove_place_id
      AND NOT EXISTS (
          SELECT 1 FROM trapper.cat_place_relationships cpr2
          WHERE cpr2.cat_id = cat_place_relationships.cat_id
            AND cpr2.place_id = p_keep_place_id
      );

    DELETE FROM trapper.cat_place_relationships
    WHERE place_id = p_remove_place_id;

    -- 7. Update journal_entries
    UPDATE trapper.journal_entries
    SET primary_place_id = p_keep_place_id
    WHERE primary_place_id = p_remove_place_id;

    -- 8. Log the merge in corrections
    INSERT INTO trapper.corrections (
        entity_type, entity_id, correction_type, field_name,
        old_value, new_value, reason, created_by, suggested_by
    ) VALUES (
        'place', p_remove_place_id, 'merge', 'merged_into',
        to_jsonb(v_remove_name), to_jsonb(p_keep_place_id::text),
        p_reason, 'system', 'rule'
    );

    -- 9. Delete the duplicate place
    DELETE FROM trapper.places WHERE place_id = p_remove_place_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.merge_places IS
'Merges two places by moving all relationships from remove_place to keep_place, then deleting remove_place.';

-- ============================================================
-- 2. Function to pick canonical place from a pair
-- ============================================================

\echo ''
\echo 'Creating pick_canonical_place function...'

CREATE OR REPLACE FUNCTION trapper.pick_canonical_place(
    p_place_id_1 UUID,
    p_place_id_2 UUID
)
RETURNS UUID AS $$
DECLARE
    p1 RECORD;
    p2 RECORD;
    score1 INT := 0;
    score2 INT := 0;
BEGIN
    SELECT * INTO p1 FROM trapper.places WHERE place_id = p_place_id_1;
    SELECT * INTO p2 FROM trapper.places WHERE place_id = p_place_id_2;

    -- Prefer geocoded (address-backed)
    IF p1.is_address_backed THEN score1 := score1 + 10; END IF;
    IF p2.is_address_backed THEN score2 := score2 + 10; END IF;

    -- Prefer with location
    IF p1.location IS NOT NULL THEN score1 := score1 + 5; END IF;
    IF p2.location IS NOT NULL THEN score2 := score2 + 5; END IF;

    -- Prefer longer formatted_address (more complete)
    IF LENGTH(COALESCE(p1.formatted_address, '')) > LENGTH(COALESCE(p2.formatted_address, '')) THEN
        score1 := score1 + 3;
    ELSIF LENGTH(COALESCE(p2.formatted_address, '')) > LENGTH(COALESCE(p1.formatted_address, '')) THEN
        score2 := score2 + 3;
    END IF;

    -- Prefer has sot_address_id
    IF p1.sot_address_id IS NOT NULL THEN score1 := score1 + 2; END IF;
    IF p2.sot_address_id IS NOT NULL THEN score2 := score2 + 2; END IF;

    -- Prefer older (more established)
    IF p1.created_at < p2.created_at THEN score1 := score1 + 1;
    ELSIF p2.created_at < p1.created_at THEN score2 := score2 + 1;
    END IF;

    IF score1 >= score2 THEN
        RETURN p_place_id_1;
    ELSE
        RETURN p_place_id_2;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- 3. Find coordinate-matched duplicates (fast, high confidence)
-- ============================================================

\echo ''
\echo 'Finding coordinate-matched duplicates (within 100m)...'

CREATE TEMP TABLE coord_duplicates AS
SELECT
    p1.place_id as place_id_1,
    p2.place_id as place_id_2,
    p1.display_name as name_1,
    p2.display_name as name_2,
    p1.formatted_address as addr_1,
    p2.formatted_address as addr_2,
    p1.is_address_backed as geocoded_1,
    p2.is_address_backed as geocoded_2
FROM trapper.places p1
JOIN trapper.places p2 ON p1.place_id < p2.place_id
WHERE p1.location IS NOT NULL
  AND p2.location IS NOT NULL
  AND ST_DWithin(p1.location, p2.location, 100);

\echo ''
\echo 'Coordinate-matched duplicates found:'
SELECT COUNT(*) as duplicate_pairs FROM coord_duplicates;

SELECT name_1, addr_1, name_2, addr_2
FROM coord_duplicates
LIMIT 20;

-- ============================================================
-- 4. Auto-merge coordinate duplicates
-- ============================================================

\echo ''
\echo 'Auto-merging coordinate-matched duplicates...'

DO $$
DECLARE
    rec RECORD;
    v_keep_id UUID;
    v_remove_id UUID;
    v_merged INT := 0;
BEGIN
    FOR rec IN SELECT place_id_1, place_id_2 FROM coord_duplicates
    LOOP
        -- Check if both still exist
        IF EXISTS (SELECT 1 FROM trapper.places WHERE place_id = rec.place_id_1)
           AND EXISTS (SELECT 1 FROM trapper.places WHERE place_id = rec.place_id_2) THEN

            v_keep_id := trapper.pick_canonical_place(rec.place_id_1, rec.place_id_2);
            IF v_keep_id = rec.place_id_1 THEN
                v_remove_id := rec.place_id_2;
            ELSE
                v_remove_id := rec.place_id_1;
            END IF;

            PERFORM trapper.merge_places(v_keep_id, v_remove_id, 'coordinate_match_duplicate');
            v_merged := v_merged + 1;
        END IF;
    END LOOP;

    RAISE NOTICE 'Merged % coordinate-matched duplicate pairs', v_merged;
END $$;

DROP TABLE coord_duplicates;

-- ============================================================
-- 5. Find the specific 15999 duplicates manually
-- ============================================================

\echo ''
\echo 'Checking 15999 Coast Hwy duplicates specifically:'

SELECT place_id, display_name, formatted_address, is_address_backed, location IS NOT NULL as has_loc
FROM trapper.places
WHERE display_name ILIKE '%15999%'
   OR formatted_address ILIKE '%15999%';

-- ============================================================
-- 6. Summary stats
-- ============================================================

\echo ''
\echo 'Place statistics after cleanup:'

SELECT
    COUNT(*) as total_places,
    COUNT(*) FILTER (WHERE is_address_backed) as geocoded,
    COUNT(*) FILTER (WHERE location IS NOT NULL) as has_location,
    COUNT(*) FILTER (WHERE sot_address_id IS NOT NULL) as has_sot_address
FROM trapper.places;

SELECT 'MIG_156 Complete' AS status;
