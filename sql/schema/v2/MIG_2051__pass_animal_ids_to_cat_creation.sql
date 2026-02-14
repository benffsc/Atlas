-- MIG_2051: Pass clinichq_animal_id and shelterluv_animal_id to Cat Creation
-- Date: 2026-02-13
--
-- Issue: sot.cats has clinichq_animal_id and shelterluv_animal_id columns but
-- they are never populated because:
-- 1. find_or_create_cat_by_microchip() doesn't accept these parameters
-- 2. Ingest pipelines don't pass the ClinicHQ "Number" field
--
-- Fix: Update function signature to accept and populate these fields
--
-- Affected pipelines (will need TypeScript updates):
-- - /api/v2/ingest/clinichq/route.ts
-- - /api/ingest/process/[id]/route.ts

\echo ''
\echo '=============================================='
\echo '  MIG_2051: Pass Animal IDs to Cat Creation'
\echo '=============================================='
\echo ''

-- ============================================================================
-- Check before state
-- ============================================================================

\echo '1. Checking current state of animal IDs on cats...'

SELECT 'BEFORE: Cats with clinichq_animal_id' as context, COUNT(*) as count
FROM sot.cats WHERE clinichq_animal_id IS NOT NULL AND merged_into_cat_id IS NULL;

SELECT 'BEFORE: Cats with shelterluv_animal_id' as context, COUNT(*) as count
FROM sot.cats WHERE shelterluv_animal_id IS NOT NULL AND merged_into_cat_id IS NULL;

-- ============================================================================
-- Update find_or_create_cat_by_microchip to accept animal IDs
-- ============================================================================

\echo ''
\echo '2. Updating sot.find_or_create_cat_by_microchip() to accept animal IDs...'

CREATE OR REPLACE FUNCTION sot.find_or_create_cat_by_microchip(
    p_microchip TEXT,
    p_name TEXT DEFAULT NULL,
    p_sex TEXT DEFAULT NULL,
    p_breed TEXT DEFAULT NULL,
    p_altered_status TEXT DEFAULT NULL,
    p_color TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'clinichq',
    -- NEW PARAMETERS (INV-36)
    p_clinichq_animal_id TEXT DEFAULT NULL,
    p_shelterluv_animal_id TEXT DEFAULT NULL
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
            source_system = p_source_system,
            updated_at = NOW()
        WHERE cat_id = v_cat_id;

        RETURN v_cat_id;
    END IF;

    -- Create new cat with clean name
    INSERT INTO sot.cats (
        name, microchip, sex, breed, color,
        clinichq_animal_id, shelterluv_animal_id,  -- MIG_2051: Include animal IDs
        source_system
    ) VALUES (
        v_clean_name,
        v_microchip,
        p_sex, p_breed, p_color,
        p_clinichq_animal_id, p_shelterluv_animal_id,  -- MIG_2051: Pass values
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

COMMENT ON FUNCTION sot.find_or_create_cat_by_microchip IS
'V2: Find or create a cat by microchip number.

MIG_2051 Update: Now accepts p_clinichq_animal_id and p_shelterluv_animal_id parameters.
These are stored both:
1. Denormalized on sot.cats for quick lookup
2. In sot.cat_identifiers for identity matching

Ingest pipelines MUST pass the ClinicHQ "Number" field as p_clinichq_animal_id
per CLAUDE.md INV-36.';

\echo '   Updated function with clinichq_animal_id and shelterluv_animal_id parameters'

-- ============================================================================
-- Also update trapper schema version for compatibility
-- ============================================================================

\echo ''
\echo '3. Updating trapper.find_or_create_cat_by_microchip() for compatibility...'

CREATE OR REPLACE FUNCTION trapper.find_or_create_cat_by_microchip(
    p_microchip TEXT,
    p_name TEXT DEFAULT NULL,
    p_sex TEXT DEFAULT NULL,
    p_breed TEXT DEFAULT NULL,
    p_altered_status TEXT DEFAULT NULL,
    p_primary_color TEXT DEFAULT NULL,
    p_secondary_color TEXT DEFAULT NULL,
    p_ownership_type TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'clinichq',
    -- NEW PARAMETERS (INV-36)
    p_clinichq_animal_id TEXT DEFAULT NULL,
    p_shelterluv_animal_id TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_cat_id UUID;
    v_microchip TEXT;
    v_clean_name TEXT;
BEGIN
    v_microchip := TRIM(p_microchip);

    IF v_microchip IS NULL OR LENGTH(v_microchip) < 9 THEN
        RETURN NULL;
    END IF;

    -- Clean the name to remove microchips and garbage
    v_clean_name := trapper.clean_cat_name(p_name);
    IF v_clean_name IS NULL OR v_clean_name = '' THEN
        v_clean_name := 'Unknown';
    END IF;

    -- Find existing cat by microchip
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    WHERE ci.id_type = 'microchip' AND ci.id_value = v_microchip;

    IF v_cat_id IS NOT NULL THEN
        -- Update with new info
        UPDATE trapper.sot_cats SET
            display_name = CASE
                WHEN display_name ~ '[0-9]{9,}'
                  OR display_name ~* '^unknown\s*\('
                  OR display_name = 'Unknown'
                THEN v_clean_name
                ELSE COALESCE(NULLIF(display_name, ''), v_clean_name)
            END,
            sex = COALESCE(NULLIF(sex, ''), p_sex),
            breed = COALESCE(NULLIF(breed, ''), p_breed),
            altered_status = COALESCE(NULLIF(altered_status, ''), p_altered_status),
            primary_color = COALESCE(NULLIF(primary_color, ''), p_primary_color),
            secondary_color = COALESCE(NULLIF(secondary_color, ''), p_secondary_color),
            ownership_type = COALESCE(NULLIF(ownership_type, ''), p_ownership_type),
            -- MIG_2051: Populate animal IDs if columns exist
            clinichq_animal_id = COALESCE(NULLIF(clinichq_animal_id, ''), p_clinichq_animal_id),
            shelterluv_animal_id = COALESCE(NULLIF(shelterluv_animal_id, ''), p_shelterluv_animal_id),
            data_source = 'clinichq',
            updated_at = NOW()
        WHERE cat_id = v_cat_id;

        RETURN v_cat_id;
    END IF;

    -- Create new cat with clean name
    INSERT INTO trapper.sot_cats (
        display_name, sex, breed, altered_status,
        primary_color, secondary_color, ownership_type,
        clinichq_animal_id, shelterluv_animal_id,
        data_source, needs_microchip
    ) VALUES (
        v_clean_name,
        p_sex, p_breed, p_altered_status,
        p_primary_color, p_secondary_color, p_ownership_type,
        p_clinichq_animal_id, p_shelterluv_animal_id,
        'clinichq', FALSE
    )
    RETURNING cat_id INTO v_cat_id;

    -- Create microchip identifier
    INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
    VALUES (v_cat_id, 'microchip', v_microchip, p_source_system, 'unified_rebuild');

    -- MIG_2051: Also create clinichq_animal_id identifier if provided
    IF p_clinichq_animal_id IS NOT NULL AND TRIM(p_clinichq_animal_id) != '' THEN
        INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
        VALUES (v_cat_id, 'clinichq_animal_id', TRIM(p_clinichq_animal_id), 'clinichq', 'unified_rebuild')
        ON CONFLICT DO NOTHING;
    END IF;

    -- MIG_2051: Also create shelterluv_animal_id identifier if provided
    IF p_shelterluv_animal_id IS NOT NULL AND TRIM(p_shelterluv_animal_id) != '' THEN
        INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
        VALUES (v_cat_id, 'shelterluv_animal_id', TRIM(p_shelterluv_animal_id), 'shelterluv', 'unified_rebuild')
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_cat_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_cat_by_microchip IS
'MIG_2051: Find or create a cat by microchip number.
Now accepts p_clinichq_animal_id and p_shelterluv_animal_id parameters.
Ingest pipelines MUST pass the ClinicHQ "Number" field per CLAUDE.md INV-36.';

\echo '   Updated trapper function for compatibility'

-- ============================================================================
-- Ensure columns exist on trapper.sot_cats
-- ============================================================================

\echo ''
\echo '4. Ensuring clinichq_animal_id and shelterluv_animal_id columns exist on trapper.sot_cats...'

ALTER TABLE trapper.sot_cats ADD COLUMN IF NOT EXISTS clinichq_animal_id TEXT;
ALTER TABLE trapper.sot_cats ADD COLUMN IF NOT EXISTS shelterluv_animal_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sot_cats_clinichq_animal_id ON trapper.sot_cats(clinichq_animal_id) WHERE clinichq_animal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sot_cats_shelterluv_animal_id ON trapper.sot_cats(shelterluv_animal_id) WHERE shelterluv_animal_id IS NOT NULL;

\echo '   Columns and indexes created'

-- ============================================================================
-- Also add indexes to sot.cats
-- ============================================================================

\echo ''
\echo '5. Adding indexes to sot.cats...'

CREATE INDEX IF NOT EXISTS idx_sot_cats_clinichq_animal_id ON sot.cats(clinichq_animal_id) WHERE clinichq_animal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sot_cats_shelterluv_animal_id ON sot.cats(shelterluv_animal_id) WHERE shelterluv_animal_id IS NOT NULL;

\echo '   Indexes created'

-- ============================================================================
-- Verification
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Checking sot.find_or_create_cat_by_microchip parameters:'
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'find_or_create_cat_by_microchip'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'sot')
LIMIT 1;

\echo ''
\echo '=============================================='
\echo '  MIG_2051 Complete'
\echo '=============================================='
\echo ''
\echo 'Function updated to accept:'
\echo '  - p_clinichq_animal_id TEXT'
\echo '  - p_shelterluv_animal_id TEXT'
\echo ''
\echo 'NEXT STEPS (TypeScript updates required):'
\echo '  1. /api/v2/ingest/clinichq/route.ts - Pass Number field as clinichq_animal_id'
\echo '  2. /api/ingest/process/[id]/route.ts - Same'
\echo '  3. Run MIG_2053 to backfill existing cats from source.clinichq_raw'
\echo ''
