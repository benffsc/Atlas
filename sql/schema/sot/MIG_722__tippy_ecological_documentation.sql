\echo '=== MIG_722: Tippy Ecological Data Documentation ==='
\echo 'Adds comprehensive documentation for temporal/ecological data architecture'

-- ============================================================
-- DOCUMENT NEW TABLES IN TIPPY_SCHEMA_DOCS
-- ============================================================

INSERT INTO trapper.tippy_schema_docs (object_type, object_name, description, key_columns, relationships, example_queries, common_questions, important_notes)
VALUES
  ('table', 'place_condition_history',
   'Bitemporal history of place conditions (hoarding, disease outbreak, breeding crisis, etc.). Tracks what conditions existed and when, separate from current operational state.',
   '{"condition_id": "Primary key", "place_id": "FK to places", "condition_type": "Type from place_condition_types", "valid_from": "When condition started", "valid_to": "When ended (NULL=ongoing)", "severity": "minor/moderate/severe/critical"}',
   '{"place_id": "places.place_id", "condition_type": "place_condition_types.condition_type"}',
   ARRAY[
     'SELECT * FROM trapper.place_condition_history WHERE place_id = $1 ORDER BY valid_from DESC',
     'SELECT * FROM trapper.place_condition_history WHERE condition_type = ''disease_outbreak'' AND valid_to IS NULL',
     'SELECT * FROM trapper.place_condition_history WHERE ecological_impact IN (''regional'', ''significant'')'
   ],
   ARRAY['Was this ever a hoarder site?', 'What disease outbreaks have occurred here?', 'Which places had breeding crises?', 'Show historical conditions at this address'],
   ARRAY['Data extracted from Google Maps AI classifications, staff observations, and request history', 'valid_from/valid_to define when condition was TRUE in reality', 'superseded_at tracks when we updated our records']
  ),

  ('table', 'place_condition_types',
   'Lookup table for place condition types with display labels, severity defaults, and ecological significance flags.',
   '{"condition_type": "Primary key (hoarding, disease_outbreak, etc.)", "display_label": "Human-readable label", "is_ecological_significant": "Whether this affects population modeling"}',
   NULL,
   ARRAY['SELECT * FROM trapper.place_condition_types ORDER BY display_order'],
   ARRAY['What condition types exist?', 'Which conditions are ecologically significant?'],
   NULL
  ),

  ('table', 'place_colony_timeline',
   'Bitemporal colony size estimates over time. Tracks how colony populations changed, enabling historical reconstruction.',
   '{"timeline_id": "Primary key", "place_id": "FK to places", "estimated_total": "Total cats", "estimated_altered": "Altered cats", "alteration_rate": "Percentage", "colony_status": "growing/stable/declining/resolved", "valid_from": "When estimate valid from", "valid_to": "When superseded"}',
   '{"place_id": "places.place_id"}',
   ARRAY[
     'SELECT * FROM trapper.place_colony_timeline WHERE place_id = $1 ORDER BY valid_from DESC',
     'SELECT MAX(estimated_total) as peak FROM trapper.place_colony_timeline WHERE place_id = $1'
   ],
   ARRAY['What was the peak colony size?', 'How has the colony changed over time?', 'When did this colony reach its peak?'],
   ARRAY['Estimates come from multiple sources with varying confidence', 'Use confidence column to weight results']
  ),

  ('table', 'place_ecological_relationships',
   'Tracks source-sink relationships between places - where cats dispersed from one location to another.',
   '{"relationship_id": "Primary key", "source_place_id": "Origin place", "sink_place_id": "Destination place", "relationship_type": "dispersal/migration/relocation", "evidence_strength": "confirmed/likely/possible"}',
   '{"source_place_id": "places.place_id", "sink_place_id": "places.place_id"}',
   ARRAY[
     'SELECT * FROM trapper.place_ecological_relationships WHERE source_place_id = $1',
     'SELECT sink.formatted_address, per.estimated_cats_transferred FROM trapper.place_ecological_relationships per JOIN trapper.places sink ON sink.place_id = per.sink_place_id WHERE per.source_place_id = $1'
   ],
   ARRAY['Where did cats from this site go?', 'What are the source sites for this colony?', 'Show dispersal patterns'],
   ARRAY['Evidence types: microchip_match (strongest), trapper_observation, ai_inferred, geographic_proximity (weakest)']
  ),

  ('table', 'data_freshness_tracking',
   'Tracks when each data category was last refreshed and whether it is stale. Used by Guardian cron and Tippy to understand data currency.',
   '{"tracking_id": "Primary key", "data_category": "Category name", "last_full_refresh": "When fully refreshed", "staleness_threshold_days": "Days before considered stale", "freshness_status": "Computed: fresh/aging/stale/never_refreshed"}',
   NULL,
   ARRAY['SELECT * FROM trapper.v_data_staleness_alerts'],
   ARRAY['Is our data current?', 'What needs refreshing?', 'When was Census data last updated?', 'Show stale data categories'],
   ARRAY['Refreshed by Guardian cron', 'View v_data_staleness_alerts shows computed freshness status']
  ),

  ('table', 'zone_data_coverage',
   'Tracks data richness by geographic zone - where we have good data vs gaps.',
   '{"zone_id": "Service zone identifier", "google_maps_entries": "Count of Google Maps pins", "clinic_appointments": "Count of appointments", "coverage_level": "Computed: rich/moderate/sparse/gap"}',
   NULL,
   ARRAY['SELECT * FROM trapper.zone_data_coverage ORDER BY coverage_level DESC'],
   ARRAY['Where do we have data gaps?', 'Which zones have good coverage?', 'Show data-sparse areas'],
   ARRAY['Refreshed by trapper.refresh_zone_data_coverage()', 'Gap zones may need targeted data collection']
  ),

  ('concept', 'operational_vs_ecological',
   'Atlas has two data layers: OPERATIONAL (current workflow state for staff) and ECOLOGICAL (historical context for analysis). Use v_place_operational_state for "is there an active request?" questions. Use v_place_ecological_context for "was this ever a problem site?" questions.',
   NULL,
   NULL,
   ARRAY[
     '-- Operational: current state\nSELECT * FROM trapper.v_place_operational_state WHERE has_active_request = true',
     '-- Ecological: historical\nSELECT * FROM trapper.v_place_ecological_context WHERE was_significant_source = true'
   ],
   ARRAY['Is there an active request?', 'Was this ever a hoarder site?', 'What is the current status vs historical context?'],
   ARRAY['Operational layer filters to valid_to IS NULL (current)', 'Ecological layer includes all history']
  ),

  ('concept', 'bitemporal_modeling',
   'Historical data uses bitemporal modeling: valid_from/valid_to (when fact was TRUE in reality) and recorded_at (when we learned about it). This enables both "what was true then?" and "what did we know then?" queries.',
   NULL,
   NULL,
   ARRAY[
     '-- What conditions existed in 2020?\nSELECT * FROM trapper.place_condition_history WHERE valid_from <= ''2020-12-31'' AND (valid_to IS NULL OR valid_to >= ''2020-01-01'')',
     '-- When did we first learn about this?\nSELECT recorded_at FROM trapper.place_condition_history WHERE place_id = $1 ORDER BY recorded_at LIMIT 1'
   ],
   ARRAY['What did this place look like in 2019?', 'When did we learn about this condition?', 'What was the timeline of this colony?'],
   NULL
  ),

  ('concept', 'pet_ownership_index',
   'Computed score (0-100) predicting likelihood of unaltered pets in an area. Higher = more likely. Based on: lower income (+), higher renter % (+), mobile homes (+), poverty (+).',
   NULL,
   NULL,
   ARRAY['SELECT area_name, pet_ownership_index FROM trapper.ref_sonoma_geography WHERE area_type = ''zip'' ORDER BY pet_ownership_index DESC'],
   ARRAY['Which areas have high pet ownership index?', 'Where should we prioritize TNR outreach?', 'What zip codes have most unaltered pets?'],
   ARRAY['Based on research correlating socioeconomic factors with unaltered pet ownership', 'Data from US Census ACS 5-year estimates']
  )
ON CONFLICT (object_type, object_name, schema_name) DO UPDATE SET
  description = EXCLUDED.description,
  key_columns = EXCLUDED.key_columns,
  relationships = EXCLUDED.relationships,
  example_queries = EXCLUDED.example_queries,
  common_questions = EXCLUDED.common_questions,
  important_notes = EXCLUDED.important_notes,
  updated_at = NOW();

-- ============================================================
-- ADD KEY ECOLOGICAL VIEWS TO TIPPY CATALOG
-- ============================================================

INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
VALUES
  ('v_beacon_zone_summary', 'ecology', 'Zone-level Beacon statistics including colony counts, alteration rates, and coverage metrics per service zone.',
   ARRAY['zone_name'], ARRAY['zone_name'],
   ARRAY['What is the alteration rate in West County?', 'How many colonies are in each zone?', 'Show Beacon stats by zone']),

  ('v_seasonal_births', 'ecology', 'Seasonal birth patterns showing when litters are most common. Critical for kitten surge planning.',
   ARRAY['month', 'birth_count'], ARRAY['year'],
   ARRAY['When is kitten season?', 'What month has the most births?', 'Show birth seasonality']),

  ('v_seasonal_mortality', 'ecology', 'Seasonal mortality patterns. Helps understand population dynamics.',
   ARRAY['month', 'death_count'], ARRAY['year'],
   ARRAY['When do most cats die?', 'Show mortality by season']),

  ('v_place_mortality_stats', 'ecology', 'Mortality statistics by place including causes and age distribution.',
   ARRAY['place_id', 'total_deaths'], ARRAY['service_zone'],
   ARRAY['How many cats have died at this address?', 'What are the mortality causes?']),

  ('v_place_reproduction_stats', 'ecology', 'Reproduction statistics by place including litter counts and kitten survival.',
   ARRAY['place_id', 'total_litters'], ARRAY['service_zone'],
   ARRAY['How many litters have been born here?', 'What is the reproduction rate?']),

  ('v_cat_movement_patterns', 'ecology', 'Tracks cat movements between places over time. Useful for understanding dispersal.',
   ARRAY['cat_id', 'from_place_id', 'to_place_id'], ARRAY['movement_type'],
   ARRAY['Where did this cat move?', 'Show cat movement patterns']),

  ('v_zone_observation_priority', 'ecology', 'Prioritizes zones for observation collection based on data gaps and colony activity.',
   ARRAY['zone_name', 'priority_score'], ARRAY['zone_name'],
   ARRAY['Where should we collect more observations?', 'Which zones need surveys?']),

  ('zone_data_coverage', 'quality', 'Data coverage by geographic zone - shows where we have rich vs sparse data.',
   ARRAY['zone_id', 'zone_name'], ARRAY['coverage_level'],
   ARRAY['Where are our data gaps?', 'Which zones have good data?', 'Show data coverage by zone']),

  ('v_households_summary', 'entity', 'Household groupings - multiple people at the same address sharing identifiers.',
   ARRAY['place_id', 'member_count'], ARRAY['service_zone'],
   ARRAY['How many households do we track?', 'Show households at this address'])
ON CONFLICT (view_name) DO UPDATE SET
  description = EXCLUDED.description,
  key_columns = EXCLUDED.key_columns,
  filter_columns = EXCLUDED.filter_columns,
  example_questions = EXCLUDED.example_questions;

-- ============================================================
-- REFRESH ZONE DATA COVERAGE
-- ============================================================

SELECT trapper.refresh_zone_data_coverage();

-- ============================================================
-- UPDATE FRESHNESS TRACKING FOR COMPLETED CATEGORIES
-- ============================================================

UPDATE trapper.data_freshness_tracking
SET last_full_refresh = NOW(),
    records_count = (SELECT COUNT(*) FROM trapper.place_condition_history WHERE superseded_at IS NULL),
    updated_at = NOW()
WHERE data_category = 'place_conditions';

UPDATE trapper.data_freshness_tracking
SET last_full_refresh = NOW(),
    records_count = (SELECT COUNT(*) FROM trapper.google_map_entries WHERE ai_classified_at IS NOT NULL),
    updated_at = NOW()
WHERE data_category = 'google_maps_classification';

-- ============================================================
-- ADD TIPPY CONCEPT DEFINITIONS FOR KEY TERMS
-- ============================================================

INSERT INTO trapper.tippy_concept_definitions (concept_name, short_definition, full_explanation, related_tables, example)
VALUES
  ('historical_source',
   'A place that was historically a significant source of cats but may now be resolved.',
   'Important for understanding regional cat populations even when current activity is low. Historical sources (like former hoarding sites or breeding crises) can explain current cat presence in nearby areas due to dispersal.',
   ARRAY['place_condition_history', 'v_place_ecological_context'],
   'SELECT * FROM trapper.v_place_ecological_context WHERE was_significant_source = true'),

  ('data_gap',
   'A geographic zone where we have sparse or no data.',
   'Identified via zone_data_coverage table. IMPORTANT: Gaps may indicate lack of activity OR lack of data collection - distinguish carefully. Low data coverage does not necessarily mean low cat population.',
   ARRAY['zone_data_coverage'],
   'SELECT * FROM trapper.zone_data_coverage WHERE coverage_level = ''gap'''),

  ('valid_time',
   'When a fact was TRUE in reality (valid_from/valid_to).',
   'In bitemporal modeling, valid_time represents when a condition actually existed. Different from transaction_time (when we recorded it in the database). Enables "what was true then?" queries.',
   ARRAY['place_condition_history', 'place_colony_timeline'],
   'SELECT * FROM trapper.place_condition_history WHERE valid_from <= $date AND (valid_to IS NULL OR valid_to >= $date)'),

  ('tnr_priority_score',
   'Computed score (0-100) for TNR prioritization based on socioeconomic factors.',
   'Higher scores indicate areas that should be prioritized for TNR outreach. Based on: lower income (+), higher renter percentage (+), mobile homes (+), poverty rate (+), and actual colony activity.',
   ARRAY['ref_sonoma_geography', 'v_area_tnr_correlation'],
   'SELECT area_name, tnr_priority_score FROM trapper.ref_sonoma_geography ORDER BY tnr_priority_score DESC')
ON CONFLICT (concept_name) DO UPDATE SET
  short_definition = EXCLUDED.short_definition,
  full_explanation = EXCLUDED.full_explanation,
  related_tables = EXCLUDED.related_tables,
  example = EXCLUDED.example;

\echo '=== MIG_722 Complete ==='
\echo 'Added: schema docs for 6 tables, 9 views to catalog, 4 concept definitions'
\echo 'Refreshed: zone_data_coverage, freshness tracking'
