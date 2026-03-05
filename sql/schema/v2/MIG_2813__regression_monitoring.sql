-- MIG_2813: Data quality regression monitoring
--
-- Extends ops.check_entity_linking_health() with 3 new checks that would have
-- caught FFS-134–137 (duplicate places, unpropagated matches, mislinked appointments).
--
-- Keeps all 5 existing checks from MIG_2435, adds:
--   6. duplicate_places — normalized_address groups with >1 active place
--   7. unpropagated_matches — clinic_day_entries matched but not propagated
--   8. mislinked_appointments — appointments where owner_address != inferred place address
--
-- Depends on: MIG_2435 (original function), MIG_2019 (normalized_address), MIG_2328 (clinic_day_entries)

DROP FUNCTION IF EXISTS ops.check_entity_linking_health();

CREATE OR REPLACE FUNCTION ops.check_entity_linking_health()
RETURNS TABLE(
    check_name TEXT,
    status TEXT,
    value INT,
    threshold INT,
    message TEXT
) AS $$
BEGIN
    -- Check 1: Clinic leakage (from MIG_2435)
    RETURN QUERY
    SELECT
        'clinic_leakage'::TEXT,
        CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'ALERT' END::TEXT,
        COUNT(*)::INT,
        0::INT,
        CASE WHEN COUNT(*) = 0 THEN 'No clinic leakage' ELSE 'Cats incorrectly linked to clinic addresses' END::TEXT
    FROM ops.v_clinic_leakage;

    -- Check 2: Cat-place coverage (from MIG_2435)
    RETURN QUERY
    SELECT
        'cat_place_coverage'::TEXT,
        CASE WHEN (SELECT place_coverage_pct FROM ops.v_cat_place_coverage) >= 80 THEN 'OK' ELSE 'WARNING' END::TEXT,
        (SELECT place_coverage_pct::INT FROM ops.v_cat_place_coverage),
        80::INT,
        'Cats with at least one place link'::TEXT;

    -- Check 3: Appointment place resolution (from MIG_2435)
    RETURN QUERY
    SELECT
        'appointment_place_resolution'::TEXT,
        CASE WHEN (SELECT inferred_place_pct FROM ops.v_appointment_place_resolution) >= 70 THEN 'OK' ELSE 'WARNING' END::TEXT,
        (SELECT inferred_place_pct::INT FROM ops.v_appointment_place_resolution),
        70::INT,
        'Appointments with inferred_place_id'::TEXT;

    -- Check 4: Recent skipped entities (from MIG_2435)
    RETURN QUERY
    SELECT
        'recent_skips'::TEXT,
        CASE WHEN COUNT(*) < 100 THEN 'OK' ELSE 'WARNING' END::TEXT,
        COUNT(*)::INT,
        100::INT,
        'Entities skipped in last 24 hours'::TEXT
    FROM ops.entity_linking_skipped
    WHERE created_at > NOW() - INTERVAL '1 day';

    -- Check 5: Last run status (from MIG_2435)
    RETURN QUERY
    SELECT
        'last_run_status'::TEXT,
        COALESCE((SELECT elr.status FROM ops.entity_linking_runs elr ORDER BY elr.created_at DESC LIMIT 1), 'never_run')::TEXT,
        COALESCE((SELECT (elr.result->>'cat_coverage_pct')::NUMERIC::INT FROM ops.entity_linking_runs elr ORDER BY elr.created_at DESC LIMIT 1), 0)::INT,
        0::INT,
        'Most recent entity linking run'::TEXT;

    -- Check 6: Duplicate places (NEW — FFS-141)
    -- Count normalized_address groups with >1 active place.
    -- The unique index should prevent this; any duplicates indicate a bug.
    RETURN QUERY
    SELECT
        'duplicate_places'::TEXT,
        CASE WHEN cnt = 0 THEN 'OK' ELSE 'ALERT' END::TEXT,
        cnt::INT,
        0::INT,
        CASE WHEN cnt = 0 THEN 'No duplicate places' ELSE cnt::TEXT || ' normalized addresses have multiple active places' END::TEXT
    FROM (
        SELECT COUNT(*)::INT AS cnt
        FROM (
            SELECT normalized_address
            FROM sot.places
            WHERE merged_into_place_id IS NULL
              AND normalized_address IS NOT NULL
            GROUP BY normalized_address
            HAVING COUNT(*) > 1
        ) dupes
    ) sub;

    -- Check 7: Unpropagated matches (NEW — FFS-141)
    -- Clinic day entries that were matched to an appointment but the link wasn't propagated.
    RETURN QUERY
    SELECT
        'unpropagated_matches'::TEXT,
        CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'ALERT' END::TEXT,
        COUNT(*)::INT,
        0::INT,
        CASE WHEN COUNT(*) = 0 THEN 'All matches propagated' ELSE COUNT(*)::TEXT || ' clinic day entries matched but not propagated' END::TEXT
    FROM ops.clinic_day_entries
    WHERE matched_appointment_id IS NOT NULL
      AND appointment_id IS NULL;

    -- Check 8: Mislinked appointments (NEW — FFS-141)
    -- Appointments where the owner_address doesn't match the inferred place's normalized address.
    -- Some noise is expected from address variants, so threshold is 50.
    RETURN QUERY
    SELECT
        'mislinked_appointments'::TEXT,
        CASE WHEN cnt <= 50 THEN 'OK' ELSE 'WARNING' END::TEXT,
        cnt::INT,
        50::INT,
        CASE WHEN cnt <= 50 THEN cnt::TEXT || ' mislinked (within tolerance)' ELSE cnt::TEXT || ' appointments where owner_address does not match inferred place' END::TEXT
    FROM (
        SELECT COUNT(*)::INT AS cnt
        FROM ops.appointments a
        JOIN sot.places p ON p.place_id = a.inferred_place_id
        WHERE a.inferred_place_id IS NOT NULL
          AND a.owner_address IS NOT NULL
          AND p.normalized_address IS NOT NULL
          AND p.merged_into_place_id IS NULL
          AND sot.normalize_address(a.owner_address) != p.normalized_address
    ) sub;

    RETURN;
END;
$$ LANGUAGE plpgsql;

-- Verify: run all 8 checks
-- SELECT * FROM ops.check_entity_linking_health();
