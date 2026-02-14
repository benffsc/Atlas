-- MIG_250: Fix sync_cats_from_visits to Use Centralized Function
--
-- Problem: sync_cats_from_visits() does direct INSERT into sot_cats
-- instead of using find_or_create_cat_by_microchip()
--
-- This causes:
-- 1. Inconsistent cat creation (doesn't follow same patterns)
-- 2. Missing deduplication logic
-- 3. Different source_system handling
--
-- Fix: Update function to use find_or_create_cat_by_microchip()

\echo ''
\echo '=============================================='
\echo 'MIG_250: Fix sync_cats_from_visits Function'
\echo '=============================================='
\echo ''

CREATE OR REPLACE FUNCTION trapper.sync_cats_from_visits()
RETURNS TABLE(cats_created INT, cats_updated INT, identifiers_added INT) AS $$
DECLARE
    v_created INT := 0;
    v_updated INT := 0;
    v_idents INT := 0;
    v_rec RECORD;
    v_cat_id UUID;
    v_existed BOOLEAN;
BEGIN
    FOR v_rec IN
        SELECT
            v.microchip,
            (SELECT animal_name FROM trapper.clinichq_visits WHERE microchip = v.microchip ORDER BY visit_date DESC LIMIT 1) AS animal_name,
            (SELECT sex FROM trapper.clinichq_visits WHERE microchip = v.microchip AND sex IS NOT NULL ORDER BY visit_date DESC LIMIT 1) AS sex,
            (SELECT altered_status FROM trapper.clinichq_visits WHERE microchip = v.microchip AND altered_status IS NOT NULL ORDER BY visit_date DESC LIMIT 1) AS altered_status,
            (SELECT breed FROM trapper.clinichq_visits WHERE microchip = v.microchip AND breed IS NOT NULL ORDER BY visit_date DESC LIMIT 1) AS breed,
            (SELECT primary_color FROM trapper.clinichq_visits WHERE microchip = v.microchip AND primary_color IS NOT NULL ORDER BY visit_date DESC LIMIT 1) AS primary_color,
            (SELECT secondary_color FROM trapper.clinichq_visits WHERE microchip = v.microchip AND secondary_color IS NOT NULL ORDER BY visit_date DESC LIMIT 1) AS secondary_color,
            (SELECT ownership_type FROM trapper.clinichq_visits WHERE microchip = v.microchip AND ownership_type IS NOT NULL ORDER BY visit_date DESC LIMIT 1) AS ownership_type,
            EXISTS(SELECT 1 FROM trapper.clinichq_visits WHERE microchip = v.microchip AND (is_spay OR is_neuter)) AS altered_by_clinic
        FROM (SELECT DISTINCT microchip FROM trapper.clinichq_visits) v
    LOOP
        -- Check if cat already exists
        SELECT ci.cat_id INTO v_cat_id
        FROM trapper.cat_identifiers ci
        WHERE ci.id_type = 'microchip' AND ci.id_value = v_rec.microchip;

        v_existed := v_cat_id IS NOT NULL;

        -- Use centralized function for cat creation/update
        v_cat_id := trapper.find_or_create_cat_by_microchip(
            v_rec.microchip,
            v_rec.animal_name,
            v_rec.sex,
            v_rec.breed,
            v_rec.altered_status,
            v_rec.primary_color,
            v_rec.secondary_color,
            v_rec.ownership_type,
            'clinichq'  -- source_system
        );

        IF v_cat_id IS NOT NULL THEN
            -- Update altered_by_clinic flag (not handled by find_or_create_cat_by_microchip)
            IF v_rec.altered_by_clinic THEN
                UPDATE trapper.sot_cats
                SET altered_by_clinic = TRUE,
                    needs_microchip = FALSE
                WHERE cat_id = v_cat_id;
            END IF;

            IF v_existed THEN
                v_updated := v_updated + 1;
            ELSE
                v_created := v_created + 1;
                v_idents := v_idents + 1;  -- Identifier was added by find_or_create
            END IF;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_created, v_updated, v_idents;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.sync_cats_from_visits IS
'Syncs cats from clinichq_visits table to sot_cats.
Uses find_or_create_cat_by_microchip() for consistent cat creation.
Updates altered_by_clinic flag based on visit data.';

\echo ''
\echo '=== MIG_250 Complete ==='
\echo ''
\echo 'Changes:'
\echo '  - sync_cats_from_visits now uses find_or_create_cat_by_microchip()'
\echo '  - Consistent with other ingest patterns'
\echo '  - Still updates altered_by_clinic flag from visit data'
\echo ''
