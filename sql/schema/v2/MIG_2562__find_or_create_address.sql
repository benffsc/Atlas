-- MIG_2562: Create sot.find_or_create_address() Function
--
-- Problem (DATA_GAP_058): 3,734 places (34%) have formatted_address text
-- but no sot.addresses record linked. This prevents city-level analysis
-- and proper address deduplication.
--
-- Root cause: No centralized function existed for address creation.
-- Places were created with formatted_address but the address lookup table
-- (sot.addresses) was never populated.
--
-- Fix: Create find_or_create_address() as the single entry point for
-- all address creation, following the same pattern as find_or_create_person()
-- and find_or_create_place_deduped().
--
-- Created: 2026-02-27

\echo ''
\echo '=============================================='
\echo '  MIG_2562: Create find_or_create_address()'
\echo '=============================================='
\echo ''

CREATE OR REPLACE FUNCTION sot.find_or_create_address(
    p_raw_input TEXT,
    p_formatted_address TEXT DEFAULT NULL,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL,
    p_source_system TEXT DEFAULT 'atlas'
)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
    v_address_id UUID;
    v_clean_raw TEXT;
    v_clean_formatted TEXT;
BEGIN
    -- Normalize input
    v_clean_raw := TRIM(p_raw_input);
    v_clean_formatted := COALESCE(TRIM(p_formatted_address), v_clean_raw);

    -- Guard: Empty input
    IF v_clean_raw IS NULL OR v_clean_raw = '' THEN
        RETURN NULL;
    END IF;

    -- DEDUP CHECK 1: Exact raw_input match (canonical lookup key)
    SELECT address_id INTO v_address_id
    FROM sot.addresses
    WHERE raw_input = v_clean_raw
      AND merged_into_address_id IS NULL
    LIMIT 1;

    IF v_address_id IS NOT NULL THEN
        RETURN v_address_id;
    END IF;

    -- DEDUP CHECK 2: formatted_address match (normalized comparison)
    SELECT address_id INTO v_address_id
    FROM sot.addresses
    WHERE LOWER(TRIM(formatted_address)) = LOWER(v_clean_formatted)
      AND merged_into_address_id IS NULL
    LIMIT 1;

    IF v_address_id IS NOT NULL THEN
        -- Found via formatted_address, update raw_input if it was different
        -- (This helps future lookups)
        RETURN v_address_id;
    END IF;

    -- CREATE NEW ADDRESS
    INSERT INTO sot.addresses (
        address_id,
        raw_input,
        raw_address,
        formatted_address,
        display_address,
        display_line,
        latitude,
        longitude,
        location,
        geocoding_status,
        source_system,
        created_at,
        updated_at
    ) VALUES (
        gen_random_uuid(),
        v_clean_raw,
        v_clean_raw,  -- raw_address = raw_input for compatibility
        v_clean_formatted,
        v_clean_formatted,  -- display_address
        v_clean_formatted,  -- display_line
        p_lat,
        p_lng,
        CASE
            WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
            ELSE NULL
        END,
        CASE
            WHEN p_lat IS NOT NULL THEN 'success'
            ELSE 'pending'
        END,
        p_source_system,
        NOW(),
        NOW()
    )
    RETURNING address_id INTO v_address_id;

    RETURN v_address_id;
END;
$$;

COMMENT ON FUNCTION sot.find_or_create_address IS
'Creates or finds an address record in sot.addresses.

Parameters:
- p_raw_input: Original address text (used as lookup key)
- p_formatted_address: Normalized address (defaults to raw_input)
- p_lat, p_lng: Coordinates if known
- p_source_system: Where this address came from

Deduplication:
1. First checks raw_input exact match
2. Then checks formatted_address (case-insensitive)
3. If no match, creates new address

Usage:
  SELECT sot.find_or_create_address(
    ''123 Main St, Santa Rosa, CA 94952'',
    ''123 Main Street, Santa Rosa, CA 94952'',
    38.4404, -122.7141,
    ''clinichq''
  );

Created by MIG_2562 for DATA_GAP_058 fix.';

-- Test the function
\echo ''
\echo 'Testing find_or_create_address...'

DO $$
DECLARE
    v_id1 UUID;
    v_id2 UUID;
BEGIN
    -- Test 1: Create new address
    v_id1 := sot.find_or_create_address(
        'MIG_2562_TEST_123 Test Lane, Santa Rosa, CA 94952',
        '123 Test Lane, Santa Rosa, CA 94952',
        38.4404, -122.7141,
        'test_mig_2562'
    );
    RAISE NOTICE 'Test 1 - Created: %', v_id1;

    -- Test 2: Find existing by raw_input
    v_id2 := sot.find_or_create_address(
        'MIG_2562_TEST_123 Test Lane, Santa Rosa, CA 94952'
    );
    RAISE NOTICE 'Test 2 - Found same: %', v_id1 = v_id2;

    -- Cleanup test data
    DELETE FROM sot.addresses WHERE source_system = 'test_mig_2562';
    RAISE NOTICE 'Test data cleaned up';
END $$;

\echo ''
\echo '=============================================='
\echo '  MIG_2562 Complete'
\echo '=============================================='
\echo ''
