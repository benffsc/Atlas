-- MIG_565__colony_growth_projection.sql
-- Add temporal growth projection for colony estimates
--
-- Purpose:
--   Project colony population forward in time to:
--   1. Prioritize sites by predicted growth
--   2. Estimate current population from stale observations
--   3. Model the impact of delayed intervention
--
-- Scientific Basis:
--   Unmanaged cat colonies grow exponentially until resource-limited.
--   Growth rate lambda = 1.78/year (Boone et al. 2019)
--   This means an unmanaged colony roughly doubles in ~1.5 years.
--
-- Formula:
--   N(t) = N(0) * lambda^t
--   where t is time in years since last observation
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_565__colony_growth_projection.sql

\echo ''
\echo '=============================================='
\echo 'MIG_565: Colony Growth Projection'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Create ecology parameters table
-- ============================================================

\echo 'Creating ecology_parameters table...'

CREATE TABLE IF NOT EXISTS trapper.ecology_parameters (
    parameter_key TEXT PRIMARY KEY,
    parameter_value NUMERIC NOT NULL,
    unit TEXT,
    description TEXT,
    source_citation TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by TEXT DEFAULT 'system'
);

COMMENT ON TABLE trapper.ecology_parameters IS
'Configurable parameters for colony population modeling.
Based on peer-reviewed literature, adjustable for local conditions.';

-- Insert default parameters from literature
INSERT INTO trapper.ecology_parameters (parameter_key, parameter_value, unit, description, source_citation)
VALUES
    ('lambda_annual', 1.78, 'ratio/year',
     'Annual population growth rate for unmanaged colonies',
     'Boone et al. 2019. Free-ranging cat population dynamics. Population Ecology.'),

    ('kitten_survival_rate', 0.25, 'proportion',
     'Proportion of kittens surviving to adulthood (pre-weaning mortality ~75%)',
     'Nutter et al. 2004. Kitten mortality in a managed colony. J Am Vet Med Assoc.'),

    ('adult_survival_rate', 0.80, 'proportion',
     'Annual survival rate for adult cats',
     'Levy et al. 2003. Evaluation of TNR programs. J Am Vet Med Assoc.'),

    ('litters_per_year', 2.5, 'count/year',
     'Average litters per unaltered female per year',
     'Scott et al. 2002. Feral cats: biology and control. J Feline Med Surg.'),

    ('kittens_per_litter', 4.0, 'count/litter',
     'Average kittens per litter',
     'Root Kustritz 2007. Determining optimal age for gonadectomy. J Am Vet Med Assoc.'),

    ('carrying_capacity_factor', 0.5, 'multiplier',
     'Growth slows as population approaches 2x initial size (resource limitation)',
     'Estimated from logistic growth models'),

    ('stale_observation_months', 6, 'months',
     'Observations older than this trigger growth projection',
     'Atlas operational parameter'),

    ('projection_cap_years', 3, 'years',
     'Maximum years to project forward (prevents runaway estimates)',
     'Atlas operational parameter')
ON CONFLICT (parameter_key) DO NOTHING;

-- ============================================================
-- 2. Function to get ecology parameter
-- ============================================================

\echo ''
\echo 'Creating get_ecology_param function...'

CREATE OR REPLACE FUNCTION trapper.get_ecology_param(p_key TEXT)
RETURNS NUMERIC AS $$
    SELECT parameter_value FROM trapper.ecology_parameters WHERE parameter_key = p_key;
$$ LANGUAGE SQL STABLE;

-- ============================================================
-- 3. Function to project colony growth
-- ============================================================

\echo ''
\echo 'Creating project_colony_growth function...'

CREATE OR REPLACE FUNCTION trapper.project_colony_growth(
    p_initial_population INTEGER,
    p_years_elapsed NUMERIC,
    p_altered_count INTEGER DEFAULT 0
) RETURNS TABLE (
    projected_population INTEGER,
    unaltered_projected INTEGER,
    growth_factor NUMERIC,
    projection_method TEXT
) AS $$
DECLARE
    v_lambda NUMERIC;
    v_cap_years NUMERIC;
    v_carrying_cap NUMERIC;
    v_years_capped NUMERIC;
    v_unaltered INTEGER;
    v_growth NUMERIC;
    v_projected NUMERIC;
BEGIN
    -- Get parameters
    v_lambda := trapper.get_ecology_param('lambda_annual');
    v_cap_years := trapper.get_ecology_param('projection_cap_years');
    v_carrying_cap := trapper.get_ecology_param('carrying_capacity_factor');

    -- Use defaults if parameters not set
    v_lambda := COALESCE(v_lambda, 1.78);
    v_cap_years := COALESCE(v_cap_years, 3);
    v_carrying_cap := COALESCE(v_carrying_cap, 0.5);

    -- Cap projection years
    v_years_capped := LEAST(p_years_elapsed, v_cap_years);

    -- Only unaltered cats reproduce
    v_unaltered := GREATEST(0, p_initial_population - COALESCE(p_altered_count, 0));

    IF v_unaltered = 0 THEN
        -- No growth if all cats altered
        RETURN QUERY SELECT
            p_initial_population,
            0,
            1.0::NUMERIC,
            'no_growth_all_altered'::TEXT;
        RETURN;
    END IF;

    IF v_years_capped <= 0 THEN
        -- No projection needed
        RETURN QUERY SELECT
            p_initial_population,
            v_unaltered,
            1.0::NUMERIC,
            'current_observation'::TEXT;
        RETURN;
    END IF;

    -- Exponential growth with carrying capacity limit
    -- Growth slows as colony approaches 2x initial size
    v_growth := POWER(v_lambda, v_years_capped);

    -- Apply carrying capacity constraint (logistic growth approximation)
    -- New unaltered = old unaltered * growth, but capped
    v_projected := v_unaltered * v_growth;
    v_projected := LEAST(v_projected, v_unaltered * (1 + v_carrying_cap * v_years_capped));

    RETURN QUERY SELECT
        (COALESCE(p_altered_count, 0) + ROUND(v_projected))::INTEGER,
        ROUND(v_projected)::INTEGER,
        ROUND(v_growth, 3),
        CASE
            WHEN v_years_capped = v_cap_years THEN 'capped_projection'
            ELSE 'exponential_projection'
        END::TEXT;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.project_colony_growth IS
'Projects colony population forward based on time elapsed since observation.

Parameters:
- p_initial_population: Last observed population
- p_years_elapsed: Time since observation in years
- p_altered_count: Known altered cats (don''t reproduce)

Returns projected population accounting for:
- Only unaltered cats reproducing (lambda = 1.78/year)
- Carrying capacity constraint (growth slows at 2x initial)
- Maximum projection cap (3 years default)

Scientific basis: Boone et al. 2019 feral cat population dynamics.';

-- ============================================================
-- 4. View with projected colony estimates
-- ============================================================

\echo ''
\echo 'Creating v_place_colony_projected view...'

CREATE OR REPLACE VIEW trapper.v_place_colony_projected AS
WITH observation_age AS (
    SELECT
        pcs.place_id,
        pcs.place_name,
        pcs.colony_size_estimate,
        pcs.verified_altered_count,
        pcs.estimated_work_remaining,
        pcs.alteration_rate_pct,
        pcs.estimation_method,
        pcs.latest_observation,
        -- Years since last observation
        EXTRACT(EPOCH FROM (NOW() - COALESCE(pcs.latest_observation, NOW() - INTERVAL '1 year'))) / (365.25 * 24 * 3600) AS years_since_observation,
        -- Is observation stale?
        COALESCE(pcs.latest_observation, NOW() - INTERVAL '1 year') <
            NOW() - (trapper.get_ecology_param('stale_observation_months') || ' months')::INTERVAL AS is_stale
    FROM trapper.v_place_colony_status pcs
)
SELECT
    oa.place_id,
    oa.place_name,

    -- Current observed values
    oa.colony_size_estimate AS observed_colony_size,
    oa.verified_altered_count,
    oa.estimated_work_remaining AS observed_work_remaining,
    oa.alteration_rate_pct AS observed_alteration_rate,
    oa.latest_observation,
    oa.years_since_observation,
    oa.is_stale,

    -- Projected values
    proj.projected_population,
    proj.unaltered_projected,
    proj.growth_factor,
    proj.projection_method,

    -- Effective values (use projection if stale)
    CASE
        WHEN oa.is_stale AND proj.projected_population IS NOT NULL
        THEN proj.projected_population
        ELSE oa.colony_size_estimate
    END AS effective_colony_size,

    CASE
        WHEN oa.is_stale AND proj.unaltered_projected IS NOT NULL
        THEN proj.unaltered_projected
        ELSE oa.estimated_work_remaining
    END AS effective_work_remaining,

    -- Effective alteration rate
    CASE
        WHEN oa.is_stale AND proj.projected_population > 0
        THEN LEAST(100.0, ROUND(100.0 * oa.verified_altered_count / proj.projected_population, 1))
        ELSE oa.alteration_rate_pct
    END AS effective_alteration_rate,

    -- Priority score based on projected growth
    CASE
        WHEN oa.is_stale AND proj.unaltered_projected > 20 THEN 5
        WHEN oa.is_stale AND proj.unaltered_projected > 10 THEN 4
        WHEN proj.unaltered_projected > 15 THEN 3
        WHEN proj.unaltered_projected > 5 THEN 2
        ELSE 1
    END AS growth_priority_score,

    -- Urgency flag
    oa.is_stale AND proj.growth_factor > 1.5 AS needs_urgent_revisit,

    oa.estimation_method

FROM observation_age oa
LEFT JOIN LATERAL trapper.project_colony_growth(
    oa.colony_size_estimate,
    oa.years_since_observation,
    oa.verified_altered_count
) proj ON TRUE;

COMMENT ON VIEW trapper.v_place_colony_projected IS
'Colony estimates with temporal growth projection.

Key Fields:
- observed_*: Last observed values
- effective_*: Projected values if observation is stale (>6 months)
- growth_priority_score: 1-5, higher = more urgent
- needs_urgent_revisit: TRUE if stale + significant projected growth

Use this view for prioritizing sites by predicted population explosion.';

-- ============================================================
-- 5. Function to get priority sites by projected growth
-- ============================================================

\echo ''
\echo 'Creating get_growth_priority_sites function...'

CREATE OR REPLACE FUNCTION trapper.get_growth_priority_sites(
    p_limit INTEGER DEFAULT 20,
    p_min_unaltered INTEGER DEFAULT 5
) RETURNS TABLE (
    place_id UUID,
    place_name TEXT,
    observed_colony_size INTEGER,
    projected_colony_size INTEGER,
    growth_factor NUMERIC,
    years_since_observation NUMERIC,
    effective_work_remaining INTEGER,
    priority_score INTEGER,
    needs_urgent_revisit BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        pcp.place_id,
        pcp.place_name,
        pcp.observed_colony_size,
        pcp.effective_colony_size,
        pcp.growth_factor,
        ROUND(pcp.years_since_observation::NUMERIC, 2),
        pcp.effective_work_remaining,
        pcp.growth_priority_score,
        pcp.needs_urgent_revisit
    FROM trapper.v_place_colony_projected pcp
    WHERE pcp.effective_work_remaining >= p_min_unaltered
    ORDER BY
        pcp.needs_urgent_revisit DESC,
        pcp.growth_priority_score DESC,
        pcp.effective_work_remaining DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.get_growth_priority_sites IS
'Returns sites prioritized by projected population growth.
Use for identifying colonies that need immediate intervention.';

-- ============================================================
-- 6. View for cluster-level projected estimates
-- ============================================================

\echo ''
\echo 'Creating v_cluster_colony_projected view...'

CREATE OR REPLACE VIEW trapper.v_cluster_colony_projected AS
SELECT
    cce.cluster_id,
    cce.place_ids,
    cce.place_count,
    cce.centroid_lat,
    cce.centroid_lng,

    -- Observed values
    cce.cluster_colony_size AS observed_cluster_size,
    cce.cluster_altered_cats,
    cce.cluster_work_remaining AS observed_work_remaining,
    cce.cluster_alteration_rate AS observed_rate,
    cce.latest_observation,

    -- Time since observation
    EXTRACT(EPOCH FROM (NOW() - COALESCE(cce.latest_observation, NOW() - INTERVAL '1 year'))) / (365.25 * 24 * 3600) AS years_since_observation,

    -- Projected values
    proj.projected_population AS projected_cluster_size,
    proj.unaltered_projected AS projected_work_remaining,
    proj.growth_factor,

    -- Effective values
    CASE
        WHEN cce.latest_observation < NOW() - INTERVAL '6 months' AND proj.projected_population IS NOT NULL
        THEN proj.projected_population
        ELSE cce.cluster_colony_size
    END AS effective_cluster_size,

    CASE
        WHEN cce.latest_observation < NOW() - INTERVAL '6 months' AND proj.unaltered_projected IS NOT NULL
        THEN proj.unaltered_projected
        ELSE cce.cluster_work_remaining
    END AS effective_work_remaining,

    -- Priority
    CASE
        WHEN proj.unaltered_projected > 30 THEN 5
        WHEN proj.unaltered_projected > 20 THEN 4
        WHEN proj.unaltered_projected > 10 THEN 3
        WHEN proj.unaltered_projected > 5 THEN 2
        ELSE 1
    END AS cluster_priority_score

FROM trapper.v_cluster_colony_estimates cce
LEFT JOIN LATERAL trapper.project_colony_growth(
    cce.cluster_colony_size,
    EXTRACT(EPOCH FROM (NOW() - COALESCE(cce.latest_observation, NOW() - INTERVAL '1 year'))) / (365.25 * 24 * 3600),
    cce.cluster_altered_cats
) proj ON TRUE;

COMMENT ON VIEW trapper.v_cluster_colony_projected IS
'Cluster-level estimates with temporal growth projection.
Use for Beacon visualization showing predicted hotspots.';

-- ============================================================
-- 7. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Ecology parameters:'
SELECT parameter_key, parameter_value, unit, description
FROM trapper.ecology_parameters
ORDER BY parameter_key;

\echo ''
\echo 'Sample growth projection (10 cats, 1 year, 3 altered):'
SELECT * FROM trapper.project_colony_growth(10, 1.0, 3);

\echo ''
\echo 'Top 10 priority sites by projected growth:'
SELECT * FROM trapper.get_growth_priority_sites(10, 3);

\echo ''
\echo 'Places needing urgent revisit:'
SELECT
    place_name,
    observed_colony_size,
    effective_colony_size,
    growth_factor,
    ROUND(years_since_observation::NUMERIC, 1) AS years_stale,
    effective_work_remaining,
    growth_priority_score
FROM trapper.v_place_colony_projected
WHERE needs_urgent_revisit = TRUE
ORDER BY growth_priority_score DESC, effective_work_remaining DESC
LIMIT 10;

\echo ''
\echo 'MIG_565 Complete!'
\echo ''
\echo 'New capabilities:'
\echo '  - ecology_parameters: Configurable growth model parameters'
\echo '  - project_colony_growth(initial, years, altered): Growth projection function'
\echo '  - v_place_colony_projected: Place estimates with growth projection'
\echo '  - v_cluster_colony_projected: Cluster estimates with growth projection'
\echo '  - get_growth_priority_sites(limit, min_unaltered): Priority site finder'
\echo ''
\echo 'Key parameters (adjustable in ecology_parameters table):'
\echo '  - lambda_annual = 1.78 (growth rate per year)'
\echo '  - stale_observation_months = 6 (when to project)'
\echo '  - projection_cap_years = 3 (max projection)'
\echo ''
\echo 'Usage:'
\echo '  SELECT * FROM trapper.get_growth_priority_sites(20, 5);'
\echo '  SELECT * FROM trapper.v_place_colony_projected WHERE needs_urgent_revisit;'
\echo ''
