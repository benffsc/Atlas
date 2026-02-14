-- MIG_209: Colony Size Tracking System
--
-- Purpose: Track colony size estimates from multiple sources with confidence scoring.
-- Combines data from:
--   - Project 75 (post-clinic surveys)
--   - Trapping requests (estimated_cat_count)
--   - Appointment requests
--   - Trapper site visits
--   - Verified cats in database
--
-- Key Features:
--   1. place_colony_estimates - All observations from various sources
--   2. v_place_colony_status - Computed "best estimate" with confidence
--   3. Recency decay and multi-source confirmation boosting

\echo ''
\echo '=============================================='
\echo 'MIG_209: Colony Size Tracking'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Colony Estimates Table
-- ============================================================

\echo 'Creating place_colony_estimates table...'

CREATE TABLE IF NOT EXISTS trapper.place_colony_estimates (
    estimate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Location
    place_id UUID NOT NULL REFERENCES trapper.places(place_id) ON DELETE CASCADE,

    -- The estimate (all nullable - sources may not have all fields)
    total_cats INTEGER,
    adult_count INTEGER,
    kitten_count INTEGER,
    altered_count INTEGER,      -- Already ear-tipped/fixed
    unaltered_count INTEGER,    -- Need spay/neuter
    friendly_count INTEGER,     -- Handleable
    feral_count INTEGER,        -- Not handleable

    -- Source classification
    source_type TEXT NOT NULL,  -- See enum below
    source_entity_type TEXT,    -- 'request', 'survey', 'site_visit', etc.
    source_entity_id UUID,      -- FK to the source record

    -- Who reported and when
    reported_by_person_id UUID REFERENCES trapper.sot_people(person_id),
    observation_date DATE,      -- When cats were actually observed
    reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Reliability indicators
    is_firsthand BOOLEAN DEFAULT TRUE,  -- Did reporter see cats themselves?
    notes TEXT,

    -- Provenance
    source_system TEXT,         -- 'airtable', 'web_app', 'clinichq'
    source_record_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL DEFAULT 'system',

    -- Prevent duplicate imports
    UNIQUE (source_system, source_record_id)
);

-- Source type enum for documentation
COMMENT ON COLUMN trapper.place_colony_estimates.source_type IS
'Source types and their base confidence:
  - verified_cats: 100% - Actual cats in database with place link
  - post_clinic_survey: 85% - Project 75 post-clinic survey
  - trapper_site_visit: 80% - Trapper assessment/visit report
  - manual_observation: 75% - Manual entry by staff
  - trapping_request: 60% - Requester estimate in trapping request
  - appointment_request: 50% - Estimate in appointment booking
  - intake_form: 55% - Web intake form submission';

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_colony_estimates_place
    ON trapper.place_colony_estimates(place_id);
CREATE INDEX IF NOT EXISTS idx_colony_estimates_observation_date
    ON trapper.place_colony_estimates(observation_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_colony_estimates_source
    ON trapper.place_colony_estimates(source_type);

-- ============================================================
-- 2. Source Confidence Configuration
-- ============================================================

\echo 'Creating colony_source_confidence table...'

CREATE TABLE IF NOT EXISTS trapper.colony_source_confidence (
    source_type TEXT PRIMARY KEY,
    base_confidence NUMERIC(4,2) NOT NULL,  -- 0.00 to 1.00
    description TEXT,
    is_firsthand_boost NUMERIC(4,2) DEFAULT 0.05  -- Boost if firsthand observation
);

-- Insert default confidence levels
INSERT INTO trapper.colony_source_confidence (source_type, base_confidence, description) VALUES
    ('verified_cats', 1.00, 'Actual cats in database with verified place link'),
    ('post_clinic_survey', 0.85, 'Project 75 post-clinic survey - recent firsthand'),
    ('trapper_site_visit', 0.80, 'Trapper assessment or site visit report'),
    ('manual_observation', 0.75, 'Manual entry by staff/admin'),
    ('trapping_request', 0.60, 'Requester estimate in trapping request'),
    ('intake_form', 0.55, 'Web intake form submission'),
    ('appointment_request', 0.50, 'Estimate in appointment booking')
ON CONFLICT (source_type) DO NOTHING;

-- ============================================================
-- 3. View: v_place_colony_status
-- Computes best estimate with weighted confidence
-- ============================================================

\echo 'Creating v_place_colony_status view...'

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

    -- Estimated counts
    COALESCE(a.estimated_total, vc.verified_cat_count, 0) AS colony_size_estimate,
    a.best_single_estimate,
    a.estimate_min,
    a.estimate_max,

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

    -- Work remaining estimate
    GREATEST(0, COALESCE(a.est_unaltered, a.estimated_total - COALESCE(vc.verified_altered_count, 0), 0)) AS estimated_work_remaining

FROM trapper.places p
LEFT JOIN verified_counts vc ON vc.place_id = p.place_id
LEFT JOIN aggregated a ON a.place_id = p.place_id
LEFT JOIN confirmations c ON c.place_id = p.place_id
WHERE vc.verified_cat_count > 0
   OR a.estimate_count > 0;

-- ============================================================
-- 4. Function to add colony estimate from request
-- ============================================================

\echo 'Creating add_colony_estimate_from_request function...'

CREATE OR REPLACE FUNCTION trapper.add_colony_estimate_from_request(
    p_request_id UUID
) RETURNS UUID AS $$
DECLARE
    v_request RECORD;
    v_estimate_id UUID;
BEGIN
    -- Get request data
    SELECT
        request_id,
        place_id,
        requester_person_id,
        estimated_cat_count,
        kitten_count,
        eartip_count,
        source_created_at,
        source_system,
        source_record_id
    INTO v_request
    FROM trapper.sot_requests
    WHERE request_id = p_request_id;

    IF v_request IS NULL OR v_request.place_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Skip if no estimate data
    IF v_request.estimated_cat_count IS NULL AND v_request.kitten_count IS NULL THEN
        RETURN NULL;
    END IF;

    -- Insert colony estimate
    INSERT INTO trapper.place_colony_estimates (
        place_id,
        total_cats,
        kitten_count,
        altered_count,
        source_type,
        source_entity_type,
        source_entity_id,
        reported_by_person_id,
        observation_date,
        is_firsthand,
        source_system,
        source_record_id,
        created_by
    ) VALUES (
        v_request.place_id,
        v_request.estimated_cat_count,
        v_request.kitten_count,
        v_request.eartip_count,
        CASE
            WHEN v_request.source_system = 'intake_form' THEN 'intake_form'
            ELSE 'trapping_request'
        END,
        'request',
        v_request.request_id,
        v_request.requester_person_id,
        COALESCE(v_request.source_created_at::date, CURRENT_DATE),
        TRUE,  -- Assume requester has seen the cats
        v_request.source_system,
        v_request.source_record_id,
        'add_colony_estimate_from_request'
    )
    ON CONFLICT (source_system, source_record_id)
    DO UPDATE SET
        total_cats = EXCLUDED.total_cats,
        kitten_count = EXCLUDED.kitten_count,
        altered_count = EXCLUDED.altered_count
    RETURNING estimate_id INTO v_estimate_id;

    RETURN v_estimate_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. Populate initial estimates from existing requests
-- ============================================================

\echo 'Populating initial colony estimates from requests...'

DO $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    -- Add estimates from all requests with cat counts
    WITH inserted AS (
        INSERT INTO trapper.place_colony_estimates (
            place_id,
            total_cats,
            kitten_count,
            altered_count,
            source_type,
            source_entity_type,
            source_entity_id,
            reported_by_person_id,
            observation_date,
            is_firsthand,
            source_system,
            source_record_id,
            created_by
        )
        SELECT
            r.place_id,
            r.estimated_cat_count,
            r.kitten_count,
            r.eartip_count,
            'trapping_request',
            'request',
            r.request_id,
            r.requester_person_id,
            COALESCE(r.source_created_at::date, r.created_at::date),
            TRUE,
            COALESCE(r.source_system, 'atlas'),
            COALESCE(r.source_record_id, r.request_id::text),
            'MIG_209_initial'
        FROM trapper.sot_requests r
        WHERE r.place_id IS NOT NULL
          AND r.estimated_cat_count IS NOT NULL
        ON CONFLICT (source_system, source_record_id) DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM inserted;

    RAISE NOTICE 'Inserted % colony estimates from requests', v_count;
END $$;

-- ============================================================
-- 6. Trigger to auto-add estimates when requests are created
-- ============================================================

\echo 'Creating auto-estimate trigger...'

CREATE OR REPLACE FUNCTION trapper.trigger_add_colony_estimate()
RETURNS TRIGGER AS $$
BEGIN
    -- Only if place_id and estimated_cat_count are set
    IF NEW.place_id IS NOT NULL AND NEW.estimated_cat_count IS NOT NULL THEN
        PERFORM trapper.add_colony_estimate_from_request(NEW.request_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_request_colony_estimate ON trapper.sot_requests;
CREATE TRIGGER trg_request_colony_estimate
    AFTER INSERT ON trapper.sot_requests
    FOR EACH ROW
    EXECUTE FUNCTION trapper.trigger_add_colony_estimate();

-- ============================================================
-- 7. Documentation
-- ============================================================

COMMENT ON TABLE trapper.place_colony_estimates IS
'Stores all colony size observations from various sources.
Each observation includes the source type, confidence, and observation date.
v_place_colony_status computes a weighted "best estimate" per place.

Data Sources:
- Trapping requests (estimated_cat_count)
- Project 75 post-clinic surveys
- Trapper site visits
- Intake forms
- Manual observations

Confidence is computed as: base_confidence * recency_decay + firsthand_boost
Multi-source confirmation (2+ sources agreeing) adds 15% confidence boost.';

COMMENT ON VIEW trapper.v_place_colony_status IS
'Computed colony size estimate per place with confidence scoring.

Key Fields:
- verified_cat_count: Actual cats in database (ground truth)
- colony_size_estimate: Weighted average of all estimates
- final_confidence: Overall confidence (0-1) with recency decay and confirmation boost
- estimated_work_remaining: Estimated cats still needing alteration';

\echo ''
\echo 'MIG_209 complete!'
\echo ''
\echo 'Created:'
\echo '  - place_colony_estimates table (all observations)'
\echo '  - colony_source_confidence table (source weights)'
\echo '  - v_place_colony_status view (computed estimates)'
\echo '  - add_colony_estimate_from_request() function'
\echo '  - Auto-trigger on request creation'
\echo ''
\echo 'Next steps:'
\echo '  - Run Project 75 ingest to populate post-clinic survey data'
\echo '  - Add trapper site visit estimates'
\echo ''
