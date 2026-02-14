-- MIG_2054: Fix ownership_type on sot.cats
-- Date: 2026-02-13
--
-- Issue: ownership_type is 0% populated on sot.cats because:
-- 1. sot.find_or_create_cat_by_microchip() doesn't have p_ownership_type parameter
-- 2. TypeScript ingest routes don't extract "Ownership" field from owner_info
--
-- The "Ownership" field in ClinicHQ owner_info contains values like:
-- "Community Cat (Feral)", "Community Cat (Friendly)", "Owned", "Foster"
--
-- Fix:
-- 1. Add p_ownership_type parameter to sot.find_or_create_cat_by_microchip()
-- 2. Backfill existing cats from source.clinichq_raw

\echo ''
\echo '=============================================='
\echo '  MIG_2054: Fix ownership_type on sot.cats'
\echo '=============================================='
\echo ''

-- ============================================================================
-- Check before state
-- ============================================================================

\echo '1. Checking current state of ownership_type...'

SELECT 'BEFORE: sot.cats ownership_type' as context,
  COUNT(*) FILTER (WHERE ownership_type IS NOT NULL AND ownership_type != '') as with_type,
  COUNT(*) FILTER (WHERE ownership_type IS NULL OR ownership_type = '') as without_type,
  COUNT(*) as total
FROM sot.cats WHERE merged_into_cat_id IS NULL;

-- Check what values exist in raw data
\echo ''
\echo '2. Checking ownership values in source.clinichq_raw...'

SELECT 'Ownership values in clinichq_raw' as context,
  payload->>'Ownership' as ownership_value,
  COUNT(*) as count
FROM source.clinichq_raw
WHERE record_type = 'owner'
  AND payload->>'Ownership' IS NOT NULL
  AND TRIM(payload->>'Ownership') != ''
GROUP BY payload->>'Ownership'
ORDER BY count DESC
LIMIT 10;

-- ============================================================================
-- Update sot.find_or_create_cat_by_microchip to accept ownership_type
-- ============================================================================

\echo ''
\echo '3. Updating sot.find_or_create_cat_by_microchip() to accept ownership_type...'

CREATE OR REPLACE FUNCTION sot.find_or_create_cat_by_microchip(
    p_microchip TEXT,
    p_name TEXT DEFAULT NULL,
    p_sex TEXT DEFAULT NULL,
    p_breed TEXT DEFAULT NULL,
    p_altered_status TEXT DEFAULT NULL,
    p_color TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'clinichq',
    p_clinichq_animal_id TEXT DEFAULT NULL,
    p_shelterluv_animal_id TEXT DEFAULT NULL,
    -- MIG_2054: Add ownership_type parameter
    p_ownership_type TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_cat_id UUID;
    v_microchip TEXT;
    v_clean_name TEXT;
    v_validation RECORD;
BEGIN
    v_microchip := TRIM(p_microchip);

    -- Validate microchip using MIG_1011 validator
    SELECT * INTO v_validation FROM sot.validate_microchip(v_microchip);

    IF NOT v_validation.is_valid THEN
        RETURN NULL;
    END IF;

    v_microchip := v_validation.cleaned;

    -- Clean the name to remove microchips and garbage
    v_clean_name := sot.clean_cat_name(p_name);
    IF v_clean_name IS NULL OR v_clean_name = '' THEN
        v_clean_name := 'Unknown';
    END IF;

    -- Find existing cat by microchip
    SELECT c.cat_id INTO v_cat_id
    FROM sot.cat_identifiers ci
    JOIN sot.cats c ON c.cat_id = ci.cat_id
    WHERE ci.id_type = 'microchip'
      AND ci.id_value = v_microchip
      AND c.merged_into_cat_id IS NULL
    LIMIT 1;

    IF v_cat_id IS NOT NULL THEN
        -- Update with new info (MIG_865 fix: NULLIF to treat empty as NULL)
        UPDATE sot.cats SET
            name = CASE
                WHEN name ~ '[0-9]{9,}'
                  OR name ~* '^unknown\s*\('
                  OR name = 'Unknown'
                THEN v_clean_name
                ELSE COALESCE(NULLIF(name, ''), v_clean_name)
            END,
            sex = COALESCE(NULLIF(sex, ''), p_sex),
            breed = COALESCE(NULLIF(breed, ''), p_breed),
            color = COALESCE(NULLIF(color, ''), p_color),
            -- MIG_2051: Populate animal IDs if not already set
            clinichq_animal_id = COALESCE(NULLIF(clinichq_animal_id, ''), p_clinichq_animal_id),
            shelterluv_animal_id = COALESCE(NULLIF(shelterluv_animal_id, ''), p_shelterluv_animal_id),
            -- MIG_2054: Populate ownership_type if not already set
            ownership_type = COALESCE(NULLIF(ownership_type, ''), p_ownership_type),
            source_system = p_source_system,
            updated_at = NOW()
        WHERE cat_id = v_cat_id;

        RETURN v_cat_id;
    END IF;

    -- Create new cat with clean name
    INSERT INTO sot.cats (
        name, microchip, sex, breed, color,
        clinichq_animal_id, shelterluv_animal_id,
        ownership_type,  -- MIG_2054: Include ownership_type
        source_system
    ) VALUES (
        v_clean_name,
        v_microchip,
        p_sex, p_breed, p_color,
        p_clinichq_animal_id, p_shelterluv_animal_id,
        p_ownership_type,  -- MIG_2054: Pass value
        p_source_system
    )
    RETURNING cat_id INTO v_cat_id;

    -- Create microchip identifier
    INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system)
    VALUES (v_cat_id, 'microchip', v_microchip, 1.0, p_source_system)
    ON CONFLICT DO NOTHING;

    -- MIG_2051: Also create clinichq_animal_id identifier if provided
    IF p_clinichq_animal_id IS NOT NULL AND TRIM(p_clinichq_animal_id) != '' THEN
        INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system)
        VALUES (v_cat_id, 'clinichq_animal_id', TRIM(p_clinichq_animal_id), 1.0, 'clinichq')
        ON CONFLICT DO NOTHING;
    END IF;

    -- MIG_2051: Also create shelterluv_animal_id identifier if provided
    IF p_shelterluv_animal_id IS NOT NULL AND TRIM(p_shelterluv_animal_id) != '' THEN
        INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system)
        VALUES (v_cat_id, 'shelterluv_animal_id', TRIM(p_shelterluv_animal_id), 1.0, 'shelterluv')
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_cat_id;
END;
$$ LANGUAGE plpgsql;

\echo '   Updated sot function with ownership_type parameter'

-- ============================================================================
-- Backfill ownership_type from source.clinichq_raw (owner records)
-- Match by microchip
-- ============================================================================

\echo ''
\echo '4. Backfilling ownership_type from source.clinichq_raw (owner records)...'

WITH ownership_data AS (
  SELECT DISTINCT ON (payload->>'Microchip Number')
    payload->>'Microchip Number' as microchip,
    payload->>'Ownership' as ownership_type
  FROM source.clinichq_raw
  WHERE record_type = 'owner'
    AND payload->>'Microchip Number' IS NOT NULL
    AND TRIM(payload->>'Microchip Number') != ''
    AND payload->>'Ownership' IS NOT NULL
    AND TRIM(payload->>'Ownership') != ''
  ORDER BY payload->>'Microchip Number', created_at DESC
)
UPDATE sot.cats c
SET
  ownership_type = o.ownership_type,
  updated_at = NOW()
FROM ownership_data o
WHERE c.microchip = o.microchip
  AND (c.ownership_type IS NULL OR c.ownership_type = '')
  AND c.merged_into_cat_id IS NULL;

\echo '   Updated sot.cats from source.clinichq_raw owner records'

-- ============================================================================
-- Also backfill from ops.staged_records (legacy staging)
-- ============================================================================

\echo ''
\echo '5. Backfilling from ops.staged_records (owner_info records)...'

WITH ownership_data AS (
  SELECT DISTINCT ON (payload->>'Microchip Number')
    payload->>'Microchip Number' as microchip,
    payload->>'Ownership' as ownership_type
  FROM ops.staged_records
  WHERE source_system = 'clinichq'
    AND source_table = 'owner_info'
    AND payload->>'Microchip Number' IS NOT NULL
    AND TRIM(payload->>'Microchip Number') != ''
    AND payload->>'Ownership' IS NOT NULL
    AND TRIM(payload->>'Ownership') != ''
  ORDER BY payload->>'Microchip Number', created_at DESC
)
UPDATE sot.cats c
SET
  ownership_type = o.ownership_type,
  updated_at = NOW()
FROM ownership_data o
WHERE c.microchip = o.microchip
  AND (c.ownership_type IS NULL OR c.ownership_type = '')
  AND c.merged_into_cat_id IS NULL;

\echo '   Updated sot.cats from ops.staged_records'

-- ============================================================================
-- Also backfill from trapper.staged_records (V1 staging)
-- ============================================================================

\echo ''
\echo '6. Backfilling from trapper.staged_records (owner_info records)...'

WITH ownership_data AS (
  SELECT DISTINCT ON (payload->>'Microchip Number')
    payload->>'Microchip Number' as microchip,
    payload->>'Ownership' as ownership_type
  FROM trapper.staged_records
  WHERE source_system = 'clinichq'
    AND source_table = 'owner_info'
    AND payload->>'Microchip Number' IS NOT NULL
    AND TRIM(payload->>'Microchip Number') != ''
    AND payload->>'Ownership' IS NOT NULL
    AND TRIM(payload->>'Ownership') != ''
  ORDER BY payload->>'Microchip Number', created_at DESC
)
UPDATE sot.cats c
SET
  ownership_type = o.ownership_type,
  updated_at = NOW()
FROM ownership_data o
WHERE c.microchip = o.microchip
  AND (c.ownership_type IS NULL OR c.ownership_type = '')
  AND c.merged_into_cat_id IS NULL;

\echo '   Updated sot.cats from trapper.staged_records'

-- ============================================================================
-- Check after state
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

SELECT 'AFTER: sot.cats ownership_type' as context,
  COUNT(*) FILTER (WHERE ownership_type IS NOT NULL AND ownership_type != '') as with_type,
  COUNT(*) FILTER (WHERE ownership_type IS NULL OR ownership_type = '') as without_type,
  COUNT(*) as total
FROM sot.cats WHERE merged_into_cat_id IS NULL;

-- Show distribution
\echo ''
\echo 'Ownership type distribution:'

SELECT ownership_type, COUNT(*) as count
FROM sot.cats
WHERE merged_into_cat_id IS NULL
  AND ownership_type IS NOT NULL
  AND ownership_type != ''
GROUP BY ownership_type
ORDER BY count DESC;

\echo ''
\echo '=============================================='
\echo '  MIG_2054 Complete'
\echo '=============================================='
\echo ''
\echo 'Updated sot.find_or_create_cat_by_microchip() with p_ownership_type parameter.'
\echo ''
\echo 'Backfilled ownership_type from:'
\echo '  - source.clinichq_raw (V2 raw storage)'
\echo '  - ops.staged_records (V2 staging)'
\echo '  - trapper.staged_records (V1 staging)'
\echo ''
\echo 'NEXT STEP: Update TypeScript ingest routes to extract Ownership field'
\echo '  - /api/v2/ingest/clinichq/route.ts'
\echo '  - /api/ingest/process/[id]/route.ts'
\echo ''
