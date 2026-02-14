\echo '=== MIG_755: Population Modeling Attributes for Beacon ==='
\echo 'Adds 12 new attributes critical for Chapman mark-recapture estimation'

-- ============================================================
-- POPULATION MODELING ATTRIBUTES
-- These attributes enable Chapman mark-recapture calculations
-- and breeding/reproduction modeling for Beacon
-- ============================================================

INSERT INTO trapper.entity_attribute_definitions
  (attribute_key, entity_type, data_type, display_label, description, enum_values, extraction_keywords, priority)
VALUES
  -- ============================================================
  -- CRITICAL FOR CHAPMAN ESTIMATOR (Priority 1-4)
  -- These directly feed into N̂ = ((M+1)(C+1)/(R+1)) - 1
  -- ============================================================

  ('is_recapture', 'cat', 'boolean', 'Recapture',
   'Cat was previously altered/seen at FFSC. Critical for Chapman R (resighted marked).',
   NULL,
   ARRAY['recapture', 'recheck', 'return', 'eartip present', 'already tipped', 'previously fixed', 'came back', 'second time', 'seen before'],
   1),

  ('was_eartipped_on_arrival', 'cat', 'boolean', 'Arrived Eartipped',
   'Cat had eartip when brought in (not tipped during this visit). Indicates prior alteration.',
   NULL,
   ARRAY['eartip noted', 'already tipped', 'has eartip', 'tip present', 'tipped on arrival', 'ear already clipped', 'previously tipped'],
   2),

  ('unfixed_count_observed', 'place', 'number', 'Unfixed Observed',
   'Count of unfixed/intact cats observed at location. Used for Chapman C - R (unmarked sample).',
   NULL,
   ARRAY['unfixed', 'intact', 'not fixed', 'unaltered', 'whole', 'unneutered', 'unspayed', 'needs fixing'],
   3),

  ('eartip_count_observed', 'place', 'number', 'Eartipped Observed',
   'Count of eartipped cats observed at location. Used for Chapman R (resighted marked cats).',
   NULL,
   ARRAY['eartipped', 'tipped', 'ear tipped', 'see eartips', 'clipped ears', 'already fixed'],
   4),

  -- ============================================================
  -- BREEDING/REPRODUCTION MODELING (Priority 5-8)
  -- These feed into population growth projections
  -- ============================================================

  ('litter_size', 'cat', 'number', 'Litter Size',
   'Number of kittens in litter if mom/kitten. Used for birth rate modeling.',
   NULL,
   ARRAY['litter of', 'kittens', 'babies', 'nursing', 'mom with', 'brought in with'],
   5),

  ('gestational_stage', 'cat', 'enum', 'Pregnancy Stage',
   'Stage of pregnancy if noted. Helps estimate birth timing.',
   ARRAY['early', 'mid', 'late', 'unknown'],
   ARRAY['early term', 'mid term', 'late term', 'about to pop', 'full term', 'very pregnant', 'just pregnant', 'weeks along'],
   6),

  ('is_lactating', 'cat', 'boolean', 'Lactating',
   'Currently nursing kittens. Indicates recent birth.',
   NULL,
   ARRAY['lactating', 'nursing', 'milk present', 'nursing mom', 'has milk', 'mammary', 'producing milk', 'nursing kittens'],
   7),

  ('kitten_count_at_location', 'place', 'number', 'Kittens at Location',
   'Number of kittens observed at site. Indicates breeding activity.',
   NULL,
   ARRAY['kittens', 'babies', 'young ones', 'litter', 'baby cats'],
   8),

  -- ============================================================
  -- COLONY CONTEXT (Priority 9-12)
  -- These help with trapping planning and population dynamics
  -- ============================================================

  ('trapping_difficulty', 'place', 'enum', 'Trapping Difficulty',
   'How hard to trap at this location. Affects resource planning.',
   ARRAY['easy', 'moderate', 'difficult', 'very_difficult'],
   ARRAY['hard to trap', 'easy to trap', 'difficult', 'wont go in', 'trap resistant', 'challenging'],
   9),

  ('has_trap_shy_cats', 'place', 'boolean', 'Has Trap-Shy Cats',
   'Some cats at location avoid traps. May require drop traps or advanced methods.',
   NULL,
   ARRAY['trap shy', 'wont go near trap', 'avoids traps', 'trap wary', 'scared of traps', 'wont enter'],
   10),

  ('newcomer_frequency', 'place', 'enum', 'Newcomer Frequency',
   'How often new cats appear at location. Indicates population dynamics.',
   ARRAY['frequent', 'occasional', 'rare', 'none', 'unknown'],
   ARRAY['new cats', 'keep showing up', 'new arrivals', 'stable', 'same cats', 'new ones', 'dumped cats'],
   11),

  ('years_feeding', 'place', 'number', 'Years Feeding',
   'How long feeder has been active at location. Indicates colony establishment.',
   NULL,
   ARRAY['years feeding', 'feeding since', 'feeding for', 'started in', 'been feeding', 'for years'],
   12)
ON CONFLICT (attribute_key) DO UPDATE SET
  description = EXCLUDED.description,
  extraction_keywords = EXCLUDED.extraction_keywords,
  priority = EXCLUDED.priority;

-- ============================================================
-- UPDATE VIEWS TO EXPOSE NEW CAT ATTRIBUTES
-- ============================================================

-- Add is_recapture and is_lactating to cat attributes view
CREATE OR REPLACE VIEW trapper.v_cat_attributes AS
SELECT
  c.cat_id,
  c.display_name,
  trapper.entity_has_attribute('cat', c.cat_id, 'is_feral') as is_feral,
  trapper.entity_has_attribute('cat', c.cat_id, 'is_friendly') as is_friendly,
  trapper.entity_has_attribute('cat', c.cat_id, 'has_disease') as has_disease,
  trapper.entity_has_attribute('cat', c.cat_id, 'special_needs') as special_needs,
  trapper.entity_has_attribute('cat', c.cat_id, 'is_recapture') as is_recapture,
  trapper.entity_has_attribute('cat', c.cat_id, 'was_eartipped_on_arrival') as was_eartipped_on_arrival,
  trapper.entity_has_attribute('cat', c.cat_id, 'is_lactating') as is_lactating,
  (SELECT ea.attribute_value->>'value' FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'cat' AND ea.entity_id = c.cat_id
   AND ea.attribute_key = 'disease_type' AND ea.superseded_at IS NULL) as disease_type,
  (SELECT ea.attribute_value->>'value' FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'cat' AND ea.entity_id = c.cat_id
   AND ea.attribute_key = 'temperament' AND ea.superseded_at IS NULL) as temperament,
  (SELECT ea.attribute_value->>'value' FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'cat' AND ea.entity_id = c.cat_id
   AND ea.attribute_key = 'estimated_age' AND ea.superseded_at IS NULL) as estimated_age,
  (SELECT ea.attribute_value->>'value' FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'cat' AND ea.entity_id = c.cat_id
   AND ea.attribute_key = 'gestational_stage' AND ea.superseded_at IS NULL) as gestational_stage,
  (SELECT (ea.attribute_value)::int FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'cat' AND ea.entity_id = c.cat_id
   AND ea.attribute_key = 'litter_size' AND ea.superseded_at IS NULL) as litter_size
FROM trapper.sot_cats c
WHERE c.merged_into_cat_id IS NULL;

-- ============================================================
-- UPDATE VIEWS TO EXPOSE NEW PLACE ATTRIBUTES
-- ============================================================

-- Add population modeling fields to place attributes view
CREATE OR REPLACE VIEW trapper.v_place_attributes AS
SELECT
  p.place_id,
  p.formatted_address,
  p.service_zone,
  -- Original boolean attributes
  trapper.entity_has_attribute('place', p.place_id, 'has_kitten_history') as has_kitten_history,
  trapper.entity_has_attribute('place', p.place_id, 'has_disease_history') as has_disease_history,
  trapper.entity_has_attribute('place', p.place_id, 'has_mortality_history') as has_mortality_history,
  trapper.entity_has_attribute('place', p.place_id, 'feeder_present') as feeder_present,
  trapper.entity_has_attribute('place', p.place_id, 'has_breeding_activity') as has_breeding_activity,
  trapper.entity_has_attribute('place', p.place_id, 'has_relocation_history') as has_relocation_history,
  trapper.entity_has_attribute('place', p.place_id, 'has_trap_shy_cats') as has_trap_shy_cats,
  -- Enum attributes
  (SELECT ea.attribute_value->>'value' FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'place' AND ea.entity_id = p.place_id
   AND ea.attribute_key = 'colony_status' AND ea.superseded_at IS NULL) as colony_status,
  (SELECT ea.attribute_value->>'value' FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'place' AND ea.entity_id = p.place_id
   AND ea.attribute_key = 'property_type' AND ea.superseded_at IS NULL) as property_type,
  (SELECT ea.attribute_value->>'value' FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'place' AND ea.entity_id = p.place_id
   AND ea.attribute_key = 'access_difficulty' AND ea.superseded_at IS NULL) as access_difficulty,
  (SELECT ea.attribute_value->>'value' FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'place' AND ea.entity_id = p.place_id
   AND ea.attribute_key = 'trapping_difficulty' AND ea.superseded_at IS NULL) as trapping_difficulty,
  (SELECT ea.attribute_value->>'value' FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'place' AND ea.entity_id = p.place_id
   AND ea.attribute_key = 'newcomer_frequency' AND ea.superseded_at IS NULL) as newcomer_frequency,
  -- Numeric attributes (for Chapman calculation)
  (SELECT (ea.attribute_value)::int FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'place' AND ea.entity_id = p.place_id
   AND ea.attribute_key = 'estimated_colony_size' AND ea.superseded_at IS NULL) as estimated_colony_size,
  (SELECT (ea.attribute_value)::int FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'place' AND ea.entity_id = p.place_id
   AND ea.attribute_key = 'unfixed_count_observed' AND ea.superseded_at IS NULL) as unfixed_count_observed,
  (SELECT (ea.attribute_value)::int FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'place' AND ea.entity_id = p.place_id
   AND ea.attribute_key = 'eartip_count_observed' AND ea.superseded_at IS NULL) as eartip_count_observed,
  (SELECT (ea.attribute_value)::int FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'place' AND ea.entity_id = p.place_id
   AND ea.attribute_key = 'kitten_count_at_location' AND ea.superseded_at IS NULL) as kitten_count_at_location,
  (SELECT (ea.attribute_value)::int FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'place' AND ea.entity_id = p.place_id
   AND ea.attribute_key = 'years_feeding' AND ea.superseded_at IS NULL) as years_feeding
FROM trapper.places p
WHERE p.merged_into_place_id IS NULL;

-- ============================================================
-- ADD TO TIPPY CATALOG
-- ============================================================

UPDATE trapper.tippy_view_catalog
SET
  filter_columns = ARRAY['has_kitten_history', 'has_disease_history', 'feeder_present', 'colony_status', 'service_zone', 'has_trap_shy_cats', 'trapping_difficulty', 'newcomer_frequency'],
  example_questions = ARRAY[
    'Which places have kitten history?',
    'Where are disease-risk locations?',
    'Show places with active feeders',
    'Find all farm properties',
    'Which locations have trap-shy cats?',
    'Where do new cats keep showing up?'
  ]
WHERE view_name = 'v_place_attributes';

UPDATE trapper.tippy_view_catalog
SET
  filter_columns = ARRAY['is_feral', 'is_friendly', 'has_disease', 'temperament', 'is_recapture', 'is_lactating'],
  example_questions = ARRAY[
    'Which cats are friendly?',
    'Show FeLV positive cats',
    'Find feral cats',
    'List special needs cats',
    'Which cats were recaptures?',
    'Show lactating cats'
  ]
WHERE view_name = 'v_cat_attributes';

\echo ''
\echo '=== MIG_755 Complete ==='
\echo 'Added 12 population modeling attributes:'
\echo '  - Chapman estimator: is_recapture, was_eartipped_on_arrival, unfixed_count_observed, eartip_count_observed'
\echo '  - Breeding: litter_size, gestational_stage, is_lactating, kitten_count_at_location'
\echo '  - Colony context: trapping_difficulty, has_trap_shy_cats, newcomer_frequency, years_feeding'
\echo 'Updated v_cat_attributes and v_place_attributes views'
\echo ''
