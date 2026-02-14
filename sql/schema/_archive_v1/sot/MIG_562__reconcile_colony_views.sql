-- MIG_562__reconcile_colony_views.sql
-- Update colony views to use GREATEST pattern and add staff_verified source type
--
-- Problem:
--   When verified_altered > reported_estimate, we get >100% alteration rates
--   Example: 10 altered / 9 reported = 111% (impossible)
--
-- Solution:
--   Apply GREATEST(verified_altered, reported_estimate) as effective colony size
--   This is Bayesian updating - clinic data is ground truth that updates priors
--
-- Formula:
--   effective_colony_size = MAX(verified_altered, reported_estimate)
--   work_remaining = effective_colony_size - verified_altered
--   alteration_rate = verified_altered / effective_colony_size (capped at 100%)
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_562__reconcile_colony_views.sql

\echo ''
\echo '=============================================='
\echo 'MIG_562: Reconcile Colony Views with GREATEST'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Add staff_verified source type with high confidence
-- ============================================================

\echo 'Adding staff_verified source type...'

INSERT INTO trapper.colony_source_confidence (source_type, base_confidence, description)
VALUES ('staff_verified', 0.95, 'Staff-verified count from request upgrade or site visit')
ON CONFLICT (source_type) DO UPDATE SET
    base_confidence = 0.95,
    description = 'Staff-verified count from request upgrade or site visit';

-- Also add ai_parsed if not exists (for cleanup queries)
INSERT INTO trapper.colony_source_confidence (source_type, base_confidence, description)
VALUES ('ai_parsed', 0.40, 'AI-parsed estimate from notes - lower confidence')
ON CONFLICT (source_type) DO NOTHING;

-- ============================================================
-- 2. Update v_place_colony_status with GREATEST pattern
-- ============================================================

\echo ''
\echo 'Updating v_place_colony_status with GREATEST pattern...'

CREATE OR REPLACE VIEW trapper.v_place_colony_status AS
WITH
-- Get verified cat count from database (ground truth)
verified_counts AS (
    SELECT
        cpr.place_id,
        COUNT(DISTINCT cpr.cat_id) AS verified_cat_count,
        COUNT(DISTINCT cpr.cat_id) FILTER (
            WHERE EXISTS (
                SELECT 1 FROM trapper.cat_procedures cp
                WHERE cp.cat_id = cpr.cat_id
                AND (cp.is_spay OR cp.is_neuter)
            )
        ) AS verified_altered_count,
        MAX(cpr.created_at) AS last_verified_at
    FROM trapper.cat_place_relationships cpr
    JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
        AND c.merged_into_cat_id IS NULL  -- Exclude merged cats
    GROUP BY cpr.place_id
),

-- Calculate recency-weighted confidence for each estimate
weighted_estimates AS (
    SELECT
        e.place_id,
        e.estimate_id,
        e.total_cats,
        e.adult_count,
        e.kitten_count,
        e.altered_count,
        e.unaltered_count,
        e.friendly_count,
        e.feral_count,
        e.source_type,
        e.observation_date,
        e.reported_at,
        e.is_firsthand,
        -- Base confidence from source type
        COALESCE(sc.base_confidence, 0.50) AS base_confidence,
        -- Days since observation (use reported_at if observation_date null)
        EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) AS days_ago,
        -- Recency decay factor
        CASE
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 30
                THEN 1.0
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 90
                THEN 0.90
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 180
                THEN 0.75
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 365
                THEN 0.50
            ELSE 0.25
        END AS recency_factor,
        -- Firsthand boost
        CASE WHEN e.is_firsthand THEN COALESCE(sc.is_firsthand_boost, 0.05) ELSE 0 END AS firsthand_boost
    FROM trapper.place_colony_estimates e
    LEFT JOIN trapper.colony_source_confidence sc ON sc.source_type = e.source_type
    WHERE e.total_cats IS NOT NULL
),

-- Calculate final weighted confidence
scored_estimates AS (
    SELECT
        *,
        -- Final confidence = base * recency + firsthand_boost, capped at 1.0
        LEAST(1.0, (base_confidence * recency_factor) + firsthand_boost) AS final_confidence
    FROM weighted_estimates
),

-- Aggregate per place with weighted average
aggregated AS (
    SELECT
        se.place_id,
        -- Weighted average of total cats
        ROUND(
            SUM(se.total_cats * se.final_confidence) / NULLIF(SUM(se.final_confidence), 0)
        )::INTEGER AS estimated_total,
        -- Best single estimate (highest confidence)
        (ARRAY_AGG(se.total_cats ORDER BY se.final_confidence DESC))[1] AS best_single_estimate,
        -- Range
        MIN(se.total_cats) AS estimate_min,
        MAX(se.total_cats) AS estimate_max,
        -- Counts
        COUNT(*) AS estimate_count,
        COUNT(*) FILTER (WHERE se.days_ago <= 90) AS recent_estimate_count,
        -- Average confidence
        ROUND(AVG(se.final_confidence)::NUMERIC, 2) AS avg_confidence,
        -- Most confident source
        (ARRAY_AGG(se.source_type ORDER BY se.final_confidence DESC))[1] AS primary_source,
        -- Most recent observation
        MAX(se.observation_date) AS latest_observation,
        -- Breakdown from most recent high-confidence estimate
        (ARRAY_AGG(se.adult_count ORDER BY se.final_confidence DESC, se.observation_date DESC NULLS LAST))[1] AS est_adults,
        (ARRAY_AGG(se.kitten_count ORDER BY se.final_confidence DESC, se.observation_date DESC NULLS LAST))[1] AS est_kittens,
        (ARRAY_AGG(se.altered_count ORDER BY se.final_confidence DESC, se.observation_date DESC NULLS LAST))[1] AS est_altered,
        (ARRAY_AGG(se.unaltered_count ORDER BY se.final_confidence DESC, se.observation_date DESC NULLS LAST))[1] AS est_unaltered,
        (ARRAY_AGG(se.friendly_count ORDER BY se.final_confidence DESC, se.observation_date DESC NULLS LAST))[1] AS est_friendly,
        (ARRAY_AGG(se.feral_count ORDER BY se.final_confidence DESC, se.observation_date DESC NULLS LAST))[1] AS est_feral
    FROM scored_estimates se
    GROUP BY se.place_id
),

-- Check for multi-source confirmation (2+ sources agreeing within 20%)
confirmations AS (
    SELECT
        se.place_id,
        CASE
            WHEN COUNT(DISTINCT se.source_type) >= 2
                AND MAX(se.total_cats) <= MIN(se.total_cats) * 1.2
            THEN TRUE
            ELSE FALSE
        END AS is_multi_source_confirmed
    FROM scored_estimates se
    WHERE se.days_ago <= 90
    GROUP BY se.place_id
)

SELECT
    p.place_id,
    p.display_name AS place_name,
    p.formatted_address,
    p.service_zone,

    -- Verified count (ground truth)
    COALESCE(vc.verified_cat_count, 0) AS verified_cat_count,
    COALESCE(vc.verified_altered_count, 0) AS verified_altered_count,
    vc.last_verified_at,

    -- Raw estimated counts (before GREATEST adjustment)
    a.estimated_total AS raw_estimated_total,
    a.best_single_estimate,
    a.estimate_min,
    a.estimate_max,

    -- COLONY SIZE: Use GREATEST(verified_altered, estimated) to prevent >100% rates
    -- Manual override takes precedence, then GREATEST pattern
    COALESCE(
        p.colony_override_count,
        GREATEST(
            COALESCE(vc.verified_altered_count, 0),
            COALESCE(a.estimated_total, 0)
        )
    ) AS colony_size_estimate,

    -- Breakdown
    a.est_adults,
    a.est_kittens,
    a.est_altered,
    a.est_unaltered,
    a.est_friendly,
    a.est_feral,

    -- Confidence info
    a.estimate_count,
    a.recent_estimate_count,
    a.avg_confidence,
    COALESCE(c.is_multi_source_confirmed, FALSE) AS is_multi_source_confirmed,

    -- Boosted confidence if multi-source confirmed
    CASE
        WHEN c.is_multi_source_confirmed THEN LEAST(1.0, COALESCE(a.avg_confidence, 0) + 0.15)
        ELSE a.avg_confidence
    END AS final_confidence,

    a.primary_source,
    a.latest_observation,

    -- WORK REMAINING: Calculate based on effective colony size
    -- Manual override takes precedence, then calculated
    COALESCE(
        CASE WHEN p.colony_override_count IS NOT NULL
             THEN GREATEST(0, p.colony_override_count - COALESCE(p.colony_override_altered, 0))
             ELSE NULL
        END,
        GREATEST(0,
            GREATEST(COALESCE(vc.verified_altered_count, 0), COALESCE(a.estimated_total, 0)) -
            COALESCE(vc.verified_altered_count, 0)
        )
    ) AS estimated_work_remaining,

    -- ALTERATION RATE: Capped at 100% using GREATEST pattern
    CASE
        WHEN p.colony_override_count IS NOT NULL AND p.colony_override_count > 0 THEN
            LEAST(100.0, ROUND(100.0 * COALESCE(p.colony_override_altered, 0) / p.colony_override_count, 1))
        WHEN GREATEST(COALESCE(vc.verified_altered_count, 0), COALESCE(a.estimated_total, 1)) > 0 THEN
            LEAST(100.0, ROUND(
                100.0 * COALESCE(vc.verified_altered_count, 0) /
                GREATEST(COALESCE(vc.verified_altered_count, 0), COALESCE(a.estimated_total, 1)),
                1
            ))
        ELSE NULL
    END AS alteration_rate_pct,

    -- Override info
    p.colony_override_count IS NOT NULL AS has_override,
    p.colony_override_count,
    p.colony_override_altered,
    p.colony_override_note,
    p.colony_override_at,
    p.colony_override_by,

    -- Estimation method for transparency
    CASE
        WHEN p.colony_override_count IS NOT NULL THEN 'Staff Override'
        WHEN COALESCE(vc.verified_altered_count, 0) > COALESCE(a.estimated_total, 0) THEN 'Verified (exceeds estimate)'
        WHEN a.estimated_total IS NOT NULL THEN 'Estimated'
        ELSE 'Verified Only'
    END AS estimation_method

FROM trapper.places p
LEFT JOIN verified_counts vc ON vc.place_id = p.place_id
LEFT JOIN aggregated a ON a.place_id = p.place_id
LEFT JOIN confirmations c ON c.place_id = p.place_id
WHERE vc.verified_cat_count > 0
   OR a.estimate_count > 0
   OR p.colony_override_count IS NOT NULL;

COMMENT ON VIEW trapper.v_place_colony_status IS
'Colony status per place using GREATEST pattern to prevent >100% alteration rates.

Key formulas:
  effective_colony_size = MAX(verified_altered, reported_estimate)
  work_remaining = effective_colony_size - verified_altered
  alteration_rate = verified_altered / effective_colony_size (capped at 100%)

Why GREATEST pattern:
  When we alter more cats than estimated (10 vs 9), the colony is at least 10.
  This is Bayesian updating - clinic data is ground truth.

Fields:
  - colony_size_estimate: Effective size using GREATEST pattern (or override)
  - estimated_work_remaining: Remaining cats to alter
  - alteration_rate_pct: Percentage altered (never >100%)
  - estimation_method: How the estimate was derived
  - has_override: TRUE if staff has set manual count';

-- ============================================================
-- 3. Create request-scoped colony summary view
-- ============================================================

\echo ''
\echo 'Creating v_request_colony_summary view...'

CREATE OR REPLACE VIEW trapper.v_request_colony_summary AS
SELECT
    r.request_id,
    r.place_id,

    -- Request-level reported counts
    r.total_cats_reported,
    r.estimated_cat_count AS cats_still_needing_tnr,
    r.cat_count_semantic,

    -- Cats explicitly linked to this request via request_cat_links
    COALESCE(rcl.request_linked_cats, 0) AS request_linked_cats,
    COALESCE(rcl.request_altered_cats, 0) AS request_altered_cats,

    -- Place-level verified counts (all historical cats at place)
    COALESCE(pcs.verified_cat_count, 0) AS place_verified_cats,
    COALESCE(pcs.verified_altered_count, 0) AS place_verified_altered,

    -- Place-level colony estimate
    COALESCE(pcs.colony_size_estimate, 0) AS place_colony_size,
    COALESCE(pcs.estimated_work_remaining, 0) AS place_work_remaining,
    pcs.alteration_rate_pct AS place_alteration_rate,

    -- Override info from place
    pcs.has_override,
    pcs.colony_override_count,
    pcs.colony_override_altered,
    pcs.colony_override_note,

    -- Effective remaining (from staff upgrade or calculated)
    COALESCE(
        r.estimated_cat_count,  -- Staff said "X remaining" during upgrade
        pcs.estimated_work_remaining
    ) AS effective_remaining,

    -- Flags for UI display
    COALESCE(pcs.verified_altered_count, 0) > COALESCE(r.total_cats_reported, 0)
        AND r.total_cats_reported IS NOT NULL
        AS verified_exceeds_reported,

    pcs.estimation_method

FROM trapper.sot_requests r
LEFT JOIN trapper.v_place_colony_status pcs ON pcs.place_id = r.place_id
LEFT JOIN LATERAL (
    SELECT
        COUNT(DISTINCT rcl.cat_id) AS request_linked_cats,
        COUNT(DISTINCT rcl.cat_id) FILTER (
            WHERE EXISTS (
                SELECT 1 FROM trapper.cat_procedures cp
                WHERE cp.cat_id = rcl.cat_id
                AND (cp.is_spay OR cp.is_neuter)
            )
        ) AS request_altered_cats
    FROM trapper.request_cat_links rcl
    WHERE rcl.request_id = r.request_id
) rcl ON TRUE;

COMMENT ON VIEW trapper.v_request_colony_summary IS
'Request-scoped colony summary combining request data with place-level stats.

Use this view on request detail pages to show:
  - Requester''s original reported count (total_cats_reported)
  - Staff-updated remaining count (cats_still_needing_tnr)
  - Place-level verified data (for context)
  - Flag when verified exceeds reported (needs reconciliation)';

-- ============================================================
-- 4. Add function to auto-reconcile on upgrade
-- ============================================================

\echo ''
\echo 'Creating auto_reconcile_colony_on_upgrade function...'

CREATE OR REPLACE FUNCTION trapper.auto_reconcile_colony_on_upgrade(
    p_request_id UUID,
    p_total_cats_reported INTEGER,
    p_cats_still_needing INTEGER,
    p_upgraded_by TEXT DEFAULT 'app_user'
) RETURNS TABLE (
    reconciled BOOLEAN,
    new_colony_size INTEGER,
    verified_altered INTEGER,
    message TEXT
) AS $$
DECLARE
    v_place_id UUID;
    v_verified_altered INTEGER;
    v_new_colony_size INTEGER;
BEGIN
    -- Get the place_id for this request
    SELECT r.place_id INTO v_place_id
    FROM trapper.sot_requests r
    WHERE r.request_id = p_request_id;

    IF v_place_id IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::INTEGER, NULL::INTEGER, 'Request has no place_id';
        RETURN;
    END IF;

    -- Get current verified altered count for the place
    SELECT COUNT(DISTINCT cp.cat_id)::INTEGER INTO v_verified_altered
    FROM trapper.cat_procedures cp
    JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = cp.cat_id
    JOIN trapper.sot_cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE cpr.place_id = v_place_id
      AND (cp.is_spay OR cp.is_neuter);

    v_verified_altered := COALESCE(v_verified_altered, 0);

    -- If verified exceeds reported, we need to reconcile
    IF v_verified_altered >= COALESCE(p_total_cats_reported, 0) AND p_cats_still_needing IS NOT NULL THEN
        v_new_colony_size := v_verified_altered + p_cats_still_needing;

        -- Set manual override with staff's authoritative input
        PERFORM trapper.set_colony_override(
            v_place_id,
            v_new_colony_size,
            v_verified_altered,
            format('Auto-reconciled: %s verified altered + %s remaining = %s total (staff upgrade)',
                   v_verified_altered, p_cats_still_needing, v_new_colony_size),
            p_upgraded_by
        );

        -- Delete old AI-parsed estimates that are now stale
        DELETE FROM trapper.place_colony_estimates
        WHERE place_id = v_place_id
          AND source_type = 'ai_parsed'
          AND observation_date < CURRENT_DATE - INTERVAL '7 days';

        RETURN QUERY SELECT
            TRUE,
            v_new_colony_size,
            v_verified_altered,
            format('Reconciled: %s altered + %s remaining = %s colony size', v_verified_altered, p_cats_still_needing, v_new_colony_size);
        RETURN;
    END IF;

    RETURN QUERY SELECT
        FALSE,
        GREATEST(v_verified_altered, COALESCE(p_total_cats_reported, 0)),
        v_verified_altered,
        'No reconciliation needed - estimate >= verified';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.auto_reconcile_colony_on_upgrade IS
'Automatically reconcile colony estimates when staff upgrades a request.

When verified_altered >= total_cats_reported and staff provides cats_still_needing:
  new_colony_size = verified_altered + cats_still_needing

This applies the Bayesian updating principle: clinic data is ground truth.

Called from the upgrade API when cat_count_clarification = "total".';

-- ============================================================
-- 5. Add function to insert staff-verified estimate
-- ============================================================

\echo ''
\echo 'Creating add_staff_verified_estimate function...'

CREATE OR REPLACE FUNCTION trapper.add_staff_verified_estimate(
    p_place_id UUID,
    p_total_cats INTEGER,
    p_source_request_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_estimate_id UUID;
BEGIN
    INSERT INTO trapper.place_colony_estimates (
        place_id,
        total_cats,
        source_type,
        observation_date,
        notes,
        source_system,
        source_entity_type,
        source_entity_id,
        is_firsthand,
        created_by
    ) VALUES (
        p_place_id,
        p_total_cats,
        'staff_verified',
        CURRENT_DATE,
        COALESCE(p_notes, 'Staff-verified count from request upgrade'),
        'atlas_ui',
        CASE WHEN p_source_request_id IS NOT NULL THEN 'request' ELSE NULL END,
        p_source_request_id,
        TRUE,
        'add_staff_verified_estimate'
    )
    RETURNING estimate_id INTO v_estimate_id;

    RETURN v_estimate_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.add_staff_verified_estimate IS
'Add a staff-verified colony estimate. Used when staff provides authoritative count during upgrade.';

-- ============================================================
-- 6. Verification queries
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Source confidence levels:'
SELECT source_type, base_confidence, description
FROM trapper.colony_source_confidence
ORDER BY base_confidence DESC;

\echo ''
\echo 'v_place_colony_status columns:'
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'trapper'
  AND table_name = 'v_place_colony_status'
ORDER BY ordinal_position;

\echo ''
\echo 'v_request_colony_summary columns:'
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'trapper'
  AND table_name = 'v_request_colony_summary'
ORDER BY ordinal_position;

\echo ''
\echo 'Sample colony status (places where verified > estimated):'
SELECT
    place_name,
    verified_altered_count,
    raw_estimated_total,
    colony_size_estimate,
    estimated_work_remaining,
    alteration_rate_pct,
    estimation_method
FROM trapper.v_place_colony_status
WHERE verified_altered_count > COALESCE(raw_estimated_total, 0)
LIMIT 5;

\echo ''
\echo 'MIG_562 Complete!'
\echo ''
\echo 'Changes made:'
\echo '  - Added staff_verified source type (95% confidence)'
\echo '  - Updated v_place_colony_status with GREATEST pattern'
\echo '  - Created v_request_colony_summary view'
\echo '  - Created auto_reconcile_colony_on_upgrade() function'
\echo '  - Created add_staff_verified_estimate() function'
\echo ''
\echo 'Key formulas:'
\echo '  colony_size = MAX(verified_altered, estimated)'
\echo '  work_remaining = colony_size - verified_altered'
\echo '  alteration_rate = verified_altered / colony_size (max 100%)'
\echo ''
