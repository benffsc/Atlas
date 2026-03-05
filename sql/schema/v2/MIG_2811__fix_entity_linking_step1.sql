-- MIG_2811: Fix Entity Linking Step 1 — Override Wrong Placements
--
-- Problem (FFS-135, FFS-136):
-- 1. link_appointments_to_places() Step 1 has WHERE inferred_place_id IS NULL,
--    so it skips 38,908 appointments that were pre-linked during V1 migration.
--    Result: Step 1 processes 0 appointments.
-- 2. ops.infer_appointment_places() called by the ingest route doesn't exist in V2.
--    Result: every upload silently fails to infer places.
--
-- Solution:
-- 1. Step 1 now processes ALL appointments with owner_address (can override wrong links)
-- 2. Step 2 (person-chain fallback) keeps WHERE inferred_place_id IS NULL
-- 3. Re-run entity linking after fix
--
-- Created: 2026-03-04

\echo ''
\echo '=============================================='
\echo '  MIG_2811: Fix Entity Linking Step 1'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Pre-check: Current state
-- ============================================================================

\echo '1. Pre-check: Current appointment place linking state...'

SELECT
    COUNT(*) as total_appointments,
    COUNT(*) FILTER (WHERE inferred_place_id IS NOT NULL) as with_inferred_place,
    COUNT(*) FILTER (WHERE inferred_place_id IS NULL AND owner_address IS NOT NULL
                     AND TRIM(owner_address) != '' AND LENGTH(TRIM(owner_address)) > 10) as null_with_address,
    COUNT(*) FILTER (WHERE inferred_place_id IS NULL AND resolved_person_id IS NOT NULL) as null_with_person
FROM ops.appointments;

-- ============================================================================
-- 2. Override link_appointments_to_places() — Step 1 processes ALL appointments
-- ============================================================================

\echo ''
\echo '2. Overriding sot.link_appointments_to_places()...'

CREATE OR REPLACE FUNCTION sot.link_appointments_to_places()
RETURNS TABLE(
    source TEXT,
    appointments_linked INT,
    appointments_unmatched INT
) AS $$
DECLARE
    v_linked INT;
    v_overridden INT;
    v_unmatched INT;
BEGIN
    -- STEP 1: Link via normalized owner address (ALWAYS processes, can override)
    -- MIG_2811: Removed WHERE inferred_place_id IS NULL so Step 1 can fix
    -- appointments that were linked to wrong places (e.g., via person-chain fallback
    -- in V1 migration when address-based match is more accurate).
    WITH address_matches AS (
        SELECT
            a.appointment_id,
            pl.place_id AS matched_place_id,
            a.inferred_place_id AS current_place_id,
            ROW_NUMBER() OVER (
                PARTITION BY a.appointment_id
                ORDER BY pl.created_at ASC  -- prefer oldest (canonical) place
            ) as rn
        FROM ops.appointments a
        JOIN sot.places pl ON pl.normalized_address = sot.normalize_address(a.owner_address)
            AND pl.merged_into_place_id IS NULL
        WHERE a.owner_address IS NOT NULL
          AND TRIM(a.owner_address) != ''
          AND LENGTH(TRIM(a.owner_address)) > 10
          -- Only process if: no inferred_place_id, OR inferred_place_id doesn't match address
          AND (a.inferred_place_id IS NULL
               OR a.inferred_place_id != pl.place_id)
    ),
    updates AS (
        UPDATE ops.appointments a
        SET
            inferred_place_id = m.matched_place_id,
            resolution_status = 'auto_linked'
        FROM address_matches m
        WHERE a.appointment_id = m.appointment_id
          AND m.rn = 1
        RETURNING a.appointment_id,
                  m.current_place_id  -- non-null means we overrode an existing link
    )
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE current_place_id IS NOT NULL)
    INTO v_linked, v_overridden
    FROM updates;

    -- Count unmatched (appointments with address but no place match)
    SELECT COUNT(*) INTO v_unmatched
    FROM ops.appointments
    WHERE inferred_place_id IS NULL
      AND owner_address IS NOT NULL
      AND TRIM(owner_address) != ''
      AND LENGTH(TRIM(owner_address)) > 10;

    IF v_overridden > 0 THEN
        RAISE NOTICE 'Step 1: % appointments linked (% overridden from wrong place)', v_linked, v_overridden;
    END IF;

    source := 'owner_address';
    appointments_linked := v_linked;
    appointments_unmatched := v_unmatched;
    RETURN NEXT;

    -- STEP 2: Link via resolved_person_id → person_place chain (FALLBACK only)
    -- Keeps WHERE inferred_place_id IS NULL — only runs for appointments Step 1 couldn't resolve
    WITH person_place_matches AS (
        SELECT
            a.appointment_id,
            pp.place_id,
            ROW_NUMBER() OVER (
                PARTITION BY a.appointment_id
                ORDER BY pp.confidence DESC, pp.created_at DESC
            ) as rn
        FROM ops.appointments a
        JOIN sot.person_place pp ON pp.person_id = a.resolved_person_id
        JOIN sot.places pl ON pl.place_id = pp.place_id
            AND pl.merged_into_place_id IS NULL
        WHERE a.inferred_place_id IS NULL
          AND a.resolved_person_id IS NOT NULL
    ),
    updates AS (
        UPDATE ops.appointments a
        SET
            inferred_place_id = m.place_id,
            resolution_status = 'auto_linked'
        FROM person_place_matches m
        WHERE a.appointment_id = m.appointment_id
          AND m.rn = 1
        RETURNING a.appointment_id
    )
    SELECT COUNT(*) INTO v_linked FROM updates;

    -- Count remaining unmatched
    SELECT COUNT(*) INTO v_unmatched
    FROM ops.appointments
    WHERE inferred_place_id IS NULL
      AND resolved_person_id IS NOT NULL;

    source := 'person_place';
    appointments_linked := v_linked;
    appointments_unmatched := v_unmatched;
    RETURN NEXT;

    IF v_unmatched > 100 THEN
        RAISE NOTICE 'link_appointments_to_places: % appointments with resolved_person_id could not be matched', v_unmatched;
    END IF;

    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.link_appointments_to_places IS
'V2/MIG_2811: Links appointments to places via owner_address or person_place chain.
Sets inferred_place_id on ops.appointments.
Step 1 (owner_address): Processes ALL appointments — can override wrong links from V1 migration.
Step 2 (person_place): Fallback for appointments Step 1 could not resolve.
Returns linked count AND unmatched count for monitoring.';

\echo '   Updated sot.link_appointments_to_places()'

-- ============================================================================
-- 3. Re-run entity linking with the fixed Step 1
-- ============================================================================

\echo ''
\echo '3. Re-running full entity linking pipeline...'

SELECT * FROM sot.run_all_entity_linking();

-- ============================================================================
-- 4. Post-check: Verify improvement
-- ============================================================================

\echo ''
\echo '4. Post-check: Verifying results...'

SELECT
    COUNT(*) as total_appointments,
    COUNT(*) FILTER (WHERE inferred_place_id IS NOT NULL) as with_inferred_place,
    COUNT(*) FILTER (WHERE inferred_place_id IS NULL AND owner_address IS NOT NULL
                     AND TRIM(owner_address) != '' AND LENGTH(TRIM(owner_address)) > 10) as still_unmatched_with_address,
    ROUND(100.0 * COUNT(*) FILTER (WHERE inferred_place_id IS NOT NULL) / NULLIF(COUNT(*), 0), 1) as coverage_pct
FROM ops.appointments;

\echo ''
\echo 'Latest entity linking run result:'
SELECT result->>'step1_owner_address_linked' as step1_linked,
       result->>'step1_owner_address_unmatched' as step1_unmatched,
       result->>'step1_coverage_pct' as coverage_pct
FROM ops.entity_linking_runs ORDER BY created_at DESC LIMIT 1;

-- ============================================================================
-- 5. Health check
-- ============================================================================

\echo ''
\echo '5. Entity linking health check...'

SELECT * FROM ops.check_entity_linking_health();

\echo ''
\echo '=============================================='
\echo '  MIG_2811 Complete'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  1. Step 1 now processes ALL appointments (can override wrong placements)'
\echo '  2. Step 2 is fallback only (WHERE inferred_place_id IS NULL)'
\echo '  3. Re-ran entity linking pipeline'
\echo ''
