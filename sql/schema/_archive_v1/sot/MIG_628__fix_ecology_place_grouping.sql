-- MIG_628: Fix Ecology Stats Place Grouping
--
-- Bug: The v_place_ecology_stats view was using COALESCE(original_place_id, place_id)
-- in the verified_altered CTE, which groups cats by their original source place
-- instead of the canonical place. This breaks the LEFT JOIN to places.
--
-- Example: Crystal's cats at "1638 McCarran Way"
-- - Cats linked to place_id = 4a9f2cf2-... (canonical)
-- - But original_place_id = e344d9ca-... (old merged place)
-- - View grouped by e344d9ca, so JOIN to 4a9f2cf2 returned NULL
-- - Result: a_known = 0 even though 4 altered cats exist
--
-- Fix: Use place_id directly, not COALESCE(original_place_id, place_id)

\echo ''
\echo '========================================================'
\echo 'MIG_628: Fix Ecology Stats Place Grouping'
\echo '========================================================'
\echo ''

\echo 'Recreating v_place_ecology_stats with corrected place grouping...'

CREATE OR REPLACE VIEW trapper.v_place_ecology_stats AS
WITH verified_altered AS (
    -- FIX: Use place_id directly, not COALESCE(original_place_id, place_id)
    -- The place_id column is the canonical place; original_place_id is for provenance only
    SELECT
        cpr.place_id,
        COUNT(DISTINCT cp.cat_id) AS a_known,
        MAX(cp.procedure_date) AS last_altered_at
    FROM trapper.cat_procedures cp
    JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = cp.cat_id
    WHERE cp.is_spay OR cp.is_neuter
    GROUP BY cpr.place_id
),

recent_reports AS (
    SELECT
        place_id,
        MAX(COALESCE(peak_count, total_cats)) AS n_recent_max,
        COUNT(*) AS report_count,
        MAX(observation_date) AS latest_observation
    FROM trapper.place_colony_estimates
    WHERE observation_date >= CURRENT_DATE - INTERVAL '180 days'
       OR (observation_date IS NULL AND reported_at >= NOW() - INTERVAL '180 days')
    GROUP BY place_id
),

eartip_observations AS (
    SELECT
        place_id,
        SUM(eartip_count_observed) AS total_eartips_seen,
        SUM(total_cats_observed) AS total_cats_seen,
        COUNT(*) AS observation_count,
        MAX(observation_date) AS latest_eartip_observation
    FROM trapper.place_colony_estimates
    WHERE eartip_count_observed IS NOT NULL
      AND total_cats_observed IS NOT NULL
      AND total_cats_observed > 0
      AND (observation_date >= CURRENT_DATE - INTERVAL '365 days'
           OR (observation_date IS NULL AND reported_at >= NOW() - INTERVAL '365 days'))
    GROUP BY place_id
)

SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    p.service_zone,
    p.is_ffsc_facility,
    COALESCE(va.a_known, 0) AS a_known,
    va.last_altered_at,
    COALESCE(rr.n_recent_max, 0) AS n_recent_max,
    COALESCE(rr.report_count, 0) AS report_count,
    rr.latest_observation,

    -- p_lower: proportion altered (capped at 1.0)
    CASE
        WHEN COALESCE(rr.n_recent_max, 0) > 0 OR COALESCE(va.a_known, 0) > 0
        THEN ROUND(
            COALESCE(va.a_known, 0)::NUMERIC /
            GREATEST(COALESCE(va.a_known, 0), COALESCE(rr.n_recent_max, 1))::NUMERIC,
            3
        )
        ELSE NULL
    END AS p_lower,

    -- p_lower_pct: percentage (capped at 100%)
    CASE
        WHEN COALESCE(rr.n_recent_max, 0) > 0 OR COALESCE(va.a_known, 0) > 0
        THEN ROUND(
            100.0 * COALESCE(va.a_known, 0)::NUMERIC /
            GREATEST(COALESCE(va.a_known, 0), COALESCE(rr.n_recent_max, 1))::NUMERIC,
            1
        )
        ELSE NULL
    END AS p_lower_pct,

    -- Eartip observation flags
    eo.observation_count IS NOT NULL AND eo.observation_count > 0 AS has_eartip_data,
    COALESCE(eo.total_eartips_seen, 0) AS total_eartips_seen,
    COALESCE(eo.total_cats_seen, 0) AS total_cats_seen,
    COALESCE(eo.observation_count, 0) AS eartip_observation_count,
    eo.latest_eartip_observation,

    -- Chapman mark-recapture estimate (only if valid eartip data)
    CASE
        WHEN eo.total_eartips_seen > 0
         AND eo.total_cats_seen > 0
         AND va.a_known > 0
         AND eo.total_eartips_seen <= eo.total_cats_seen
        THEN ROUND(
            ((va.a_known + 1) * (eo.total_cats_seen + 1)::NUMERIC /
             (eo.total_eartips_seen + 1)) - 1,
            0
        )
        ELSE NULL
    END AS n_hat_chapman,

    -- Estimation method used
    CASE
        WHEN eo.total_eartips_seen > 0 AND eo.total_cats_seen > 0 AND va.a_known > 0
        THEN 'mark_resight'
        WHEN rr.n_recent_max > 0
        THEN 'max_recent'
        WHEN va.a_known > 0
        THEN 'verified_only'
        ELSE 'no_data'
    END AS estimation_method

FROM trapper.places p
LEFT JOIN verified_altered va ON va.place_id = p.place_id
LEFT JOIN recent_reports rr ON rr.place_id = p.place_id
LEFT JOIN eartip_observations eo ON eo.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL
  AND COALESCE(p.is_ffsc_facility, FALSE) = FALSE;

COMMENT ON VIEW trapper.v_place_ecology_stats IS
'Ecology statistics for each place, including verified alterations and colony estimates.
Fixed in MIG_628 to use canonical place_id instead of original_place_id.';

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Verification:'

\echo 'Checking Crystal Mittelstedter place (1638 McCarran Way):'

SELECT
    p.formatted_address,
    p.colony_classification::TEXT,
    p.authoritative_cat_count,
    v.a_known,
    v.n_recent_max,
    v.p_lower_pct,
    v.estimation_method
FROM trapper.places p
LEFT JOIN trapper.v_place_ecology_stats v ON v.place_id = p.place_id
WHERE p.place_id = '4a9f2cf2-876c-4a97-9f61-4faf3c1ecc6f';

\echo ''
\echo '========================================================'
\echo 'MIG_628 Complete!'
\echo '========================================================'
\echo ''
\echo 'Fixed v_place_ecology_stats to use canonical place_id.'
\echo 'Verified alterations (a_known) should now count correctly.'
\echo ''
