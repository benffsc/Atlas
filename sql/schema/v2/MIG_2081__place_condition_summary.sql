-- MIG_2081: Place Condition Summary Views for V2
-- Date: 2026-02-14
-- Purpose: Create v_place_condition_summary for map badges
-- Uses V2 tables: sot.place_conditions, sot.condition_types

\echo ''
\echo '=============================================='
\echo '  MIG_2081: Place Condition Summary Views'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. PLACE CONDITION SUMMARY VIEW
-- ============================================================================

\echo '1. Creating ops.v_place_condition_summary...'

CREATE OR REPLACE VIEW ops.v_place_condition_summary AS
SELECT
    pc.place_id,
    -- Condition badges as JSONB array
    COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'condition_type', ct.condition_type,
                'label', ct.display_label,
                'color', ct.display_color,
                'severity', pc.severity,
                'valid_from', pc.valid_from,
                'valid_to', pc.valid_to,
                'peak_count', pc.peak_cat_count,
                'is_active', (pc.valid_to IS NULL OR pc.valid_to > CURRENT_DATE)
            )
            ORDER BY ct.display_order, pc.valid_from DESC
        ) FILTER (WHERE ct.condition_type IS NOT NULL),
        '[]'::jsonb
    ) AS condition_badges,
    -- Active condition count
    COUNT(*) FILTER (
        WHERE pc.valid_to IS NULL OR pc.valid_to > CURRENT_DATE
    ) AS active_condition_count,
    -- Has ecological conditions
    BOOL_OR(ct.is_ecological_significant) FILTER (
        WHERE pc.valid_to IS NULL OR pc.valid_to > CURRENT_DATE
    ) AS has_ecological_conditions,
    -- Most severe active condition (DB uses: minor, moderate, severe, critical)
    MAX(CASE pc.severity
        WHEN 'critical' THEN 4
        WHEN 'severe' THEN 3
        WHEN 'moderate' THEN 2
        WHEN 'minor' THEN 1
        ELSE 0
    END) FILTER (
        WHERE pc.valid_to IS NULL OR pc.valid_to > CURRENT_DATE
    ) AS max_severity_rank,
    -- Risk level based on severity (output: high/medium/low for UI)
    CASE MAX(CASE pc.severity
        WHEN 'critical' THEN 4
        WHEN 'severe' THEN 3
        WHEN 'moderate' THEN 2
        WHEN 'minor' THEN 1
        ELSE 0
    END) FILTER (WHERE pc.valid_to IS NULL OR pc.valid_to > CURRENT_DATE)
        WHEN 4 THEN 'critical'
        WHEN 3 THEN 'high'
        WHEN 2 THEN 'medium'
        WHEN 1 THEN 'low'
        ELSE 'none'
    END AS risk_level
FROM sot.place_conditions pc
LEFT JOIN sot.condition_types ct ON ct.condition_type = pc.condition_type
WHERE pc.superseded_at IS NULL  -- Only current records
GROUP BY pc.place_id;

COMMENT ON VIEW ops.v_place_condition_summary IS 'Summary of place conditions for map badges and risk assessment';

-- ============================================================================
-- 2. DISEASE/CONDITION RISK VIEW FOR MAP PINS
-- ============================================================================

\echo ''
\echo '2. Creating ops.v_place_risk_status...'

CREATE OR REPLACE VIEW ops.v_place_risk_status AS
SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    COALESCE(pcs.risk_level, 'none') AS risk_level,
    COALESCE(pcs.active_condition_count, 0) AS condition_count,
    COALESCE(pcs.condition_badges, '[]'::jsonb) AS condition_badges,
    COALESCE(pcs.has_ecological_conditions, FALSE) AS has_ecological_conditions,
    -- Watch list status (from place table if exists)
    FALSE AS watch_list,  -- TODO: Add watch_list column to sot.places if needed
    NULL AS watch_list_reason,
    -- Determine pin style based on risk
    CASE
        WHEN COALESCE(pcs.risk_level, 'none') IN ('critical', 'high') THEN 'disease'
        WHEN COALESCE(pcs.risk_level, 'none') IN ('medium', 'low') THEN 'active'
        ELSE 'minimal'
    END AS suggested_pin_style
FROM sot.places p
LEFT JOIN ops.v_place_condition_summary pcs ON pcs.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL;

COMMENT ON VIEW ops.v_place_risk_status IS 'Place risk status for map pin styling';

-- ============================================================================
-- 3. COMPATIBILITY VIEWS
-- ============================================================================

\echo ''
\echo '3. Creating trapper compatibility views...'

-- Alias for code expecting v_place_disease_summary
CREATE OR REPLACE VIEW trapper.v_place_disease_summary AS
SELECT
    place_id,
    condition_badges AS disease_badges,
    active_condition_count AS disease_count,
    risk_level AS disease_risk
FROM ops.v_place_condition_summary;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

SELECT 'ops.v_place_condition_summary' AS view_name, COUNT(*) AS row_count FROM ops.v_place_condition_summary
UNION ALL
SELECT 'ops.v_place_risk_status', COUNT(*) FROM ops.v_place_risk_status;

\echo ''
\echo '=============================================='
\echo '  MIG_2081 Complete!'
\echo '=============================================='
\echo ''
