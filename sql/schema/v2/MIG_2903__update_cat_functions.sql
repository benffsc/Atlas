-- MIG_2903: Add p_secondary_color to find_or_create_cat_by_microchip (FFS-421)
--
-- Problem: cat_info extraction already reads Secondary Color from CSV, but
-- find_or_create_cat_by_microchip has no parameter for it. The value is
-- extracted in the CTE but never passed through to sot.cats.
--
-- Solution: Add p_secondary_color TEXT DEFAULT NULL parameter.
-- On INSERT: set secondary_color. On UPDATE: COALESCE (don't overwrite existing).

CREATE OR REPLACE FUNCTION sot.find_or_create_cat_by_microchip(
    p_microchip TEXT,
    p_name TEXT DEFAULT NULL,
    p_sex TEXT DEFAULT NULL,
    p_breed TEXT DEFAULT NULL,
    p_altered_status TEXT DEFAULT NULL,
    p_color TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'clinichq',
    p_clinichq_animal_id TEXT DEFAULT NULL,
    p_ownership_type TEXT DEFAULT NULL,
    p_secondary_color TEXT DEFAULT NULL  -- NEW: MIG_2903
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
            secondary_color = COALESCE(NULLIF(secondary_color, ''), p_secondary_color),  -- MIG_2903
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

    -- Step 2: Check by clinichq_animal_id before creating new cat (MIG_2340)
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
                secondary_color = COALESCE(NULLIF(secondary_color, ''), p_secondary_color),  -- MIG_2903
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
        secondary_color,  -- MIG_2903
        clinichq_animal_id,
        ownership_type,
        source_system
    ) VALUES (
        v_clean_name,
        v_microchip,
        p_sex, p_breed, p_color,
        NULLIF(TRIM(p_secondary_color), ''),  -- MIG_2903
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
'V2 MIG_2903: Find or create a cat by microchip number.
Now passes secondary_color through to sot.cats (INSERT and COALESCE on UPDATE).
Also checks clinichq_animal_id as fallback to prevent duplicates (MIG_2340).';
