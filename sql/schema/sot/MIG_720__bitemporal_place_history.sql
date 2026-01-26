\echo '=== MIG_720: Bitemporal Place History & Ecological Context ==='
\echo 'Creates temporal data architecture for tracking historical conditions'
\echo 'Separates operational state from ecological context'

-- ============================================================
-- PLACE CONDITION TYPES (Lookup Table)
-- ============================================================
CREATE TABLE IF NOT EXISTS trapper.place_condition_types (
  condition_type TEXT PRIMARY KEY,
  display_label TEXT NOT NULL,
  description TEXT,
  default_severity TEXT,
  is_ecological_significant BOOLEAN DEFAULT TRUE,  -- Matters for population modeling
  display_color TEXT,  -- For map visualization
  display_order INT
);

INSERT INTO trapper.place_condition_types VALUES
  ('hoarding', 'Hoarding Situation', 'Large number of cats in poor conditions', 'severe', TRUE, '#9333ea', 1),
  ('breeding_crisis', 'Breeding Crisis', 'Rapid uncontrolled breeding', 'severe', TRUE, '#dc2626', 2),
  ('disease_outbreak', 'Disease Outbreak', 'FeLV/FIV or other disease cluster', 'critical', TRUE, '#ef4444', 3),
  ('feeding_station', 'Feeding Station', 'Regular outdoor feeding attracting cats', 'moderate', TRUE, '#f59e0b', 4),
  ('abandonment', 'Abandonment', 'Cats left behind by previous occupant', 'moderate', TRUE, '#8b5cf6', 5),
  ('neglect', 'Neglect Situation', 'Cats present but not properly cared for', 'moderate', FALSE, '#6b7280', 6),
  ('difficult_client', 'Difficult Client', 'Safety or communication concerns', 'minor', FALSE, '#f97316', 7),
  ('resolved_colony', 'Resolved Colony', 'TNR completed, population managed', 'minor', FALSE, '#10b981', 8),
  ('historical_source', 'Historical Source', 'Known historical breeding/source site', 'moderate', TRUE, '#7c3aed', 9)
ON CONFLICT (condition_type) DO NOTHING;

-- ============================================================
-- PLACE CONDITION HISTORY (Event-Sourced)
-- Tracks historical conditions like "was hoarder site 2018-2020"
-- ============================================================
CREATE TABLE IF NOT EXISTS trapper.place_condition_history (
  condition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id UUID NOT NULL REFERENCES trapper.places(place_id),

  -- What condition
  condition_type TEXT NOT NULL REFERENCES trapper.place_condition_types(condition_type),
  severity TEXT NOT NULL DEFAULT 'moderate',  -- 'minor', 'moderate', 'severe', 'critical'

  -- Valid time: When was this TRUE in reality?
  valid_from DATE NOT NULL,      -- When condition started
  valid_to DATE,                 -- When condition ended (NULL = ongoing)

  -- Transaction time: When did we LEARN about this?
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  recorded_by TEXT,              -- Staff member or 'ai_extracted'

  -- Context
  description TEXT,              -- What happened
  peak_cat_count INT,            -- Maximum cats during this period
  intervention_type TEXT,        -- 'tnr', 'removal', 'surrender', 'eviction', 'none'
  outcome TEXT,                  -- 'resolved', 'improved', 'ongoing', 'abandoned'

  -- Ecological significance
  estimated_dispersed_cats INT,  -- How many unfixed cats likely left before intervention
  ecological_impact TEXT,        -- 'minimal', 'local', 'regional', 'significant'

  -- Provenance
  source_type TEXT NOT NULL DEFAULT 'staff_observation',  -- 'staff_observation', 'ai_extracted', 'google_maps', 'request_history'
  source_system TEXT,
  source_record_id TEXT,
  evidence_notes TEXT,

  -- Soft delete / supersede
  superseded_at TIMESTAMPTZ,
  superseded_by UUID REFERENCES trapper.place_condition_history(condition_id),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_place_condition_place ON trapper.place_condition_history(place_id) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_place_condition_type ON trapper.place_condition_history(condition_type) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_place_condition_valid ON trapper.place_condition_history(valid_from, valid_to) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_place_condition_ecological ON trapper.place_condition_history(ecological_impact) WHERE superseded_at IS NULL AND ecological_impact IS NOT NULL;

COMMENT ON TABLE trapper.place_condition_history IS 'Bitemporal history of place conditions (hoarding, disease outbreak, etc.). Supports both operational queries (current state) and ecological analysis (full history).';
COMMENT ON COLUMN trapper.place_condition_history.valid_from IS 'When this condition started in reality';
COMMENT ON COLUMN trapper.place_condition_history.valid_to IS 'When this condition ended in reality (NULL = ongoing)';
COMMENT ON COLUMN trapper.place_condition_history.recorded_at IS 'When we learned about this condition (transaction time)';

-- ============================================================
-- PLACE COLONY TIMELINE (Bitemporal Colony Estimates)
-- Extends place_colony_estimates with proper temporal modeling
-- ============================================================
CREATE TABLE IF NOT EXISTS trapper.place_colony_timeline (
  timeline_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id UUID NOT NULL REFERENCES trapper.places(place_id),

  -- Population state
  estimated_total INT,           -- Total cats at this time
  estimated_altered INT,         -- Altered cats
  estimated_unaltered INT,       -- Unaltered cats
  alteration_rate NUMERIC(5,2),  -- Percentage altered

  -- Colony status
  colony_status TEXT NOT NULL DEFAULT 'unknown',   -- 'growing', 'stable', 'declining', 'resolved', 'unknown'
  breeding_active BOOLEAN,       -- Are new kittens being born?

  -- Valid time
  valid_from DATE NOT NULL,      -- When this estimate became valid
  valid_to DATE,                 -- When it was superseded (NULL = current)

  -- Transaction time
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  recorded_by TEXT,

  -- Source
  source_type TEXT NOT NULL DEFAULT 'ai_inferred',
  source_system TEXT,
  source_record_id TEXT,
  observation_method TEXT,       -- 'survey', 'trapper_report', 'clinic_data', 'ai_inferred'
  confidence NUMERIC(3,2),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_colony_timeline_place ON trapper.place_colony_timeline(place_id);
CREATE INDEX IF NOT EXISTS idx_colony_timeline_valid ON trapper.place_colony_timeline(valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_colony_timeline_status ON trapper.place_colony_timeline(colony_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_colony_timeline_current ON trapper.place_colony_timeline(place_id) WHERE valid_to IS NULL;

COMMENT ON TABLE trapper.place_colony_timeline IS 'Bitemporal colony population estimates. Each row represents a period when the colony had a certain population.';

-- ============================================================
-- ECOLOGICAL RELATIONSHIP: Source-Sink Tracking
-- Which places have contributed cats to which other places
-- ============================================================
CREATE TABLE IF NOT EXISTS trapper.place_ecological_relationships (
  relationship_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_place_id UUID NOT NULL REFERENCES trapper.places(place_id),
  sink_place_id UUID NOT NULL REFERENCES trapper.places(place_id),

  relationship_type TEXT NOT NULL,  -- 'dispersal', 'migration', 'relocation', 'adjacent_colony'

  -- Evidence
  evidence_type TEXT,            -- 'microchip_match', 'trapper_observation', 'ai_inferred', 'geographic_proximity'
  evidence_strength TEXT,        -- 'confirmed', 'likely', 'possible'
  supporting_cat_ids UUID[],     -- Cats that moved between these places

  -- Temporal
  valid_from DATE,
  valid_to DATE,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),

  -- Impact
  estimated_cats_transferred INT,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT different_places CHECK (source_place_id != sink_place_id)
);

CREATE INDEX IF NOT EXISTS idx_eco_rel_source ON trapper.place_ecological_relationships(source_place_id);
CREATE INDEX IF NOT EXISTS idx_eco_rel_sink ON trapper.place_ecological_relationships(sink_place_id);

COMMENT ON TABLE trapper.place_ecological_relationships IS 'Tracks source-sink relationships between places. Used for understanding regional cat population dynamics.';

-- ============================================================
-- ZONE DATA COVERAGE (Track data gaps)
-- ============================================================
CREATE TABLE IF NOT EXISTS trapper.zone_data_coverage (
  zone_id TEXT PRIMARY KEY,  -- Service zone name
  zone_name TEXT,

  -- Data source counts
  google_maps_entries INT DEFAULT 0,
  airtable_requests INT DEFAULT 0,
  clinic_appointments INT DEFAULT 0,
  intake_submissions INT DEFAULT 0,

  -- Coverage level (computed)
  coverage_level TEXT,

  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.zone_data_coverage IS 'Tracks data coverage by service zone. Identifies data-rich areas vs gaps.';

-- ============================================================
-- FUNCTION: Record Place Condition
-- ============================================================
CREATE OR REPLACE FUNCTION trapper.record_place_condition(
  p_place_id UUID,
  p_condition_type TEXT,
  p_valid_from DATE,
  p_valid_to DATE DEFAULT NULL,
  p_severity TEXT DEFAULT 'moderate',
  p_description TEXT DEFAULT NULL,
  p_peak_cat_count INT DEFAULT NULL,
  p_ecological_impact TEXT DEFAULT NULL,
  p_source_type TEXT DEFAULT 'staff_observation',
  p_source_system TEXT DEFAULT NULL,
  p_source_record_id TEXT DEFAULT NULL,
  p_recorded_by TEXT DEFAULT 'system'
) RETURNS UUID AS $$
DECLARE
  v_new_id UUID;
  v_old_id UUID;
BEGIN
  -- Find existing active condition of same type
  SELECT condition_id INTO v_old_id
  FROM trapper.place_condition_history
  WHERE place_id = p_place_id
    AND condition_type = p_condition_type
    AND superseded_at IS NULL
    AND valid_to IS NULL;

  -- Insert new condition record
  INSERT INTO trapper.place_condition_history (
    place_id, condition_type, severity, valid_from, valid_to,
    description, peak_cat_count, ecological_impact,
    source_type, source_system, source_record_id, recorded_by
  ) VALUES (
    p_place_id, p_condition_type, p_severity, p_valid_from, p_valid_to,
    p_description, p_peak_cat_count, p_ecological_impact,
    p_source_type, p_source_system, p_source_record_id, p_recorded_by
  ) RETURNING condition_id INTO v_new_id;

  -- Supersede old condition if exists and new one replaces it
  IF v_old_id IS NOT NULL AND p_valid_to IS NOT NULL THEN
    UPDATE trapper.place_condition_history
    SET superseded_at = NOW(), superseded_by = v_new_id
    WHERE condition_id = v_old_id;
  END IF;

  RETURN v_new_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.record_place_condition IS 'Record a place condition with proper bitemporal handling. Automatically supersedes previous conditions of same type if needed.';

-- ============================================================
-- FUNCTION: Refresh Zone Data Coverage
-- ============================================================
CREATE OR REPLACE FUNCTION trapper.refresh_zone_data_coverage()
RETURNS void AS $$
BEGIN
  -- Clear and rebuild
  DELETE FROM trapper.zone_data_coverage;

  INSERT INTO trapper.zone_data_coverage (zone_id, zone_name, google_maps_entries, airtable_requests, clinic_appointments, intake_submissions, coverage_level)
  SELECT
    COALESCE(p.service_zone, 'Unknown') as zone_id,
    COALESCE(p.service_zone, 'Unknown') as zone_name,
    COUNT(DISTINCT g.entry_id) as google_maps_entries,
    COUNT(DISTINCT r.request_id) FILTER (WHERE r.source_system = 'airtable') as airtable_requests,
    COUNT(DISTINCT a.appointment_id) as clinic_appointments,
    COUNT(DISTINCT wi.submission_id) as intake_submissions,
    CASE
      WHEN COUNT(DISTINCT g.entry_id) + COUNT(DISTINCT r.request_id) + COUNT(DISTINCT a.appointment_id) + COUNT(DISTINCT wi.submission_id) > 100 THEN 'rich'
      WHEN COUNT(DISTINCT g.entry_id) + COUNT(DISTINCT r.request_id) + COUNT(DISTINCT a.appointment_id) + COUNT(DISTINCT wi.submission_id) > 20 THEN 'moderate'
      WHEN COUNT(DISTINCT g.entry_id) + COUNT(DISTINCT r.request_id) + COUNT(DISTINCT a.appointment_id) + COUNT(DISTINCT wi.submission_id) > 0 THEN 'sparse'
      ELSE 'gap'
    END as coverage_level
  FROM trapper.places p
  LEFT JOIN trapper.google_map_entries g ON g.linked_place_id = p.place_id
  LEFT JOIN trapper.sot_requests r ON r.place_id = p.place_id
  LEFT JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
  LEFT JOIN trapper.sot_appointments a ON a.cat_id = cpr.cat_id
  LEFT JOIN trapper.web_intake_submissions wi ON wi.place_id = p.place_id
  WHERE p.merged_into_place_id IS NULL
  GROUP BY COALESCE(p.service_zone, 'Unknown');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- VIEW: Current Operational State (for staff workflows)
-- ============================================================
CREATE OR REPLACE VIEW trapper.v_place_operational_state AS
SELECT
  p.place_id,
  p.formatted_address,
  p.service_zone,
  ST_Y(p.location::geometry) as lat,
  ST_X(p.location::geometry) as lng,

  -- Current request status
  EXISTS (SELECT 1 FROM trapper.sot_requests r
          WHERE r.place_id = p.place_id
          AND r.status IN ('new', 'triaged', 'scheduled', 'in_progress')) as has_active_request,

  (SELECT r.request_id FROM trapper.sot_requests r
   WHERE r.place_id = p.place_id AND r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
   ORDER BY r.created_at DESC LIMIT 1) as active_request_id,

  -- Current context tags (only active)
  (SELECT array_agg(DISTINCT pc.context_type)
   FROM trapper.place_contexts pc
   WHERE pc.place_id = p.place_id AND pc.valid_to IS NULL) as current_contexts,

  -- Current colony estimate
  (SELECT ct.estimated_total FROM trapper.place_colony_timeline ct
   WHERE ct.place_id = p.place_id AND ct.valid_to IS NULL
   ORDER BY ct.recorded_at DESC LIMIT 1) as current_cat_estimate,

  -- Any active conditions (ongoing problems)
  (SELECT array_agg(DISTINCT pch.condition_type)
   FROM trapper.place_condition_history pch
   WHERE pch.place_id = p.place_id
   AND pch.valid_to IS NULL
   AND pch.superseded_at IS NULL) as active_conditions

FROM trapper.places p
WHERE p.merged_into_place_id IS NULL;

COMMENT ON VIEW trapper.v_place_operational_state IS 'Current operational state for staff workflows. Shows only ACTIVE/CURRENT information.';

-- ============================================================
-- VIEW: Historical Ecological Context (for Beacon/analysis)
-- ============================================================
CREATE OR REPLACE VIEW trapper.v_place_ecological_context AS
SELECT
  p.place_id,
  p.formatted_address,
  p.service_zone,
  ST_Y(p.location::geometry) as lat,
  ST_X(p.location::geometry) as lng,

  -- Historical conditions (includes resolved)
  (SELECT jsonb_agg(jsonb_build_object(
    'condition_id', pch.condition_id,
    'condition', pch.condition_type,
    'severity', pch.severity,
    'valid_from', pch.valid_from,
    'valid_to', pch.valid_to,
    'peak_cats', pch.peak_cat_count,
    'outcome', pch.outcome,
    'ecological_impact', pch.ecological_impact,
    'description', pch.description
  ) ORDER BY pch.valid_from DESC)
   FROM trapper.place_condition_history pch
   WHERE pch.place_id = p.place_id AND pch.superseded_at IS NULL) as condition_history,

  -- Count of historical conditions
  (SELECT COUNT(*) FROM trapper.place_condition_history pch
   WHERE pch.place_id = p.place_id AND pch.superseded_at IS NULL) as condition_count,

  -- Peak historical population
  (SELECT MAX(ct.estimated_total) FROM trapper.place_colony_timeline ct
   WHERE ct.place_id = p.place_id) as peak_population,

  -- When peak occurred
  (SELECT ct.valid_from FROM trapper.place_colony_timeline ct
   WHERE ct.place_id = p.place_id
   ORDER BY ct.estimated_total DESC NULLS LAST LIMIT 1) as peak_date,

  -- Total births documented (uses place_id column, not birth_place_id)
  (SELECT COUNT(*) FROM trapper.cat_birth_events cbe
   WHERE cbe.place_id = p.place_id) as documented_births,

  -- Was this ever a significant source?
  EXISTS (SELECT 1 FROM trapper.place_condition_history pch
          WHERE pch.place_id = p.place_id
          AND pch.ecological_impact IN ('regional', 'significant')
          AND pch.superseded_at IS NULL) as was_significant_source,

  -- Most significant historical condition
  (SELECT pch.condition_type FROM trapper.place_condition_history pch
   WHERE pch.place_id = p.place_id AND pch.superseded_at IS NULL
   ORDER BY
     CASE pch.ecological_impact
       WHEN 'significant' THEN 1
       WHEN 'regional' THEN 2
       WHEN 'local' THEN 3
       ELSE 4
     END,
     pch.peak_cat_count DESC NULLS LAST
   LIMIT 1) as most_significant_condition,

  -- Related sink places (where cats from here went)
  (SELECT array_agg(DISTINCT per.sink_place_id)
   FROM trapper.place_ecological_relationships per
   WHERE per.source_place_id = p.place_id) as dispersal_destinations

FROM trapper.places p
WHERE p.merged_into_place_id IS NULL;

COMMENT ON VIEW trapper.v_place_ecological_context IS 'Historical ecological context for population modeling. Shows FULL HISTORY including resolved conditions.';

-- ============================================================
-- VIEW: Complete Profile (both layers for Tippy)
-- ============================================================
CREATE OR REPLACE VIEW trapper.v_place_complete_profile AS
SELECT
  ops.place_id,
  ops.formatted_address,
  ops.service_zone,
  ops.lat,
  ops.lng,
  ops.has_active_request,
  ops.active_request_id,
  ops.current_contexts,
  ops.current_cat_estimate,
  ops.active_conditions,

  eco.condition_history,
  eco.condition_count,
  eco.peak_population,
  eco.peak_date,
  eco.documented_births,
  eco.was_significant_source,
  eco.most_significant_condition,
  eco.dispersal_destinations,

  -- Interpretation helpers
  CASE
    WHEN ops.has_active_request THEN 'active_request'
    WHEN ops.active_conditions IS NOT NULL THEN 'ongoing_condition'
    WHEN eco.was_significant_source THEN 'historical_source'
    WHEN eco.condition_count > 0 THEN 'has_history'
    ELSE 'no_significant_history'
  END as place_significance,

  -- Tippy context hint
  CASE
    WHEN ops.has_active_request THEN 'This place has an active request - focus on operational details.'
    WHEN eco.was_significant_source AND ops.current_cat_estimate IS NULL THEN
      'This was historically a significant cat source but appears resolved. Historical context relevant for regional understanding.'
    WHEN eco.peak_population > 20 THEN
      'This place had significant cat activity historically (peak: ' || eco.peak_population || ' cats).'
    WHEN eco.condition_count > 0 THEN
      'This place has ' || eco.condition_count || ' historical condition record(s).'
    ELSE 'No significant history at this location.'
  END as tippy_context_hint

FROM trapper.v_place_operational_state ops
LEFT JOIN trapper.v_place_ecological_context eco ON eco.place_id = ops.place_id;

COMMENT ON VIEW trapper.v_place_complete_profile IS 'Combined operational + ecological view for Tippy queries. Includes interpretation hints.';

-- ============================================================
-- VIEW: Historical Sources for Map Display
-- ============================================================
CREATE OR REPLACE VIEW trapper.v_historical_sources_map AS
SELECT
  p.place_id,
  p.formatted_address,
  ST_Y(p.location::geometry) as lat,
  ST_X(p.location::geometry) as lng,
  pch.condition_type,
  pct.display_label,
  pct.display_color,
  pch.severity,
  pch.valid_from,
  pch.valid_to,
  pch.peak_cat_count,
  pch.ecological_impact,
  pch.description,
  -- Opacity based on recency (older = more transparent)
  CASE
    WHEN pch.valid_to IS NULL THEN 1.0
    WHEN pch.valid_to > CURRENT_DATE - INTERVAL '2 years' THEN 0.9
    WHEN pch.valid_to > CURRENT_DATE - INTERVAL '5 years' THEN 0.7
    WHEN pch.valid_to > CURRENT_DATE - INTERVAL '10 years' THEN 0.5
    ELSE 0.3
  END as opacity
FROM trapper.places p
JOIN trapper.place_condition_history pch ON pch.place_id = p.place_id
JOIN trapper.place_condition_types pct ON pct.condition_type = pch.condition_type
WHERE p.merged_into_place_id IS NULL
  AND pch.superseded_at IS NULL
  AND pct.is_ecological_significant = TRUE
  AND p.location IS NOT NULL
ORDER BY pch.peak_cat_count DESC NULLS LAST;

COMMENT ON VIEW trapper.v_historical_sources_map IS 'Historical source places for map display. Only shows ecologically significant conditions.';

-- Add to Tippy view catalog (using valid categories: entity, ecology, stats, quality, linkage, processing)
INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
VALUES
  ('v_place_operational_state', 'entity', 'Current operational state - active requests, current contexts, ongoing conditions',
   ARRAY['place_id', 'formatted_address'], ARRAY['has_active_request', 'service_zone'],
   ARRAY['Does this address have an active request?', 'What is the current situation at this place?']),

  ('v_place_ecological_context', 'ecology', 'Historical ecological context - full condition history, peak populations, source-sink relationships',
   ARRAY['place_id', 'formatted_address'], ARRAY['was_significant_source', 'service_zone'],
   ARRAY['Was this ever a hoarder site?', 'Has this place contributed cats historically?', 'What is the peak population this address ever had?']),

  ('v_place_complete_profile', 'entity', 'Combined operational + ecological view with interpretation hints',
   ARRAY['place_id', 'formatted_address'], ARRAY['place_significance', 'service_zone'],
   ARRAY['Tell me about this address', 'What is the full history of this place?']),

  ('place_condition_history', 'ecology', 'Bitemporal history of place conditions (hoarding, disease, etc.)',
   ARRAY['place_id', 'condition_type'], ARRAY['condition_type', 'ecological_impact', 'valid_to'],
   ARRAY['Show all hoarding situations', 'What places had disease outbreaks?', 'List resolved conditions']),

  ('zone_data_coverage', 'stats', 'Data coverage by service zone - identifies data gaps',
   ARRAY['zone_id', 'zone_name'], ARRAY['coverage_level'],
   ARRAY['Which zones have the most data?', 'Where are the data gaps?', 'How much data do we have for Santa Rosa?'])
ON CONFLICT (view_name) DO UPDATE SET
  description = EXCLUDED.description,
  key_columns = EXCLUDED.key_columns,
  filter_columns = EXCLUDED.filter_columns,
  example_questions = EXCLUDED.example_questions;

\echo '=== MIG_720 Complete ==='
\echo 'Tables created: place_condition_types, place_condition_history, place_colony_timeline, place_ecological_relationships, zone_data_coverage'
\echo 'Views created: v_place_operational_state, v_place_ecological_context, v_place_complete_profile, v_historical_sources_map'
\echo 'Functions created: record_place_condition, refresh_zone_data_coverage'
