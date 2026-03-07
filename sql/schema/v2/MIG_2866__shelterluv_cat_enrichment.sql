-- MIG_2866: Enrich cats with ShelterLuv photos, descriptions, and status tracking (FFS-302)
--
-- ShelterLuv animal payloads contain rich data not captured by the current pipeline:
-- - Photo URLs (Photo field)
-- - Narrative descriptions/bios (Description field)
-- - Lifecycle status (Available, Adopted, In Foster, Deceased, etc.)
--
-- This migration:
-- 1. Adds photo_url and description columns to sot.cats
-- 2. Backfills from source.shelterluv_raw via cat_identifiers
-- 3. Creates monitoring views for status distribution and outcome history
--
-- Depends on: FFS-300/301 (ShelterLuv data populated), MIG_2857 staging table
-- Safety: Additive only — new columns and views, no existing data modified.

BEGIN;

-- =============================================================================
-- Step 1: Add photo_url and description columns to sot.cats
-- =============================================================================

ALTER TABLE sot.cats ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE sot.cats ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN sot.cats.photo_url IS 'Cat photo URL from ShelterLuv (MIG_2866)';
COMMENT ON COLUMN sot.cats.description IS 'Cat description/bio from ShelterLuv (MIG_2866)';

-- =============================================================================
-- Step 2: Backfill photo_url from ShelterLuv animal records
-- Joins via cat_identifiers (shelterluv_animal_id) to find the matching raw record.
-- Uses latest record per animal (DISTINCT ON + ORDER BY fetched_at DESC).
-- =============================================================================

UPDATE sot.cats c
SET photo_url = sl.photo_url
FROM (
    SELECT DISTINCT ON (ci.cat_id)
        ci.cat_id,
        sr.payload->>'CoverPhoto' AS photo_url
    FROM sot.cat_identifiers ci
    JOIN source.shelterluv_raw sr
        ON sr.source_record_id = ci.id_value
        AND sr.record_type = 'animal'
    WHERE ci.id_type = 'shelterluv_animal_id'
      AND sr.payload->>'CoverPhoto' IS NOT NULL
      AND sr.payload->>'CoverPhoto' NOT LIKE '%default_cat.png'
    ORDER BY ci.cat_id, sr.fetched_at DESC
) sl
WHERE c.cat_id = sl.cat_id
  AND c.photo_url IS NULL
  AND c.merged_into_cat_id IS NULL;

-- =============================================================================
-- Step 3: Backfill description from ShelterLuv animal records
-- =============================================================================

UPDATE sot.cats c
SET description = sl.description
FROM (
    SELECT DISTINCT ON (ci.cat_id)
        ci.cat_id,
        COALESCE(
            sr.payload->>'Description',
            sr.payload->>'Bio'
        ) AS description
    FROM sot.cat_identifiers ci
    JOIN source.shelterluv_raw sr
        ON sr.source_record_id = ci.id_value
        AND sr.record_type = 'animal'
    WHERE ci.id_type = 'shelterluv_animal_id'
      AND COALESCE(sr.payload->>'Description', sr.payload->>'Bio') IS NOT NULL
      AND BTRIM(COALESCE(sr.payload->>'Description', sr.payload->>'Bio')) != ''
    ORDER BY ci.cat_id, sr.fetched_at DESC
) sl
WHERE c.cat_id = sl.cat_id
  AND c.description IS NULL
  AND c.merged_into_cat_id IS NULL;

-- =============================================================================
-- Step 4: ShelterLuv status distribution view
-- Shows how many animals are in each ShelterLuv status category.
-- =============================================================================

CREATE OR REPLACE VIEW ops.v_shelterluv_cat_status AS
SELECT
    COALESCE(sr.payload->>'Status', 'Unknown') AS shelterluv_status,
    COUNT(*) AS animal_count,
    COUNT(*) FILTER (WHERE ci.cat_id IS NOT NULL) AS matched_to_sot,
    COUNT(*) FILTER (WHERE ci.cat_id IS NULL) AS unmatched
FROM source.shelterluv_raw sr
LEFT JOIN sot.cat_identifiers ci
    ON ci.id_type = 'shelterluv_animal_id'
    AND ci.id_value = sr.source_record_id
WHERE sr.record_type = 'animal'
GROUP BY sr.payload->>'Status'
ORDER BY animal_count DESC;

COMMENT ON VIEW ops.v_shelterluv_cat_status IS 'ShelterLuv animal status distribution with SOT match rates (MIG_2866)';

-- =============================================================================
-- Step 5: Cat outcome history view
-- Aggregates all ShelterLuv events per cat for a complete lifecycle view.
-- =============================================================================

CREATE OR REPLACE VIEW ops.v_cat_outcome_history AS
WITH event_animals AS (
    -- Extract Animal ID from AssociatedRecords array
    SELECT
        sr.id AS raw_id,
        sr.payload->>'Type' AS event_type,
        sr.payload->>'Subtype' AS event_subtype,
        TO_TIMESTAMP((sr.payload->>'Time')::BIGINT) AS event_time,
        sr.payload->>'User' AS event_user,
        ar->>'Id' AS animal_id,
        sr.fetched_at
    FROM source.shelterluv_raw sr,
         jsonb_array_elements(sr.payload->'AssociatedRecords') ar
    WHERE sr.record_type = 'event'
      AND ar->>'Type' = 'Animal'
),
event_persons AS (
    -- Extract Person ID from AssociatedRecords array
    SELECT
        sr.id AS raw_id,
        ar->>'Id' AS person_id
    FROM source.shelterluv_raw sr,
         jsonb_array_elements(sr.payload->'AssociatedRecords') ar
    WHERE sr.record_type = 'event'
      AND ar->>'Type' = 'Person'
)
SELECT
    ci.cat_id,
    c.name AS cat_name,
    c.microchip,
    ea.event_type,
    ea.event_subtype,
    ea.event_time,
    ea.event_user,
    sp.payload->>'Firstname' AS person_first_name,
    sp.payload->>'Lastname' AS person_last_name,
    sp.payload->>'Email' AS person_email,
    ea.fetched_at
FROM event_animals ea
JOIN sot.cat_identifiers ci
    ON ci.id_type = 'shelterluv_animal_id'
    AND ci.id_value = ea.animal_id
JOIN sot.cats c ON c.cat_id = ci.cat_id AND c.merged_into_cat_id IS NULL
LEFT JOIN event_persons ep ON ep.raw_id = ea.raw_id
LEFT JOIN source.shelterluv_raw sp
    ON sp.record_type = 'person'
    AND sp.source_record_id = ep.person_id
ORDER BY ci.cat_id, ea.event_time;

COMMENT ON VIEW ops.v_cat_outcome_history IS 'Complete ShelterLuv event history per cat — adoptions, fosters, returns, mortality (MIG_2866)';

-- =============================================================================
-- Step 6: Enrichment summary (logged via RAISE NOTICE in DO block)
-- =============================================================================

DO $$
DECLARE
    v_photos INTEGER;
    v_descriptions INTEGER;
    v_total_sl_cats INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_photos FROM sot.cats WHERE photo_url IS NOT NULL AND merged_into_cat_id IS NULL;
    SELECT COUNT(*) INTO v_descriptions FROM sot.cats WHERE description IS NOT NULL AND merged_into_cat_id IS NULL;
    SELECT COUNT(*) INTO v_total_sl_cats FROM sot.cats WHERE source_system = 'shelterluv' AND merged_into_cat_id IS NULL;

    RAISE NOTICE 'MIG_2866 enrichment summary:';
    RAISE NOTICE '  Cats with photos: %', v_photos;
    RAISE NOTICE '  Cats with descriptions: %', v_descriptions;
    RAISE NOTICE '  Total ShelterLuv cats: %', v_total_sl_cats;
END $$;

COMMIT;
