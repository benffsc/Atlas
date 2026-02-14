-- ============================================================================
-- MIG_965: Organization Stats Triggers
-- ============================================================================
-- Creates triggers to maintain denormalized stats on the orgs table:
--   - appointments_count
--   - cats_count
--   - first_appointment_date
--   - last_appointment_date
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_965: Organization Stats Triggers'
\echo '=============================================='
\echo ''

-- ============================================================================
-- FUNCTION: update_org_stats
-- Updates denormalized stats when appointments are linked/unlinked
-- ============================================================================

\echo 'Creating update_org_stats function...'

CREATE OR REPLACE FUNCTION trapper.update_org_stats()
RETURNS TRIGGER AS $$
DECLARE
    v_org_id UUID;
BEGIN
    -- Determine which org_id to update
    IF TG_OP = 'DELETE' THEN
        v_org_id := OLD.org_id;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Update both old and new org_id if they're different
        IF OLD.org_id IS DISTINCT FROM NEW.org_id THEN
            -- Update old org stats
            IF OLD.org_id IS NOT NULL THEN
                UPDATE trapper.orgs
                SET
                    appointments_count = (
                        SELECT COUNT(*)
                        FROM trapper.sot_appointments
                        WHERE org_id = OLD.org_id
                    ),
                    cats_count = (
                        SELECT COUNT(DISTINCT cat_id)
                        FROM trapper.sot_appointments
                        WHERE org_id = OLD.org_id
                        AND cat_id IS NOT NULL
                    ),
                    first_appointment_date = (
                        SELECT MIN(appointment_date)
                        FROM trapper.sot_appointments
                        WHERE org_id = OLD.org_id
                    ),
                    last_appointment_date = (
                        SELECT MAX(appointment_date)
                        FROM trapper.sot_appointments
                        WHERE org_id = OLD.org_id
                    )
                WHERE id = OLD.org_id;
            END IF;
        END IF;
        v_org_id := NEW.org_id;
    ELSE
        v_org_id := NEW.org_id;
    END IF;

    -- Update the current/new org stats
    IF v_org_id IS NOT NULL THEN
        UPDATE trapper.orgs
        SET
            appointments_count = (
                SELECT COUNT(*)
                FROM trapper.sot_appointments
                WHERE org_id = v_org_id
            ),
            cats_count = (
                SELECT COUNT(DISTINCT cat_id)
                FROM trapper.sot_appointments
                WHERE org_id = v_org_id
                AND cat_id IS NOT NULL
            ),
            first_appointment_date = (
                SELECT MIN(appointment_date)
                FROM trapper.sot_appointments
                WHERE org_id = v_org_id
            ),
            last_appointment_date = (
                SELECT MAX(appointment_date)
                FROM trapper.sot_appointments
                WHERE org_id = v_org_id
            )
        WHERE id = v_org_id;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.update_org_stats IS
'Trigger function to maintain denormalized stats on the orgs table.
Updates counts when appointments are inserted, updated, or deleted.';

-- ============================================================================
-- TRIGGER: Update org stats on appointment changes
-- ============================================================================

\echo 'Creating trigger for appointment org stats...'

DROP TRIGGER IF EXISTS trg_update_org_stats ON trapper.sot_appointments;

CREATE TRIGGER trg_update_org_stats
    AFTER INSERT OR UPDATE OF org_id OR DELETE
    ON trapper.sot_appointments
    FOR EACH ROW
    EXECUTE FUNCTION trapper.update_org_stats();

COMMENT ON TRIGGER trg_update_org_stats ON trapper.sot_appointments IS
'Maintains denormalized stats on the orgs table when appointments change.';

-- ============================================================================
-- FUNCTION: refresh_all_org_stats
-- Recalculates stats for all orgs (for maintenance/repair)
-- ============================================================================

\echo 'Creating refresh_all_org_stats function...'

CREATE OR REPLACE FUNCTION trapper.refresh_all_org_stats()
RETURNS TABLE (
    orgs_updated INT,
    total_appointments INT,
    total_cats INT
) AS $$
DECLARE
    v_orgs_updated INT := 0;
    v_total_appointments INT := 0;
    v_total_cats INT := 0;
BEGIN
    -- Update all orgs with their current stats
    WITH org_stats AS (
        SELECT
            org_id,
            COUNT(*) AS appt_count,
            COUNT(DISTINCT cat_id) FILTER (WHERE cat_id IS NOT NULL) AS cat_count,
            MIN(appointment_date) AS first_date,
            MAX(appointment_date) AS last_date
        FROM trapper.sot_appointments
        WHERE org_id IS NOT NULL
        GROUP BY org_id
    ),
    updates AS (
        UPDATE trapper.orgs o
        SET
            appointments_count = COALESCE(s.appt_count, 0),
            cats_count = COALESCE(s.cat_count, 0),
            first_appointment_date = s.first_date,
            last_appointment_date = s.last_date
        FROM org_stats s
        WHERE o.id = s.org_id
        RETURNING o.id
    )
    SELECT COUNT(*) INTO v_orgs_updated FROM updates;

    -- Also update orgs with zero appointments
    UPDATE trapper.orgs
    SET
        appointments_count = 0,
        cats_count = 0,
        first_appointment_date = NULL,
        last_appointment_date = NULL
    WHERE id NOT IN (
        SELECT DISTINCT org_id
        FROM trapper.sot_appointments
        WHERE org_id IS NOT NULL
    );

    -- Get totals
    SELECT
        COUNT(*),
        COUNT(DISTINCT cat_id) FILTER (WHERE cat_id IS NOT NULL)
    INTO v_total_appointments, v_total_cats
    FROM trapper.sot_appointments
    WHERE org_id IS NOT NULL;

    RETURN QUERY SELECT v_orgs_updated, v_total_appointments, v_total_cats;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.refresh_all_org_stats IS
'Recalculates denormalized stats for all organizations.
Use for maintenance or after bulk data changes.';

-- ============================================================================
-- VIEW: v_org_stats
-- Convenient view of org statistics
-- ============================================================================

\echo 'Creating v_org_stats view...'

CREATE OR REPLACE VIEW trapper.v_org_stats AS
SELECT
    o.id,
    o.name,
    o.short_name,
    o.org_type,
    o.is_active,
    o.place_id,
    p.formatted_address AS facility_address,
    o.appointments_count,
    o.cats_count,
    o.first_appointment_date,
    o.last_appointment_date,
    -- Calculated fields
    CASE
        WHEN o.last_appointment_date IS NOT NULL
        THEN CURRENT_DATE - o.last_appointment_date
        ELSE NULL
    END AS days_since_last_appointment,
    CASE
        WHEN o.first_appointment_date IS NOT NULL AND o.last_appointment_date IS NOT NULL
        THEN o.last_appointment_date - o.first_appointment_date
        ELSE NULL
    END AS relationship_duration_days,
    -- Contact info
    o.email,
    o.phone,
    o.website,
    -- Patterns
    array_length(o.name_patterns, 1) AS pattern_count,
    o.created_at
FROM trapper.orgs o
LEFT JOIN trapper.places p ON p.place_id = o.place_id
ORDER BY o.appointments_count DESC NULLS LAST, o.name;

COMMENT ON VIEW trapper.v_org_stats IS
'Organization statistics with facility address and derived metrics.
Used by admin UI and reporting.';

-- ============================================================================
-- Initial stats population
-- ============================================================================

\echo 'Populating initial stats...'

SELECT * FROM trapper.refresh_all_org_stats();

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'Verification'
\echo '=============================================='
\echo ''

\echo 'Top organizations by appointment count:'
SELECT name, org_type, appointments_count, cats_count, last_appointment_date
FROM trapper.v_org_stats
WHERE appointments_count > 0
ORDER BY appointments_count DESC
LIMIT 10;

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_965 Complete!'
\echo '=============================================='
\echo ''

SELECT 'Created' AS status, 'update_org_stats() trigger function' AS detail
UNION ALL SELECT 'Created', 'trg_update_org_stats trigger on sot_appointments'
UNION ALL SELECT 'Created', 'refresh_all_org_stats() maintenance function'
UNION ALL SELECT 'Created', 'v_org_stats view'
UNION ALL SELECT 'Populated', 'Initial org stats';

\echo ''
\echo 'Org stats are now automatically maintained.'
\echo 'Use refresh_all_org_stats() if stats get out of sync.'
\echo ''
\echo 'Database migrations complete!'
\echo 'Next: Create API routes and admin pages.'
\echo ''
