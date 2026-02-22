-- MIG_2431: Fix Silent NULL Updates in Appointment Place Linking
--
-- Problem: link_appointments_to_places() uses UPDATE with subquery that can return NULL.
--          When the subquery finds no match, place_id stays NULL but no error is raised.
--          This causes appointments to silently lose their place links.
--
-- Solution: Use explicit CTE + JOIN pattern instead of subquery UPDATE.
--           This ensures only appointments with valid place matches are updated.
--
-- @see DATA_GAP_040
-- @see docs/ENTITY_LINKING_FORTIFICATION_PLAN.md
--
-- Created: 2026-02-21

\echo ''
\echo '=============================================='
\echo '  MIG_2431: Fix Silent NULL Updates'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. FIX link_appointments_to_places() - USE EXPLICIT JOINS
-- ============================================================================

\echo '1. Fixing sot.link_appointments_to_places()...'

CREATE OR REPLACE FUNCTION sot.link_appointments_to_places()
RETURNS TABLE(
    source TEXT,
    appointments_linked INT,
    appointments_unmatched INT
) AS $$
DECLARE
    v_linked INT;
    v_unmatched INT;
BEGIN
    -- STEP 1: Link via normalized owner address
    -- Uses CTE + JOIN pattern to prevent NULL updates (MIG_2431 fix)
    WITH address_matches AS (
        SELECT
            a.appointment_id,
            pl.place_id,
            ROW_NUMBER() OVER (
                PARTITION BY a.appointment_id
                ORDER BY pl.created_at DESC  -- prefer most recently created place on tie
            ) as rn
        FROM ops.appointments a
        JOIN sot.places pl ON pl.normalized_address = sot.normalize_address(a.owner_address)
        WHERE a.inferred_place_id IS NULL
          AND a.owner_address IS NOT NULL
          AND TRIM(a.owner_address) != ''
          AND LENGTH(TRIM(a.owner_address)) > 10
          AND pl.merged_into_place_id IS NULL
    ),
    updates AS (
        UPDATE ops.appointments a
        SET
            inferred_place_id = m.place_id,
            resolution_status = 'auto_linked'
        FROM address_matches m
        WHERE a.appointment_id = m.appointment_id
          AND m.rn = 1
        RETURNING a.appointment_id
    )
    SELECT COUNT(*) INTO v_linked FROM updates;

    -- Count unmatched for monitoring
    SELECT COUNT(*) INTO v_unmatched
    FROM ops.appointments
    WHERE inferred_place_id IS NULL
      AND owner_address IS NOT NULL
      AND TRIM(owner_address) != ''
      AND LENGTH(TRIM(owner_address)) > 10;

    source := 'owner_address';
    appointments_linked := v_linked;
    appointments_unmatched := v_unmatched;
    RETURN NEXT;

    -- STEP 2: Link via resolved_person_id → person_place chain
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

    -- Log warning if significant unmatched count
    IF v_unmatched > 100 THEN
        RAISE NOTICE 'link_appointments_to_places: % appointments with resolved_person_id could not be matched', v_unmatched;
    END IF;

    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.link_appointments_to_places IS
'V2/MIG_2431: Links appointments to places via owner_address or person_place chain.
Sets inferred_place_id on ops.appointments.
FIX: Uses CTE + JOIN pattern instead of subquery UPDATE to prevent silent NULL writes.
Priority: 1. normalized_address match, 2. person_place (best confidence)
Returns linked count AND unmatched count for monitoring.';

\echo '   Fixed sot.link_appointments_to_places()'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Current appointment linking status:'
SELECT
    COUNT(*) as total_appointments,
    COUNT(*) FILTER (WHERE inferred_place_id IS NOT NULL) as with_inferred_place,
    COUNT(*) FILTER (WHERE place_id IS NOT NULL) as with_clinic_place,
    COUNT(*) FILTER (WHERE inferred_place_id IS NULL AND owner_address IS NOT NULL) as unmatched_with_address,
    COUNT(*) FILTER (WHERE inferred_place_id IS NULL AND resolved_person_id IS NOT NULL) as unmatched_with_person
FROM ops.appointments;

\echo ''
\echo 'Testing link_appointments_to_places()...'
SELECT * FROM sot.link_appointments_to_places();

\echo ''
\echo '=============================================='
\echo '  MIG_2431 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  - Replaced subquery UPDATE with CTE + JOIN pattern'
\echo '  - Appointments now only updated when valid place match exists'
\echo '  - Returns unmatched count for monitoring'
\echo '  - Logs warning when > 100 appointments unmatched'
\echo ''
