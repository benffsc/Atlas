-- MIG_1013: V2 Architecture - ShelterLuv Microchip Extraction Fix
-- Phase 1.5, Part 6: Extract microchips from Microchips array (G-12, G-13)
--
-- Problem: ShelterLuv stores microchips in payload->'Microchips'[0]->>'Id'
--          but code was using payload->>'Microchip_ID' (which doesn't exist)
-- Evidence: 7,652 staged records have microchips in wrong location
-- Impact: 1,624 cats have no microchip identifier
--
-- Creates:
-- 1. sot.extract_shelterluv_microchip() - Extract from Microchips array
-- 2. Backfill cat_identifiers from ShelterLuv staged records

\echo ''
\echo '=============================================='
\echo '  MIG_1013: ShelterLuv Microchip Extraction Fix'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. MICROCHIP EXTRACTION FUNCTION
-- ============================================================================

\echo '1. Creating sot.extract_shelterluv_microchip()...'

CREATE OR REPLACE FUNCTION sot.extract_shelterluv_microchip(p_payload JSONB)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_microchips JSONB;
    v_microchip TEXT;
    v_validation RECORD;
BEGIN
    -- Check Microchips array (correct location)
    v_microchips := p_payload->'Microchips';

    IF v_microchips IS NOT NULL AND jsonb_array_length(v_microchips) > 0 THEN
        -- Get first microchip's Id field
        v_microchip := v_microchips->0->>'Id';

        IF v_microchip IS NOT NULL AND v_microchip != '' THEN
            -- Validate microchip
            SELECT * INTO v_validation FROM sot.validate_microchip(v_microchip);
            IF v_validation.is_valid THEN
                RETURN v_validation.cleaned;
            END IF;
        END IF;
    END IF;

    -- Fallback: check Microchip_ID (some records might have it)
    v_microchip := p_payload->>'Microchip_ID';
    IF v_microchip IS NOT NULL AND v_microchip != '' THEN
        SELECT * INTO v_validation FROM sot.validate_microchip(v_microchip);
        IF v_validation.is_valid THEN
            RETURN v_validation.cleaned;
        END IF;
    END IF;

    -- Fallback: check MicrochipNumber
    v_microchip := p_payload->>'MicrochipNumber';
    IF v_microchip IS NOT NULL AND v_microchip != '' THEN
        SELECT * INTO v_validation FROM sot.validate_microchip(v_microchip);
        IF v_validation.is_valid THEN
            RETURN v_validation.cleaned;
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION sot.extract_shelterluv_microchip IS
'Extracts microchip from ShelterLuv payload.
Checks in order:
1. payload->''Microchips''[0]->>''Id'' (correct location)
2. payload->>''Microchip_ID'' (fallback)
3. payload->>''MicrochipNumber'' (another fallback)
Validates microchip before returning.';

\echo '   Created sot.extract_shelterluv_microchip()'

-- ============================================================================
-- 2. BACKFILL CAT_IDENTIFIERS FROM V1 STAGED RECORDS
-- ============================================================================

\echo ''
\echo '2. Backfilling cat_identifiers from ShelterLuv staged records...'

-- First, let's see how many we can extract
\echo 'Checking ShelterLuv staged records for microchips...'

WITH microchip_candidates AS (
    SELECT
        s.staged_record_id,
        s.entity_type,
        s.payload,
        sot.extract_shelterluv_microchip(s.payload) AS microchip,
        s.payload->>'Internal-ID' AS shelterluv_id,
        s.payload->>'Name' AS cat_name
    FROM trapper.staged_source_records s
    WHERE s.source_system = 'shelterluv'
      AND s.entity_type IN ('Animal', 'animal', 'Cat', 'cat')
      AND s.payload->'Microchips' IS NOT NULL
      AND jsonb_array_length(s.payload->'Microchips') > 0
)
SELECT
    COUNT(*) AS total_records,
    COUNT(microchip) AS valid_microchips,
    COUNT(*) - COUNT(microchip) AS invalid_or_missing
FROM microchip_candidates;

-- Now backfill into V1 cat_identifiers (which will dual-write to V2 if enabled)
\echo ''
\echo 'Backfilling valid microchips to trapper.cat_identifiers...'

WITH microchip_data AS (
    SELECT
        c.cat_id,
        sot.extract_shelterluv_microchip(s.payload) AS microchip,
        s.payload->>'Internal-ID' AS shelterluv_id
    FROM trapper.staged_source_records s
    JOIN trapper.sot_cats c ON c.shelterluv_animal_id = s.payload->>'Internal-ID'
    WHERE s.source_system = 'shelterluv'
      AND s.entity_type IN ('Animal', 'animal', 'Cat', 'cat')
      AND s.payload->'Microchips' IS NOT NULL
      AND jsonb_array_length(s.payload->'Microchips') > 0
      AND sot.extract_shelterluv_microchip(s.payload) IS NOT NULL
)
INSERT INTO trapper.cat_identifiers (
    cat_id,
    id_type,
    id_value_raw,
    id_value_norm,
    source_system,
    source_table,
    confidence,
    created_at
)
SELECT
    md.cat_id,
    'microchip',
    md.microchip,
    md.microchip,
    'shelterluv',
    'staged_source_records',
    1.0,
    NOW()
FROM microchip_data md
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.cat_identifiers ci
    WHERE ci.cat_id = md.cat_id
      AND ci.id_type = 'microchip'
      AND ci.id_value_norm = md.microchip
)
ON CONFLICT (cat_id, id_type, id_value_norm) DO NOTHING;

-- Also backfill directly to V2 (in case dual-write is disabled)
\echo ''
\echo 'Backfilling valid microchips to sot.cat_identifiers...'

WITH microchip_data AS (
    SELECT
        c.cat_id,
        sot.extract_shelterluv_microchip(s.payload) AS microchip,
        s.payload->>'Internal-ID' AS shelterluv_id
    FROM trapper.staged_source_records s
    JOIN sot.cats c ON c.shelterluv_animal_id = s.payload->>'Internal-ID'
    WHERE s.source_system = 'shelterluv'
      AND s.entity_type IN ('Animal', 'animal', 'Cat', 'cat')
      AND s.payload->'Microchips' IS NOT NULL
      AND jsonb_array_length(s.payload->'Microchips') > 0
      AND sot.extract_shelterluv_microchip(s.payload) IS NOT NULL
)
INSERT INTO sot.cat_identifiers (
    cat_id,
    id_type,
    id_value_raw,
    id_value_norm,
    source_system,
    source_table,
    confidence,
    created_at
)
SELECT
    md.cat_id,
    'microchip',
    md.microchip,
    md.microchip,
    'shelterluv',
    'staged_source_records',
    1.0,
    NOW()
FROM microchip_data md
WHERE NOT EXISTS (
    SELECT 1 FROM sot.cat_identifiers ci
    WHERE ci.cat_id = md.cat_id
      AND ci.id_type = 'microchip'
      AND ci.id_value_norm = md.microchip
)
ON CONFLICT (cat_id, id_type, id_value_norm) DO NOTHING;

-- ============================================================================
-- 3. UPDATE CATS TABLE WITH MICROCHIP
-- ============================================================================

\echo ''
\echo '3. Updating sot.cats with extracted microchips...'

WITH best_microchip AS (
    SELECT DISTINCT ON (cat_id)
        cat_id,
        id_value_norm AS microchip
    FROM sot.cat_identifiers
    WHERE id_type = 'microchip'
      AND id_value_norm IS NOT NULL
      AND id_value_norm != ''
    ORDER BY cat_id, confidence DESC, created_at DESC
)
UPDATE sot.cats c
SET microchip = bm.microchip,
    updated_at = NOW()
FROM best_microchip bm
WHERE c.cat_id = bm.cat_id
  AND (c.microchip IS NULL OR c.microchip = '');

-- ============================================================================
-- 4. CHECK FOR MICROCHIPS IN NOTES FIELD
-- ============================================================================

\echo ''
\echo '4. Checking for microchips hidden in notes fields...'

-- ShelterLuv sometimes has microchips in notes (mentioned by user)
WITH notes_microchips AS (
    SELECT
        c.cat_id,
        c.name,
        -- Extract potential microchips from notes using regex
        (REGEXP_MATCHES(
            COALESCE(s.payload->>'MemoList', '') || ' ' || COALESCE(s.payload->>'Description', ''),
            '([0-9]{9,15})',
            'g'
        ))[1] AS potential_microchip
    FROM sot.cats c
    JOIN trapper.staged_source_records s ON s.payload->>'Internal-ID' = c.shelterluv_animal_id
    WHERE s.source_system = 'shelterluv'
      AND c.microchip IS NULL
      AND (s.payload->>'MemoList' ~* '[0-9]{9,15}'
           OR s.payload->>'Description' ~* '[0-9]{9,15}')
)
SELECT
    COUNT(*) AS cats_with_potential_microchips_in_notes
FROM notes_microchips;

-- Extract valid microchips from notes (with validation)
WITH notes_microchips AS (
    SELECT
        c.cat_id,
        (REGEXP_MATCHES(
            COALESCE(s.payload->>'MemoList', '') || ' ' || COALESCE(s.payload->>'Description', ''),
            '([0-9]{9,15})',
            'g'
        ))[1] AS potential_microchip
    FROM sot.cats c
    JOIN trapper.staged_source_records s ON s.payload->>'Internal-ID' = c.shelterluv_animal_id
    WHERE s.source_system = 'shelterluv'
      AND c.microchip IS NULL
),
validated AS (
    SELECT
        nm.cat_id,
        nm.potential_microchip,
        (sot.validate_microchip(nm.potential_microchip)).is_valid,
        (sot.validate_microchip(nm.potential_microchip)).cleaned
    FROM notes_microchips nm
)
INSERT INTO sot.cat_identifiers (
    cat_id,
    id_type,
    id_value_raw,
    id_value_norm,
    source_system,
    source_table,
    confidence,
    created_at
)
SELECT DISTINCT ON (cat_id)
    cat_id,
    'microchip',
    potential_microchip,
    cleaned,
    'shelterluv',
    'notes_extraction',
    0.8,  -- Lower confidence for notes extraction
    NOW()
FROM validated
WHERE is_valid = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM sot.cat_identifiers ci
    WHERE ci.cat_id = validated.cat_id
      AND ci.id_type = 'microchip'
)
ON CONFLICT (cat_id, id_type, id_value_norm) DO NOTHING;

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Cat identifier counts by type:'
SELECT
    id_type,
    COUNT(*) AS count,
    COUNT(DISTINCT cat_id) AS unique_cats
FROM sot.cat_identifiers
GROUP BY id_type
ORDER BY count DESC;

\echo ''
\echo 'Cats with microchips:'
SELECT
    COUNT(*) FILTER (WHERE microchip IS NOT NULL AND microchip != '') AS with_microchip,
    COUNT(*) FILTER (WHERE microchip IS NULL OR microchip = '') AS without_microchip,
    COUNT(*) AS total
FROM sot.cats
WHERE merged_into_cat_id IS NULL;

\echo ''
\echo 'Microchip sources:'
SELECT
    source_system,
    source_table,
    COUNT(*) AS count
FROM sot.cat_identifiers
WHERE id_type = 'microchip'
GROUP BY source_system, source_table
ORDER BY count DESC;

\echo ''
\echo '=============================================='
\echo '  MIG_1013 Complete'
\echo '=============================================='
\echo 'Created:'
\echo '  - sot.extract_shelterluv_microchip() function'
\echo ''
\echo 'Backfilled:'
\echo '  - Microchips from ShelterLuv Microchips array'
\echo '  - Microchips from notes fields (lower confidence)'
\echo '  - Updated sot.cats with best microchip values'
\echo ''
\echo 'Gap Fixed:'
\echo '  - G-12: ShelterLuv Microchips array now extracted correctly'
\echo '  - G-13: Cats without microchip identifiers now populated'
\echo ''
