\echo '=== MIG_632: Cat Deduplication Race Condition Fix ==='
\echo 'Adds advisory locking to unified_find_or_create_cat to prevent duplicates'
\echo 'when ShelterLuv and ClinicHQ data arrive concurrently'
\echo ''

-- ============================================================================
-- PURPOSE
-- Fix race condition in unified_find_or_create_cat where concurrent calls
-- with the same microchip could both create new cats before either commits.
--
-- PROBLEM:
--   1. ShelterLuv cron runs, calls unified_find_or_create_cat('985...')
--   2. ClinicHQ import runs simultaneously with same microchip
--   3. Both see no existing cat, both insert → DUPLICATE
--
-- SOLUTION:
--   Use pg_advisory_xact_lock to serialize access per-microchip.
--   Only one transaction at a time can process a given microchip.
-- ============================================================================

\echo 'Step 1: Creating updated unified_find_or_create_cat with advisory lock...'

CREATE OR REPLACE FUNCTION trapper.unified_find_or_create_cat(
    p_microchip TEXT,
    p_name TEXT DEFAULT NULL,
    p_sex TEXT DEFAULT NULL,
    p_breed TEXT DEFAULT NULL,
    p_altered_status TEXT DEFAULT NULL,
    p_primary_color TEXT DEFAULT NULL,
    p_secondary_color TEXT DEFAULT NULL,
    p_ownership_type TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'clinichq',
    p_source_id TEXT DEFAULT NULL  -- Source-specific ID (SL animal ID, etc)
)
RETURNS UUID AS $$
DECLARE
    v_cat_id UUID;
    v_existing_cat_id UUID;
    v_microchip_clean TEXT;
    v_lock_key BIGINT;
BEGIN
    -- =========================================================================
    -- VALIDATION: Reject junk data
    -- =========================================================================

    -- Clean microchip
    v_microchip_clean := UPPER(TRIM(REGEXP_REPLACE(p_microchip, '[^A-Za-z0-9]', '', 'g')));

    -- Reject junk microchip
    IF trapper.is_junk_microchip(v_microchip_clean) THEN
        RAISE NOTICE 'Rejecting junk microchip: %', p_microchip;
        RETURN NULL;
    END IF;

    -- Microchip is required for cat creation
    IF v_microchip_clean IS NULL OR LENGTH(v_microchip_clean) < 9 THEN
        RAISE NOTICE 'Invalid microchip (too short or null): %', p_microchip;
        RETURN NULL;
    END IF;

    -- Reject junk names (but don't reject the cat)
    IF trapper.is_junk_cat_name(p_name) THEN
        -- Don't reject the cat, just don't use the name
        -- Cats can exist with just microchip
    END IF;

    -- =========================================================================
    -- ADVISORY LOCK: Serialize access per-microchip
    -- This prevents race conditions when multiple sources ingest the same cat
    -- =========================================================================

    -- Generate a lock key from the microchip (hashtext returns int4, cast to bigint)
    v_lock_key := hashtext('cat_microchip_' || v_microchip_clean)::BIGINT;

    -- Acquire transaction-scoped advisory lock
    -- This will wait if another transaction has the same microchip in flight
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- =========================================================================
    -- DEDUPLICATION: Check for existing cat by microchip
    -- Now safe because we hold the lock
    -- =========================================================================

    SELECT ci.cat_id INTO v_existing_cat_id
    FROM trapper.cat_identifiers ci
    JOIN trapper.sot_cats sc ON sc.cat_id = ci.cat_id
    WHERE ci.id_type = 'microchip'
      AND ci.id_value = v_microchip_clean
      AND sc.merged_into_cat_id IS NULL
    LIMIT 1;

    IF v_existing_cat_id IS NOT NULL THEN
        -- Update existing cat with survivorship rules
        PERFORM trapper.update_cat_with_survivorship(
            v_existing_cat_id,
            CASE WHEN trapper.is_junk_cat_name(p_name) THEN NULL ELSE p_name END,
            p_sex, p_breed, p_altered_status,
            p_primary_color, p_secondary_color,
            p_ownership_type, p_source_system
        );

        -- Add source ID if provided
        IF p_source_id IS NOT NULL THEN
            INSERT INTO trapper.cat_identifiers (
                cat_id, id_type, id_value, source_system
            )
            VALUES (
                v_existing_cat_id,
                p_source_system || '_animal_id',
                p_source_id,
                p_source_system
            )
            ON CONFLICT (id_type, id_value) DO NOTHING;
        END IF;

        RETURN v_existing_cat_id;
    END IF;

    -- =========================================================================
    -- CREATE NEW CAT
    -- =========================================================================

    INSERT INTO trapper.sot_cats (
        display_name, sex, breed, altered_status,
        primary_color, secondary_color, ownership_type,
        source_system
    )
    VALUES (
        CASE WHEN trapper.is_junk_cat_name(p_name) THEN 'Unknown' ELSE COALESCE(p_name, 'Unknown') END,
        LOWER(p_sex),
        p_breed,
        LOWER(p_altered_status),
        p_primary_color,
        p_secondary_color,
        p_ownership_type,
        p_source_system
    )
    RETURNING cat_id INTO v_cat_id;

    -- Add microchip identifier
    INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system)
    VALUES (v_cat_id, 'microchip', v_microchip_clean, p_source_system);

    -- Add source ID if provided
    IF p_source_id IS NOT NULL THEN
        INSERT INTO trapper.cat_identifiers (
            cat_id, id_type, id_value, source_system
        )
        VALUES (
            v_cat_id,
            p_source_system || '_animal_id',
            p_source_id,
            p_source_system
        )
        ON CONFLICT (id_type, id_value) DO NOTHING;
    END IF;

    RETURN v_cat_id;

    -- Advisory lock is automatically released at end of transaction
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.unified_find_or_create_cat IS
'Unified cat find/create with junk detection, survivorship rules, and race condition protection.

IMPORTANT: Uses pg_advisory_xact_lock to serialize access per-microchip.
This prevents duplicates when ShelterLuv (API/cron) and ClinicHQ (manual export)
ingest the same cat concurrently.

Parameters:
- p_microchip: Required microchip number (primary key)
- p_name: Cat name (optional, junk names ignored)
- p_sex, p_breed, p_altered_status: Cat attributes
- p_primary_color, p_secondary_color: Colors
- p_ownership_type: Ownership type
- p_source_system: Source of data
- p_source_id: Source-specific ID

Returns: cat_id UUID or NULL if rejected';

\echo 'Updated unified_find_or_create_cat with advisory lock'

-- ============================================================================
-- Step 2: Enhanced survivorship rules for ClinicHQ vs ShelterLuv
-- ============================================================================

\echo ''
\echo 'Step 2: Creating enhanced cat survivorship with source priority...'

CREATE OR REPLACE FUNCTION trapper.update_cat_with_survivorship(
    p_cat_id UUID,
    p_name TEXT,
    p_sex TEXT,
    p_breed TEXT,
    p_altered_status TEXT,
    p_primary_color TEXT,
    p_secondary_color TEXT,
    p_ownership_type TEXT,
    p_source_system TEXT
)
RETURNS VOID AS $$
DECLARE
    v_current RECORD;
    v_result JSONB;
    v_updates JSONB := '{}'::JSONB;
    v_incoming_priority INT;
    v_current_priority INT;
BEGIN
    SELECT * INTO v_current
    FROM trapper.sot_cats
    WHERE cat_id = p_cat_id;

    IF v_current IS NULL THEN RETURN; END IF;

    -- Source priority: ClinicHQ > ShelterLuv > web_intake > atlas
    -- Higher number = higher priority
    v_incoming_priority := CASE p_source_system
        WHEN 'clinichq' THEN 100
        WHEN 'shelterluv' THEN 80
        WHEN 'web_intake' THEN 60
        WHEN 'atlas' THEN 40
        ELSE 20
    END;

    v_current_priority := CASE v_current.source_system
        WHEN 'clinichq' THEN 100
        WHEN 'shelterluv' THEN 80
        WHEN 'web_intake' THEN 60
        WHEN 'atlas' THEN 40
        ELSE 20
    END;

    -- Apply survivorship for each field
    -- Rule: ClinicHQ always wins for verified fields (name, sex, breed, altered_status)

    -- Name: ClinicHQ wins, or fill empty
    IF p_name IS NOT NULL AND LENGTH(TRIM(p_name)) > 0 THEN
        IF v_current.display_name IS NULL OR v_current.display_name = 'Unknown' OR v_incoming_priority >= v_current_priority THEN
            v_updates := v_updates || jsonb_build_object('display_name', p_name);
        END IF;
    END IF;

    -- Sex: ClinicHQ wins, or fill empty
    IF p_sex IS NOT NULL THEN
        IF v_current.sex IS NULL OR v_incoming_priority >= v_current_priority THEN
            v_updates := v_updates || jsonb_build_object('sex', LOWER(p_sex));
        END IF;
    END IF;

    -- Altered status: Critical for ecology - ClinicHQ is ground truth
    IF p_altered_status IS NOT NULL THEN
        IF v_current.altered_status IS NULL OR v_incoming_priority >= v_current_priority THEN
            v_updates := v_updates || jsonb_build_object('altered_status', LOWER(p_altered_status));
        END IF;
    END IF;

    -- Breed: ClinicHQ wins
    IF p_breed IS NOT NULL AND LENGTH(TRIM(p_breed)) > 0 THEN
        IF v_current.breed IS NULL OR v_incoming_priority >= v_current_priority THEN
            v_updates := v_updates || jsonb_build_object('breed', p_breed);
        END IF;
    END IF;

    -- Colors: Fill if empty
    IF p_primary_color IS NOT NULL AND v_current.primary_color IS NULL THEN
        v_updates := v_updates || jsonb_build_object('primary_color', p_primary_color);
    END IF;

    IF p_secondary_color IS NOT NULL AND v_current.secondary_color IS NULL THEN
        v_updates := v_updates || jsonb_build_object('secondary_color', p_secondary_color);
    END IF;

    -- Apply updates if any
    IF v_updates != '{}'::JSONB THEN
        UPDATE trapper.sot_cats
        SET display_name = COALESCE((v_updates->>'display_name'), display_name),
            sex = COALESCE((v_updates->>'sex'), sex),
            altered_status = COALESCE((v_updates->>'altered_status'), altered_status),
            breed = COALESCE((v_updates->>'breed'), breed),
            primary_color = COALESCE((v_updates->>'primary_color'), primary_color),
            secondary_color = COALESCE((v_updates->>'secondary_color'), secondary_color),
            ownership_type = COALESCE(p_ownership_type, ownership_type),
            -- Update source_system only if incoming has higher priority
            source_system = CASE WHEN v_incoming_priority >= v_current_priority THEN p_source_system ELSE source_system END,
            updated_at = NOW()
        WHERE cat_id = p_cat_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.update_cat_with_survivorship IS
'Update cat record using survivorship rules with source priority.

Source Priority (highest to lowest):
1. clinichq (100) - Verified clinic data
2. shelterluv (80) - Adoption system
3. web_intake (60) - Intake forms
4. atlas (40) - Manual entry
5. other (20) - Unknown sources

Rule: Higher priority source wins for name, sex, breed, altered_status.
Empty fields are always filled by any source.';

\echo 'Updated update_cat_with_survivorship with source priority'

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=== MIG_632 Complete ==='
\echo ''
\echo 'Changes made:'
\echo '  1. unified_find_or_create_cat now uses pg_advisory_xact_lock'
\echo '     - Serializes access per-microchip'
\echo '     - Prevents race conditions between ShelterLuv and ClinicHQ'
\echo ''
\echo '  2. update_cat_with_survivorship now has source priority:'
\echo '     - ClinicHQ > ShelterLuv > web_intake > atlas'
\echo '     - Higher priority source wins for verified fields'
\echo ''
\echo 'Testing:'
\echo '  -- In two terminals, run simultaneously:'
\echo '  BEGIN; SELECT trapper.unified_find_or_create_cat(''985112345678901'', ''Test'');'
\echo '  -- Second transaction will wait until first commits'
\echo ''
