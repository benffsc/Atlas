-- MIG_2812: Propagate Master List Matches
--
-- Problem (FFS-137): apply_smart_master_list_matches() writes to matched_appointment_id
-- but nothing copies the result to appointment_id. The import route has no propagation
-- step after matching. Result: 112 master list matches never linked to appointment_id/cat_id.
--
-- Solution:
-- 1. Create ops.propagate_master_list_matches(date) function
-- 2. Backfill all existing matched entries
--
-- Created: 2026-03-04

\echo ''
\echo '=============================================='
\echo '  MIG_2812: Propagate Master List Matches'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Pre-check: Count unpropagated matches
-- ============================================================================

\echo '1. Pre-check: Counting unpropagated matches...'

SELECT
    COUNT(*) as total_entries,
    COUNT(*) FILTER (WHERE matched_appointment_id IS NOT NULL) as with_matched,
    COUNT(*) FILTER (WHERE matched_appointment_id IS NOT NULL AND appointment_id IS NULL) as unpropagated,
    COUNT(*) FILTER (WHERE appointment_id IS NOT NULL) as with_appointment_id,
    COUNT(*) FILTER (WHERE cat_id IS NOT NULL) as with_cat_id
FROM ops.clinic_day_entries;

-- ============================================================================
-- 2. Create propagation function
-- ============================================================================

\echo ''
\echo '2. Creating ops.propagate_master_list_matches()...'

CREATE OR REPLACE FUNCTION ops.propagate_master_list_matches(p_date DATE)
RETURNS TABLE(propagated INT, cat_ids_linked INT) AS $$
DECLARE
    v_propagated INT;
    v_cat_ids INT;
BEGIN
    -- Copy matched_appointment_id → appointment_id for high/medium confidence
    WITH propagated AS (
        UPDATE ops.clinic_day_entries e
        SET appointment_id = e.matched_appointment_id
        FROM ops.clinic_days cd
        WHERE cd.clinic_day_id = e.clinic_day_id
          AND cd.clinic_date = p_date
          AND e.matched_appointment_id IS NOT NULL
          AND e.appointment_id IS NULL
          AND e.match_confidence IN ('high', 'medium')
        RETURNING e.entry_id
    )
    SELECT COUNT(*) INTO v_propagated FROM propagated;

    -- Link cat_id from matched appointment
    WITH cat_linked AS (
        UPDATE ops.clinic_day_entries e
        SET cat_id = a.cat_id
        FROM ops.appointments a
        WHERE a.appointment_id = e.appointment_id
          AND e.appointment_id IS NOT NULL
          AND e.cat_id IS NULL
          AND a.cat_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM ops.clinic_days cd
            WHERE cd.clinic_day_id = e.clinic_day_id AND cd.clinic_date = p_date
          )
        RETURNING e.entry_id
    )
    SELECT COUNT(*) INTO v_cat_ids FROM cat_linked;

    RETURN QUERY SELECT v_propagated, v_cat_ids;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.propagate_master_list_matches IS
'MIG_2812: Copies matched_appointment_id → appointment_id and links cat_id
for high/medium confidence master list matches on a given clinic date.
Called after apply_smart_master_list_matches() in the import route.';

\echo '   Created ops.propagate_master_list_matches()'

-- ============================================================================
-- 3. Backfill: Propagate all existing matched entries
-- ============================================================================

\echo ''
\echo '3. Backfilling all existing matched entries...'

DO $$
DECLARE
    v_date RECORD;
    v_total_propagated INT := 0;
    v_total_cat_ids INT := 0;
    v_result RECORD;
BEGIN
    FOR v_date IN
        SELECT DISTINCT cd.clinic_date
        FROM ops.clinic_days cd
        JOIN ops.clinic_day_entries e ON e.clinic_day_id = cd.clinic_day_id
        WHERE e.matched_appointment_id IS NOT NULL
          AND e.appointment_id IS NULL
        ORDER BY cd.clinic_date
    LOOP
        SELECT * INTO v_result FROM ops.propagate_master_list_matches(v_date.clinic_date);
        v_total_propagated := v_total_propagated + v_result.propagated;
        v_total_cat_ids := v_total_cat_ids + v_result.cat_ids_linked;
    END LOOP;

    RAISE NOTICE 'Backfill complete: % appointment_ids propagated, % cat_ids linked',
        v_total_propagated, v_total_cat_ids;
END;
$$;

-- ============================================================================
-- 4. Post-check: Verify propagation
-- ============================================================================

\echo ''
\echo '4. Post-check: Verifying propagation results...'

SELECT
    COUNT(*) as total_entries,
    COUNT(*) FILTER (WHERE matched_appointment_id IS NOT NULL) as with_matched,
    COUNT(*) FILTER (WHERE matched_appointment_id IS NOT NULL AND appointment_id IS NULL) as still_unpropagated,
    COUNT(*) FILTER (WHERE appointment_id IS NOT NULL) as with_appointment_id,
    COUNT(*) FILTER (WHERE cat_id IS NOT NULL) as with_cat_id
FROM ops.clinic_day_entries;

\echo ''
\echo '=============================================='
\echo '  MIG_2812 Complete'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  1. Created ops.propagate_master_list_matches(date) function'
\echo '  2. Backfilled all existing matched entries'
\echo ''
