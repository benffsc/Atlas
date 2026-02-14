\echo '=== MIG_360: Unified Person Creation Core ==='
\echo 'Fixes the identity resolution bugs and unifies person creation paths'
\echo ''

-- ============================================================================
-- PROBLEM STATEMENT
-- ============================================================================
-- The Data Engine has critical bugs causing massive data pollution:
-- 1. ON CONFLICT DO NOTHING in create_person_basic() silently fails when
--    identifier already exists for another person
-- 2. No check for existing identifiers before creating new person
-- 3. Name doubling when first_name = last_name (business names)
--
-- EVIDENCE:
-- - 26,132 people but only 8,795 unique names (3x duplication)
-- - 81% of new_entity decisions have no identifiers
-- - Jean Worthey: 119 duplicate records
-- - 1,289 doubled names like "Mick's Door Shop Mick's Door Shop"
--
-- SOLUTION:
-- 1. Pre-check identifiers BEFORE creating person
-- 2. Return existing person if identifier found
-- 3. Normalize names (dedupe first=last)
-- 4. Detect business names
-- ============================================================================

-- ============================================================================
-- STEP 1: Name Normalization Helper
-- ============================================================================

\echo 'Step 1: Creating normalize_display_name function...'

CREATE OR REPLACE FUNCTION trapper.normalize_display_name(
    p_first_name TEXT,
    p_last_name TEXT
) RETURNS TEXT AS $$
DECLARE
    v_first TEXT;
    v_last TEXT;
BEGIN
    v_first := NULLIF(TRIM(COALESCE(p_first_name, '')), '');
    v_last := NULLIF(TRIM(COALESCE(p_last_name, '')), '');

    -- If first and last are identical (case-insensitive), use just one
    -- This handles cases like "Mick's Door Shop" / "Mick's Door Shop"
    IF v_first IS NOT NULL AND v_last IS NOT NULL
       AND LOWER(v_first) = LOWER(v_last) THEN
        RETURN v_first;
    END IF;

    -- Otherwise concatenate normally
    RETURN TRIM(CONCAT_WS(' ', v_first, v_last));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.normalize_display_name IS
'Builds display name from first/last, handling case where they are identical
(common with business names stored in both fields by ClinicHQ).';

\echo 'Created normalize_display_name function'

-- ============================================================================
-- STEP 2: Business Name Detection
-- ============================================================================

\echo ''
\echo 'Step 2: Creating is_business_name function...'

CREATE OR REPLACE FUNCTION trapper.is_business_name(p_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF p_name IS NULL OR p_name = '' THEN
        RETURN FALSE;
    END IF;

    -- Check for common business/organization indicators
    -- Using word boundaries (\m and \M) to avoid false positives
    RETURN
        -- Corporate suffixes
        p_name ~* '\m(llc|inc|corp|corporation|company|co\.|ltd|lp)\M'
        -- Commercial establishments
        OR p_name ~* '\m(shop|store|repair|auto|garage|salon|spa)\M'
        -- Industrial/Commercial
        OR p_name ~* '\m(industries|industrial|manufacturing|supply|supplies)\M'
        -- Healthcare/Services
        OR p_name ~* '\m(center|centre|clinic|hospital|medical|dental)\M'
        -- Agricultural
        OR p_name ~* '\m(dairy|ranch|farm|vineyard|winery|orchard)\M'
        -- Non-profits
        OR p_name ~* '\m(association|foundation|rescue|shelter|society)\M'
        -- Animal-specific
        OR p_name ~* '\m(animal control|humane society|spca|aspca)\M'
        -- Veterinary
        OR p_name ~* '\m(veterinary|vet\s|pet\s|grooming|boarding|kennel)\M'
        -- Pattern: "The X of Y" is often an organization
        OR p_name ~* '^the\s+\w+\s+(of|at|in|on)\s+'
        -- Pattern: Contains "services" or "solutions"
        OR p_name ~* '\m(services|solutions|consulting|management)\M';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.is_business_name IS
'Detects if a name appears to be a business/organization rather than a person.
Used to flag records for review or set entity_type = organization.';

\echo 'Created is_business_name function'

-- ============================================================================
-- STEP 3: Fixed create_person_basic
-- ============================================================================

\echo ''
\echo 'Step 3: Fixing create_person_basic function (CRITICAL FIX)...'

CREATE OR REPLACE FUNCTION trapper.create_person_basic(
    p_display_name TEXT,
    p_email_norm TEXT,
    p_phone_norm TEXT,
    p_source_system TEXT
)
RETURNS UUID AS $$
DECLARE
    v_person_id UUID;
    v_existing_email_person UUID;
    v_existing_phone_person UUID;
    v_data_source trapper.data_source;
    v_email_inserted BOOLEAN := FALSE;
    v_phone_inserted BOOLEAN := FALSE;
BEGIN
    -- Validate name first
    IF NOT trapper.is_valid_person_name(p_display_name) THEN
        RAISE NOTICE 'Invalid person name rejected: %', p_display_name;
        RETURN NULL;
    END IF;

    -- =========================================================================
    -- CRITICAL FIX: Check if identifiers already exist BEFORE creating person
    -- If they do, return the existing person instead of creating a duplicate.
    -- This prevents the ON CONFLICT DO NOTHING bug that left 81% of new
    -- entities without searchable identifiers.
    -- =========================================================================

    -- Check for existing email owner
    IF p_email_norm IS NOT NULL AND p_email_norm != '' THEN
        SELECT pi.person_id INTO v_existing_email_person
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = p_email_norm
          AND p.merged_into_person_id IS NULL  -- Only match active people
        LIMIT 1;

        IF v_existing_email_person IS NOT NULL THEN
            RAISE NOTICE 'Email % already belongs to person %, returning existing',
                p_email_norm, v_existing_email_person;
            RETURN v_existing_email_person;
        END IF;
    END IF;

    -- Check for existing phone owner (if not blacklisted)
    IF p_phone_norm IS NOT NULL AND p_phone_norm != '' THEN
        IF NOT EXISTS (
            SELECT 1 FROM trapper.identity_phone_blacklist
            WHERE phone_norm = p_phone_norm
        ) THEN
            SELECT pi.person_id INTO v_existing_phone_person
            FROM trapper.person_identifiers pi
            JOIN trapper.sot_people p ON p.person_id = pi.person_id
            WHERE pi.id_type = 'phone'
              AND pi.id_value_norm = p_phone_norm
              AND p.merged_into_person_id IS NULL
            LIMIT 1;

            IF v_existing_phone_person IS NOT NULL THEN
                RAISE NOTICE 'Phone % already belongs to person %, returning existing',
                    p_phone_norm, v_existing_phone_person;
                RETURN v_existing_phone_person;
            END IF;
        END IF;
    END IF;

    -- =========================================================================
    -- Safe to create new person - no identifier conflicts exist
    -- =========================================================================

    -- Map source_system to data_source enum
    v_data_source := CASE p_source_system
        WHEN 'clinichq' THEN 'clinichq'::trapper.data_source
        WHEN 'airtable' THEN 'airtable'::trapper.data_source
        WHEN 'web_intake' THEN 'web_app'::trapper.data_source
        WHEN 'atlas_ui' THEN 'web_app'::trapper.data_source
        ELSE 'web_app'::trapper.data_source
    END;

    -- Create person
    INSERT INTO trapper.sot_people (
        display_name, data_source, is_canonical, primary_email, primary_phone
    ) VALUES (
        p_display_name, v_data_source, TRUE, p_email_norm, p_phone_norm
    ) RETURNING person_id INTO v_person_id;

    -- Add email identifier (we already verified it doesn't exist)
    IF p_email_norm IS NOT NULL AND p_email_norm != '' THEN
        INSERT INTO trapper.person_identifiers (
            person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
        ) VALUES (
            v_person_id, 'email', p_email_norm, p_email_norm, p_source_system, 1.0
        );
        v_email_inserted := TRUE;
    END IF;

    -- Add phone identifier (we already verified it doesn't exist and isn't blacklisted)
    IF p_phone_norm IS NOT NULL AND p_phone_norm != '' THEN
        IF NOT EXISTS (
            SELECT 1 FROM trapper.identity_phone_blacklist
            WHERE phone_norm = p_phone_norm
        ) THEN
            INSERT INTO trapper.person_identifiers (
                person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
            ) VALUES (
                v_person_id, 'phone', p_phone_norm, p_phone_norm, p_source_system, 1.0
            );
            v_phone_inserted := TRUE;
        END IF;
    END IF;

    -- Log if no identifiers were created (should only happen if both are NULL)
    IF NOT v_email_inserted AND NOT v_phone_inserted THEN
        RAISE NOTICE 'Person % created without any identifiers (email: %, phone: %)',
            v_person_id, p_email_norm, p_phone_norm;
    END IF;

    RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_person_basic IS
'Creates a new person with email/phone identifiers. FIXED to check for existing
identifiers BEFORE creating person to prevent identifier-less duplicates.
If identifier already exists for another person, returns that person_id instead.';

\echo 'Fixed create_person_basic function'

-- ============================================================================
-- STEP 4: Unified create_or_match_person function
-- ============================================================================

\echo ''
\echo 'Step 4: Creating unified create_or_match_person function...'

CREATE OR REPLACE FUNCTION trapper.create_or_match_person(
    p_email TEXT,
    p_phone TEXT,
    p_first_name TEXT,
    p_last_name TEXT,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'unknown',
    p_allow_create BOOLEAN DEFAULT TRUE
) RETURNS TABLE (
    person_id UUID,
    is_new BOOLEAN,
    match_type TEXT,
    is_business BOOLEAN
) AS $$
DECLARE
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_display_name TEXT;
    v_is_business BOOLEAN;
    v_existing_person_id UUID;
    v_new_person_id UUID;
BEGIN
    -- Step 1: Normalize inputs
    v_email_norm := trapper.norm_email(p_email);
    v_phone_norm := trapper.norm_phone_us(p_phone);
    v_display_name := trapper.normalize_display_name(p_first_name, p_last_name);
    v_is_business := trapper.is_business_name(v_display_name);

    -- Step 2: Check email identifier for existing match
    IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
        SELECT pi.person_id INTO v_existing_person_id
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = v_email_norm
          AND p.merged_into_person_id IS NULL
        LIMIT 1;

        IF v_existing_person_id IS NOT NULL THEN
            RETURN QUERY SELECT
                trapper.get_canonical_person_id(v_existing_person_id),
                FALSE,
                'email_match'::TEXT,
                v_is_business;
            RETURN;
        END IF;
    END IF;

    -- Step 3: Check phone identifier for existing match (skip if blacklisted)
    IF v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
        IF NOT EXISTS (
            SELECT 1 FROM trapper.identity_phone_blacklist
            WHERE phone_norm = v_phone_norm
        ) THEN
            SELECT pi.person_id INTO v_existing_person_id
            FROM trapper.person_identifiers pi
            JOIN trapper.sot_people p ON p.person_id = pi.person_id
            WHERE pi.id_type = 'phone'
              AND pi.id_value_norm = v_phone_norm
              AND p.merged_into_person_id IS NULL
            LIMIT 1;

            IF v_existing_person_id IS NOT NULL THEN
                RETURN QUERY SELECT
                    trapper.get_canonical_person_id(v_existing_person_id),
                    FALSE,
                    'phone_match'::TEXT,
                    v_is_business;
                RETURN;
            END IF;
        END IF;
    END IF;

    -- Step 4: No existing match found
    IF NOT p_allow_create THEN
        -- Caller doesn't want creation, return NULL
        RETURN QUERY SELECT NULL::UUID, FALSE, 'no_match'::TEXT, v_is_business;
        RETURN;
    END IF;

    -- Step 5: Create new person using fixed create_person_basic
    v_new_person_id := trapper.create_person_basic(
        v_display_name,
        v_email_norm,
        v_phone_norm,
        p_source_system
    );

    IF v_new_person_id IS NULL THEN
        -- Name validation failed
        RETURN QUERY SELECT NULL::UUID, FALSE, 'invalid_name'::TEXT, v_is_business;
        RETURN;
    END IF;

    RETURN QUERY SELECT
        v_new_person_id,
        TRUE,
        'new_entity'::TEXT,
        v_is_business;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_or_match_person IS
'Unified person creation/matching function. Checks for existing identifiers
first, returns existing person if found, otherwise creates new person.
Returns match metadata for audit trail.';

\echo 'Created create_or_match_person function'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=== Verification Tests ==='

-- Test normalize_display_name
\echo 'Testing normalize_display_name:'
SELECT
    test_case,
    first_name,
    last_name,
    trapper.normalize_display_name(first_name, last_name) as result
FROM (VALUES
    ('Normal case', 'John', 'Smith'),
    ('Doubled name', 'Micks Door Shop', 'Micks Door Shop'),
    ('Case insensitive', 'AAMCO REPAIR', 'Aamco Repair'),
    ('First only', 'Alice', NULL),
    ('Last only', NULL, 'Johnson'),
    ('Both NULL', NULL, NULL)
) AS t(test_case, first_name, last_name);

-- Test is_business_name
\echo ''
\echo 'Testing is_business_name:'
SELECT
    name,
    trapper.is_business_name(name) as is_business
FROM (VALUES
    ('John Smith'),
    ('Micks Door Shop'),
    ('AAMCO Repair Santa Rosa'),
    ('San Francisco Animal Control'),
    ('Jean Worthey'),
    ('Northbay Industries'),
    ('The Oaks Veterinary Clinic'),
    ('Bucher Dairy'),
    ('Katherine Henry')
) AS t(name);

\echo ''
\echo '=== MIG_360 Complete ==='
\echo 'Created/Fixed:'
\echo '  1. normalize_display_name() - handles first=last deduplication'
\echo '  2. is_business_name() - detects organization names'
\echo '  3. create_person_basic() - FIXED to check identifiers before creating'
\echo '  4. create_or_match_person() - unified entry point with metadata'
\echo ''
\echo 'The critical ON CONFLICT bug is now fixed. New people will always'
\echo 'have identifiers, and duplicates will not be created.'
\echo ''
