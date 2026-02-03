\echo '=== MIG_865: Fix find_or_create_cat_by_microchip Empty-String + Name Bugs ==='
\echo 'Fixes DQ_CLINIC_001c/e: Colors/breed not overwriting empty strings,'
\echo 'and display_name "Unknown" not replaced by real name from ClinicHQ.'
\echo ''
\echo 'Root cause: find_or_create_cat_by_microchip (MIG_576) uses inline'
\echo 'COALESCE(field, p_field) — but COALESCE treats empty string as non-NULL.'
\echo 'Also: display_name regex only matched "Unknown(" not plain "Unknown".'
\echo ''

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
DECLARE
    v_cat_id UUID;
    v_microchip TEXT;
    v_clean_name TEXT;
BEGIN
    v_microchip := TRIM(p_microchip);

    IF v_microchip IS NULL OR LENGTH(v_microchip) < 9 THEN
        RETURN NULL;
    END IF;

    -- Clean the name to remove microchips and garbage
    v_clean_name := trapper.clean_cat_name(p_name);
    IF v_clean_name IS NULL OR v_clean_name = '' THEN
        v_clean_name := 'Unknown';
    END IF;

    -- Find existing cat by microchip
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    WHERE ci.id_type = 'microchip' AND ci.id_value = v_microchip;

    IF v_cat_id IS NOT NULL THEN
        -- Update with new info
        -- MIG_865 FIX 1: Use NULLIF to treat empty strings as NULL so COALESCE falls through
        -- MIG_865 FIX 2: Match plain 'Unknown' in display_name (not just 'Unknown(')
        UPDATE trapper.sot_cats SET
            display_name = CASE
                WHEN display_name ~ '[0-9]{9,}'
                  OR display_name ~* '^unknown\s*\('
                  OR display_name = 'Unknown'
                THEN v_clean_name
                ELSE COALESCE(NULLIF(display_name, ''), v_clean_name)
            END,
            sex = COALESCE(NULLIF(sex, ''), p_sex),
            breed = COALESCE(NULLIF(breed, ''), p_breed),
            altered_status = COALESCE(NULLIF(altered_status, ''), p_altered_status),
            primary_color = COALESCE(NULLIF(primary_color, ''), p_primary_color),
            secondary_color = COALESCE(NULLIF(secondary_color, ''), p_secondary_color),
            ownership_type = COALESCE(NULLIF(ownership_type, ''), p_ownership_type),
            data_source = 'clinichq',
            updated_at = NOW()
        WHERE cat_id = v_cat_id;

        RETURN v_cat_id;
    END IF;

    -- Create new cat with clean name
    INSERT INTO trapper.sot_cats (
        display_name, sex, breed, altered_status,
        primary_color, secondary_color, ownership_type,
        data_source, needs_microchip
    ) VALUES (
        v_clean_name,
        p_sex, p_breed, p_altered_status,
        p_primary_color, p_secondary_color, p_ownership_type,
        'clinichq', FALSE
    )
    RETURNING cat_id INTO v_cat_id;

    -- Create microchip identifier
    INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
    VALUES (v_cat_id, 'microchip', v_microchip, p_source_system, 'unified_rebuild');

    RETURN v_cat_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_cat_by_microchip IS
'MIG_865: Find or create a cat by microchip number.
Fixes:
1. COALESCE empty-string bug: NULLIF(field, '''') ensures empty strings are treated as NULL
   so incoming data from ClinicHQ can overwrite placeholder values.
2. display_name "Unknown" match: Added OR display_name = ''Unknown'' so plain Unknown
   names get replaced by real names from clinic data.

Fields affected: primary_color, secondary_color, breed, sex, altered_status, display_name.';

\echo ''
\echo '=== MIG_865 Complete ==='
\echo ''
\echo 'Changes to find_or_create_cat_by_microchip:'
\echo '  1. All field updates: COALESCE(field, p_field) → COALESCE(NULLIF(field, ''''), p_field)'
\echo '  2. display_name: Added OR display_name = ''Unknown'' to replacement check'
\echo ''
\echo 'After running this migration, re-backfill affected cats:'
\echo '  -- Reset processed_at so they get reprocessed'
\echo '  UPDATE trapper.staged_records SET processed_at = NULL'
\echo '  WHERE source_system = ''clinichq'' AND source_table = ''cat_info'''
\echo '  AND is_processed = TRUE;'
\echo '  -- Then re-run'
\echo '  SELECT * FROM trapper.process_clinichq_cat_info(5000);'
