-- MIG_3010: Fix compute_place_disease_status to clear stale disease records
--
-- BUG: The function only UPSERTS disease records for diseases it finds in current
-- test results. When cats are unlinked from a place or their test results removed,
-- the old disease_status records remain as false positives.
--
-- FIX: After computing current disease status, mark any previously-computed records
-- (evidence_source = 'computed') that no longer have backing test data as 'cleared'.
-- Manual overrides (perpetual, false_flag, cleared) are never touched.
--
-- Impact: 20 places had stale disease flags (45 records). Already cleaned up via
-- direct UPDATE. This migration prevents future recurrence.

CREATE OR REPLACE FUNCTION ops.compute_place_disease_status(p_place_id UUID DEFAULT NULL)
RETURNS TABLE(out_place_id UUID, diseases_updated INT)
LANGUAGE plpgsql AS $function$
DECLARE
    v_place_rec RECORD;
    v_disease_rec RECORD;
    v_updated INT := 0;
    v_total_updated INT := 0;
    v_residential_types TEXT[];
    v_found_disease_keys TEXT[];
BEGIN
    -- V2: Get residential relationship types
    v_residential_types := sot.get_residential_relationship_types();

    -- ========================================================================
    -- Iterate through places (with V2 GATED CHECK)
    -- ========================================================================
    FOR v_place_rec IN
        SELECT p.place_id
        FROM sot.places p
        WHERE p.merged_into_place_id IS NULL
          AND (p_place_id IS NULL OR p.place_id = p_place_id)
          -- V2 GATED CHECK: Skip clinic/shelter/blacklisted places
          AND sot.should_compute_disease_for_place(p.place_id)
    LOOP
        v_updated := 0;
        v_found_disease_keys := ARRAY[]::TEXT[];

        -- ====================================================================
        -- Aggregate test results for RESIDENT cats at this place
        -- V2: Only use residential relationship types
        -- ====================================================================
        FOR v_disease_rec IN
            WITH place_cats AS (
                -- V2 BOUNDED LINKING: Only residential relationships
                SELECT DISTINCT cp.cat_id
                FROM sot.cat_place cp
                JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
                WHERE cp.place_id = v_place_rec.place_id
                  AND cp.relationship_type = ANY(v_residential_types)  -- V2 FIX
            ),
            place_test_results AS (
                -- Get test results for those cats
                SELECT
                    tr.test_type,
                    tr.result,
                    tr.test_date,
                    tr.cat_id
                FROM ops.cat_test_results tr
                JOIN place_cats pc ON pc.cat_id = tr.cat_id
            ),
            disease_summary AS (
                -- Aggregate by disease type
                SELECT
                    CASE
                        WHEN test_type IN ('felv', 'felv_fiv_combo') THEN 'felv'
                        WHEN test_type = 'fiv' THEN 'fiv'
                        WHEN test_type = 'felv_fiv_combo' THEN 'fiv'
                        ELSE test_type
                    END as disease_key,
                    COUNT(*) FILTER (WHERE result = 'positive') as positive_count,
                    COUNT(*) as total_tested,
                    MIN(test_date) FILTER (WHERE result = 'positive') as first_positive,
                    MAX(test_date) FILTER (WHERE result = 'positive') as last_positive
                FROM place_test_results
                GROUP BY 1
            )
            SELECT
                ds.disease_key,
                ds.positive_count,
                ds.total_tested,
                ds.first_positive,
                ds.last_positive,
                dt.decay_window_months
            FROM disease_summary ds
            JOIN ops.disease_types dt ON dt.disease_key = ds.disease_key
            WHERE ds.positive_count > 0
        LOOP
            -- Track which diseases we found
            v_found_disease_keys := array_append(v_found_disease_keys, v_disease_rec.disease_key);

            -- Compute status based on decay window
            INSERT INTO ops.place_disease_status (
                place_id,
                disease_type_key,
                status,
                evidence_source,
                first_positive_date,
                last_positive_date,
                positive_cat_count,
                total_tested_count,
                set_at
            )
            VALUES (
                v_place_rec.place_id,
                v_disease_rec.disease_key,
                CASE
                    WHEN v_disease_rec.last_positive >= CURRENT_DATE - (v_disease_rec.decay_window_months * INTERVAL '1 month')
                    THEN 'confirmed_active'
                    ELSE 'historical'
                END,
                'computed',
                v_disease_rec.first_positive,
                v_disease_rec.last_positive,
                v_disease_rec.positive_count,
                v_disease_rec.total_tested,
                NOW()
            )
            ON CONFLICT (place_id, disease_type_key)
            DO UPDATE SET
                -- Don't overwrite manual overrides
                status = CASE
                    WHEN ops.place_disease_status.evidence_source IN ('manual')
                         AND ops.place_disease_status.status IN ('perpetual', 'false_flag', 'cleared')
                    THEN ops.place_disease_status.status
                    WHEN EXCLUDED.last_positive_date >= CURRENT_DATE - (v_disease_rec.decay_window_months * INTERVAL '1 month')
                    THEN 'confirmed_active'
                    ELSE 'historical'
                END,
                last_positive_date = GREATEST(ops.place_disease_status.last_positive_date, EXCLUDED.last_positive_date),
                first_positive_date = LEAST(ops.place_disease_status.first_positive_date, EXCLUDED.first_positive_date),
                positive_cat_count = EXCLUDED.positive_cat_count,
                total_tested_count = EXCLUDED.total_tested_count,
                updated_at = NOW();

            v_updated := v_updated + 1;
        END LOOP;

        -- ====================================================================
        -- MIG_3010 FIX: Clear stale computed records that no longer have
        -- backing test data. Only affects 'computed' evidence_source records —
        -- manual overrides (perpetual, false_flag, cleared) are never touched.
        -- ====================================================================
        UPDATE ops.place_disease_status
        SET status = 'cleared',
            notes = COALESCE(notes, '') || ' [auto-cleared: no current positive tests]',
            set_by = 'system',
            set_at = NOW(),
            updated_at = NOW()
        WHERE place_id = v_place_rec.place_id
          AND evidence_source = 'computed'
          AND status NOT IN ('false_flag', 'cleared', 'perpetual')
          AND (array_length(v_found_disease_keys, 1) IS NULL
               OR disease_type_key != ALL(v_found_disease_keys));

        IF v_updated > 0 THEN
            v_total_updated := v_total_updated + v_updated;
            out_place_id := v_place_rec.place_id;
            diseases_updated := v_updated;
            RETURN NEXT;
        END IF;
    END LOOP;

    RETURN;
END;
$function$;

-- Verify: recompute for formerly-stale place should now properly clear
-- SELECT * FROM ops.compute_place_disease_status('ee60e843-dfbe-4aef-a887-0a128a276a0d'::uuid);
