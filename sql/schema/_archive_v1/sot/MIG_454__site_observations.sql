\echo === MIG_454: Site Observations Table ===
\echo General observation model for trappers, staff, and client reports

-- Site observations table (generalized from trip reports)
CREATE TABLE IF NOT EXISTS trapper.site_observations (
  observation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Context: What site/request is this for?
  place_id UUID REFERENCES trapper.places(place_id),
  request_id UUID REFERENCES trapper.sot_requests(request_id),

  -- Who submitted?
  observer_person_id UUID REFERENCES trapper.sot_people(person_id),
  observer_staff_id UUID REFERENCES trapper.staff(staff_id),
  observer_type TEXT CHECK (observer_type IN (
    'trapper_field',      -- Trapper at site
    'staff_phone_call',   -- Staff calling client
    'client_report',      -- Client reporting to us
    'requester_update',   -- Original requester
    'admin_entry'         -- Manual admin entry
  )),

  -- Observation date/time
  observation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  observation_time TIME,
  time_of_day TEXT CHECK (time_of_day IN ('dawn', 'morning', 'midday', 'afternoon', 'dusk', 'evening', 'night')),

  -- Cat counts
  cats_seen_total INT,
  cats_seen_is_estimate BOOLEAN DEFAULT TRUE,
  eartipped_seen INT,
  eartipped_is_estimate BOOLEAN DEFAULT TRUE,

  -- For trappers: what happened?
  cats_trapped INT DEFAULT 0,
  cats_returned INT DEFAULT 0,

  -- Sex breakdown (optional, from visual observation)
  female_seen INT,
  male_seen INT,
  unknown_sex_seen INT,
  sex_counts_are_estimates BOOLEAN DEFAULT TRUE,

  -- Context flags
  is_at_feeding_station BOOLEAN,
  weather_conditions TEXT,
  confidence TEXT DEFAULT 'medium' CHECK (confidence IN ('high', 'medium', 'low')),

  -- Notes
  notes TEXT,

  -- Metadata
  source_system TEXT DEFAULT 'web_app',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_site_obs_place ON trapper.site_observations(place_id);
CREATE INDEX IF NOT EXISTS idx_site_obs_request ON trapper.site_observations(request_id);
CREATE INDEX IF NOT EXISTS idx_site_obs_date ON trapper.site_observations(observation_date);
CREATE INDEX IF NOT EXISTS idx_site_obs_observer ON trapper.site_observations(observer_person_id);
CREATE INDEX IF NOT EXISTS idx_site_obs_observer_staff ON trapper.site_observations(observer_staff_id);

-- Trigger: Auto-create colony estimate from observation
CREATE OR REPLACE FUNCTION trapper.site_observation_to_colony_estimate()
RETURNS TRIGGER AS $$
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
      source_record_id
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
      NEW.observation_id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trg_site_obs_colony_estimate ON trapper.site_observations;

-- Create trigger
CREATE TRIGGER trg_site_obs_colony_estimate
  AFTER INSERT ON trapper.site_observations
  FOR EACH ROW EXECUTE FUNCTION trapper.site_observation_to_colony_estimate();

-- Comments
COMMENT ON TABLE trapper.site_observations IS 'General site observations from trappers, staff, and clients';
COMMENT ON COLUMN trapper.site_observations.observer_type IS 'Who submitted: trapper_field, staff_phone_call, client_report, requester_update, admin_entry';
COMMENT ON COLUMN trapper.site_observations.cats_seen_is_estimate IS 'TRUE if count is estimate, FALSE if exact count';
COMMENT ON COLUMN trapper.site_observations.sex_counts_are_estimates IS 'TRUE if sex breakdown is estimated from observation';
COMMENT ON COLUMN trapper.site_observations.confidence IS 'Reporter confidence: high (exact count), medium (good estimate), low (rough guess)';

\echo MIG_454 complete: site_observations table created with colony estimate integration
