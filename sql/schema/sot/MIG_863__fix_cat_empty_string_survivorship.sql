\echo '=== MIG_863: Fix Cat Empty-String Survivorship Bug ==='
\echo 'Fixes DQ_CLINIC_001c: Colors not overwriting empty strings'
\echo ''
\echo 'Bug: update_cat_with_survivorship checked "IS NULL" for colors,'
\echo 'but cats created without color data get empty string, not NULL.'
\echo 'Empty string passes IS NULL check, so color is never filled.'
\echo ''

-- ============================================================================
-- FIX: update_cat_with_survivorship — treat empty strings as NULL for colors
-- ============================================================================

\echo 'Step 1: Recreating update_cat_with_survivorship with empty-string fix...'

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
    v_incoming_priority INT;
    v_current_priority INT;
BEGIN
    SELECT * INTO v_current
    FROM trapper.sot_cats
    WHERE cat_id = p_cat_id;

    IF v_current IS NULL THEN RETURN; END IF;

    -- Source priority: ClinicHQ > ShelterLuv > web_intake > atlas
    v_incoming_priority := CASE p_source_system
        WHEN 'clinichq' THEN 100
        WHEN 'shelterluv' THEN 80
        WHEN 'web_intake' THEN 60
        WHEN 'atlas' THEN 40
        ELSE 20
    END;

    v_current_priority := CASE v_current.source_system
        WHEN 'clinichq' THEN 100
        WHEN 'shelterluv' THEN 80
        WHEN 'web_intake' THEN 60
        WHEN 'atlas' THEN 40
        ELSE 20
    END;

    -- Name: ClinicHQ wins, or fill empty
    IF p_name IS NOT NULL AND LENGTH(TRIM(p_name)) > 0 THEN
        IF v_current.display_name IS NULL OR v_current.display_name = 'Unknown' OR v_incoming_priority >= v_current_priority THEN
            v_updates := v_updates || jsonb_build_object('display_name', p_name);
        END IF;
    END IF;

    -- Sex: ClinicHQ wins, or fill empty
    IF p_sex IS NOT NULL THEN
        IF v_current.sex IS NULL OR v_incoming_priority >= v_current_priority THEN
            v_updates := v_updates || jsonb_build_object('sex', LOWER(p_sex));
        END IF;
    END IF;

    -- Altered status: Critical for ecology - ClinicHQ is ground truth
    IF p_altered_status IS NOT NULL THEN
        IF v_current.altered_status IS NULL OR v_incoming_priority >= v_current_priority THEN
            v_updates := v_updates || jsonb_build_object('altered_status', LOWER(p_altered_status));
        END IF;
    END IF;

    -- Breed: ClinicHQ wins
    IF p_breed IS NOT NULL AND LENGTH(TRIM(p_breed)) > 0 THEN
        IF v_current.breed IS NULL OR v_incoming_priority >= v_current_priority THEN
            v_updates := v_updates || jsonb_build_object('breed', p_breed);
        END IF;
    END IF;

    -- Colors: Fill if empty
    -- MIG_863 FIX: Also treat empty string as NULL so colors get filled
    IF p_primary_color IS NOT NULL AND (v_current.primary_color IS NULL OR v_current.primary_color = '') THEN
        v_updates := v_updates || jsonb_build_object('primary_color', p_primary_color);
    END IF;

    IF p_secondary_color IS NOT NULL AND (v_current.secondary_color IS NULL OR v_current.secondary_color = '') THEN
        v_updates := v_updates || jsonb_build_object('secondary_color', p_secondary_color);
    END IF;

    -- Apply updates if any
    IF v_updates != '{}'::JSONB THEN
        UPDATE trapper.sot_cats
        SET display_name = COALESCE((v_updates->>'display_name'), display_name),
            sex = COALESCE((v_updates->>'sex'), sex),
            altered_status = COALESCE((v_updates->>'altered_status'), altered_status),
            breed = COALESCE((v_updates->>'breed'), breed),
            primary_color = COALESCE((v_updates->>'primary_color'), primary_color),
            secondary_color = COALESCE((v_updates->>'secondary_color'), secondary_color),
            ownership_type = COALESCE(p_ownership_type, ownership_type),
            source_system = CASE WHEN v_incoming_priority >= v_current_priority THEN p_source_system ELSE source_system END,
            updated_at = NOW()
        WHERE cat_id = p_cat_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.update_cat_with_survivorship IS
'MIG_863: Update cat record using survivorship rules with source priority.
Fix: Colors now overwrite empty strings (previously only overwrite NULL).

Source Priority (highest to lowest):
1. clinichq (100) - Verified clinic data
2. shelterluv (80) - Adoption system
3. web_intake (60) - Intake forms
4. atlas (40) - Manual entry
5. other (20) - Unknown sources

Rule: Higher priority source wins for name, sex, breed, altered_status.
Empty fields are always filled by any source.';

\echo 'update_cat_with_survivorship updated with empty-string fix'

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=== MIG_863 Complete ==='
\echo ''
\echo 'Changes:'
\echo '  - primary_color: IS NULL → (IS NULL OR = empty string)'
\echo '  - secondary_color: IS NULL → (IS NULL OR = empty string)'
\echo ''
\echo 'Resolves: DQ_CLINIC_001c'
\echo ''
\echo 'After running this migration, re-run process_clinichq_cat_info to backfill:'
\echo '  SELECT * FROM trapper.process_clinichq_cat_info(NULL, 5000);'
