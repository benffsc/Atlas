-- MIG_2008: Copy V1 Entity Creation Functions to V2 sot Schema
--
-- Purpose: Port the V1 place and cat entity creation functions to V2
-- These functions handle deduplication and creation of places and cats.
--
-- Key V1 functions being copied:
-- 1. sot.find_or_create_place_deduped() - Place creation with 2-stage dedup (MIG_560)
-- 2. sot.find_or_create_cat_by_microchip() - Cat creation with microchip lookup (MIG_865)
-- 3. sot.clean_cat_name() - Cat name cleaning
--
-- Created: 2026-02-12

\echo ''
\echo '=============================================='
\echo '  MIG_2008: Copy V1 Entity Functions to V2'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CLEAN CAT NAME HELPER
-- ============================================================================

\echo '1. Creating sot.clean_cat_name()...'

CREATE OR REPLACE FUNCTION sot.clean_cat_name(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_name TEXT;
BEGIN
    IF p_name IS NULL OR TRIM(p_name) = '' THEN
        RETURN NULL;
    END IF;

    v_name := TRIM(p_name);

    -- Remove microchip numbers embedded in name
    v_name := REGEXP_REPLACE(v_name, '\d{9,15}', '', 'g');

    -- Remove "Unknown (" pattern
    v_name := REGEXP_REPLACE(v_name, '^Unknown\s*\(.*\)$', '', 'i');

    -- Remove surrounding whitespace
    v_name := TRIM(v_name);

    -- If empty after cleaning, return NULL
    IF v_name = '' OR v_name ~* '^unknown$' THEN
        RETURN NULL;
    END IF;

    RETURN v_name;
END;
$$;

COMMENT ON FUNCTION sot.clean_cat_name IS
'V2: Cleans cat names by removing embedded microchips and garbage patterns.
Ported from V1 clean_cat_name.';

\echo '   Created sot.clean_cat_name()'

-- ============================================================================
-- 2. FIND OR CREATE PLACE DEDUPED (from MIG_560)
-- ============================================================================

\echo ''
\echo '2. Creating sot.find_or_create_place_deduped()...'

CREATE OR REPLACE FUNCTION sot.find_or_create_place_deduped(
    p_formatted_address TEXT,
    p_display_name TEXT DEFAULT NULL,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL,
    p_source_system TEXT DEFAULT 'atlas'
)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
    v_normalized TEXT;
    v_existing_id UUID;
    v_new_id UUID;
    v_has_coords BOOLEAN;
    v_address_id UUID;
BEGIN
    -- Normalize the address
    v_normalized := sot.normalize_address(p_formatted_address);

    IF v_normalized IS NULL OR v_normalized = '' THEN
        RETURN NULL;
    END IF;

    -- =========================================================================
    -- DEDUP CHECK 1: Exact normalized address match
    -- =========================================================================
    SELECT place_id INTO v_existing_id
    FROM sot.places
    WHERE normalized_address = v_normalized
      AND merged_into_place_id IS NULL
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RETURN v_existing_id;
    END IF;

    -- =========================================================================
    -- DEDUP CHECK 2: Coordinate match (within 10 meters)
    -- Only if coordinates are provided AND no exact address match found
    -- Skip if checking for a unit (would merge different apartments)
    -- =========================================================================
    v_has_coords := (p_lat IS NOT NULL AND p_lng IS NOT NULL);

    IF v_has_coords THEN
        SELECT place_id INTO v_existing_id
        FROM sot.places
        WHERE location IS NOT NULL
          AND merged_into_place_id IS NULL
          AND (unit_number IS NULL OR unit_number = '')
          AND ST_DWithin(
              location,
              ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
              10  -- 10 meter tolerance
          )
        ORDER BY
            -- Prefer places with normalized_address populated
            CASE WHEN normalized_address IS NOT NULL THEN 0 ELSE 1 END,
            -- Then prefer closer matches
            ST_Distance(location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography),
            -- Then prefer older places (more established)
            created_at
        LIMIT 1;

        IF v_existing_id IS NOT NULL THEN
            RETURN v_existing_id;
        END IF;
    END IF;

    -- =========================================================================
    -- CREATE NEW PLACE (no match found)
    -- =========================================================================

    -- First create address record
    INSERT INTO sot.addresses (raw_input, display_address, source_system)
    VALUES (p_formatted_address, p_formatted_address, p_source_system)
    ON CONFLICT DO NOTHING
    RETURNING address_id INTO v_address_id;

    -- If address already existed, get its ID
    IF v_address_id IS NULL THEN
        SELECT address_id INTO v_address_id
        FROM sot.addresses
        WHERE raw_input = p_formatted_address
        LIMIT 1;
    END IF;

    -- Create new place
    INSERT INTO sot.places (
        display_name,
        formatted_address,
        normalized_address,
        location,
        source_system,
        address_id
    ) VALUES (
        COALESCE(p_display_name, p_formatted_address),
        p_formatted_address,
        v_normalized,
        CASE WHEN v_has_coords
             THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
             ELSE NULL END,
        p_source_system,
        v_address_id
    )
    RETURNING place_id INTO v_new_id;

    RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION sot.find_or_create_place_deduped IS
'V2: Find existing place by normalized address OR coordinates, or create new one.
Ported from V1 MIG_560.

Deduplication strategy:
1. First check for exact normalized_address match
2. If no match and coordinates provided, check for places within 10 meters
   (but only if neither place has a unit_number to preserve apartment units)
3. If still no match, create new place with address record';

\echo '   Created sot.find_or_create_place_deduped()'

-- ============================================================================
-- 3. FIND OR CREATE CAT BY MICROCHIP (from MIG_865)
-- ============================================================================

\echo ''
\echo '3. Creating sot.find_or_create_cat_by_microchip()...'

CREATE OR REPLACE FUNCTION sot.find_or_create_cat_by_microchip(
    p_microchip TEXT,
    p_name TEXT DEFAULT NULL,
    p_sex TEXT DEFAULT NULL,
    p_breed TEXT DEFAULT NULL,
    p_altered_status TEXT DEFAULT NULL,
    p_color TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'clinichq'
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
            source_system = p_source_system,
            updated_at = NOW()
        WHERE cat_id = v_cat_id;

        RETURN v_cat_id;
    END IF;

    -- Create new cat with clean name
    INSERT INTO sot.cats (
        name, microchip, sex, breed, color,
        source_system
    ) VALUES (
        v_clean_name,
        v_microchip,
        p_sex, p_breed, p_color,
        p_source_system
    )
    RETURNING cat_id INTO v_cat_id;

    -- Create microchip identifier
    INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system)
    VALUES (v_cat_id, 'microchip', v_microchip, 1.0, p_source_system)
    ON CONFLICT DO NOTHING;

    RETURN v_cat_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.find_or_create_cat_by_microchip IS
'V2: Find or create a cat by microchip number.
Ported from V1 MIG_865 with fixes:
1. Uses sot.validate_microchip() for validation (MIG_1011)
2. COALESCE NULLIF fix: empty strings treated as NULL
3. display_name "Unknown" replaced by real names';

\echo '   Created sot.find_or_create_cat_by_microchip()'

-- ============================================================================
-- 4. LINK CAT TO PLACE (from MIG_797)
-- ============================================================================

\echo ''
\echo '4. Creating sot.link_cat_to_place()...'

CREATE OR REPLACE FUNCTION sot.link_cat_to_place(
    p_cat_id UUID,
    p_place_id UUID,
    p_relationship_type TEXT DEFAULT 'seen_at',
    p_evidence_type TEXT DEFAULT 'appointment',
    p_source_system TEXT DEFAULT 'atlas',
    p_source_table TEXT DEFAULT NULL,
    p_evidence_detail JSONB DEFAULT NULL,
    p_confidence TEXT DEFAULT 'medium'
)
RETURNS UUID AS $$
DECLARE
    v_link_id UUID;
BEGIN
    -- Validate entities exist and aren't merged
    IF NOT EXISTS (
        SELECT 1 FROM sot.cats WHERE cat_id = p_cat_id AND merged_into_cat_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM sot.places WHERE place_id = p_place_id AND merged_into_place_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    -- Insert or update relationship
    INSERT INTO sot.cat_place (
        cat_id, place_id, relationship_type,
        confidence, evidence_type, source_system
    ) VALUES (
        p_cat_id, p_place_id, p_relationship_type,
        p_confidence, p_evidence_type, p_source_system
    )
    ON CONFLICT (cat_id, place_id, relationship_type)
    DO UPDATE SET
        confidence = CASE
            WHEN EXCLUDED.confidence > sot.cat_place.confidence THEN EXCLUDED.confidence
            ELSE sot.cat_place.confidence
        END,
        updated_at = NOW()
    RETURNING id INTO v_link_id;

    RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.link_cat_to_place IS
'V2: Creates or updates a cat-place relationship.
Ported from V1 MIG_797 link_cat_to_place.
Validates entities exist and arent merged before linking.
Uses ON CONFLICT to update if higher confidence.';

\echo '   Created sot.link_cat_to_place()'

-- ============================================================================
-- 5. LINK PERSON TO CAT (from MIG_797)
-- ============================================================================

\echo ''
\echo '5. Creating sot.link_person_to_cat()...'

CREATE OR REPLACE FUNCTION sot.link_person_to_cat(
    p_person_id UUID,
    p_cat_id UUID,
    p_relationship_type TEXT DEFAULT 'owner',
    p_evidence_type TEXT DEFAULT 'appointment',
    p_source_system TEXT DEFAULT 'atlas',
    p_confidence TEXT DEFAULT 'medium'
)
RETURNS UUID AS $$
DECLARE
    v_link_id UUID;
BEGIN
    -- Validate entities exist and aren't merged
    IF NOT EXISTS (
        SELECT 1 FROM sot.people WHERE person_id = p_person_id AND merged_into_person_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM sot.cats WHERE cat_id = p_cat_id AND merged_into_cat_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    -- Insert or update relationship
    INSERT INTO sot.person_cat (
        person_id, cat_id, relationship_type,
        confidence, evidence_type, source_system
    ) VALUES (
        p_person_id, p_cat_id, p_relationship_type,
        p_confidence, p_evidence_type, p_source_system
    )
    ON CONFLICT (person_id, cat_id, relationship_type)
    DO UPDATE SET
        confidence = CASE
            WHEN EXCLUDED.confidence > sot.person_cat.confidence THEN EXCLUDED.confidence
            ELSE sot.person_cat.confidence
        END,
        updated_at = NOW()
    RETURNING id INTO v_link_id;

    RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.link_person_to_cat IS
'V2: Creates or updates a person-cat relationship.
Ported from V1 MIG_797 link_person_to_cat.
Validates entities exist and arent merged before linking.
Uses ON CONFLICT to update if higher confidence.';

\echo '   Created sot.link_person_to_cat()'

-- ============================================================================
-- 6. LINK PERSON TO PLACE (from MIG_797)
-- ============================================================================

\echo ''
\echo '6. Creating sot.link_person_to_place()...'

CREATE OR REPLACE FUNCTION sot.link_person_to_place(
    p_person_id UUID,
    p_place_id UUID,
    p_role TEXT DEFAULT 'resident',
    p_evidence_type TEXT DEFAULT 'appointment',
    p_source_system TEXT DEFAULT 'atlas',
    p_confidence TEXT DEFAULT 'medium'
)
RETURNS UUID AS $$
DECLARE
    v_link_id UUID;
BEGIN
    -- Validate entities exist and aren't merged
    IF NOT EXISTS (
        SELECT 1 FROM sot.people WHERE person_id = p_person_id AND merged_into_person_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM sot.places WHERE place_id = p_place_id AND merged_into_place_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    -- Insert or update relationship
    INSERT INTO sot.person_place (
        person_id, place_id, role,
        confidence, evidence_type, source_system
    ) VALUES (
        p_person_id, p_place_id, p_role,
        p_confidence, p_evidence_type, p_source_system
    )
    ON CONFLICT (person_id, place_id, role)
    DO UPDATE SET
        confidence = CASE
            WHEN EXCLUDED.confidence > sot.person_place.confidence THEN EXCLUDED.confidence
            ELSE sot.person_place.confidence
        END,
        updated_at = NOW()
    RETURNING id INTO v_link_id;

    RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.link_person_to_place IS
'V2: Creates or updates a person-place relationship.
Ported from V1 MIG_797 link_person_to_place.
Validates entities exist and arent merged before linking.
Uses ON CONFLICT to update if higher confidence.';

\echo '   Created sot.link_person_to_place()'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Testing sot.clean_cat_name():'
SELECT
    input,
    sot.clean_cat_name(input) AS cleaned
FROM (VALUES
    ('Whiskers'),
    ('Unknown (123456789012345)'),
    ('Fluffy 985112345678901'),
    ('Unknown'),
    (NULL)
) AS t(input);

\echo ''
\echo '=============================================='
\echo '  MIG_2008 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created V2 Entity Creation functions:'
\echo '  - sot.clean_cat_name()'
\echo '  - sot.find_or_create_place_deduped()'
\echo '  - sot.find_or_create_cat_by_microchip()'
\echo '  - sot.link_cat_to_place()'
\echo '  - sot.link_person_to_cat()'
\echo '  - sot.link_person_to_place()'
\echo ''
\echo 'Place deduplication: normalized address + 10m coordinate match'
\echo 'Cat creation: microchip validation + name cleaning'
\echo 'All link functions validate entities before creating relationships'
\echo ''
