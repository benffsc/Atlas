-- MIG_2340__backfill_microchip_on_return.sql
-- Automatically add microchip to existing cats when they return with one
--
-- Problem: Cat comes in without chip (too sick, too young, etc.)
--          Cat returns later and gets chipped
--          find_or_create_cat_by_microchip doesn't find by clinichq_animal_id
--          → Creates DUPLICATE cat instead of updating existing one!
--
-- Solution:
-- 1. Update find_or_create_cat_by_microchip to check clinichq_animal_id as fallback
-- 2. If found by clinichq_animal_id, ADD the microchip to existing cat
-- 3. Create monitoring view for cats awaiting chips

-- ==============================================================================
-- 1. FIX: find_or_create_cat_by_microchip - check clinichq_animal_id as fallback
-- ==============================================================================
-- Before creating a new cat, check if one exists by clinichq_animal_id
-- If so, add the microchip to that existing cat instead of creating duplicate

CREATE OR REPLACE FUNCTION sot.find_or_create_cat_by_microchip(
    p_microchip TEXT,
    p_name TEXT DEFAULT NULL,
    p_sex TEXT DEFAULT NULL,
    p_breed TEXT DEFAULT NULL,
    p_altered_status TEXT DEFAULT NULL,
    p_color TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'clinichq',
    p_clinichq_animal_id TEXT DEFAULT NULL,  -- Added to check for existing cat
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

    -- Step 1: Find existing cat by microchip
    SELECT c.cat_id INTO v_cat_id
    FROM sot.cat_identifiers ci
    JOIN sot.cats c ON c.cat_id = ci.cat_id
    WHERE ci.id_type = 'microchip'
      AND ci.id_value = v_microchip
      AND c.merged_into_cat_id IS NULL
    LIMIT 1;

    IF v_cat_id IS NOT NULL THEN
        -- Found by microchip - update with new info
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
            ownership_type = COALESCE(NULLIF(ownership_type, ''), p_ownership_type),
            source_system = p_source_system,
            updated_at = NOW()
        WHERE cat_id = v_cat_id;

        -- Add clinichq_animal_id if provided and not already set
        IF p_clinichq_animal_id IS NOT NULL AND TRIM(p_clinichq_animal_id) != '' THEN
            INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system)
            VALUES (v_cat_id, 'clinichq_animal_id', TRIM(p_clinichq_animal_id), 1.0, p_source_system)
            ON CONFLICT DO NOTHING;
        END IF;

        RETURN v_cat_id;
    END IF;

    -- =========================================================================
    -- Step 2: NEW! Check by clinichq_animal_id before creating new cat
    -- This prevents duplicates when a cat returns and gets chipped
    -- =========================================================================
    IF p_clinichq_animal_id IS NOT NULL AND TRIM(p_clinichq_animal_id) != '' THEN
        -- Check cat_identifiers
        SELECT c.cat_id INTO v_cat_id
        FROM sot.cat_identifiers ci
        JOIN sot.cats c ON c.cat_id = ci.cat_id
        WHERE ci.id_type = 'clinichq_animal_id'
          AND ci.id_value = TRIM(p_clinichq_animal_id)
          AND c.merged_into_cat_id IS NULL
        LIMIT 1;

        -- Fallback: check cats.clinichq_animal_id directly
        IF v_cat_id IS NULL THEN
            SELECT c.cat_id INTO v_cat_id
            FROM sot.cats c
            WHERE c.clinichq_animal_id = TRIM(p_clinichq_animal_id)
              AND c.merged_into_cat_id IS NULL
            LIMIT 1;
        END IF;

        IF v_cat_id IS NOT NULL THEN
            -- Found by clinichq_animal_id - ADD THE MICROCHIP!
            RAISE NOTICE 'Cat found by clinichq_animal_id %, adding microchip %',
                p_clinichq_animal_id, v_microchip;

            -- Add microchip to identifiers
            INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system, created_at)
            VALUES (v_cat_id, 'microchip', v_microchip, 1.0, p_source_system, NOW())
            ON CONFLICT (id_type, id_value) DO NOTHING;

            -- Update cat record
            UPDATE sot.cats SET
                microchip = v_microchip,
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
                ownership_type = COALESCE(NULLIF(ownership_type, ''), p_ownership_type),
                source_system = p_source_system,
                updated_at = NOW()
            WHERE cat_id = v_cat_id;

            RETURN v_cat_id;
        END IF;
    END IF;

    -- Step 3: Create new cat (no existing record found)
    INSERT INTO sot.cats (
        name, microchip, sex, breed, color,
        clinichq_animal_id,
        ownership_type,
        source_system
    ) VALUES (
        v_clean_name,
        v_microchip,
        p_sex, p_breed, p_color,
        NULLIF(TRIM(p_clinichq_animal_id), ''),
        p_ownership_type,
        p_source_system
    )
    RETURNING cat_id INTO v_cat_id;

    -- Create microchip identifier
    INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system)
    VALUES (v_cat_id, 'microchip', v_microchip, 1.0, p_source_system)
    ON CONFLICT DO NOTHING;

    -- Create clinichq_animal_id identifier if provided
    IF p_clinichq_animal_id IS NOT NULL AND TRIM(p_clinichq_animal_id) != '' THEN
        INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system)
        VALUES (v_cat_id, 'clinichq_animal_id', TRIM(p_clinichq_animal_id), 1.0, p_source_system)
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_cat_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.find_or_create_cat_by_microchip IS
'V2 MIG_2340: Find or create a cat by microchip number.
Now also checks clinichq_animal_id as fallback to prevent duplicates
when a cat returns and gets chipped after initial visit without chip.';

-- ==============================================================================
-- 2. Enhanced find_or_create_cat_by_clinichq_id that can also backfill microchips
-- ==============================================================================

CREATE OR REPLACE FUNCTION sot.find_or_create_cat_by_clinichq_id(
    p_clinichq_animal_id TEXT,
    p_name TEXT DEFAULT NULL,
    p_sex TEXT DEFAULT NULL,
    p_breed TEXT DEFAULT NULL,
    p_altered_status TEXT DEFAULT NULL,
    p_color TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'clinichq',
    p_ownership_type TEXT DEFAULT NULL,
    p_microchip TEXT DEFAULT NULL  -- NEW: Accept microchip to backfill
)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
    v_cat_id UUID;
    v_clean_name TEXT;
    v_clinichq_id TEXT;
    v_existing_microchip TEXT;
    v_clean_microchip TEXT;
BEGIN
    -- Validate clinichq_animal_id
    v_clinichq_id := TRIM(p_clinichq_animal_id);
    IF v_clinichq_id IS NULL OR v_clinichq_id = '' THEN
        RETURN NULL;
    END IF;

    -- Clean the microchip (validate 15-digit format)
    v_clean_microchip := TRIM(p_microchip);
    IF v_clean_microchip IS NOT NULL AND v_clean_microchip !~ '^[0-9]{15}$' THEN
        v_clean_microchip := NULL;  -- Invalid microchip format
    END IF;

    -- Clean the name to remove microchips and garbage
    v_clean_name := sot.clean_cat_name(p_name);
    IF v_clean_name IS NULL OR v_clean_name = '' THEN
        v_clean_name := 'Unknown';
    END IF;

    -- Find existing cat by clinichq_animal_id (check cat_identifiers first)
    SELECT c.cat_id, COALESCE(ci_mc.id_value, c.microchip)
    INTO v_cat_id, v_existing_microchip
    FROM sot.cat_identifiers ci
    JOIN sot.cats c ON c.cat_id = ci.cat_id
    LEFT JOIN sot.cat_identifiers ci_mc ON ci_mc.cat_id = c.cat_id AND ci_mc.id_type = 'microchip'
    WHERE ci.id_type = 'clinichq_animal_id'
      AND ci.id_value = v_clinichq_id
      AND c.merged_into_cat_id IS NULL
    LIMIT 1;

    -- FALLBACK: Also check cats.clinichq_animal_id directly
    IF v_cat_id IS NULL THEN
        SELECT c.cat_id, COALESCE(ci_mc.id_value, c.microchip)
        INTO v_cat_id, v_existing_microchip
        FROM sot.cats c
        LEFT JOIN sot.cat_identifiers ci_mc ON ci_mc.cat_id = c.cat_id AND ci_mc.id_type = 'microchip'
        WHERE c.clinichq_animal_id = v_clinichq_id
          AND c.merged_into_cat_id IS NULL
        LIMIT 1;

        -- If found via fallback, add the missing identifier
        IF v_cat_id IS NOT NULL THEN
            INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system)
            VALUES (v_cat_id, 'clinichq_animal_id', v_clinichq_id, 1.0, p_source_system)
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    IF v_cat_id IS NOT NULL THEN
        -- Update with new info (fill empty fields only)
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
            ownership_type = COALESCE(NULLIF(ownership_type, ''), p_ownership_type),
            source_system = p_source_system,
            updated_at = NOW()
        WHERE cat_id = v_cat_id;

        -- ============================================================
        -- NEW: Backfill microchip if cat had none but now has one
        -- ============================================================
        IF v_clean_microchip IS NOT NULL AND (v_existing_microchip IS NULL OR v_existing_microchip = '') THEN
            -- Add microchip to cat_identifiers
            INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system, created_at)
            VALUES (v_cat_id, 'microchip', v_clean_microchip, 1.0, p_source_system, NOW())
            ON CONFLICT (id_type, id_value) DO NOTHING;

            -- Also update sot.cats.microchip for backwards compat
            UPDATE sot.cats SET
                microchip = v_clean_microchip,
                updated_at = NOW()
            WHERE cat_id = v_cat_id
              AND (microchip IS NULL OR microchip = '');

            -- Log the backfill for visibility
            RAISE NOTICE 'Backfilled microchip % for cat % (clinichq_id: %)',
                v_clean_microchip, v_cat_id, v_clinichq_id;
        END IF;

        RETURN v_cat_id;
    END IF;

    -- Create new cat (with or without microchip)
    INSERT INTO sot.cats (
        name, microchip, sex, breed, color,
        clinichq_animal_id,
        ownership_type,
        source_system
    ) VALUES (
        v_clean_name,
        v_clean_microchip,  -- May be NULL
        p_sex, p_breed, p_color,
        v_clinichq_id,
        p_ownership_type,
        p_source_system
    )
    RETURNING cat_id INTO v_cat_id;

    -- Create clinichq_animal_id identifier
    INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system)
    VALUES (v_cat_id, 'clinichq_animal_id', v_clinichq_id, 1.0, 'clinichq')
    ON CONFLICT DO NOTHING;

    -- Create microchip identifier if provided
    IF v_clean_microchip IS NOT NULL THEN
        INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system)
        VALUES (v_cat_id, 'microchip', v_clean_microchip, 1.0, 'clinichq')
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_cat_id;
END;
$$;

COMMENT ON FUNCTION sot.find_or_create_cat_by_clinichq_id IS
'Find or create cat by ClinicHQ Animal ID. Now also accepts microchip parameter
to backfill chips on cats that returned and got chipped after initial visit.';

-- ==============================================================================
-- 2. Monitoring view: Cats seen recently without microchips
-- ==============================================================================

CREATE OR REPLACE VIEW ops.v_cats_awaiting_microchip AS
SELECT
    c.cat_id,
    c.name,
    c.sex,
    c.breed,
    c.ownership_type,
    c.clinichq_animal_id,
    a.appointment_date AS last_seen,
    a.appointment_number,
    p.display_name AS owner_name,
    pl.formatted_address AS place_address,
    -- Days since last seen
    CURRENT_DATE - a.appointment_date AS days_since_seen
FROM sot.cats c
JOIN ops.appointments a ON a.cat_id = c.cat_id
LEFT JOIN sot.people p ON p.person_id = a.person_id AND p.merged_into_person_id IS NULL
LEFT JOIN sot.places pl ON pl.place_id = COALESCE(a.inferred_place_id, a.place_id) AND pl.merged_into_place_id IS NULL
LEFT JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
WHERE c.merged_into_cat_id IS NULL
  AND c.microchip IS NULL
  AND ci.id_value IS NULL  -- No microchip in identifiers either
  -- Only cats seen in last 90 days (likely to return)
  AND a.appointment_date >= CURRENT_DATE - INTERVAL '90 days'
  -- Exclude cats that are known deceased
  AND COALESCE(c.is_deceased, FALSE) = FALSE
ORDER BY a.appointment_date DESC;

COMMENT ON VIEW ops.v_cats_awaiting_microchip IS
'Cats seen at clinic in last 90 days that have no microchip.
These cats may return and get chipped - use this to track follow-ups.';

-- ==============================================================================
-- 3. Function to manually backfill microchip for a known cat
-- ==============================================================================

CREATE OR REPLACE FUNCTION sot.backfill_microchip(
    p_cat_id UUID,
    p_microchip TEXT,
    p_source_system TEXT DEFAULT 'atlas_ui'
)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
    v_existing_microchip TEXT;
    v_clean_microchip TEXT;
BEGIN
    -- Validate microchip format
    v_clean_microchip := TRIM(p_microchip);
    IF v_clean_microchip IS NULL OR v_clean_microchip !~ '^[0-9]{15}$' THEN
        RAISE EXCEPTION 'Invalid microchip format: must be 15 digits';
    END IF;

    -- Check if cat exists and has no microchip
    SELECT COALESCE(ci.id_value, c.microchip)
    INTO v_existing_microchip
    FROM sot.cats c
    LEFT JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
    WHERE c.cat_id = p_cat_id
      AND c.merged_into_cat_id IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cat not found: %', p_cat_id;
    END IF;

    IF v_existing_microchip IS NOT NULL AND v_existing_microchip != '' THEN
        RAISE EXCEPTION 'Cat already has microchip: %', v_existing_microchip;
    END IF;

    -- Add microchip
    INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system, created_at)
    VALUES (p_cat_id, 'microchip', v_clean_microchip, 1.0, p_source_system, NOW())
    ON CONFLICT (id_type, id_value) DO NOTHING;

    UPDATE sot.cats SET
        microchip = v_clean_microchip,
        updated_at = NOW()
    WHERE cat_id = p_cat_id;

    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION sot.backfill_microchip IS
'Manually add microchip to an existing cat that previously had none.
Use for cases where cat returned and got chipped.';
