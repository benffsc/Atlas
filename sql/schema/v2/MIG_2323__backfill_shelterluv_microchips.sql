-- ============================================================================
-- MIG_2323: Backfill ShelterLuv Microchips from API Data
-- ============================================================================
-- Root Cause: V1 to V2 migration didn't properly extract microchips from
-- ShelterLuv data. The ShelterLuv API returns microchips in payload->Microchips
-- array, but V1 stored them separately in sot.cat_identifiers.
--
-- After running shelterluv_api_sync.mjs, we have 4,196 animals with 3,740
-- having microchips. This migration:
--   1. Updates shelterluv_animal_id to Internal-ID format for existing matches
--   2. Backfills microchips using FFSC-A ID matching (PreviousIds)
--   3. Backfills microchips using unique 1:1 name matching
--   4. Creates audit table for tracking
--
-- Usage: psql -f MIG_2323__backfill_shelterluv_microchips.sql
-- ============================================================================

\echo '=== MIG_2323: Backfill ShelterLuv Microchips ==='
\echo ''

BEGIN;

-- ============================================================================
-- Phase 1: Create audit table for tracking backfills
-- ============================================================================

\echo 'Phase 1: Creating audit table...'

DROP TABLE IF EXISTS ops.shelterluv_microchip_backfill_log;

CREATE TABLE ops.shelterluv_microchip_backfill_log (
    id SERIAL PRIMARY KEY,
    cat_id UUID NOT NULL,
    cat_name TEXT,
    old_shelterluv_animal_id TEXT,
    new_shelterluv_animal_id TEXT,
    microchip TEXT,
    match_method TEXT NOT NULL,
    match_confidence TEXT NOT NULL,
    backfilled_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE ops.shelterluv_microchip_backfill_log IS
'Audit log for MIG_2323 ShelterLuv microchip backfill operations';

-- ============================================================================
-- Phase 2: Update cats that already have microchips - add Internal-ID
-- ============================================================================

\echo 'Phase 2: Updating shelterluv_animal_id for cats with microchips...'

WITH staged_chips AS (
    SELECT
        payload->>'Internal-ID' as internal_id,
        payload->'Microchips'->0->>'Id' as microchip
    FROM ops.staged_records
    WHERE source_system = 'shelterluv' AND source_table = 'animals'
      AND jsonb_array_length(COALESCE(payload->'Microchips', '[]'::jsonb)) > 0
),
matched AS (
    SELECT
        c.cat_id,
        c.name,
        c.shelterluv_animal_id as old_id,
        s.internal_id as new_id,
        c.microchip
    FROM sot.cats c
    JOIN staged_chips s ON c.microchip = s.microchip
    WHERE c.source_system = 'shelterluv'
      AND c.merged_into_cat_id IS NULL
      AND c.shelterluv_animal_id IS DISTINCT FROM s.internal_id
)
UPDATE sot.cats c
SET
    shelterluv_animal_id = m.new_id,
    updated_at = NOW()
FROM matched m
WHERE c.cat_id = m.cat_id;

-- Log the updates
INSERT INTO ops.shelterluv_microchip_backfill_log
    (cat_id, cat_name, old_shelterluv_animal_id, new_shelterluv_animal_id, microchip, match_method, match_confidence)
SELECT
    c.cat_id,
    c.name,
    'existing_id' as old_id,
    s.internal_id as new_id,
    c.microchip,
    'microchip_match',
    'high'
FROM sot.cats c
JOIN (
    SELECT
        payload->>'Internal-ID' as internal_id,
        payload->'Microchips'->0->>'Id' as microchip
    FROM ops.staged_records
    WHERE source_system = 'shelterluv' AND source_table = 'animals'
      AND jsonb_array_length(COALESCE(payload->'Microchips', '[]'::jsonb)) > 0
) s ON c.microchip = s.microchip
WHERE c.source_system = 'shelterluv'
  AND c.merged_into_cat_id IS NULL;

\echo 'Updated shelterluv_animal_id for cats with existing microchips'

-- ============================================================================
-- Phase 3: Backfill microchips using FFSC-A ID matching (PreviousIds)
-- ============================================================================

\echo ''
\echo 'Phase 3: Backfilling via FFSC-A ID match...'

WITH staged_previous AS (
    SELECT
        payload->>'Internal-ID' as internal_id,
        payload->'Microchips'->0->>'Id' as microchip,
        payload->>'Name' as api_name,
        jsonb_array_elements(payload->'PreviousIds')->>'IdValue' as previous_id
    FROM ops.staged_records
    WHERE source_system = 'shelterluv' AND source_table = 'animals'
      AND jsonb_array_length(COALESCE(payload->'Microchips', '[]'::jsonb)) > 0
      AND jsonb_array_length(COALESCE(payload->'PreviousIds', '[]'::jsonb)) > 0
),
matched AS (
    SELECT DISTINCT ON (c.cat_id)
        c.cat_id,
        c.name as cat_name,
        c.shelterluv_animal_id as old_id,
        s.internal_id as new_id,
        s.microchip
    FROM sot.cats c
    JOIN staged_previous s ON (
        c.shelterluv_animal_id = s.previous_id
        OR c.shelterluv_animal_id = 'sl_animal_' || s.previous_id
        OR REPLACE(c.shelterluv_animal_id, 'sl_animal_', '') = s.previous_id
    )
    WHERE c.source_system = 'shelterluv'
      AND c.merged_into_cat_id IS NULL
      AND c.microchip IS NULL
)
INSERT INTO ops.shelterluv_microchip_backfill_log
    (cat_id, cat_name, old_shelterluv_animal_id, new_shelterluv_animal_id, microchip, match_method, match_confidence)
SELECT cat_id, cat_name, old_id, new_id, microchip, 'ffsc_a_id_match', 'high'
FROM matched;

-- Apply the updates (skip if microchip already exists on another cat)
UPDATE sot.cats c
SET
    microchip = l.microchip,
    shelterluv_animal_id = l.new_shelterluv_animal_id,
    updated_at = NOW()
FROM ops.shelterluv_microchip_backfill_log l
WHERE c.cat_id = l.cat_id
  AND l.match_method = 'ffsc_a_id_match'
  AND c.microchip IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM sot.cats existing
    WHERE existing.microchip = l.microchip
      AND existing.merged_into_cat_id IS NULL
  );

-- ============================================================================
-- Phase 4: Backfill using unique 1:1 name matches
-- ============================================================================

\echo ''
\echo 'Phase 4: Backfilling via unique name match...'

WITH cats_clean AS (
    SELECT
        cat_id,
        name as full_name,
        shelterluv_animal_id,
        LOWER(TRIM((regexp_match(name, '^"?([A-Za-z]+)'))[1])) as core_name
    FROM sot.cats
    WHERE source_system = 'shelterluv'
      AND merged_into_cat_id IS NULL
      AND microchip IS NULL
      AND name IS NOT NULL
      AND name !~* '^(unknown|dsh|test|unnamed)'
),
staged_clean AS (
    SELECT
        payload->'Microchips'->0->>'Id' as microchip,
        payload->>'Internal-ID' as internal_id,
        LOWER(TRIM(payload->>'Name')) as name
    FROM ops.staged_records
    WHERE source_system = 'shelterluv' AND source_table = 'animals'
      AND jsonb_array_length(COALESCE(payload->'Microchips', '[]'::jsonb)) > 0
),
unique_cat_names AS (
    SELECT core_name
    FROM cats_clean
    WHERE core_name IS NOT NULL AND core_name != ''
    GROUP BY core_name
    HAVING COUNT(DISTINCT cat_id) = 1
),
unique_staged_names AS (
    SELECT name
    FROM staged_clean
    WHERE name IS NOT NULL AND name != ''
    GROUP BY name
    HAVING COUNT(*) = 1
),
matched AS (
    SELECT DISTINCT
        c.cat_id,
        c.full_name as cat_name,
        c.shelterluv_animal_id as old_id,
        s.internal_id as new_id,
        s.microchip
    FROM cats_clean c
    JOIN unique_cat_names ucn ON c.core_name = ucn.core_name
    JOIN unique_staged_names usn ON c.core_name = usn.name
    JOIN staged_clean s ON c.core_name = s.name
    WHERE NOT EXISTS (
        SELECT 1 FROM ops.shelterluv_microchip_backfill_log l
        WHERE l.cat_id = c.cat_id
    )
)
INSERT INTO ops.shelterluv_microchip_backfill_log
    (cat_id, cat_name, old_shelterluv_animal_id, new_shelterluv_animal_id, microchip, match_method, match_confidence)
SELECT cat_id, cat_name, old_id, new_id, microchip, 'unique_name_match', 'medium'
FROM matched;

-- Apply the updates (skip if microchip already exists on another cat)
UPDATE sot.cats c
SET
    microchip = l.microchip,
    shelterluv_animal_id = l.new_shelterluv_animal_id,
    updated_at = NOW()
FROM ops.shelterluv_microchip_backfill_log l
WHERE c.cat_id = l.cat_id
  AND l.match_method = 'unique_name_match'
  AND c.microchip IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM sot.cats existing
    WHERE existing.microchip = l.microchip
      AND existing.merged_into_cat_id IS NULL
  );

-- ============================================================================
-- Phase 5: Verification
-- ============================================================================

\echo ''
\echo 'Phase 5: Verification...'

DO $$
DECLARE
    v_total_sl_cats INTEGER;
    v_with_microchip INTEGER;
    v_without_microchip INTEGER;
    v_backfilled INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total_sl_cats
    FROM sot.cats
    WHERE source_system = 'shelterluv' AND merged_into_cat_id IS NULL;

    SELECT COUNT(*) INTO v_with_microchip
    FROM sot.cats
    WHERE source_system = 'shelterluv' AND merged_into_cat_id IS NULL AND microchip IS NOT NULL;

    SELECT COUNT(*) INTO v_without_microchip
    FROM sot.cats
    WHERE source_system = 'shelterluv' AND merged_into_cat_id IS NULL AND microchip IS NULL;

    SELECT COUNT(*) INTO v_backfilled
    FROM ops.shelterluv_microchip_backfill_log;

    RAISE NOTICE '=== MIG_2323 Verification ===';
    RAISE NOTICE 'Total ShelterLuv cats: %', v_total_sl_cats;
    RAISE NOTICE 'Cats with microchip: % (%.1f%%)', v_with_microchip, 100.0 * v_with_microchip / v_total_sl_cats;
    RAISE NOTICE 'Cats without microchip: % (%.1f%%)', v_without_microchip, 100.0 * v_without_microchip / v_total_sl_cats;
    RAISE NOTICE 'Records in backfill log: %', v_backfilled;
END;
$$;

\echo ''
\echo 'Backfill summary by method:'
SELECT
    match_method,
    match_confidence,
    COUNT(*) as count
FROM ops.shelterluv_microchip_backfill_log
GROUP BY match_method, match_confidence
ORDER BY match_method;

COMMIT;

\echo ''
\echo '=============================================='
\echo 'MIG_2323 Complete!'
\echo '=============================================='
\echo ''
\echo 'Summary:'
\echo '  - Updated shelterluv_animal_id to Internal-ID for microchip-matched cats'
\echo '  - Backfilled microchips via FFSC-A ID matching'
\echo '  - Backfilled microchips via unique name matching'
\echo ''
\echo 'Remaining gap explanation:'
\echo '  - V1 cats have FFSC-A-xxx IDs (public ShelterLuv IDs)'
\echo '  - API returns Internal-ID (numeric, different system)'
\echo '  - Only ~380 API records have PreviousIds with FFSC-A format'
\echo '  - V1 cats are largely different animals from current API data'
\echo '  - Many V1 cats are historical (pre-2022) not in current ShelterLuv'
\echo ''
\echo 'To increase coverage:'
\echo '  - Check if ShelterLuv has historical export with microchips'
\echo '  - Match remaining cats manually if business-critical'
\echo ''
