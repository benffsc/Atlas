-- MIG_2530: Backfill Address Components
-- Date: 2026-02-26
--
-- Problem: V2 migration didn't extract address components (street_number,
-- street_name, city, state, postal_code) from formatted_address.
-- All 7,844 addresses have NULL component fields despite data being in formatted_address.
--
-- Solution: Parse all components from formatted_address using regex
-- Format is typically: "123 Street Name, City, CA XXXXX"

\echo ''
\echo '=============================================='
\echo '  MIG_2530: Backfill Address Components'
\echo '=============================================='
\echo ''

\echo 'Before: Count of addresses with components...'
SELECT
    COUNT(*) FILTER (WHERE city IS NOT NULL) as with_city,
    COUNT(*) FILTER (WHERE street_number IS NOT NULL) as with_street_number,
    COUNT(*) FILTER (WHERE street_name IS NOT NULL) as with_street_name,
    COUNT(*) FILTER (WHERE postal_code IS NOT NULL) as with_postal_code
FROM sot.addresses;

-- ============================================================================
-- EXTRACT ALL ADDRESS COMPONENTS
-- Format: "123 Street Name, City, CA 95XXX" or "Street Name, City, CA 95XXX"
-- ============================================================================

-- Helper function to parse address components
CREATE OR REPLACE FUNCTION sot.parse_address_components(p_address TEXT)
RETURNS TABLE (
    street_number TEXT,
    street_name TEXT,
    city TEXT,
    state TEXT,
    postal_code TEXT
)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_parts TEXT[];
    v_street_part TEXT;
    v_city_part TEXT;
    v_state_zip TEXT;
    v_street_number TEXT;
    v_street_name TEXT;
    v_city TEXT;
    v_state TEXT;
    v_postal_code TEXT;
BEGIN
    IF p_address IS NULL OR TRIM(p_address) = '' THEN
        RETURN;
    END IF;

    -- Split by comma
    v_parts := regexp_split_to_array(TRIM(p_address), ',\s*');

    -- Extract postal code (5 digits, possibly followed by -XXXX)
    -- Note: \b word boundary doesn't work in PostgreSQL, use simpler pattern
    v_postal_code := (regexp_match(p_address, '(\d{5})(?:-\d{4})?'))[1];

    -- Extract state (CA, California, etc.)
    v_state := (regexp_match(p_address, '\s(CA|California)\s', 'i'))[1];
    IF v_state ILIKE 'California' THEN
        v_state := 'CA';
    END IF;
    IF v_state IS NULL THEN
        v_state := 'CA';  -- Default to CA for Sonoma County
    END IF;

    -- Find city (part before state, after street address)
    -- Iterate through parts to find the city
    FOR i IN 1..array_length(v_parts, 1) LOOP
        v_city_part := TRIM(v_parts[i]);

        -- Skip if it contains the state or ZIP
        IF v_city_part ~ '\b(CA|California)\b' OR v_city_part ~ '\d{5}' THEN
            CONTINUE;
        END IF;

        -- Skip if it starts with a number (street address)
        IF v_city_part ~ '^\d' THEN
            -- This is likely the street address
            v_street_part := v_city_part;
            CONTINUE;
        END IF;

        -- Skip very short parts or common street suffixes
        IF length(v_city_part) < 4 OR v_city_part ~ '^(St|Rd|Ave|Dr|Ln|Ct|Blvd|Way|Pl|Cir|Trl|Hwy)$' THEN
            CONTINUE;
        END IF;

        -- This is likely the city
        v_city := v_city_part;
    END LOOP;

    -- Parse street number and name from the street part
    IF v_street_part IS NOT NULL THEN
        -- Extract leading number as street number
        v_street_number := (regexp_match(v_street_part, '^(\d+)\s'))[1];

        -- Everything after the number is street name
        IF v_street_number IS NOT NULL THEN
            v_street_name := TRIM(regexp_replace(v_street_part, '^\d+\s*', ''));
        ELSE
            v_street_name := v_street_part;
        END IF;
    END IF;

    -- If we didn't find a street part from comma parsing, try the first part
    IF v_street_part IS NULL AND array_length(v_parts, 1) >= 1 THEN
        v_street_part := TRIM(v_parts[1]);
        v_street_number := (regexp_match(v_street_part, '^(\d+)\s'))[1];
        IF v_street_number IS NOT NULL THEN
            v_street_name := TRIM(regexp_replace(v_street_part, '^\d+\s*', ''));
        ELSE
            v_street_name := v_street_part;
        END IF;
    END IF;

    RETURN QUERY SELECT v_street_number, v_street_name, v_city, v_state, v_postal_code;
END;
$$;

-- Update addresses with parsed components using a CTE
WITH parsed_addresses AS (
    SELECT
        a.address_id,
        a.formatted_address,
        a.display_address,
        a.street_number AS old_street_number,
        a.street_name AS old_street_name,
        a.city AS old_city,
        a.state AS old_state,
        a.postal_code AS old_postal_code,
        (sot.parse_address_components(COALESCE(a.formatted_address, a.display_address))).*
    FROM sot.addresses a
    WHERE a.city IS NULL OR a.street_number IS NULL OR a.postal_code IS NULL
)
UPDATE sot.addresses addr
SET
    street_number = COALESCE(addr.street_number, parsed.street_number),
    street_name = COALESCE(addr.street_name, parsed.street_name),
    city = COALESCE(addr.city, parsed.city),
    state = COALESCE(addr.state, parsed.state),
    postal_code = COALESCE(addr.postal_code, parsed.postal_code)
FROM parsed_addresses parsed
WHERE addr.address_id = parsed.address_id;

\echo ''
\echo 'After: Count of addresses with components...'
SELECT
    COUNT(*) FILTER (WHERE city IS NOT NULL) as with_city,
    COUNT(*) FILTER (WHERE street_number IS NOT NULL) as with_street_number,
    COUNT(*) FILTER (WHERE street_name IS NOT NULL) as with_street_name,
    COUNT(*) FILTER (WHERE postal_code IS NOT NULL) as with_postal_code
FROM sot.addresses;

\echo ''
\echo 'Sample of parsed addresses...'
SELECT
    display_address,
    street_number,
    street_name,
    city,
    state,
    postal_code
FROM sot.addresses
WHERE city IS NOT NULL
ORDER BY RANDOM()
LIMIT 5;

\echo ''
\echo 'Top cities by count...'
SELECT city, COUNT(*) as count
FROM sot.addresses
WHERE city IS NOT NULL
GROUP BY city
ORDER BY count DESC
LIMIT 10;

-- ============================================================================
-- TRIGGER: Auto-extract all components on INSERT/UPDATE
-- ============================================================================

\echo ''
\echo 'Creating trigger to auto-extract address components on future inserts/updates...'

CREATE OR REPLACE FUNCTION sot.extract_address_components()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_parsed RECORD;
BEGIN
    -- Only extract if we have missing components and have an address
    IF (NEW.city IS NULL OR NEW.street_number IS NULL OR NEW.postal_code IS NULL)
       AND (NEW.formatted_address IS NOT NULL OR NEW.display_address IS NOT NULL) THEN

        SELECT * INTO v_parsed
        FROM sot.parse_address_components(COALESCE(NEW.formatted_address, NEW.display_address));

        -- Fill in missing components only (don't overwrite existing values)
        NEW.street_number := COALESCE(NEW.street_number, v_parsed.street_number);
        NEW.street_name := COALESCE(NEW.street_name, v_parsed.street_name);
        NEW.city := COALESCE(NEW.city, v_parsed.city);
        NEW.state := COALESCE(NEW.state, v_parsed.state);
        NEW.postal_code := COALESCE(NEW.postal_code, v_parsed.postal_code);
    END IF;

    RETURN NEW;
END;
$$;

-- Create trigger if it doesn't exist
DROP TRIGGER IF EXISTS trg_extract_address_city ON sot.addresses;
DROP TRIGGER IF EXISTS trg_extract_address_components ON sot.addresses;
CREATE TRIGGER trg_extract_address_components
    BEFORE INSERT OR UPDATE ON sot.addresses
    FOR EACH ROW
    EXECUTE FUNCTION sot.extract_address_components();

\echo 'Trigger created: trg_extract_address_components'

\echo ''
\echo '=============================================='
\echo '  MIG_2530 Complete!'
\echo '=============================================='
