-- MIG_2810: Fix Place Deduplication — Merge Duplicates, Add Unique Index, ON CONFLICT
--
-- Problem (FFS-134): 2,642 duplicate place records (19.6% of all places).
-- Root cause: find_or_create_place_deduped() uses SELECT ... LIMIT 1 without a
-- UNIQUE constraint. Concurrent ingest batches create duplicates because multiple
-- transactions see no existing record simultaneously.
--
-- Solution:
-- 1. Merge all duplicate places by normalized_address (using existing merge_place_into)
-- 2. Add partial unique index on normalized_address
-- 3. Update find_or_create_place_deduped() to use INSERT ... ON CONFLICT
--
-- Created: 2026-03-04

\echo ''
\echo '=============================================='
\echo '  MIG_2810: Fix Place Deduplication'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Pre-check: Count duplicates by normalized_address
-- ============================================================================

\echo '1. Pre-check: Counting duplicate place groups by normalized_address...'

WITH dups AS (
  SELECT normalized_address, COUNT(*) as cnt
  FROM sot.places
  WHERE merged_into_place_id IS NULL
    AND normalized_address IS NOT NULL
  GROUP BY normalized_address
  HAVING COUNT(*) > 1
)
SELECT 'duplicate_groups' as metric, COUNT(*) as value FROM dups
UNION ALL
SELECT 'total_duplicate_places', SUM(cnt) FROM dups
UNION ALL
SELECT 'extra_duplicates_to_merge', SUM(cnt) - COUNT(*) FROM dups;

-- ============================================================================
-- 2. Merge duplicate places by normalized_address
-- ============================================================================

\echo ''
\echo '2. Merging duplicate places by normalized_address...'

DO $$
DECLARE
  v_group RECORD;
  v_place RECORD;
  v_winner_id UUID;
  v_merged_count INT := 0;
  v_group_count INT := 0;
BEGIN
  FOR v_group IN
    SELECT normalized_address
    FROM sot.places
    WHERE merged_into_place_id IS NULL
      AND normalized_address IS NOT NULL
    GROUP BY normalized_address
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  LOOP
    v_group_count := v_group_count + 1;
    v_winner_id := NULL;

    -- Pick winner: most FK references, then oldest created_at
    FOR v_place IN
      SELECT p.place_id,
        (
          (SELECT COUNT(*) FROM ops.requests WHERE place_id = p.place_id) +
          (SELECT COUNT(*) FROM ops.appointments WHERE place_id = p.place_id) +
          (SELECT COUNT(*) FROM ops.appointments WHERE inferred_place_id = p.place_id) +
          (SELECT COUNT(*) FROM sot.person_place WHERE place_id = p.place_id) +
          (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = p.place_id)
        ) as ref_count
      FROM sot.places p
      WHERE p.normalized_address = v_group.normalized_address
        AND p.merged_into_place_id IS NULL
      ORDER BY ref_count DESC, p.created_at ASC
    LOOP
      IF v_winner_id IS NULL THEN
        v_winner_id := v_place.place_id;
      ELSE
        PERFORM sot.merge_place_into(v_place.place_id, v_winner_id, 'duplicate_normalized_address', 'MIG_2810');
        v_merged_count := v_merged_count + 1;
      END IF;
    END LOOP;

    IF v_group_count % 50 = 0 THEN
      RAISE NOTICE 'Processed % groups, merged % places...', v_group_count, v_merged_count;
    END IF;
  END LOOP;

  RAISE NOTICE 'Merge complete: % groups processed, % places merged', v_group_count, v_merged_count;
END;
$$;

-- ============================================================================
-- 3. Verify no duplicates remain
-- ============================================================================

\echo ''
\echo '3. Post-merge verification...'

SELECT 'remaining_duplicates' as metric, COUNT(*) as value
FROM (
  SELECT normalized_address
  FROM sot.places
  WHERE merged_into_place_id IS NULL
    AND normalized_address IS NOT NULL
  GROUP BY normalized_address
  HAVING COUNT(*) > 1
) dups;

-- ============================================================================
-- 4. Add partial unique index on normalized_address
-- ============================================================================

\echo ''
\echo '4. Creating unique index on normalized_address...'

CREATE UNIQUE INDEX IF NOT EXISTS idx_places_normalized_address_unique
  ON sot.places (normalized_address)
  WHERE merged_into_place_id IS NULL AND normalized_address IS NOT NULL;

\echo '   Created idx_places_normalized_address_unique'

-- ============================================================================
-- 5. Update find_or_create_place_deduped() to use ON CONFLICT
-- ============================================================================

\echo ''
\echo '5. Updating find_or_create_place_deduped() with ON CONFLICT...'

DROP FUNCTION IF EXISTS sot.find_or_create_place_deduped(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT);

CREATE OR REPLACE FUNCTION sot.find_or_create_place_deduped(
    p_formatted_address TEXT,
    p_display_name TEXT DEFAULT NULL,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL,
    p_source_system TEXT DEFAULT 'atlas'
)
RETURNS UUID
LANGUAGE plpgsql AS $function$
DECLARE
    v_normalized TEXT;
    v_existing_id UUID;
    v_new_id UUID;
    v_has_coords BOOLEAN;
    v_address_id UUID;
    v_needs_address_link BOOLEAN;
BEGIN
    -- Normalize the address
    v_normalized := sot.normalize_address(p_formatted_address);

    IF v_normalized IS NULL OR v_normalized = '' THEN
        RETURN NULL;
    END IF;

    -- DEDUP CHECK 1: Exact normalized address match
    SELECT place_id INTO v_existing_id
    FROM sot.places
    WHERE normalized_address = v_normalized
      AND merged_into_place_id IS NULL
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        -- Ensure existing place has address link (MIG_2563 fix)
        SELECT (sot_address_id IS NULL AND formatted_address IS NOT NULL)
        INTO v_needs_address_link
        FROM sot.places WHERE place_id = v_existing_id;

        IF v_needs_address_link THEN
            v_address_id := sot.find_or_create_address(
                p_formatted_address,
                p_formatted_address,
                p_lat,
                p_lng,
                p_source_system
            );

            IF v_address_id IS NOT NULL THEN
                UPDATE sot.places
                SET sot_address_id = v_address_id,
                    is_address_backed = TRUE,
                    updated_at = NOW()
                WHERE place_id = v_existing_id;
            END IF;
        END IF;

        RETURN v_existing_id;
    END IF;

    -- DEDUP CHECK 2: Coordinate match (within 10 meters)
    v_has_coords := (p_lat IS NOT NULL AND p_lng IS NOT NULL);

    IF v_has_coords THEN
        SELECT place_id INTO v_existing_id
        FROM sot.places
        WHERE location IS NOT NULL
          AND merged_into_place_id IS NULL
          AND (unit_identifier IS NULL OR unit_identifier = '')
          AND ST_DWithin(
              location,
              ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
              10
          )
        ORDER BY
            CASE WHEN normalized_address IS NOT NULL THEN 0 ELSE 1 END,
            ST_Distance(location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography),
            created_at
        LIMIT 1;

        IF v_existing_id IS NOT NULL THEN
            -- Ensure existing place has address link (MIG_2563 fix)
            SELECT (sot_address_id IS NULL AND p_formatted_address IS NOT NULL)
            INTO v_needs_address_link
            FROM sot.places WHERE place_id = v_existing_id;

            IF v_needs_address_link THEN
                v_address_id := sot.find_or_create_address(
                    p_formatted_address,
                    p_formatted_address,
                    p_lat,
                    p_lng,
                    p_source_system
                );

                IF v_address_id IS NOT NULL THEN
                    UPDATE sot.places
                    SET sot_address_id = v_address_id,
                        is_address_backed = TRUE,
                        formatted_address = COALESCE(formatted_address, p_formatted_address),
                        updated_at = NOW()
                    WHERE place_id = v_existing_id;
                END IF;
            END IF;

            RETURN v_existing_id;
        END IF;
    END IF;

    -- CREATE NEW PLACE WITH ADDRESS (using ON CONFLICT for race condition safety)
    -- First create address record
    v_address_id := sot.find_or_create_address(
        p_formatted_address,
        p_formatted_address,
        p_lat,
        p_lng,
        p_source_system
    );

    -- MIG_2810: Use ON CONFLICT to handle concurrent inserts
    INSERT INTO sot.places (
        place_id,
        display_name,
        formatted_address,
        normalized_address,
        location,
        source_system,
        sot_address_id,
        is_address_backed,
        created_at
    ) VALUES (
        gen_random_uuid(),
        COALESCE(p_display_name, p_formatted_address),
        p_formatted_address,
        v_normalized,
        CASE WHEN v_has_coords THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography ELSE NULL END,
        p_source_system,
        v_address_id,
        (v_address_id IS NOT NULL),
        NOW()
    )
    ON CONFLICT (normalized_address) WHERE merged_into_place_id IS NULL AND normalized_address IS NOT NULL
    DO UPDATE SET updated_at = NOW()  -- no-op update to return the existing row
    RETURNING place_id INTO v_new_id;

    RETURN v_new_id;
END;
$function$;

COMMENT ON FUNCTION sot.find_or_create_place_deduped IS
'Creates or finds a place with proper deduplication and address linking.

MIG_2810: Uses INSERT ... ON CONFLICT with partial unique index on normalized_address
to prevent duplicate creation from concurrent transactions.

Deduplication order:
1. Exact normalized_address match (SELECT)
2. Coordinate match (within 10 meters, non-unit only)
3. Create new with ON CONFLICT safety net

Address linking:
- New places: Always creates address record first
- Existing places: Creates address record if missing (MIG_2563)';

-- ============================================================================
-- 6. Final stats
-- ============================================================================

\echo ''
\echo '6. Final statistics...'

SELECT 'active_places' as metric, COUNT(*) as value
FROM sot.places WHERE merged_into_place_id IS NULL
UNION ALL
SELECT 'merged_places', COUNT(*)
FROM sot.places WHERE merged_into_place_id IS NOT NULL
UNION ALL
SELECT 'merged_by_MIG_2810', COUNT(*)
FROM sot.places WHERE merge_reason = 'duplicate_normalized_address';

\echo ''
\echo '=============================================='
\echo '  MIG_2810 Complete'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  1. Merged duplicate places by normalized_address'
\echo '  2. Added unique index idx_places_normalized_address_unique'
\echo '  3. Updated find_or_create_place_deduped() with ON CONFLICT'
\echo ''
