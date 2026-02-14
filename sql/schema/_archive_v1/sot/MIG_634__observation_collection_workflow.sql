\echo '=== MIG_634: Observation Collection Workflow ==='
\echo 'Adds campaign tracking and prioritized collection views'
\echo ''

-- ============================================================================
-- PURPOSE
-- Enable organized observation collection campaigns to fill the 91% gap
-- in places needing site observations for Chapman estimation.
--
-- Key workflows:
-- 1. Request completion prompts for observation data
-- 2. Trapper site visit forms capture observations
-- 3. Organized field campaigns target high-priority zones
-- ============================================================================

-- ============================================================================
-- Step 1: Observation Campaigns Table
-- ============================================================================

\echo 'Step 1: Creating observation_campaigns table...'

CREATE TABLE IF NOT EXISTS trapper.observation_campaigns (
  campaign_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Campaign identification
  campaign_name TEXT NOT NULL,
  campaign_type TEXT CHECK (campaign_type IN (
    'zone_sweep',        -- Systematic zone coverage
    'high_priority',     -- Focus on high cat count sites
    'stale_refresh',     -- Refresh old observations
    'request_followup',  -- Observations during request work
    'volunteer_day'      -- Organized volunteer event
  )),

  -- Target scope
  target_zone_id UUID REFERENCES trapper.observation_zones(zone_id),
  target_service_zone TEXT,
  target_zip TEXT,

  -- Goals
  target_observations INT,
  target_places INT,

  -- Assignment
  assigned_to_person_id UUID REFERENCES trapper.sot_people(person_id),
  assigned_to_name TEXT,
  team_members JSONB,  -- Array of additional person_ids

  -- Status
  status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Results
  observations_collected INT DEFAULT 0,
  places_visited INT DEFAULT 0,
  notes TEXT,

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.observation_campaigns IS
'Tracks organized observation collection campaigns for field work.
Campaigns target specific zones, zip codes, or priority levels.';

CREATE INDEX IF NOT EXISTS idx_obs_campaigns_status ON trapper.observation_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_obs_campaigns_zone ON trapper.observation_campaigns(target_zone_id);

\echo 'Created observation_campaigns table'

-- ============================================================================
-- Step 2: Link Observations to Campaigns
-- ============================================================================

\echo ''
\echo 'Step 2: Adding campaign_id to zone_observations...'

ALTER TABLE trapper.zone_observations
ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES trapper.observation_campaigns(campaign_id);

COMMENT ON COLUMN trapper.zone_observations.campaign_id IS
'Links observation to a campaign if collected during organized field work.';

CREATE INDEX IF NOT EXISTS idx_zone_obs_campaign ON trapper.zone_observations(campaign_id);

\echo 'Added campaign_id to zone_observations'

-- ============================================================================
-- Step 3: Place-Level Observation Collection View
-- ============================================================================

\echo ''
\echo 'Step 3: Creating v_observation_collection_priority view...'

CREATE OR REPLACE VIEW trapper.v_observation_collection_priority AS
WITH place_altered_counts AS (
  -- Count of altered cats linked to each place (M value for Chapman)
  SELECT
    cpr.place_id,
    COUNT(DISTINCT cp.cat_id) AS altered_count,
    MAX(cp.procedure_date) AS last_alteration_date
  FROM trapper.cat_place_relationships cpr
  JOIN trapper.cat_procedures cp ON cp.cat_id = cpr.cat_id
  WHERE cp.is_spay OR cp.is_neuter
  GROUP BY cpr.place_id
),
place_observations AS (
  -- Latest observation data for each place
  SELECT
    pce.place_id,
    MAX(pce.observation_date) AS latest_observation_date,
    MAX(pce.eartip_count_observed) AS last_eartip_count,
    MAX(pce.peak_count) AS last_total_count
  FROM trapper.place_colony_estimates pce
  WHERE pce.eartip_count_observed IS NOT NULL
     OR pce.peak_count IS NOT NULL
  GROUP BY pce.place_id
),
active_requests AS (
  -- Places with active requests (higher priority)
  SELECT DISTINCT place_id
  FROM trapper.sot_requests
  WHERE status NOT IN ('completed', 'cancelled')
    AND place_id IS NOT NULL
)
SELECT
  p.place_id,
  p.formatted_address,
  p.service_zone,
  COALESCE(pac.altered_count, 0) AS m_value,
  po.latest_observation_date,
  po.last_eartip_count AS last_r_value,
  po.last_total_count AS last_c_value,
  -- Observation status
  CASE
    WHEN po.latest_observation_date IS NULL THEN 'never_observed'
    WHEN po.latest_observation_date < CURRENT_DATE - INTERVAL '1 year' THEN 'stale'
    WHEN po.latest_observation_date < CURRENT_DATE - INTERVAL '6 months' THEN 'needs_refresh'
    ELSE 'current'
  END AS observation_status,
  -- Can we do Chapman?
  CASE
    WHEN COALESCE(pac.altered_count, 0) > 0
     AND po.latest_observation_date IS NOT NULL
     AND po.last_eartip_count IS NOT NULL
     AND po.last_total_count IS NOT NULL
    THEN TRUE
    ELSE FALSE
  END AS chapman_ready,
  -- Priority score (higher = more urgent)
  (
    COALESCE(pac.altered_count, 0) * 2 +  -- More cats = higher priority
    CASE WHEN ar.place_id IS NOT NULL THEN 30 ELSE 0 END +  -- Active request
    CASE
      WHEN po.latest_observation_date IS NULL THEN 20  -- Never observed
      WHEN po.latest_observation_date < CURRENT_DATE - INTERVAL '1 year' THEN 15  -- Stale
      WHEN po.latest_observation_date < CURRENT_DATE - INTERVAL '6 months' THEN 10  -- Needs refresh
      ELSE 0
    END
  ) AS collection_priority,
  ar.place_id IS NOT NULL AS has_active_request
FROM trapper.places p
LEFT JOIN place_altered_counts pac ON pac.place_id = p.place_id
LEFT JOIN place_observations po ON po.place_id = p.place_id
LEFT JOIN active_requests ar ON ar.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL
  AND COALESCE(pac.altered_count, 0) > 0  -- Only places with linked cats
ORDER BY collection_priority DESC NULLS LAST;

COMMENT ON VIEW trapper.v_observation_collection_priority IS
'Places prioritized for observation collection.
Shows M value (altered cats), observation status, and collection priority.
Use this for planning field campaigns and prompting staff during workflows.

Priority factors:
- Number of altered cats (higher = more data available)
- Active request (ongoing work = higher priority)
- Observation staleness (never observed > stale > needs refresh > current)';

\echo 'Created v_observation_collection_priority view'

-- ============================================================================
-- Step 4: Campaign Progress View
-- ============================================================================

\echo ''
\echo 'Step 4: Creating v_campaign_progress view...'

CREATE OR REPLACE VIEW trapper.v_campaign_progress AS
SELECT
  oc.campaign_id,
  oc.campaign_name,
  oc.campaign_type,
  oc.status,
  oc.target_zone_id,
  oz.zone_code,
  oc.target_service_zone,
  oc.target_observations,
  oc.target_places,
  COALESCE(
    (SELECT COUNT(*) FROM trapper.zone_observations zo WHERE zo.campaign_id = oc.campaign_id),
    0
  ) AS observations_collected,
  CASE
    WHEN oc.target_observations > 0 THEN
      ROUND(100.0 * COALESCE(
        (SELECT COUNT(*) FROM trapper.zone_observations zo WHERE zo.campaign_id = oc.campaign_id),
        0
      ) / oc.target_observations, 1)
    ELSE 0
  END AS progress_pct,
  oc.assigned_to_name,
  oc.started_at,
  oc.completed_at,
  EXTRACT(DAY FROM (COALESCE(oc.completed_at, NOW()) - oc.started_at)) AS days_elapsed
FROM trapper.observation_campaigns oc
LEFT JOIN trapper.observation_zones oz ON oz.zone_id = oc.target_zone_id
ORDER BY
  CASE oc.status
    WHEN 'active' THEN 1
    WHEN 'planned' THEN 2
    WHEN 'completed' THEN 3
    WHEN 'cancelled' THEN 4
  END,
  oc.created_at DESC;

COMMENT ON VIEW trapper.v_campaign_progress IS
'Shows progress of observation campaigns.
Use this to track field work and identify campaigns needing attention.';

\echo 'Created v_campaign_progress view'

-- ============================================================================
-- Step 5: Function to Record Place Observation
-- ============================================================================

\echo ''
\echo 'Step 5: Creating record_place_observation function...'

CREATE OR REPLACE FUNCTION trapper.record_place_observation(
  p_place_id UUID,
  p_total_cats INT,
  p_eartipped_cats INT,
  p_observation_date DATE DEFAULT CURRENT_DATE,
  p_observer_name TEXT DEFAULT NULL,
  p_campaign_id UUID DEFAULT NULL,
  p_source_type TEXT DEFAULT 'staff_observation'
)
RETURNS UUID AS $$
DECLARE
  v_estimate_id UUID;
  v_zone_id UUID;
  v_zone_obs_id UUID;
BEGIN
  -- Validate inputs
  IF p_eartipped_cats > p_total_cats THEN
    RAISE EXCEPTION 'Eartipped cats (%) cannot exceed total cats (%)',
      p_eartipped_cats, p_total_cats;
  END IF;

  -- Create place colony estimate record
  INSERT INTO trapper.place_colony_estimates (
    place_id,
    peak_count,
    eartip_count_observed,
    observation_date,
    source_type,
    notes
  )
  VALUES (
    p_place_id,
    p_total_cats,
    p_eartipped_cats,
    p_observation_date,
    p_source_type,
    CASE
      WHEN p_observer_name IS NOT NULL THEN 'Observed by ' || p_observer_name
      ELSE NULL
    END
  )
  RETURNING estimate_id INTO v_estimate_id;

  -- Also record at zone level if place is in a zone
  SELECT poz.zone_id INTO v_zone_id
  FROM trapper.place_observation_zone poz
  WHERE poz.place_id = p_place_id
  LIMIT 1;

  IF v_zone_id IS NOT NULL THEN
    INSERT INTO trapper.zone_observations (
      zone_id,
      observation_date,
      total_cats_observed,
      eartipped_cats_observed,
      observer_name,
      campaign_id,
      confidence_level
    )
    VALUES (
      v_zone_id,
      p_observation_date,
      p_total_cats,
      p_eartipped_cats,
      p_observer_name,
      p_campaign_id,
      'medium'
    )
    RETURNING observation_id INTO v_zone_obs_id;
  END IF;

  -- Update campaign count if provided
  IF p_campaign_id IS NOT NULL THEN
    UPDATE trapper.observation_campaigns
    SET observations_collected = observations_collected + 1,
        updated_at = NOW()
    WHERE campaign_id = p_campaign_id;
  END IF;

  RETURN v_estimate_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.record_place_observation IS
'Records an observation at a place (total cats seen, eartipped cats seen).
Automatically creates both place_colony_estimate and zone_observation records.

Parameters:
- p_place_id: The place being observed
- p_total_cats: Total cats visible (C for Chapman)
- p_eartipped_cats: Eartipped cats visible (R for Chapman)
- p_observation_date: Date of observation
- p_observer_name: Who recorded the observation
- p_campaign_id: Optional campaign this is part of
- p_source_type: Source of observation (staff_observation, request_completion, etc.)

Returns: The estimate_id of the created place_colony_estimate record';

\echo 'Created record_place_observation function'

-- ============================================================================
-- Step 6: Stats View for Observation Collection
-- ============================================================================

\echo ''
\echo 'Step 6: Creating v_observation_collection_stats view...'

CREATE OR REPLACE VIEW trapper.v_observation_collection_stats AS
WITH place_stats AS (
  SELECT
    service_zone,
    COUNT(*) AS total_places,
    COUNT(*) FILTER (WHERE observation_status = 'never_observed') AS never_observed,
    COUNT(*) FILTER (WHERE observation_status = 'stale') AS stale,
    COUNT(*) FILTER (WHERE observation_status = 'needs_refresh') AS needs_refresh,
    COUNT(*) FILTER (WHERE observation_status = 'current') AS current_obs,
    COUNT(*) FILTER (WHERE chapman_ready) AS chapman_ready,
    SUM(m_value) AS total_altered_cats
  FROM trapper.v_observation_collection_priority
  GROUP BY service_zone
),
monthly_obs AS (
  SELECT
    DATE_TRUNC('month', observation_date) AS month,
    COUNT(*) AS observations
  FROM trapper.place_colony_estimates
  WHERE eartip_count_observed IS NOT NULL
    AND observation_date >= CURRENT_DATE - INTERVAL '12 months'
  GROUP BY DATE_TRUNC('month', observation_date)
)
SELECT
  ps.service_zone,
  ps.total_places,
  ps.never_observed,
  ps.stale,
  ps.needs_refresh,
  ps.current_obs,
  ps.chapman_ready,
  ps.total_altered_cats,
  ROUND(100.0 * ps.current_obs / NULLIF(ps.total_places, 0), 1) AS coverage_pct,
  ROUND(100.0 * ps.chapman_ready / NULLIF(ps.total_places, 0), 1) AS chapman_ready_pct
FROM place_stats ps
ORDER BY ps.total_places DESC;

COMMENT ON VIEW trapper.v_observation_collection_stats IS
'Summary statistics for observation collection by service zone.
Shows coverage gaps and Chapman readiness.';

\echo 'Created v_observation_collection_stats view'

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=== MIG_634 Complete ==='
\echo ''
\echo 'Created:'
\echo '  - observation_campaigns: Track organized field campaigns'
\echo '  - campaign_id on zone_observations: Link observations to campaigns'
\echo '  - v_observation_collection_priority: Places prioritized for collection'
\echo '  - v_campaign_progress: Campaign tracking view'
\echo '  - record_place_observation(): Function to record observations'
\echo '  - v_observation_collection_stats: Coverage statistics'
\echo ''
\echo 'Usage:'
\echo '  -- Record an observation at a place'
\echo '  SELECT trapper.record_place_observation('
\echo '    ''place-uuid''::uuid,'
\echo '    15,  -- total cats seen'
\echo '    10,  -- eartipped cats seen'
\echo '    CURRENT_DATE,'
\echo '    ''Staff Name'''
\echo '  );'
\echo ''
\echo '  -- Get high priority places for collection'
\echo '  SELECT * FROM trapper.v_observation_collection_priority'
\echo '  WHERE observation_status = ''never_observed'''
\echo '  ORDER BY collection_priority DESC'
\echo '  LIMIT 50;'
\echo ''
\echo '  -- Check coverage by zone'
\echo '  SELECT * FROM trapper.v_observation_collection_stats;'
\echo ''
