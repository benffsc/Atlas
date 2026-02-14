\echo '=== MIG_483: Unified Entity Creation Functions ==='
\echo 'Creating unified functions that replace old find_or_create_* functions'
\echo 'with enhanced validation, junk detection, and survivorship rules'
\echo ''

-- ============================================================================
-- PURPOSE
-- Create unified entity creation functions that:
-- 1. Validate inputs (reject junk data)
-- 2. Support source-specific IDs
-- 3. Apply survivorship rules
-- 4. Use source confidence scoring
-- ============================================================================

-- ============================================================================
-- JUNK DETECTION FUNCTIONS
-- ============================================================================

\echo 'Step 1: Creating junk detection functions...'

-- Detect junk person names
CREATE OR REPLACE FUNCTION trapper.is_junk_person_name(p_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF p_name IS NULL THEN RETURN FALSE; END IF;

    -- Test/dummy names
    IF p_name ~* '^(test|dummy|sample|xxx|zzz|asdf|qwerty|fake|none|n/?a|unknown|na)\s*\d*$' THEN
        RETURN TRUE;
    END IF;

    -- Just numbers
    IF p_name ~ '^\s*\d+\s*$' THEN
        RETURN TRUE;
    END IF;

    -- Single character
    IF LENGTH(TRIM(p_name)) < 2 THEN
        RETURN TRUE;
    END IF;

    -- Repeated characters
    IF p_name ~* '^(.)\1{3,}$' THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.is_junk_person_name IS
'Returns TRUE if name appears to be junk/test data that should not be inserted.';

-- Detect junk cat names
CREATE OR REPLACE FUNCTION trapper.is_junk_cat_name(p_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF p_name IS NULL THEN RETURN FALSE; END IF;

    -- Test/dummy names
    IF p_name ~* '^(test|dummy|sample|xxx|zzz|asdf|tbd|unknown|none|n/?a)\s*\d*$' THEN
        RETURN TRUE;
    END IF;

    -- Just numbers
    IF p_name ~ '^\s*\d+\s*$' THEN
        RETURN TRUE;
    END IF;

    -- Repeated characters (but allow "Mimi" etc)
    IF p_name ~* '^(.)\1{4,}$' THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.is_junk_cat_name IS
'Returns TRUE if cat name appears to be junk/test data.';

-- Detect junk microchip
CREATE OR REPLACE FUNCTION trapper.is_junk_microchip(p_microchip TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF p_microchip IS NULL THEN RETURN FALSE; END IF;

    -- Too short
    IF LENGTH(p_microchip) < 9 THEN
        RETURN TRUE;
    END IF;

    -- All zeros or nines
    IF p_microchip ~ '^0+$' OR p_microchip ~ '^9+$' THEN
        RETURN TRUE;
    END IF;

    -- Test patterns
    IF p_microchip ~* '^(test|fake|sample|xxx|123456789)' THEN
        RETURN TRUE;
    END IF;

    -- Sequential numbers like 123456789012345
    IF p_microchip ~ '^12345' THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.is_junk_microchip IS
'Returns TRUE if microchip appears to be fake/test data.';

-- Detect junk address (enhanced version)
CREATE OR REPLACE FUNCTION trapper.is_junk_address(p_address TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF p_address IS NULL THEN RETURN FALSE; END IF;

    -- Too short
    IF LENGTH(TRIM(p_address)) < 10 THEN
        RETURN TRUE;
    END IF;

    -- Test/dummy addresses
    IF p_address ~* '(123\s*main|test|sample|xxx|null|n/?a|unknown|^tbd$)' THEN
        RETURN TRUE;
    END IF;

    -- PO Box (not a physical location for colony work)
    IF p_address ~* '(p\.?o\.?\s*box|post\s*office\s*box)' THEN
        RETURN TRUE;
    END IF;

    -- Just a city/state/zip
    IF p_address ~* '^[a-z\s]+,?\s*(ca|california)?\s*\d{5}?$' THEN
        RETURN TRUE;
    END IF;

    -- No house number (unless it's a named place)
    IF p_address !~ '\d' AND p_address !~* '(shelter|clinic|hospital|park|center|plaza|ranch|farm)' THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.is_junk_address IS
'Returns TRUE if address appears to be junk/unusable.';

\echo 'Created junk detection functions'

-- ============================================================================
-- UNIFIED PERSON CREATION
-- ============================================================================

\echo ''
\echo 'Step 2: Creating unified_find_or_create_person...'

CREATE OR REPLACE FUNCTION trapper.unified_find_or_create_person(
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'web_intake',
    p_source_id TEXT DEFAULT NULL  -- Source-specific ID (VH ID, SL ID, etc)
)
RETURNS UUID AS $$
DECLARE
    v_result RECORD;
    v_person_id UUID;
    v_display_name TEXT;
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_confidence NUMERIC;
BEGIN
    -- Normalize inputs
    v_email_norm := trapper.norm_email(p_email);
    v_phone_norm := trapper.norm_phone_us(p_phone);
    v_display_name := TRIM(CONCAT_WS(' ',
        NULLIF(TRIM(INITCAP(p_first_name)), ''),
        NULLIF(TRIM(INITCAP(p_last_name)), '')
    ));

    -- =========================================================================
    -- VALIDATION: Reject junk data
    -- =========================================================================

    -- Reject junk names
    IF trapper.is_junk_person_name(v_display_name) THEN
        RAISE NOTICE 'Rejecting junk person name: %', v_display_name;
        RETURN NULL;
    END IF;

    -- Reject internal/org accounts
    IF trapper.is_internal_account(v_display_name) THEN
        RETURN NULL;
    END IF;
    IF v_email_norm IS NOT NULL AND v_email_norm LIKE '%@forgottenfelines.org' THEN
        RETURN NULL;
    END IF;

    -- =========================================================================
    -- IDENTITY RESOLUTION
    -- =========================================================================

    -- Try source ID first if provided (fastest match)
    IF p_source_id IS NOT NULL THEN
        SELECT pi.person_id INTO v_person_id
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
        WHERE pi.id_type = 'external_id'
          AND pi.id_value_norm = p_source_id
          AND pi.source_system = p_source_system
          AND sp.merged_into_person_id IS NULL
        LIMIT 1;

        IF v_person_id IS NOT NULL THEN
            -- Found by source ID - update with any new info using survivorship
            PERFORM trapper.update_person_with_survivorship(
                v_person_id, v_display_name, v_email_norm, v_phone_norm,
                p_address, p_source_system
            );
            RETURN v_person_id;
        END IF;
    END IF;

    -- Use Data Engine for identity resolution (handles email/phone/name matching)
    SELECT * INTO v_result
    FROM trapper.data_engine_resolve_identity(
        p_email, p_phone, p_first_name, p_last_name, p_address, p_source_system
    );

    v_person_id := v_result.person_id;

    -- Store source ID if provided and person was found/created
    IF v_person_id IS NOT NULL AND p_source_id IS NOT NULL THEN
        INSERT INTO trapper.person_identifiers (
            person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
        )
        VALUES (
            v_person_id, 'external_id', p_source_id, p_source_id, p_source_system,
            trapper.get_source_confidence(p_source_system, 'source_id')
        )
        ON CONFLICT (id_type, id_value_norm) DO NOTHING;
    END IF;

    RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.unified_find_or_create_person IS
'Unified person find/create with junk detection, source ID support, and survivorship rules.
Replaces find_or_create_person with enhanced validation.

Parameters:
- p_email, p_phone: Contact info for identity matching
- p_first_name, p_last_name: Name parts
- p_address: Address for matching
- p_source_system: Source of data (clinichq, volunteerhub, etc)
- p_source_id: Source-specific ID for faster matching

Returns: person_id UUID or NULL if rejected as junk/internal';

\echo 'Created unified_find_or_create_person'

-- ============================================================================
-- HELPER: Update person with survivorship rules
-- ============================================================================

\echo ''
\echo 'Step 3: Creating survivorship update helper...'

CREATE OR REPLACE FUNCTION trapper.update_person_with_survivorship(
    p_person_id UUID,
    p_display_name TEXT,
    p_email_norm TEXT,
    p_phone_norm TEXT,
    p_address TEXT,
    p_source_system TEXT
)
RETURNS VOID AS $$
DECLARE
    v_current RECORD;
    v_result JSONB;
BEGIN
    -- Get current values
    SELECT display_name, primary_email, primary_phone, source_system
    INTO v_current
    FROM trapper.sot_people
    WHERE person_id = p_person_id;

    IF v_current IS NULL THEN RETURN; END IF;

    -- Apply survivorship for display_name
    IF p_display_name IS NOT NULL AND LENGTH(TRIM(p_display_name)) > 0 THEN
        v_result := trapper.apply_survivorship(
            'person', 'display_name',
            v_current.display_name, v_current.source_system,
            p_display_name, p_source_system
        );

        IF (v_result->>'winner') = p_source_system THEN
            UPDATE trapper.sot_people
            SET display_name = p_display_name,
                source_system = p_source_system,
                updated_at = NOW()
            WHERE person_id = p_person_id;
        END IF;
    END IF;

    -- Add new email identifier if provided and not exists
    IF p_email_norm IS NOT NULL THEN
        INSERT INTO trapper.person_identifiers (
            person_id, id_type, id_value_norm, id_value_raw, source_system,
            confidence
        )
        VALUES (
            p_person_id, 'email', p_email_norm, p_email_norm, p_source_system,
            trapper.get_source_confidence(p_source_system, 'email')
        )
        ON CONFLICT (id_type, id_value_norm) DO NOTHING;
    END IF;

    -- Add new phone identifier if provided and not exists
    IF p_phone_norm IS NOT NULL AND LENGTH(p_phone_norm) = 10 THEN
        INSERT INTO trapper.person_identifiers (
            person_id, id_type, id_value_norm, id_value_raw, source_system,
            confidence
        )
        VALUES (
            p_person_id, 'phone', p_phone_norm, p_phone_norm, p_source_system,
            trapper.get_source_confidence(p_source_system, 'phone')
        )
        ON CONFLICT (id_type, id_value_norm) DO NOTHING;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.update_person_with_survivorship IS
'Update person record using survivorship rules to determine which source wins.';

\echo 'Created update_person_with_survivorship'

-- ============================================================================
-- UNIFIED PLACE CREATION
-- ============================================================================

\echo ''
\echo 'Step 4: Creating unified_find_or_create_place...'

CREATE OR REPLACE FUNCTION trapper.unified_find_or_create_place(
    p_formatted_address TEXT,
    p_display_name TEXT DEFAULT NULL,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL,
    p_source_system TEXT DEFAULT 'atlas',
    p_google_place_id TEXT DEFAULT NULL  -- For Google deduplication
)
RETURNS UUID AS $$
DECLARE
    v_place_id UUID;
    v_normalized_address TEXT;
    v_existing_place_id UUID;
BEGIN
    -- =========================================================================
    -- VALIDATION: Reject junk addresses
    -- =========================================================================

    IF p_formatted_address IS NULL OR LENGTH(TRIM(p_formatted_address)) = 0 THEN
        RETURN NULL;
    END IF;

    IF trapper.is_junk_address(p_formatted_address) THEN
        RAISE NOTICE 'Rejecting junk address: %', p_formatted_address;
        RETURN NULL;
    END IF;

    -- Normalize address
    v_normalized_address := trapper.normalize_address(p_formatted_address);

    -- =========================================================================
    -- DEDUPLICATION: Check for existing place
    -- =========================================================================

    -- First check by Google Place ID (if provided) - most reliable
    IF p_google_place_id IS NOT NULL THEN
        SELECT place_id INTO v_existing_place_id
        FROM trapper.places
        WHERE google_place_id = p_google_place_id
          AND merged_into_place_id IS NULL
        LIMIT 1;

        IF v_existing_place_id IS NOT NULL THEN
            RETURN v_existing_place_id;
        END IF;
    END IF;

    -- Then check by normalized address
    IF v_normalized_address IS NOT NULL THEN
        SELECT place_id INTO v_existing_place_id
        FROM trapper.places
        WHERE normalized_address = v_normalized_address
          AND merged_into_place_id IS NULL
        LIMIT 1;

        IF v_existing_place_id IS NOT NULL THEN
            -- Update google_place_id if we have it and existing doesn't
            IF p_google_place_id IS NOT NULL THEN
                UPDATE trapper.places
                SET google_place_id = p_google_place_id,
                    is_google_verified = TRUE,
                    updated_at = NOW()
                WHERE place_id = v_existing_place_id
                  AND google_place_id IS NULL;
            END IF;
            RETURN v_existing_place_id;
        END IF;
    END IF;

    -- =========================================================================
    -- CREATE NEW PLACE
    -- =========================================================================

    -- Use existing find_or_create_place_deduped for the heavy lifting
    -- (handles sot_addresses, geocoding queue, etc)
    v_place_id := trapper.find_or_create_place_deduped(
        p_formatted_address,
        p_display_name,
        p_lat,
        p_lng,
        p_source_system
    );

    -- Update with google_place_id if provided
    IF v_place_id IS NOT NULL AND p_google_place_id IS NOT NULL THEN
        UPDATE trapper.places
        SET google_place_id = p_google_place_id,
            is_google_verified = TRUE,
            updated_at = NOW()
        WHERE place_id = v_place_id
          AND google_place_id IS NULL;
    END IF;

    RETURN v_place_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.unified_find_or_create_place IS
'Unified place find/create with junk detection and Google deduplication.

Parameters:
- p_formatted_address: The address string
- p_display_name: Optional friendly name
- p_lat, p_lng: Optional coordinates
- p_source_system: Source of data
- p_google_place_id: Google Place ID for deduplication

Returns: place_id UUID or NULL if rejected as junk';

\echo 'Created unified_find_or_create_place'

-- ============================================================================
-- UNIFIED CAT CREATION
-- ============================================================================

\echo ''
\echo 'Step 5: Creating unified_find_or_create_cat...'

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

    -- Reject junk names
    IF trapper.is_junk_cat_name(p_name) THEN
        -- Don't reject the cat, just don't use the name
        -- Cats can exist with just microchip
    END IF;

    -- =========================================================================
    -- DEDUPLICATION: Check for existing cat by microchip
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
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.unified_find_or_create_cat IS
'Unified cat find/create with junk detection and survivorship rules.

Parameters:
- p_microchip: Required microchip number (primary key)
- p_name: Cat name (optional, junk names ignored)
- p_sex, p_breed, p_altered_status: Cat attributes
- p_primary_color, p_secondary_color: Colors
- p_ownership_type: Ownership type
- p_source_system: Source of data
- p_source_id: Source-specific ID

Returns: cat_id UUID or NULL if rejected';

\echo 'Created unified_find_or_create_cat'

-- ============================================================================
-- HELPER: Update cat with survivorship rules
-- ============================================================================

\echo ''
\echo 'Step 6: Creating cat survivorship update helper...'

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
BEGIN
    SELECT * INTO v_current
    FROM trapper.sot_cats
    WHERE cat_id = p_cat_id;

    IF v_current IS NULL THEN RETURN; END IF;

    -- Apply survivorship for each field
    -- Name
    IF p_name IS NOT NULL THEN
        v_result := trapper.apply_survivorship(
            'cat', 'name',
            v_current.display_name, v_current.source_system,
            p_name, p_source_system
        );
        IF (v_result->>'winner') = p_source_system THEN
            v_updates := v_updates || jsonb_build_object('display_name', p_name);
        END IF;
    END IF;

    -- Sex
    IF p_sex IS NOT NULL THEN
        v_result := trapper.apply_survivorship(
            'cat', 'sex',
            v_current.sex, v_current.source_system,
            LOWER(p_sex), p_source_system
        );
        IF (v_result->>'winner') = p_source_system THEN
            v_updates := v_updates || jsonb_build_object('sex', LOWER(p_sex));
        END IF;
    END IF;

    -- Altered status (critical for Beacon)
    IF p_altered_status IS NOT NULL THEN
        v_result := trapper.apply_survivorship(
            'cat', 'altered_status',
            v_current.altered_status, v_current.source_system,
            LOWER(p_altered_status), p_source_system
        );
        IF (v_result->>'winner') = p_source_system THEN
            v_updates := v_updates || jsonb_build_object('altered_status', LOWER(p_altered_status));
        END IF;
    END IF;

    -- Breed
    IF p_breed IS NOT NULL THEN
        v_result := trapper.apply_survivorship(
            'cat', 'breed',
            v_current.breed, v_current.source_system,
            p_breed, p_source_system
        );
        IF (v_result->>'winner') = p_source_system THEN
            v_updates := v_updates || jsonb_build_object('breed', p_breed);
        END IF;
    END IF;

    -- Apply updates if any
    IF v_updates != '{}'::JSONB THEN
        UPDATE trapper.sot_cats
        SET display_name = COALESCE((v_updates->>'display_name'), display_name),
            sex = COALESCE((v_updates->>'sex'), sex),
            altered_status = COALESCE((v_updates->>'altered_status'), altered_status),
            breed = COALESCE((v_updates->>'breed'), breed),
            primary_color = COALESCE(p_primary_color, primary_color),
            secondary_color = COALESCE(p_secondary_color, secondary_color),
            ownership_type = COALESCE(p_ownership_type, ownership_type),
            source_system = p_source_system,
            updated_at = NOW()
        WHERE cat_id = p_cat_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.update_cat_with_survivorship IS
'Update cat record using survivorship rules to determine which source wins.';

\echo 'Created update_cat_with_survivorship'

-- ============================================================================
-- Step 7: Summary
-- ============================================================================

\echo ''
\echo '=== MIG_483 Complete ==='
\echo ''
\echo 'Created unified entity functions:'
\echo '  - unified_find_or_create_person(): Person with junk detection + source IDs'
\echo '  - unified_find_or_create_place(): Place with junk detection + Google dedup'
\echo '  - unified_find_or_create_cat(): Cat with junk detection + source IDs'
\echo ''
\echo 'Created junk detection functions:'
\echo '  - is_junk_person_name(), is_junk_cat_name()'
\echo '  - is_junk_microchip(), is_junk_address()'
\echo ''
\echo 'Created survivorship helpers:'
\echo '  - update_person_with_survivorship()'
\echo '  - update_cat_with_survivorship()'
\echo ''
\echo 'Next: MIG_488 will rewire old function names to call these unified versions'
\echo ''

