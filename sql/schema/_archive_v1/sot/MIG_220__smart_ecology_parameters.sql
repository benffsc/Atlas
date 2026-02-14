-- MIG_220__smart_ecology_parameters.sql
-- Smart ecology calculations with configurable, auditable parameters
--
-- Purpose:
--   - Make ecology calculations configurable via admin settings
--   - Account for cat lifespan when calculating active altered population
--   - Clinic revisits extend a cat's "active" window
--   - Handle cases where a_known > n_recent_max (show "Complete" not ">100%")
--   - Full audit trail for all parameter changes
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_220__smart_ecology_parameters.sql

\echo ''
\echo 'MIG_220: Smart Ecology Parameters'
\echo '=================================='
\echo ''

-- ============================================================
-- 1. Create ecology_config table
-- ============================================================

\echo 'Creating ecology_config table...'

CREATE TABLE IF NOT EXISTS trapper.ecology_config (
    config_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key TEXT UNIQUE NOT NULL,
    config_value NUMERIC NOT NULL,
    unit TEXT,                        -- 'years', 'days', 'percentage', etc.
    description TEXT,
    min_value NUMERIC,
    max_value NUMERIC,
    is_active BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by TEXT
);

COMMENT ON TABLE trapper.ecology_config IS
'Configurable parameters for ecology calculations. Changes are auditable.';

-- ============================================================
-- 2. Insert default configuration values
-- ============================================================

\echo ''
\echo 'Inserting default ecology parameters...'

INSERT INTO trapper.ecology_config (config_key, config_value, unit, description, min_value, max_value) VALUES
    -- Cat lifespan parameters
    ('cat_lifespan_years', 15, 'years',
     'Expected lifespan of a feral cat. Altered cats within this age are counted as "active" at their place.',
     5, 20),

    ('clinic_revisit_extension_years', 2, 'years',
     'How many years a clinic revisit extends a cat''s "active" status beyond the base lifespan.',
     0, 5),

    -- Reporting windows
    ('recent_report_window_days', 180, 'days',
     'How many days back to look for colony size reports when calculating n_recent_max.',
     30, 365),

    ('eartip_observation_window_days', 90, 'days',
     'How many days back to look for ear-tip observations for mark-resight calculations.',
     30, 180),

    -- Colony estimation thresholds
    ('max_reasonable_colony_size', 100, 'cats',
     'Maximum reasonable colony size. Reports above this are flagged for review.',
     50, 500),

    ('min_reports_for_confidence', 2, 'reports',
     'Minimum number of reports needed for "medium" confidence in estimates.',
     1, 10),

    -- Alteration rate interpretation
    ('high_alteration_threshold', 80, 'percentage',
     'Alteration rate above this is considered "high" (green status).',
     70, 95),

    ('medium_alteration_threshold', 50, 'percentage',
     'Alteration rate above this is considered "medium" (yellow status).',
     30, 70),

    ('complete_colony_threshold', 95, 'percentage',
     'Alteration rate above this is considered "complete" (colony is done).',
     90, 100)
ON CONFLICT (config_key) DO NOTHING;

-- ============================================================
-- 3. Create config audit table
-- ============================================================

\echo ''
\echo 'Creating ecology_config_audit table...'

CREATE TABLE IF NOT EXISTS trapper.ecology_config_audit (
    audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key TEXT NOT NULL,
    old_value NUMERIC,
    new_value NUMERIC NOT NULL,
    changed_by TEXT NOT NULL,
    change_reason TEXT,
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ecology_config_audit_key
ON trapper.ecology_config_audit(config_key, changed_at DESC);

COMMENT ON TABLE trapper.ecology_config_audit IS
'Audit trail for all ecology configuration changes.';

-- ============================================================
-- 4. Create function to update config with audit
-- ============================================================

\echo ''
\echo 'Creating update_ecology_config function...'

CREATE OR REPLACE FUNCTION trapper.update_ecology_config(
    p_config_key TEXT,
    p_new_value NUMERIC,
    p_changed_by TEXT,
    p_reason TEXT DEFAULT NULL
) RETURNS TABLE (
    success BOOLEAN,
    message TEXT,
    old_value NUMERIC,
    new_value NUMERIC
) AS $$
DECLARE
    v_old_value NUMERIC;
    v_min NUMERIC;
    v_max NUMERIC;
BEGIN
    -- Get current value and limits
    SELECT config_value, min_value, max_value
    INTO v_old_value, v_min, v_max
    FROM trapper.ecology_config
    WHERE config_key = p_config_key;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Config key not found: ' || p_config_key, NULL::NUMERIC, NULL::NUMERIC;
        RETURN;
    END IF;

    -- Validate against limits
    IF p_new_value < v_min OR p_new_value > v_max THEN
        RETURN QUERY SELECT FALSE,
            format('Value %s out of range [%s, %s]', p_new_value, v_min, v_max),
            v_old_value, p_new_value;
        RETURN;
    END IF;

    -- Record audit
    INSERT INTO trapper.ecology_config_audit (
        config_key, old_value, new_value, changed_by, change_reason
    ) VALUES (
        p_config_key, v_old_value, p_new_value, p_changed_by, p_reason
    );

    -- Update config
    UPDATE trapper.ecology_config
    SET config_value = p_new_value,
        updated_at = NOW(),
        updated_by = p_changed_by
    WHERE config_key = p_config_key;

    RETURN QUERY SELECT TRUE, 'Config updated successfully', v_old_value, p_new_value;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.update_ecology_config IS
'Updates an ecology config parameter with full audit trail.
Example: SELECT * FROM trapper.update_ecology_config(''cat_lifespan_years'', 12, ''ben@example.com'', ''Research suggests shorter average'');';

-- ============================================================
-- 5. Create helper function to get config values
-- ============================================================

\echo ''
\echo 'Creating get_ecology_config function...'

CREATE OR REPLACE FUNCTION trapper.get_ecology_config(p_key TEXT)
RETURNS NUMERIC AS $$
    SELECT config_value FROM trapper.ecology_config WHERE config_key = p_key;
$$ LANGUAGE SQL STABLE;

-- ============================================================
-- 6. Update v_place_ecology_stats with smart calculations
-- ============================================================

\echo ''
\echo 'Updating v_place_ecology_stats view with smart calculations...'

CREATE OR REPLACE VIEW trapper.v_place_ecology_stats AS
WITH
-- Configuration values
config AS (
    SELECT
        (SELECT config_value FROM trapper.ecology_config WHERE config_key = 'cat_lifespan_years') AS lifespan_years,
        (SELECT config_value FROM trapper.ecology_config WHERE config_key = 'clinic_revisit_extension_years') AS revisit_extension,
        (SELECT config_value FROM trapper.ecology_config WHERE config_key = 'recent_report_window_days') AS report_window_days,
        (SELECT config_value FROM trapper.ecology_config WHERE config_key = 'eartip_observation_window_days') AS eartip_window_days,
        (SELECT config_value FROM trapper.ecology_config WHERE config_key = 'complete_colony_threshold') AS complete_threshold,
        (SELECT config_value FROM trapper.ecology_config WHERE config_key = 'high_alteration_threshold') AS high_threshold
),

-- A_known: verified altered cats linked to place
-- Now filters by "active" cats (within lifespan + revisit extension)
verified_altered AS (
    SELECT
        cpr.place_id,
        COUNT(DISTINCT cp.cat_id) AS a_known,
        COUNT(DISTINCT CASE
            WHEN cp.procedure_date >= CURRENT_DATE - (
                (SELECT lifespan_years FROM config) +
                COALESCE(
                    (SELECT MAX((SELECT revisit_extension FROM config))
                     FROM trapper.sot_appointments a2
                     WHERE a2.cat_id = cp.cat_id AND a2.appointment_date > cp.procedure_date),
                    0
                )
            ) * INTERVAL '1 year'
            THEN cp.cat_id
        END) AS a_active,  -- Active within lifespan
        MAX(cp.procedure_date) AS last_altered_at
    FROM trapper.cat_procedures cp
    JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = cp.cat_id
    WHERE cp.is_spay OR cp.is_neuter
    GROUP BY cpr.place_id
),

-- N_recent_max: max reported total within configurable window
recent_reports AS (
    SELECT
        place_id,
        MAX(COALESCE(peak_count, total_cats)) AS n_recent_max,
        COUNT(*) AS report_count,
        MAX(observation_date) AS latest_observation
    FROM trapper.place_colony_estimates pce, config c
    WHERE observation_date >= CURRENT_DATE - (c.report_window_days || ' days')::INTERVAL
       OR (observation_date IS NULL AND reported_at >= NOW() - (c.report_window_days || ' days')::INTERVAL)
    GROUP BY place_id
),

-- Ear-tip observations for mark-resight
eartip_observations AS (
    SELECT
        place_id,
        SUM(eartip_count_observed) AS total_eartips_seen,
        SUM(total_cats_observed) AS total_cats_seen,
        COUNT(*) AS observation_count
    FROM trapper.place_colony_estimates pce, config c
    WHERE eartip_count_observed IS NOT NULL
      AND total_cats_observed IS NOT NULL
      AND observation_date >= CURRENT_DATE - (c.eartip_window_days || ' days')::INTERVAL
    GROUP BY place_id
)

SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    p.atlas_id,
    p.service_zone,

    -- Verified ground truth (all time)
    COALESCE(va.a_known, 0) AS a_known,

    -- Active altered cats (within lifespan)
    COALESCE(va.a_active, 0) AS a_active,

    va.last_altered_at,

    -- Survey-based estimate
    COALESCE(rr.n_recent_max, 0) AS n_recent_max,
    rr.report_count,
    rr.latest_observation,

    -- Manual override (takes precedence if set)
    p.colony_override_count,
    p.colony_override_altered,
    p.colony_override_note,
    p.colony_override_at,
    p.colony_override_by,
    (p.colony_override_count IS NOT NULL) AS has_override,

    -- SMART COLONY SIZE: Uses the larger of a_known and n_recent_max
    -- This handles the "more altered than reported" case
    COALESCE(
        p.colony_override_count,
        GREATEST(COALESCE(va.a_known, 0), COALESCE(rr.n_recent_max, 0))
    ) AS effective_colony_size,

    -- Effective altered count (override or verified)
    COALESCE(
        p.colony_override_altered,
        COALESCE(va.a_known, 0)
    ) AS effective_altered,

    -- SMART ALTERATION RATE
    -- When a_known > n_recent_max, cap at 100% (don't show >100%)
    CASE
        WHEN p.colony_override_count IS NOT NULL AND p.colony_override_count > 0 THEN
            ROUND(COALESCE(p.colony_override_altered, 0)::NUMERIC / p.colony_override_count::NUMERIC, 3)
        WHEN COALESCE(va.a_known, 0) >= COALESCE(rr.n_recent_max, 1) AND COALESCE(va.a_known, 0) > 0 THEN
            1.000  -- 100% - colony is at least complete based on reports
        WHEN COALESCE(rr.n_recent_max, 0) > 0 THEN
            ROUND(
                COALESCE(va.a_known, 0)::NUMERIC / rr.n_recent_max::NUMERIC,
                3
            )
        ELSE NULL
    END AS p_lower,

    -- Percentage version with same smart logic
    CASE
        WHEN p.colony_override_count IS NOT NULL AND p.colony_override_count > 0 THEN
            ROUND(100.0 * COALESCE(p.colony_override_altered, 0)::NUMERIC / p.colony_override_count::NUMERIC, 1)
        WHEN COALESCE(va.a_known, 0) >= COALESCE(rr.n_recent_max, 1) AND COALESCE(va.a_known, 0) > 0 THEN
            100.0  -- Cap at 100%
        WHEN COALESCE(rr.n_recent_max, 0) > 0 THEN
            ROUND(
                100.0 * COALESCE(va.a_known, 0)::NUMERIC / rr.n_recent_max::NUMERIC,
                1
            )
        ELSE NULL
    END AS p_lower_pct,

    -- NEW: Colony completion status
    -- 'complete' when a_known >= n_recent_max (we've altered at least as many as were reported)
    -- 'high' when rate > 80%
    -- 'medium' when rate > 50%
    -- 'low' otherwise
    CASE
        WHEN p.colony_override_count IS NOT NULL THEN
            CASE
                WHEN COALESCE(p.colony_override_altered, 0) >= p.colony_override_count * 0.95 THEN 'complete'
                WHEN COALESCE(p.colony_override_altered, 0) >= p.colony_override_count * 0.80 THEN 'high'
                WHEN COALESCE(p.colony_override_altered, 0) >= p.colony_override_count * 0.50 THEN 'medium'
                ELSE 'low'
            END
        WHEN COALESCE(va.a_known, 0) >= COALESCE(rr.n_recent_max, 1) AND COALESCE(va.a_known, 0) > 0 THEN
            'complete'  -- Altered at least as many as were reported
        WHEN COALESCE(rr.n_recent_max, 0) > 0 AND COALESCE(va.a_known, 0)::NUMERIC / rr.n_recent_max >= 0.80 THEN
            'high'
        WHEN COALESCE(rr.n_recent_max, 0) > 0 AND COALESCE(va.a_known, 0)::NUMERIC / rr.n_recent_max >= 0.50 THEN
            'medium'
        WHEN COALESCE(va.a_known, 0) > 0 THEN
            'low'
        ELSE
            'unknown'
    END AS completion_status,

    -- Mark-resight readiness
    eo.observation_count IS NOT NULL AS has_eartip_data,
    eo.total_eartips_seen,
    eo.total_cats_seen,

    -- Chapman estimator (when ear-tip data available)
    CASE
        WHEN eo.total_eartips_seen > 0 AND eo.total_cats_seen > 0 AND va.a_known > 0
        THEN ROUND(
            ((va.a_known + 1) * (eo.total_cats_seen + 1)::NUMERIC /
             (eo.total_eartips_seen + 1)) - 1,
            1
        )
        ELSE NULL
    END AS n_hat_chapman,

    -- Chapman alteration rate
    CASE
        WHEN eo.total_eartips_seen > 0 AND eo.total_cats_seen > 0 AND va.a_known > 0
        THEN ROUND(
            100.0 * va.a_known::NUMERIC / (
                ((va.a_known + 1) * (eo.total_cats_seen + 1)::NUMERIC /
                 (eo.total_eartips_seen + 1)) - 1
            ),
            1
        )
        ELSE NULL
    END AS p_hat_chapman_pct,

    -- Estimation method used
    CASE
        WHEN p.colony_override_count IS NOT NULL THEN 'manual_override'
        WHEN eo.total_eartips_seen > 0 AND va.a_known > 0 THEN 'mark_resight'
        WHEN rr.n_recent_max > 0 THEN 'max_recent'
        WHEN va.a_known > 0 THEN 'verified_only'
        ELSE 'no_data'
    END AS estimation_method,

    -- Best colony estimate (single number for display)
    COALESCE(
        p.colony_override_count,
        CASE
            WHEN eo.total_eartips_seen > 0 AND eo.total_cats_seen > 0 AND va.a_known > 0
            THEN ROUND(((va.a_known + 1) * (eo.total_cats_seen + 1)::NUMERIC / (eo.total_eartips_seen + 1)) - 1)::INTEGER
            ELSE GREATEST(COALESCE(va.a_known, 0), COALESCE(rr.n_recent_max, 0))
        END
    ) AS best_colony_estimate,

    -- Estimated work remaining
    CASE
        WHEN p.colony_override_count IS NOT NULL THEN
            GREATEST(0, p.colony_override_count - COALESCE(p.colony_override_altered, 0))
        WHEN COALESCE(va.a_known, 0) >= COALESCE(rr.n_recent_max, 0) THEN
            0  -- Colony is complete based on reports
        WHEN eo.total_eartips_seen > 0 AND eo.total_cats_seen > 0 AND va.a_known > 0
        THEN GREATEST(0, ROUND(((va.a_known + 1) * (eo.total_cats_seen + 1)::NUMERIC / (eo.total_eartips_seen + 1)) - 1)::INTEGER - COALESCE(va.a_known, 0))
        ELSE GREATEST(0, COALESCE(rr.n_recent_max, 0) - COALESCE(va.a_known, 0))
    END AS estimated_work_remaining,

    -- NEW: Interpretation note for staff
    CASE
        WHEN p.colony_override_count IS NOT NULL THEN
            'Manual override set by ' || p.colony_override_by
        WHEN COALESCE(va.a_known, 0) > COALESCE(rr.n_recent_max, 0) AND rr.n_recent_max > 0 THEN
            format('More cats altered (%s) than reported (%s) - likely underreported colony', va.a_known, rr.n_recent_max)
        WHEN COALESCE(va.a_known, 0) = COALESCE(rr.n_recent_max, 0) AND va.a_known > 0 THEN
            'Colony appears complete based on reports'
        WHEN rr.n_recent_max IS NULL AND va.a_known > 0 THEN
            format('No recent colony reports, but %s cats verified altered', va.a_known)
        ELSE NULL
    END AS interpretation_note

FROM trapper.places p
LEFT JOIN verified_altered va ON va.place_id = p.place_id
LEFT JOIN recent_reports rr ON rr.place_id = p.place_id
LEFT JOIN eartip_observations eo ON eo.place_id = p.place_id
WHERE va.a_known > 0
   OR rr.n_recent_max > 0
   OR p.colony_override_count IS NOT NULL;

COMMENT ON VIEW trapper.v_place_ecology_stats IS
'Ecology-based colony metrics per place with smart calculations.
- Uses configurable parameters from ecology_config table
- a_active: altered cats within configured lifespan (15 years default)
- p_lower_pct: capped at 100% when a_known >= n_recent_max
- completion_status: complete/high/medium/low/unknown
- interpretation_note: human-readable explanation of the data';

-- ============================================================
-- 7. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Ecology configuration:';
SELECT config_key, config_value, unit, description
FROM trapper.ecology_config
ORDER BY config_key;

\echo ''
\echo '111 Sebastopol Rd check (should show "complete" not >100%):';
SELECT
    display_name,
    a_known,
    n_recent_max,
    p_lower_pct,
    completion_status,
    interpretation_note
FROM trapper.v_place_ecology_stats
WHERE formatted_address ILIKE '%111 sebastopol%';

\echo ''
\echo 'Places with "complete" status:';
SELECT COUNT(*) as complete_colonies
FROM trapper.v_place_ecology_stats
WHERE completion_status = 'complete';

\echo ''
\echo 'Places where a_known > n_recent_max (underreported):';
SELECT COUNT(*) as underreported_colonies
FROM trapper.v_place_ecology_stats
WHERE a_known > n_recent_max AND n_recent_max > 0;

SELECT 'MIG_220 Complete' AS status;
