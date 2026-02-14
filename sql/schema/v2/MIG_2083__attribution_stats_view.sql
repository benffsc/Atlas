-- MIG_2083: Attribution Stats View for V2
-- Date: 2026-02-14
-- Purpose: Create v_request_alteration_stats for tracking request progress
-- This view calculates attribution windows and links alterations to requests

\echo ''
\echo '=============================================='
\echo '  MIG_2083: Attribution Stats View'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. REQUEST ALTERATION STATS VIEW
-- ============================================================================

\echo '1. Creating ops.v_request_alteration_stats...'

CREATE OR REPLACE VIEW ops.v_request_alteration_stats AS
WITH request_windows AS (
    -- Calculate attribution windows for each request
    -- Window: 6 months before request OR first appointment at place, whichever is later
    -- End: 3 months after resolution for completed/cancelled, or 6 months from now for active
    SELECT
        r.request_id,
        r.status,
        r.place_id,
        r.requester_person_id AS requester_id,
        r.created_at AS request_date,
        r.resolved_at,
        r.estimated_cat_count,
        -- Window start: max of (request - 6 months) or first appointment at place
        GREATEST(
            r.created_at - INTERVAL '6 months',
            COALESCE(
                (SELECT MIN(a.appointment_date)::timestamptz
                 FROM ops.appointments a
                 WHERE a.place_id = r.place_id
                   OR a.inferred_place_id = r.place_id),
                r.created_at - INTERVAL '6 months'
            )
        ) AS window_start,
        -- Window end: 3 months after resolution, or 6 months from now if still active
        CASE
            WHEN r.status IN ('completed', 'cancelled')
            THEN COALESCE(r.resolved_at, r.updated_at) + INTERVAL '3 months'
            ELSE NOW() + INTERVAL '6 months'
        END AS window_end
    FROM ops.requests r
),
place_appointments AS (
    -- Get all appointments at each place with cat info
    SELECT
        COALESCE(a.place_id, a.inferred_place_id) AS place_id,
        a.appointment_id,
        a.cat_id,
        a.appointment_date,
        a.is_alteration,
        a.is_spay,
        a.is_neuter,
        c.altered_status,
        c.sex
    FROM ops.appointments a
    LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
    WHERE COALESCE(a.place_id, a.inferred_place_id) IS NOT NULL
),
place_cats AS (
    -- Get all cats linked to each place
    SELECT
        cp.place_id,
        c.cat_id,
        c.altered_status,
        c.sex,
        -- Get first alteration date for this cat
        (
            SELECT MIN(a.appointment_date)
            FROM ops.appointments a
            WHERE a.cat_id = c.cat_id
              AND a.is_alteration = TRUE
        ) AS altered_date
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id
    WHERE c.merged_into_cat_id IS NULL
)
SELECT
    rw.request_id,
    rw.status,
    rw.place_id,
    rw.requester_id,
    rw.request_date,
    rw.resolved_at,
    rw.window_start,
    rw.window_end,
    rw.estimated_cat_count,
    -- Total cats at place (from cat_place relationships)
    (SELECT COUNT(DISTINCT cat_id) FROM place_cats WHERE place_id = rw.place_id) AS total_cats_at_place,
    -- Cats seen at appointments within window
    COUNT(DISTINCT pa.cat_id) FILTER (
        WHERE pa.appointment_date::timestamptz BETWEEN rw.window_start AND rw.window_end
    ) AS cats_seen_in_window,
    -- All cats altered at this place (ever)
    COUNT(DISTINCT pc.cat_id) FILTER (
        WHERE pc.altered_status IN ('spayed', 'neutered', 'altered')
    ) AS cats_altered_total,
    -- Cats altered within attribution window
    COUNT(DISTINCT pc.cat_id) FILTER (
        WHERE pc.altered_status IN ('spayed', 'neutered', 'altered')
          AND pc.altered_date BETWEEN rw.window_start::date AND rw.window_end::date
    ) AS cats_altered_for_request,
    -- Appointments within window
    COUNT(DISTINCT pa.appointment_id) FILTER (
        WHERE pa.appointment_date::timestamptz BETWEEN rw.window_start AND rw.window_end
    ) AS appointments_in_window,
    -- Alteration appointments within window
    COUNT(DISTINCT pa.appointment_id) FILTER (
        WHERE pa.is_alteration = TRUE
          AND pa.appointment_date::timestamptz BETWEEN rw.window_start AND rw.window_end
    ) AS alterations_in_window,
    -- Progress percentage
    CASE
        WHEN COALESCE(rw.estimated_cat_count, 0) > 0
        THEN ROUND(
            COUNT(DISTINCT pc.cat_id) FILTER (
                WHERE pc.altered_status IN ('spayed', 'neutered', 'altered')
                  AND pc.altered_date BETWEEN rw.window_start::date AND rw.window_end::date
            )::numeric / rw.estimated_cat_count * 100, 1
        )
        ELSE NULL
    END AS progress_pct,
    -- Days since request
    EXTRACT(DAY FROM NOW() - rw.request_date)::INT AS days_since_request,
    -- Days until window closes (negative if closed)
    EXTRACT(DAY FROM rw.window_end - NOW())::INT AS days_until_window_closes
FROM request_windows rw
LEFT JOIN place_appointments pa ON pa.place_id = rw.place_id
LEFT JOIN place_cats pc ON pc.place_id = rw.place_id
GROUP BY
    rw.request_id, rw.status, rw.place_id, rw.requester_id,
    rw.request_date, rw.resolved_at, rw.window_start, rw.window_end,
    rw.estimated_cat_count;

COMMENT ON VIEW ops.v_request_alteration_stats IS 'Request progress tracking with attribution windows for alteration counts';

-- ============================================================================
-- 2. ACTIVE REQUEST PROGRESS VIEW (Simplified for dashboards)
-- ============================================================================

\echo ''
\echo '2. Creating ops.v_active_request_progress...'

CREATE OR REPLACE VIEW ops.v_active_request_progress AS
SELECT
    ras.request_id,
    ras.place_id,
    p.display_name AS place_name,
    p.formatted_address,
    ras.status,
    ras.request_date,
    ras.estimated_cat_count,
    ras.cats_altered_for_request,
    ras.progress_pct,
    ras.days_since_request,
    ras.days_until_window_closes,
    -- Priority scoring
    CASE
        WHEN ras.progress_pct IS NULL OR ras.progress_pct < 25 THEN 'high'
        WHEN ras.progress_pct < 75 THEN 'medium'
        ELSE 'low'
    END AS attention_level,
    -- Assigned trappers
    (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'person_id', rta.trapper_person_id,
            'name', per.display_name,
            'role', rta.assignment_type
        )), '[]'::jsonb)
        FROM ops.request_trapper_assignments rta
        JOIN sot.people per ON per.person_id = rta.trapper_person_id
        WHERE rta.request_id = ras.request_id
          AND rta.status IN ('active', 'accepted', 'pending')
    ) AS assigned_trappers
FROM ops.v_request_alteration_stats ras
JOIN sot.places p ON p.place_id = ras.place_id
WHERE ras.status IN ('new', 'triaged', 'scheduled', 'in_progress')
ORDER BY
    CASE ras.status
        WHEN 'in_progress' THEN 1
        WHEN 'scheduled' THEN 2
        WHEN 'triaged' THEN 3
        WHEN 'new' THEN 4
    END,
    ras.progress_pct ASC NULLS FIRST,
    ras.days_since_request DESC;

COMMENT ON VIEW ops.v_active_request_progress IS 'Active requests with progress metrics for coordinator dashboard';

-- ============================================================================
-- 3. STALE REQUESTS VIEW
-- ============================================================================

\echo ''
\echo '3. Creating ops.v_stale_requests...'

CREATE OR REPLACE VIEW ops.v_stale_requests AS
SELECT
    r.request_id,
    r.place_id,
    p.display_name AS place_name,
    p.formatted_address,
    r.status,
    r.created_at,
    r.updated_at,
    EXTRACT(DAY FROM NOW() - r.created_at)::INT AS days_open,
    EXTRACT(DAY FROM NOW() - r.updated_at)::INT AS days_since_activity,
    r.estimated_cat_count,
    -- Count of appointments in last 30 days
    (
        SELECT COUNT(*)
        FROM ops.appointments a
        WHERE (a.place_id = r.place_id OR a.inferred_place_id = r.place_id)
          AND a.appointment_date >= CURRENT_DATE - 30
    ) AS recent_appointments,
    -- Has assigned trapper
    EXISTS (
        SELECT 1 FROM ops.request_trapper_assignments rta
        WHERE rta.request_id = r.request_id
          AND rta.status IN ('active', 'accepted', 'pending')
    ) AS has_trapper,
    -- Stale reason
    CASE
        WHEN EXTRACT(DAY FROM NOW() - r.updated_at) > 90 THEN 'No activity in 90+ days'
        WHEN EXTRACT(DAY FROM NOW() - r.updated_at) > 60 THEN 'No activity in 60+ days'
        WHEN EXTRACT(DAY FROM NOW() - r.updated_at) > 30 THEN 'No activity in 30+ days'
        WHEN NOT EXISTS (
            SELECT 1 FROM ops.request_trapper_assignments rta
            WHERE rta.request_id = r.request_id
              AND rta.status IN ('active', 'accepted', 'pending')
        ) THEN 'No trapper assigned'
        ELSE 'Review needed'
    END AS stale_reason
FROM ops.requests r
JOIN sot.places p ON p.place_id = r.place_id
WHERE r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
  AND (
      -- No activity in 30+ days
      r.updated_at < NOW() - INTERVAL '30 days'
      -- OR no trapper assigned after 7 days
      OR (
          r.created_at < NOW() - INTERVAL '7 days'
          AND NOT EXISTS (
              SELECT 1 FROM ops.request_trapper_assignments rta
              WHERE rta.request_id = r.request_id
                AND rta.status IN ('active', 'accepted', 'pending')
          )
      )
  )
ORDER BY days_since_activity DESC;

COMMENT ON VIEW ops.v_stale_requests IS 'Requests that need attention due to inactivity or missing assignment';

-- ============================================================================
-- 4. TRAPPER COMPATIBILITY VIEW
-- ============================================================================

\echo ''
\echo '4. Creating trapper compatibility view...'

CREATE OR REPLACE VIEW trapper.v_request_alteration_stats AS
SELECT * FROM ops.v_request_alteration_stats;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

SELECT 'ops.v_request_alteration_stats' AS view_name, COUNT(*) AS row_count FROM ops.v_request_alteration_stats
UNION ALL
SELECT 'ops.v_active_request_progress', COUNT(*) FROM ops.v_active_request_progress
UNION ALL
SELECT 'ops.v_stale_requests', COUNT(*) FROM ops.v_stale_requests;

\echo ''
\echo '=============================================='
\echo '  MIG_2083 Complete!'
\echo '=============================================='
\echo ''
