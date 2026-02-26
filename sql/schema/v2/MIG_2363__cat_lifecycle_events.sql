-- MIG_2363: Cat Lifecycle Events Table
-- Purpose: Event sourcing for cat lifecycle (intake, TNR, foster, adoption, mortality)
--
-- This enables:
-- - Full audit trail of cat movements
-- - Temporal queries (where was this cat on date X?)
-- - Foster/adoption analytics
-- - Mortality tracking for population modeling

-- Create the cat_lifecycle_events table
CREATE TABLE IF NOT EXISTS sot.cat_lifecycle_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cat_id UUID NOT NULL REFERENCES sot.cats(cat_id),

  -- Event classification
  event_type TEXT NOT NULL,
  -- Allowed values: intake, tnr_procedure, foster_start, foster_end,
  --                 adoption, return_to_field, transfer, mortality
  event_subtype TEXT,
  -- Subtype examples:
  --   intake: stray, surrender, transfer_in, born_in_care
  --   mortality: natural, euthanasia, hit_by_car, unknown
  --   transfer: to_rescue, to_shelter, to_clinic

  -- When did this event occur?
  event_at TIMESTAMPTZ NOT NULL,

  -- Who was involved? (optional - not all events have people)
  person_id UUID REFERENCES sot.people(person_id),

  -- Where did this happen? (optional - not all events have places)
  place_id UUID REFERENCES sot.places(place_id),

  -- Additional context as JSON
  metadata JSONB DEFAULT '{}',
  -- Examples:
  --   tnr_procedure: {"services": ["spay", "ear_tip", "microchip"], "vet": "Dr. Smith"}
  --   mortality: {"cause": "natural", "age_at_death": "12 years"}
  --   foster_start: {"foster_type": "medical", "expected_duration": "2 weeks"}

  -- Provenance
  source_system TEXT NOT NULL,
  source_record_id TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add constraint for valid event types
ALTER TABLE sot.cat_lifecycle_events
ADD CONSTRAINT chk_event_type CHECK (
  event_type IN (
    'intake',
    'tnr_procedure',
    'foster_start',
    'foster_end',
    'adoption',
    'return_to_field',
    'transfer',
    'mortality'
  )
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_cat_lifecycle_cat_id
  ON sot.cat_lifecycle_events(cat_id);

CREATE INDEX IF NOT EXISTS idx_cat_lifecycle_event_type
  ON sot.cat_lifecycle_events(event_type);

CREATE INDEX IF NOT EXISTS idx_cat_lifecycle_event_at
  ON sot.cat_lifecycle_events(event_at);

CREATE INDEX IF NOT EXISTS idx_cat_lifecycle_person_id
  ON sot.cat_lifecycle_events(person_id)
  WHERE person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cat_lifecycle_place_id
  ON sot.cat_lifecycle_events(place_id)
  WHERE place_id IS NOT NULL;

-- Composite index for timeline queries
CREATE INDEX IF NOT EXISTS idx_cat_lifecycle_cat_timeline
  ON sot.cat_lifecycle_events(cat_id, event_at DESC);

-- Comments
COMMENT ON TABLE sot.cat_lifecycle_events IS
'Event sourcing table for cat lifecycle tracking. Each row represents a
discrete event in a cat''s life (intake, TNR procedure, foster placement,
adoption, mortality, etc.). Enables temporal queries and full audit trail.';

COMMENT ON COLUMN sot.cat_lifecycle_events.event_type IS
'Primary event classification: intake, tnr_procedure, foster_start, foster_end,
adoption, return_to_field, transfer, mortality';

COMMENT ON COLUMN sot.cat_lifecycle_events.event_subtype IS
'Secondary classification within event_type. Examples: intake->stray,
mortality->natural, transfer->to_rescue';

COMMENT ON COLUMN sot.cat_lifecycle_events.metadata IS
'Additional event-specific data as JSON. Schema varies by event_type.';

-- Helper view: Get current status of each cat
CREATE OR REPLACE VIEW sot.v_cat_current_status AS
WITH ranked_events AS (
  SELECT
    cat_id,
    event_type,
    event_subtype,
    event_at,
    person_id,
    place_id,
    metadata,
    ROW_NUMBER() OVER (PARTITION BY cat_id ORDER BY event_at DESC) as rn
  FROM sot.cat_lifecycle_events
)
SELECT
  c.cat_id,
  c.name,
  c.microchip,
  e.event_type as last_event_type,
  e.event_subtype as last_event_subtype,
  e.event_at as last_event_at,
  e.person_id as last_event_person_id,
  e.place_id as last_event_place_id,
  CASE
    WHEN e.event_type = 'mortality' THEN 'deceased'
    WHEN e.event_type = 'adoption' THEN 'adopted'
    WHEN e.event_type = 'foster_start' THEN 'in_foster'
    WHEN e.event_type = 'return_to_field' THEN 'community_cat'
    WHEN e.event_type = 'transfer' THEN 'transferred'
    WHEN e.event_type = 'tnr_procedure' THEN 'tnr_complete'
    WHEN e.event_type = 'intake' THEN 'in_care'
    ELSE 'unknown'
  END as current_status
FROM sot.cats c
LEFT JOIN ranked_events e ON e.cat_id = c.cat_id AND e.rn = 1
WHERE c.merged_into_cat_id IS NULL;

COMMENT ON VIEW sot.v_cat_current_status IS
'Derived view showing current status of each cat based on most recent lifecycle event.';

-- Report results
DO $$
BEGIN
  RAISE NOTICE 'MIG_2363: cat_lifecycle_events table created successfully';
  RAISE NOTICE 'Indexes created: 6';
  RAISE NOTICE 'View created: sot.v_cat_current_status';
END $$;
