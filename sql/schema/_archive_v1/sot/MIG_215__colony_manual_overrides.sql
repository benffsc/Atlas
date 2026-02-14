-- MIG_215__colony_manual_overrides.sql
-- Add manual override capability for colony counts with full audit trail
--
-- Purpose:
--   - Allow staff to override estimated colony counts with confirmed data
--   - Track who made the override and why
--   - Preserve history for later review
--   - Support notes like "confirmed this place has 15 cats, all altered"
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_215__colony_manual_overrides.sql

\echo ''
\echo 'MIG_215: Colony Manual Overrides'
\echo '================================='
\echo ''

-- ============================================================
-- 1. Add override columns to places table
-- ============================================================

\echo 'Adding override columns to places...'

-- Manual override for colony size (staff confirmed count)
ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS colony_override_count INTEGER,
ADD COLUMN IF NOT EXISTS colony_override_altered INTEGER,
ADD COLUMN IF NOT EXISTS colony_override_note TEXT,
ADD COLUMN IF NOT EXISTS colony_override_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS colony_override_by TEXT;

COMMENT ON COLUMN trapper.places.colony_override_count IS
'Staff-confirmed total cat count. When set, takes precedence over estimates.';

COMMENT ON COLUMN trapper.places.colony_override_altered IS
'Staff-confirmed altered cat count at this location.';

COMMENT ON COLUMN trapper.places.colony_override_note IS
'Reason/notes for the override (e.g., "Confirmed all 15 cats altered via site visit 2025-01-10")';

-- ============================================================
-- 2. Create colony override history table
-- ============================================================

\echo ''
\echo 'Creating colony_override_history table...'

CREATE TABLE IF NOT EXISTS trapper.colony_override_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id UUID NOT NULL REFERENCES trapper.places(place_id),

    -- What was set
    override_count INTEGER,
    override_altered INTEGER,
    override_note TEXT,

    -- What it replaced
    previous_count INTEGER,
    previous_altered INTEGER,
    previous_note TEXT,

    -- Who/when/why
    changed_by TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    change_reason TEXT,

    -- Context at time of change
    a_known_at_time INTEGER,  -- Verified altered cats at time of override
    n_max_at_time INTEGER,    -- Max reported at time of override

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_colony_override_history_place
ON trapper.colony_override_history(place_id, changed_at DESC);

COMMENT ON TABLE trapper.colony_override_history IS
'Audit trail of all colony count overrides. Preserves why decisions were made.';

-- ============================================================
-- 3. Create function to set colony override
-- ============================================================

\echo ''
\echo 'Creating set_colony_override function...'

CREATE OR REPLACE FUNCTION trapper.set_colony_override(
    p_place_id UUID,
    p_count INTEGER,
    p_altered INTEGER DEFAULT NULL,
    p_note TEXT DEFAULT NULL,
    p_changed_by TEXT DEFAULT 'unknown'
) RETURNS TABLE (
    success BOOLEAN,
    message TEXT,
    previous_count INTEGER,
    previous_altered INTEGER
) AS $$
DECLARE
    v_prev_count INTEGER;
    v_prev_altered INTEGER;
    v_prev_note TEXT;
    v_a_known INTEGER;
    v_n_max INTEGER;
BEGIN
    -- Get current values
    SELECT
        colony_override_count,
        colony_override_altered,
        colony_override_note
    INTO v_prev_count, v_prev_altered, v_prev_note
    FROM trapper.places WHERE place_id = p_place_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Place not found', NULL::INTEGER, NULL::INTEGER;
        RETURN;
    END IF;

    -- Get current ecology stats for context
    SELECT
        COALESCE(e.a_known, 0),
        COALESCE(e.n_recent_max, 0)
    INTO v_a_known, v_n_max
    FROM trapper.v_place_ecology_stats e
    WHERE e.place_id = p_place_id;

    -- Record history
    INSERT INTO trapper.colony_override_history (
        place_id,
        override_count, override_altered, override_note,
        previous_count, previous_altered, previous_note,
        changed_by, change_reason,
        a_known_at_time, n_max_at_time
    ) VALUES (
        p_place_id,
        p_count, p_altered, p_note,
        v_prev_count, v_prev_altered, v_prev_note,
        p_changed_by, p_note,
        v_a_known, v_n_max
    );

    -- Update place
    UPDATE trapper.places
    SET
        colony_override_count = p_count,
        colony_override_altered = p_altered,
        colony_override_note = p_note,
        colony_override_at = NOW(),
        colony_override_by = p_changed_by,
        updated_at = NOW()
    WHERE place_id = p_place_id;

    RETURN QUERY SELECT TRUE, 'Override set successfully', v_prev_count, v_prev_altered;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.set_colony_override IS
'Sets a manual override for colony count at a place. Records full history for audit.
Example: SELECT * FROM trapper.set_colony_override(
    ''place-uuid'',
    15,                    -- total cats
    15,                    -- altered cats
    ''Confirmed via site visit 2025-01-10 - all cats ear-tipped'',
    ''ben@example.com''
);';

-- ============================================================
-- 4. Create function to clear colony override
-- ============================================================

\echo ''
\echo 'Creating clear_colony_override function...'

CREATE OR REPLACE FUNCTION trapper.clear_colony_override(
    p_place_id UUID,
    p_reason TEXT DEFAULT NULL,
    p_changed_by TEXT DEFAULT 'unknown'
) RETURNS BOOLEAN AS $$
DECLARE
    v_prev_count INTEGER;
    v_prev_altered INTEGER;
    v_prev_note TEXT;
BEGIN
    -- Get current values
    SELECT
        colony_override_count,
        colony_override_altered,
        colony_override_note
    INTO v_prev_count, v_prev_altered, v_prev_note
    FROM trapper.places WHERE place_id = p_place_id;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Record history (clearing is an override to NULL)
    INSERT INTO trapper.colony_override_history (
        place_id,
        override_count, override_altered, override_note,
        previous_count, previous_altered, previous_note,
        changed_by, change_reason
    ) VALUES (
        p_place_id,
        NULL, NULL, 'Override cleared: ' || COALESCE(p_reason, 'No reason given'),
        v_prev_count, v_prev_altered, v_prev_note,
        p_changed_by, p_reason
    );

    -- Clear override
    UPDATE trapper.places
    SET
        colony_override_count = NULL,
        colony_override_altered = NULL,
        colony_override_note = NULL,
        colony_override_at = NULL,
        colony_override_by = NULL,
        updated_at = NOW()
    WHERE place_id = p_place_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.clear_colony_override IS
'Clears a manual override, reverting to computed estimates. Records why it was cleared.';

-- ============================================================
-- 5. Update v_place_ecology_stats to respect overrides
-- ============================================================

\echo ''
\echo 'Updating v_place_ecology_stats to include overrides...'

CREATE OR REPLACE VIEW trapper.v_place_ecology_stats AS
WITH
-- A_known: verified altered cats from clinic data
verified_altered AS (
    SELECT
        cpr.place_id,
        COUNT(DISTINCT cp.cat_id) AS a_known,
        MAX(cp.procedure_date) AS last_altered_at
    FROM trapper.cat_procedures cp
    JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = cp.cat_id
    WHERE cp.is_spay OR cp.is_neuter
    GROUP BY cpr.place_id
),

-- N_recent_max: max reported total within 180 days
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

-- Ear-tip observations for mark-resight
eartip_observations AS (
    SELECT
        place_id,
        SUM(eartip_count_observed) AS total_eartips_seen,
        SUM(total_cats_observed) AS total_cats_seen,
        COUNT(*) AS observation_count
    FROM trapper.place_colony_estimates
    WHERE eartip_count_observed IS NOT NULL
      AND total_cats_observed IS NOT NULL
      AND observation_date >= CURRENT_DATE - INTERVAL '90 days'
    GROUP BY place_id
)

SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    p.atlas_id,

    -- Verified ground truth
    COALESCE(va.a_known, 0) AS a_known,
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

    -- Effective colony size (override or computed)
    COALESCE(
        p.colony_override_count,
        GREATEST(COALESCE(va.a_known, 0), COALESCE(rr.n_recent_max, 0))
    ) AS effective_colony_size,

    -- Effective altered count (override or verified)
    COALESCE(
        p.colony_override_altered,
        COALESCE(va.a_known, 0)
    ) AS effective_altered,

    -- Lower-bound alteration rate (respects override)
    CASE
        WHEN p.colony_override_count IS NOT NULL AND p.colony_override_count > 0 THEN
            ROUND(COALESCE(p.colony_override_altered, 0)::NUMERIC / p.colony_override_count::NUMERIC, 3)
        WHEN COALESCE(rr.n_recent_max, 0) > 0 OR COALESCE(va.a_known, 0) > 0 THEN
            ROUND(
                COALESCE(va.a_known, 0)::NUMERIC /
                GREATEST(COALESCE(va.a_known, 0), COALESCE(rr.n_recent_max, 1))::NUMERIC,
                3
            )
        ELSE NULL
    END AS p_lower,

    -- Percentage version
    CASE
        WHEN p.colony_override_count IS NOT NULL AND p.colony_override_count > 0 THEN
            ROUND(100.0 * COALESCE(p.colony_override_altered, 0)::NUMERIC / p.colony_override_count::NUMERIC, 1)
        WHEN COALESCE(rr.n_recent_max, 0) > 0 OR COALESCE(va.a_known, 0) > 0 THEN
            ROUND(
                100.0 * COALESCE(va.a_known, 0)::NUMERIC /
                GREATEST(COALESCE(va.a_known, 0), COALESCE(rr.n_recent_max, 1))::NUMERIC,
                1
            )
        ELSE NULL
    END AS p_lower_pct,

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
        WHEN eo.total_eartips_seen > 0 AND eo.total_cats_seen > 0 AND va.a_known > 0
        THEN GREATEST(0, ROUND(((va.a_known + 1) * (eo.total_cats_seen + 1)::NUMERIC / (eo.total_eartips_seen + 1)) - 1)::INTEGER - COALESCE(va.a_known, 0))
        ELSE GREATEST(0, COALESCE(rr.n_recent_max, 0) - COALESCE(va.a_known, 0))
    END AS estimated_work_remaining

FROM trapper.places p
LEFT JOIN verified_altered va ON va.place_id = p.place_id
LEFT JOIN recent_reports rr ON rr.place_id = p.place_id
LEFT JOIN eartip_observations eo ON eo.place_id = p.place_id
WHERE va.a_known > 0
   OR rr.n_recent_max > 0
   OR p.colony_override_count IS NOT NULL;

COMMENT ON VIEW trapper.v_place_ecology_stats IS
'Ecology-based colony metrics per place. Respects manual overrides when set.
- effective_colony_size: override or computed best estimate
- effective_altered: override or verified from clinic
- estimation_method: manual_override, mark_resight, max_recent, verified_only, no_data
- has_override: TRUE if staff has set manual count';

-- ============================================================
-- 6. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Override columns added:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'trapper'
  AND table_name = 'places'
  AND column_name LIKE 'colony_override%';

\echo ''
\echo 'Override history table created:'
SELECT COUNT(*) as history_rows FROM trapper.colony_override_history;

\echo ''
\echo 'View updated with override support:'
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'trapper'
  AND table_name = 'v_place_ecology_stats'
  AND column_name LIKE '%override%' OR column_name LIKE 'effective%'
ORDER BY ordinal_position;

SELECT 'MIG_215 Complete' AS status;
