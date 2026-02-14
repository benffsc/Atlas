\echo ''
\echo '=============================================='
\echo 'MIG_539: Observation System Unification'
\echo '=============================================='
\echo ''
\echo 'Adds trip report fields to site_observations table to unify'
\echo 'LogObservationModal and TripReportModal into a single system.'
\echo ''

-- ============================================================================
-- PART 1: Add trip report fields to site_observations
-- ============================================================================

\echo 'Adding trip report fields to site_observations...'

-- Timing fields
ALTER TABLE trapper.site_observations
ADD COLUMN IF NOT EXISTS arrival_time TIME,
ADD COLUMN IF NOT EXISTS departure_time TIME;

-- Trap tracking
ALTER TABLE trapper.site_observations
ADD COLUMN IF NOT EXISTS traps_set INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS traps_retrieved INT DEFAULT 0;

-- Issue tracking (array of issue codes)
ALTER TABLE trapper.site_observations
ADD COLUMN IF NOT EXISTS issues_encountered TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Issue details (free text for explaining issues)
ALTER TABLE trapper.site_observations
ADD COLUMN IF NOT EXISTS issue_details TEXT;

-- Final visit flag (for request completion workflow)
ALTER TABLE trapper.site_observations
ADD COLUMN IF NOT EXISTS is_final_visit BOOLEAN DEFAULT FALSE;

-- Equipment used (optional tracking)
ALTER TABLE trapper.site_observations
ADD COLUMN IF NOT EXISTS equipment_used TEXT[];

COMMENT ON COLUMN trapper.site_observations.arrival_time IS 'Time trapper arrived at site';
COMMENT ON COLUMN trapper.site_observations.departure_time IS 'Time trapper departed site';
COMMENT ON COLUMN trapper.site_observations.traps_set IS 'Number of traps set during this visit';
COMMENT ON COLUMN trapper.site_observations.traps_retrieved IS 'Number of traps retrieved during this visit';
COMMENT ON COLUMN trapper.site_observations.issues_encountered IS 'Array of issue codes: no_access, cat_hiding, trap_shy, bad_weather, equipment_issue, owner_absent, aggressive_cat, other';
COMMENT ON COLUMN trapper.site_observations.issue_details IS 'Free text explanation of issues encountered';
COMMENT ON COLUMN trapper.site_observations.is_final_visit IS 'Whether this is the final visit for the linked request';
COMMENT ON COLUMN trapper.site_observations.equipment_used IS 'Array of equipment identifiers used during visit';

-- ============================================================================
-- PART 2: Create issue codes lookup
-- ============================================================================

\echo 'Creating observation_issue_types lookup...'

CREATE TABLE IF NOT EXISTS trapper.observation_issue_types (
  issue_code TEXT PRIMARY KEY,
  issue_label TEXT NOT NULL,
  issue_description TEXT,
  display_order INT DEFAULT 100,
  is_active BOOLEAN DEFAULT TRUE
);

INSERT INTO trapper.observation_issue_types (issue_code, issue_label, issue_description, display_order)
VALUES
  ('no_access', 'Could not access property', 'Unable to get onto the property', 10),
  ('cat_hiding', 'Cat(s) hiding', 'Cats present but hiding and not coming to traps', 20),
  ('trap_shy', 'Trap shy cat(s)', 'Cats avoid traps even with bait', 30),
  ('bad_weather', 'Bad weather', 'Weather prevented effective trapping', 40),
  ('equipment_issue', 'Equipment issue', 'Problem with traps or other equipment', 50),
  ('owner_absent', 'Owner/contact not available', 'Needed contact at site but they were unavailable', 60),
  ('aggressive_cat', 'Aggressive cat', 'Cat displayed aggressive behavior', 70),
  ('cats_not_present', 'No cats present', 'Cats not seen during visit', 80),
  ('other', 'Other issue', 'Other issue - see details', 99)
ON CONFLICT (issue_code) DO NOTHING;

-- ============================================================================
-- PART 3: Update trigger to handle final visit flag
-- ============================================================================

\echo 'Updating site_observation_to_colony_estimate trigger...'

CREATE OR REPLACE FUNCTION trapper.site_observation_to_colony_estimate()
RETURNS TRIGGER AS $$
DECLARE
  v_estimate_id UUID;
BEGIN
  -- Only create estimate if we have place_id and cats_seen_total
  IF NEW.place_id IS NOT NULL AND NEW.cats_seen_total IS NOT NULL THEN
    INSERT INTO trapper.place_colony_estimates (
      place_id,
      total_cats,
      eartip_count_observed,
      total_cats_observed,
      observation_date,
      observation_time_of_day,
      is_at_feeding_station,
      reporter_confidence,
      source_type,
      is_firsthand,
      source_system,
      source_record_id,
      notes
    ) VALUES (
      NEW.place_id,
      NEW.cats_seen_total,
      NEW.eartipped_seen,
      NEW.cats_seen_total,
      NEW.observation_date,
      NEW.time_of_day,
      NEW.is_at_feeding_station,
      NEW.confidence,
      CASE NEW.observer_type
        WHEN 'trapper_field' THEN 'trapper_site_visit'
        WHEN 'staff_phone_call' THEN 'manual_observation'
        WHEN 'client_report' THEN 'manual_observation'
        WHEN 'requester_update' THEN 'trapping_request'
        ELSE 'manual_observation'
      END,
      NEW.observer_type IN ('trapper_field', 'client_report', 'requester_update'),
      NEW.source_system,
      NEW.observation_id::TEXT,
      NEW.notes
    )
    RETURNING estimate_id INTO v_estimate_id;
  END IF;

  -- If this is marked as final visit and linked to a request, update the request
  IF NEW.is_final_visit = TRUE AND NEW.request_id IS NOT NULL THEN
    UPDATE trapper.sot_requests
    SET
      final_observation_id = NEW.observation_id,
      updated_at = NOW()
    WHERE request_id = NEW.request_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PART 4: Add final_observation_id to sot_requests
-- ============================================================================

\echo 'Adding final_observation_id to sot_requests...'

ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS final_observation_id UUID REFERENCES trapper.site_observations(observation_id);

COMMENT ON COLUMN trapper.sot_requests.final_observation_id IS
'Link to the final site observation logged when completing this request';

-- ============================================================================
-- PART 5: Create function to calculate Chapman estimate
-- ============================================================================

\echo 'Creating calculate_chapman_estimate function...'

CREATE OR REPLACE FUNCTION trapper.calculate_chapman_estimate(
  p_place_id UUID,
  p_cats_observed INT,
  p_eartipped_observed INT
)
RETURNS TABLE (
  estimated_population NUMERIC,
  confidence_interval_low NUMERIC,
  confidence_interval_high NUMERIC,
  verified_altered INT,
  observation_count INT,
  recapture_count INT
) AS $$
DECLARE
  v_verified_altered INT;
BEGIN
  -- Get verified altered count for this place (M = marked population)
  SELECT COALESCE(COUNT(*), 0)::INT INTO v_verified_altered
  FROM trapper.cat_place_relationships cpr
  JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
  JOIN trapper.sot_appointments a ON a.microchip = (
    SELECT ci.id_value FROM trapper.cat_identifiers ci
    WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip' LIMIT 1
  )
  WHERE cpr.place_id = p_place_id
    AND a.service_type IN ('Spay', 'Neuter', 'Already Altered');

  -- Chapman estimator: N = ((M+1)(C+1)/(R+1)) - 1
  -- M = verified altered (marked)
  -- C = total observed
  -- R = eartipped observed (recaptured marked)

  RETURN QUERY
  SELECT
    CASE
      WHEN p_eartipped_observed > 0 AND v_verified_altered > 0 THEN
        (((v_verified_altered + 1)::NUMERIC * (p_cats_observed + 1)::NUMERIC) /
         (p_eartipped_observed + 1)::NUMERIC) - 1
      ELSE
        p_cats_observed::NUMERIC  -- Fallback to observed count
    END AS estimated_population,
    -- Simplified confidence intervals (Chapman variance approximation)
    CASE
      WHEN p_eartipped_observed > 0 AND v_verified_altered > 0 THEN
        GREATEST(p_cats_observed::NUMERIC,
          (((v_verified_altered + 1)::NUMERIC * (p_cats_observed + 1)::NUMERIC) /
           (p_eartipped_observed + 1)::NUMERIC) - 1 -
          2 * SQRT(((v_verified_altered + 1)::NUMERIC * (p_cats_observed + 1)::NUMERIC *
                    (v_verified_altered - p_eartipped_observed)::NUMERIC *
                    (p_cats_observed - p_eartipped_observed)::NUMERIC) /
                   ((p_eartipped_observed + 1)::NUMERIC * (p_eartipped_observed + 1)::NUMERIC *
                    (p_eartipped_observed + 2)::NUMERIC)))
      ELSE
        p_cats_observed::NUMERIC * 0.8  -- 20% below observed
    END AS confidence_interval_low,
    CASE
      WHEN p_eartipped_observed > 0 AND v_verified_altered > 0 THEN
        (((v_verified_altered + 1)::NUMERIC * (p_cats_observed + 1)::NUMERIC) /
         (p_eartipped_observed + 1)::NUMERIC) - 1 +
        2 * SQRT(((v_verified_altered + 1)::NUMERIC * (p_cats_observed + 1)::NUMERIC *
                  (v_verified_altered - p_eartipped_observed)::NUMERIC *
                  (p_cats_observed - p_eartipped_observed)::NUMERIC) /
                 ((p_eartipped_observed + 1)::NUMERIC * (p_eartipped_observed + 1)::NUMERIC *
                  (p_eartipped_observed + 2)::NUMERIC))
      ELSE
        p_cats_observed::NUMERIC * 1.5  -- 50% above observed
    END AS confidence_interval_high,
    v_verified_altered,
    p_cats_observed,
    p_eartipped_observed;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.calculate_chapman_estimate IS
'Calculate Chapman population estimate from observation data.
Returns estimated population with confidence intervals.
Uses verified altered cats from clinic data as the marked population.';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_539 Complete!'
\echo '=============================================='
\echo ''
\echo 'Added to site_observations:'
\echo '  - arrival_time, departure_time'
\echo '  - traps_set, traps_retrieved'
\echo '  - issues_encountered (TEXT[]), issue_details'
\echo '  - is_final_visit, equipment_used'
\echo ''
\echo 'Created:'
\echo '  - observation_issue_types lookup table'
\echo '  - calculate_chapman_estimate() function'
\echo '  - sot_requests.final_observation_id column'
\echo ''
\echo 'Updated:'
\echo '  - site_observation_to_colony_estimate trigger for final visit handling'
\echo ''
