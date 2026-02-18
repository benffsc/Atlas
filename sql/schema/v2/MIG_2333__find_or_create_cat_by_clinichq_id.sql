-- MIG_2333__find_or_create_cat_by_clinichq_id.sql
-- Create function to find or create cats by ClinicHQ Animal ID (for cats without microchip)
--
-- Problem: find_or_create_cat_by_microchip returns NULL for invalid microchips
-- Solution: For cats without microchip, use clinichq_animal_id as the primary identifier

CREATE OR REPLACE FUNCTION sot.find_or_create_cat_by_clinichq_id(
    p_clinichq_animal_id TEXT,
    p_name TEXT DEFAULT NULL,
    p_sex TEXT DEFAULT NULL,
    p_breed TEXT DEFAULT NULL,
    p_altered_status TEXT DEFAULT NULL,
    p_color TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'clinichq',
    p_ownership_type TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
    v_cat_id UUID;
    v_clean_name TEXT;
    v_clinichq_id TEXT;
BEGIN
    -- Validate clinichq_animal_id
    v_clinichq_id := TRIM(p_clinichq_animal_id);
    IF v_clinichq_id IS NULL OR v_clinichq_id = '' THEN
        RETURN NULL;
    END IF;

    -- Clean the name to remove microchips and garbage
    v_clean_name := sot.clean_cat_name(p_name);
    IF v_clean_name IS NULL OR v_clean_name = '' THEN
        v_clean_name := 'Unknown';
    END IF;

    -- Find existing cat by clinichq_animal_id (check cat_identifiers first)
    SELECT c.cat_id INTO v_cat_id
    FROM sot.cat_identifiers ci
    JOIN sot.cats c ON c.cat_id = ci.cat_id
    WHERE ci.id_type = 'clinichq_animal_id'
      AND ci.id_value = v_clinichq_id
      AND c.merged_into_cat_id IS NULL
    LIMIT 1;

    -- FALLBACK: Also check cats.clinichq_animal_id directly
    IF v_cat_id IS NULL THEN
        SELECT c.cat_id INTO v_cat_id
        FROM sot.cats c
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

        RETURN v_cat_id;
    END IF;

    -- Create new cat without microchip
    INSERT INTO sot.cats (
        name, microchip, sex, breed, color,
        clinichq_animal_id,
        ownership_type,
        source_system
    ) VALUES (
        v_clean_name,
        NULL,  -- No microchip
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

    RETURN v_cat_id;
END;
$$;

COMMENT ON FUNCTION sot.find_or_create_cat_by_clinichq_id IS
'Find or create cat by ClinicHQ Animal ID (for cats without microchip).
Uses clinichq_animal_id as primary identifier. Creates cat_identifiers entry for lookup.';
