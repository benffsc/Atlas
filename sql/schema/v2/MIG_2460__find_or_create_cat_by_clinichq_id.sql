-- MIG_2460: Find or Create Cat by ClinicHQ Animal ID
--
-- DATA_GAP_051: Creates cats without microchips using clinichq_animal_id as identifier.
-- This function parallels the TypeScript logic in the ingest route for consistency.
--
-- Use case: ClinicHQ cats that never get microchipped (euthanasia, kittens died, etc.)
-- still need cat records for proper appointment linking and reporting.
--
-- Created: 2026-02-22

\echo ''
\echo '=============================================='
\echo '  MIG_2460: Find or Create Cat by ClinicHQ ID'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE sot.find_or_create_cat_by_clinichq_id()
-- ============================================================================

\echo '1. Creating sot.find_or_create_cat_by_clinichq_id()...'

CREATE OR REPLACE FUNCTION sot.find_or_create_cat_by_clinichq_id(
    p_clinichq_animal_id TEXT,
    p_name TEXT DEFAULT NULL,
    p_sex TEXT DEFAULT NULL,
    p_breed TEXT DEFAULT NULL,
    p_color TEXT DEFAULT NULL,
    p_secondary_color TEXT DEFAULT NULL,
    p_ownership_type TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'clinichq'
)
RETURNS UUID AS $$
DECLARE
    v_cat_id UUID;
    v_clean_animal_id TEXT;
    v_clean_name TEXT;
BEGIN
    -- Clean input
    v_clean_animal_id := NULLIF(TRIM(p_clinichq_animal_id), '');

    -- Must have clinichq_animal_id
    IF v_clean_animal_id IS NULL THEN
        RAISE DEBUG 'find_or_create_cat_by_clinichq_id: No animal_id provided';
        RETURN NULL;
    END IF;

    -- Clean name - if name looks like a microchip, set to 'Unknown'
    v_clean_name := NULLIF(TRIM(p_name), '');
    IF v_clean_name ~ '^[0-9]{15}$' THEN
        v_clean_name := 'Unknown';
    END IF;

    -- Step 1: Check cat_identifiers for existing cat
    SELECT ci.cat_id INTO v_cat_id
    FROM sot.cat_identifiers ci
    JOIN sot.cats c ON c.cat_id = ci.cat_id
    WHERE ci.id_type = 'clinichq_animal_id'
      AND ci.id_value = v_clean_animal_id
      AND c.merged_into_cat_id IS NULL
    LIMIT 1;

    IF v_cat_id IS NOT NULL THEN
        RAISE DEBUG 'find_or_create_cat_by_clinichq_id: Found by cat_identifiers: %', v_cat_id;
        RETURN v_cat_id;
    END IF;

    -- Step 2: Check sot.cats.clinichq_animal_id directly (denormalized column)
    SELECT c.cat_id INTO v_cat_id
    FROM sot.cats c
    WHERE c.clinichq_animal_id = v_clean_animal_id
      AND c.merged_into_cat_id IS NULL
    LIMIT 1;

    IF v_cat_id IS NOT NULL THEN
        RAISE DEBUG 'find_or_create_cat_by_clinichq_id: Found by denormalized column: %', v_cat_id;

        -- Ensure identifier exists (backfill if missing)
        INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at, confidence)
        VALUES (v_cat_id, 'clinichq_animal_id', v_clean_animal_id, p_source_system, NOW(), 1.0)
        ON CONFLICT (id_type, id_value) DO NOTHING;

        RETURN v_cat_id;
    END IF;

    -- Step 3: Create new cat
    v_cat_id := gen_random_uuid();

    INSERT INTO sot.cats (
        cat_id,
        name,
        sex,
        breed,
        primary_color,
        secondary_color,
        clinichq_animal_id,
        ownership_type,
        source_system,
        source_record_id,
        created_at,
        updated_at
    ) VALUES (
        v_cat_id,
        COALESCE(v_clean_name, 'Unknown'),
        LOWER(NULLIF(TRIM(p_sex), '')),
        NULLIF(TRIM(p_breed), ''),
        NULLIF(TRIM(p_color), ''),
        NULLIF(TRIM(p_secondary_color), ''),
        v_clean_animal_id,
        CASE NULLIF(TRIM(p_ownership_type), '')
            WHEN 'Community Cat (Feral)' THEN 'feral'
            WHEN 'Community Cat (Friendly)' THEN 'community'
            WHEN 'Owned' THEN 'owned'
            WHEN 'Foster' THEN 'foster'
            ELSE NULL
        END,
        p_source_system,
        v_clean_animal_id,
        NOW(),
        NOW()
    );

    -- Create identifier
    INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at, confidence)
    VALUES (v_cat_id, 'clinichq_animal_id', v_clean_animal_id, p_source_system, NOW(), 1.0);

    RAISE DEBUG 'find_or_create_cat_by_clinichq_id: Created new cat: %', v_cat_id;

    RETURN v_cat_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.find_or_create_cat_by_clinichq_id IS
'Creates or finds a cat using clinichq_animal_id as the primary identifier.
DATA_GAP_051: For cats without microchips (euthanasia, kittens, etc.).
Returns cat_id or NULL if no animal_id provided.';

-- ============================================================================
-- 2. GRANT PERMISSIONS
-- ============================================================================

\echo '2. Granting permissions...'

-- Grant to service role for API access
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT EXECUTE ON FUNCTION sot.find_or_create_cat_by_clinichq_id TO service_role;
    END IF;
END $$;

-- ============================================================================
-- 3. VERIFICATION
-- ============================================================================

\echo ''
\echo '3. Verification...'

-- Test the function exists
DO $$
BEGIN
    ASSERT (SELECT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'sot' AND p.proname = 'find_or_create_cat_by_clinichq_id'
    )), 'Function sot.find_or_create_cat_by_clinichq_id() not found';

    RAISE NOTICE 'Function created successfully';
END $$;

\echo ''
\echo '=============================================='
\echo '  MIG_2460 COMPLETE'
\echo '=============================================='
\echo ''
