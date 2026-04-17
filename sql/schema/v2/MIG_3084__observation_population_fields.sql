-- MIG_3084: Create ops.site_observations + population signal fields
--
-- Part of CATS (Cat Alteration Tracking System) — FFS-1266
-- Ported from V1 MIG_454 (trapper.site_observations) to ops schema
-- with new population signal fields: kittens_seen, new_unfamiliar_cats

CREATE TABLE IF NOT EXISTS ops.site_observations (
  observation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Context
  place_id UUID,
  request_id UUID,
  observer_person_id UUID,
  observer_staff_id UUID,
  observer_type TEXT,
  observer_name TEXT,

  -- Date/time
  observation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  observation_time TIME,
  time_of_day TEXT,

  -- Cat counts
  cats_seen_total INT,
  cats_seen_is_estimate BOOLEAN DEFAULT TRUE,
  eartipped_seen INT,
  eartipped_is_estimate BOOLEAN DEFAULT TRUE,

  -- Trapping activity
  cats_trapped INT DEFAULT 0,
  cats_returned INT DEFAULT 0,

  -- Sex breakdown
  female_seen INT,
  male_seen INT,
  unknown_sex_seen INT,
  sex_counts_are_estimates BOOLEAN DEFAULT TRUE,

  -- Context flags
  is_at_feeding_station BOOLEAN,
  weather_conditions TEXT,
  confidence TEXT DEFAULT 'medium',

  -- CATS population signals (new)
  kittens_seen INT,
  new_unfamiliar_cats INT,

  -- Notes
  notes TEXT,

  -- Trip report fields
  arrival_time TEXT,
  departure_time TEXT,
  traps_set INT DEFAULT 0,
  traps_retrieved INT DEFAULT 0,
  issues_encountered TEXT[],
  issue_details TEXT,
  is_final_visit BOOLEAN DEFAULT FALSE,
  equipment_used TEXT[],

  -- Metadata
  source_system TEXT DEFAULT 'atlas_ui',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_site_obs_place ON ops.site_observations(place_id);
CREATE INDEX IF NOT EXISTS idx_site_obs_request ON ops.site_observations(request_id);
CREATE INDEX IF NOT EXISTS idx_site_obs_date ON ops.site_observations(observation_date);

COMMENT ON COLUMN ops.site_observations.kittens_seen IS 'Number of kittens observed — signals active breeding at site';
COMMENT ON COLUMN ops.site_observations.new_unfamiliar_cats IS 'Cats observer has not seen at this site before — signals immigration or missed population';
