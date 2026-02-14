\echo '=== MIG_488: Rewire Legacy Functions to Unified Versions ==='
\echo 'Makes old function names call unified versions for backwards compatibility'
\echo ''

-- ============================================================================
-- PURPOSE
-- Rewire legacy entity creation functions to call the new unified versions.
-- This ensures:
-- 1. All existing code continues to work
-- 2. All data goes through unified validation/deduplication
-- 3. No duplicate code paths that could insert bad data
-- ============================================================================

\echo 'Step 1: Rewiring find_or_create_person...'

-- Drop the old function and create a wrapper
DROP FUNCTION IF EXISTS trapper.find_or_create_person(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION trapper.find_or_create_person(
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'web_intake'
)
RETURNS UUID AS $$
BEGIN
    -- Delegate to unified function (source_id = NULL for legacy callers)
    RETURN trapper.unified_find_or_create_person(
        p_email,
        p_phone,
        p_first_name,
        p_last_name,
        p_address,
        p_source_system,
        NULL  -- source_id not supported by legacy signature
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_person IS
'DEPRECATED: Wrapper that calls unified_find_or_create_person.
Use unified_find_or_create_person directly for new code.
Kept for backwards compatibility with existing callers.';

\echo 'Rewired find_or_create_person -> unified_find_or_create_person'

-- ============================================================================
-- Step 2: Rewire find_or_create_place_deduped
-- ============================================================================

\echo ''
\echo 'Step 2: Rewiring find_or_create_place_deduped...'

DROP FUNCTION IF EXISTS trapper.find_or_create_place_deduped(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT);

CREATE OR REPLACE FUNCTION trapper.find_or_create_place_deduped(
    p_formatted_address TEXT,
    p_display_name TEXT DEFAULT NULL,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL,
    p_source_system TEXT DEFAULT 'atlas'
)
RETURNS UUID AS $$
BEGIN
    -- Delegate to unified function (google_place_id = NULL for legacy callers)
    RETURN trapper.unified_find_or_create_place(
        p_formatted_address,
        p_display_name,
        p_lat,
        p_lng,
        p_source_system,
        NULL  -- google_place_id not supported by legacy signature
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_place_deduped IS
'DEPRECATED: Wrapper that calls unified_find_or_create_place.
Use unified_find_or_create_place directly for new code.
Kept for backwards compatibility with existing callers.';

\echo 'Rewired find_or_create_place_deduped -> unified_find_or_create_place'

-- ============================================================================
-- Step 3: Rewire find_or_create_cat_by_microchip
-- ============================================================================

\echo ''
\echo 'Step 3: Rewiring find_or_create_cat_by_microchip...'

DROP FUNCTION IF EXISTS trapper.find_or_create_cat_by_microchip(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION trapper.find_or_create_cat_by_microchip(
    p_microchip TEXT,
    p_name TEXT DEFAULT NULL,
    p_sex TEXT DEFAULT NULL,
    p_breed TEXT DEFAULT NULL,
    p_altered_status TEXT DEFAULT NULL,
    p_primary_color TEXT DEFAULT NULL,
    p_secondary_color TEXT DEFAULT NULL,
    p_ownership_type TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'clinichq'
)
RETURNS UUID AS $$
BEGIN
    -- Delegate to unified function (source_id = NULL for legacy callers)
    RETURN trapper.unified_find_or_create_cat(
        p_microchip,
        p_name,
        p_sex,
        p_breed,
        p_altered_status,
        p_primary_color,
        p_secondary_color,
        p_ownership_type,
        p_source_system,
        NULL  -- source_id not supported by legacy signature
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_cat_by_microchip IS
'DEPRECATED: Wrapper that calls unified_find_or_create_cat.
Use unified_find_or_create_cat directly for new code.
Kept for backwards compatibility with existing callers.';

\echo 'Rewired find_or_create_cat_by_microchip -> unified_find_or_create_cat'

-- ============================================================================
-- Step 4: Update Data Engine to use unified functions
-- ============================================================================

\echo ''
\echo 'Step 4: Updating data_engine_resolve_identity to use unified validation...'

-- The data_engine_resolve_identity function already handles identity resolution
-- We just need to ensure it validates data before insertion

CREATE OR REPLACE FUNCTION trapper.data_engine_resolve_identity(
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'web_intake'
)
RETURNS TABLE (
    person_id UUID,
    is_new BOOLEAN,
    match_type TEXT,
    match_confidence NUMERIC,
    household_id UUID
) AS $$
DECLARE
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_display_name TEXT;
    v_address_norm TEXT;
    v_best_match RECORD;
    v_new_person_id UUID;
BEGIN
    -- Validate inputs using unified junk detection
    v_display_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));
    v_display_name := NULLIF(TRIM(v_display_name), '');

    -- Check for junk names
    IF v_display_name IS NOT NULL AND trapper.is_junk_person_name(v_display_name) THEN
        RAISE WARNING 'Data Engine: Rejected junk name: %', v_display_name;
        RETURN;  -- Return empty result for junk data
    END IF;

    -- Normalize email
    v_email_norm := LOWER(TRIM(p_email));
    IF v_email_norm = '' THEN v_email_norm := NULL; END IF;

    -- Normalize phone
    v_phone_norm := trapper.norm_phone_us(p_phone);

    -- Normalize address
    v_address_norm := trapper.normalize_address(p_address);

    -- Score candidates
    SELECT INTO v_best_match *
    FROM trapper.data_engine_score_candidates(
        v_email_norm, v_phone_norm, v_display_name, v_address_norm
    )
    WHERE total_score >= 0.7
    ORDER BY total_score DESC
    LIMIT 1;

    -- If match found, return it
    IF v_best_match.person_id IS NOT NULL THEN
        person_id := v_best_match.person_id;
        is_new := FALSE;
        match_type := CASE
            WHEN 'exact_email' = ANY(v_best_match.matched_rules) THEN 'email'
            WHEN 'exact_phone' = ANY(v_best_match.matched_rules) THEN 'phone'
            WHEN 'address_match' = ANY(v_best_match.matched_rules) THEN 'address'
            ELSE 'composite'
        END;
        match_confidence := v_best_match.total_score;
        household_id := v_best_match.household_id;
        RETURN NEXT;
        RETURN;
    END IF;

    -- No match - create new person via unified function
    -- (which handles validation and identifier creation)
    v_new_person_id := trapper.unified_find_or_create_person(
        v_email_norm,
        v_phone_norm,
        p_first_name,
        p_last_name,
        p_address,
        p_source_system,
        NULL
    );

    IF v_new_person_id IS NOT NULL THEN
        person_id := v_new_person_id;
        is_new := TRUE;
        match_type := 'new';
        match_confidence := 1.0;
        household_id := NULL;
        RETURN NEXT;
    END IF;

    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity IS
'Identity resolution for Data Engine using unified validation.
Now uses unified_find_or_create_person for new records.';

\echo 'Updated data_engine_resolve_identity with unified validation'

-- ============================================================================
-- Step 5: Summary
-- ============================================================================

\echo ''
\echo '=== MIG_488 Complete ==='
\echo ''
\echo 'Rewired legacy functions:'
\echo '  - find_or_create_person -> unified_find_or_create_person'
\echo '  - find_or_create_place_deduped -> unified_find_or_create_place'
\echo '  - find_or_create_cat_by_microchip -> unified_find_or_create_cat'
\echo ''
\echo 'All data now flows through unified validation:'
\echo '  - Junk names rejected (test, unknown, xxx, etc.)'
\echo '  - Junk microchips rejected (000000, test, etc.)'
\echo '  - Junk addresses rejected (PO boxes, city-only, etc.)'
\echo '  - Source confidence scoring applied'
\echo '  - Google Place ID deduplication available'
\echo ''
\echo 'Existing callers continue to work - no code changes required.'
\echo ''


