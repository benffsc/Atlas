\echo '=== MIG_710: Entity Attributes System - AI-Parsed Structured Data ==='
\echo 'Creates unified system for extracting queryable attributes from unstructured text'

-- ============================================================
-- ATTRIBUTE DEFINITIONS CATALOG
-- Defines what attributes we track and their schema
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.entity_attribute_definitions (
  attribute_key TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL, -- 'place', 'person', 'cat', 'request'
  data_type TEXT NOT NULL,   -- 'boolean', 'enum', 'number', 'date', 'text', 'array'
  enum_values TEXT[],        -- For enum types, valid values
  display_label TEXT NOT NULL,
  description TEXT,
  extraction_keywords TEXT[], -- Keywords that suggest this attribute in text
  tippy_queryable BOOLEAN DEFAULT TRUE,
  priority INT DEFAULT 50,    -- Lower = extract first
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed attribute definitions
INSERT INTO trapper.entity_attribute_definitions
  (attribute_key, entity_type, data_type, display_label, description, enum_values, extraction_keywords, priority)
VALUES
  -- ============================================================
  -- PLACE ATTRIBUTES
  -- ============================================================
  ('has_kitten_history', 'place', 'boolean', 'Kitten History',
   'Kittens have been found/reported at this location', NULL,
   ARRAY['kitten', 'kittens', 'litter', 'babies', 'nursing', 'pregnant', 'lactating', 'mama', 'momma'], 10),

  ('has_disease_history', 'place', 'boolean', 'Disease History',
   'FeLV/FIV positive cats documented at this location', NULL,
   ARRAY['felv', 'fiv', 'leukemia', 'positive', 'disease', 'sick', 'infected'], 5),

  ('has_mortality_history', 'place', 'boolean', 'Mortality History',
   'Cat deaths documented at this location', NULL,
   ARRAY['died', 'death', 'deceased', 'passed', 'euthanasia', 'hit by car', 'hbc', 'found dead'], 15),

  ('feeder_present', 'place', 'boolean', 'Feeder Present',
   'Someone actively feeds cats at this location', NULL,
   ARRAY['feeds', 'feeding', 'feeder', 'caretaker', 'puts out food', 'food station'], 20),

  ('colony_status', 'place', 'enum', 'Colony Status',
   'Current status of colony at this location',
   ARRAY['active', 'managed', 'resolved', 'unknown'],
   ARRAY['colony', 'managed colony', 'tnr complete', 'all fixed', 'ongoing'], 25),

  ('estimated_colony_size', 'place', 'number', 'Est. Colony Size',
   'Estimated number of cats at location', NULL,
   ARRAY['cats', 'colony of', 'about', 'approximately', 'around'], 30),

  ('property_type', 'place', 'enum', 'Property Type',
   'Type of property',
   ARRAY['residential', 'commercial', 'farm', 'mobile_home', 'apartment', 'rural', 'industrial', 'unknown'],
   ARRAY['house', 'apartment', 'mobile home', 'trailer', 'farm', 'barn', 'business', 'store', 'warehouse'], 40),

  ('access_difficulty', 'place', 'enum', 'Access Difficulty',
   'How hard to access location for trapping',
   ARRAY['easy', 'moderate', 'difficult', 'unknown'],
   ARRAY['hard to access', 'difficult', 'rural', 'gated', 'private', 'easy access'], 45),

  ('has_breeding_activity', 'place', 'boolean', 'Active Breeding',
   'Evidence of ongoing breeding/reproduction at this location', NULL,
   ARRAY['breeding', 'reproducing', 'new kittens', 'pregnant cats', 'unfixed cats mating'], 12),

  ('has_relocation_history', 'place', 'boolean', 'Relocation History',
   'Cats have been relocated to/from this location', NULL,
   ARRAY['relocated', 'relocation', 'barn home', 'moved cats', 'rehomed'], 35),

  -- ============================================================
  -- PERSON ATTRIBUTES
  -- ============================================================
  ('is_volunteer', 'person', 'boolean', 'Volunteer',
   'Person is an active volunteer', NULL,
   ARRAY['volunteer', 'helps', 'assists', 'traps for us'], 20),

  ('is_feeder', 'person', 'boolean', 'Feeder',
   'Person feeds community cats', NULL,
   ARRAY['feeds', 'feeder', 'caretaker', 'puts out food', 'feeds strays'], 25),

  ('is_trapper', 'person', 'boolean', 'Trapper',
   'Person traps cats', NULL,
   ARRAY['trapper', 'traps', 'trapping', 'catches cats'], 30),

  ('safety_concern', 'person', 'boolean', 'Safety Concern',
   'Staff safety concern documented', NULL,
   ARRAY['hostile', 'aggressive', 'threatening', 'difficult', 'dangerous', 'do not contact', 'watch list', 'warning'], 5),

  ('communication_preference', 'person', 'enum', 'Comm. Preference',
   'Preferred contact method',
   ARRAY['phone', 'text', 'email', 'any'],
   ARRAY['prefers text', 'call only', 'email preferred', 'text only'], 50),

  ('responsiveness', 'person', 'enum', 'Responsiveness',
   'How responsive to contact',
   ARRAY['highly_responsive', 'responsive', 'slow', 'unresponsive', 'unknown'],
   ARRAY['very responsive', 'hard to reach', 'never answers', 'always available', 'ghosted'], 55),

  ('provides_barn_homes', 'person', 'boolean', 'Provides Barn Homes',
   'Person accepts cats for barn/working cat placement', NULL,
   ARRAY['barn home', 'working cat', 'takes cats', 'rehomes to barn'], 35),

  -- ============================================================
  -- CAT ATTRIBUTES
  -- ============================================================
  ('is_feral', 'cat', 'boolean', 'Feral',
   'Cat is feral (not socialized)', NULL,
   ARRAY['feral', 'wild', 'untouchable', 'cannot handle', 'hisses', 'bites', 'scratches'], 20),

  ('is_friendly', 'cat', 'boolean', 'Friendly',
   'Cat is people-friendly', NULL,
   ARRAY['friendly', 'sweet', 'loves people', 'purrs', 'affectionate', 'lap cat', 'adoptable'], 25),

  ('has_disease', 'cat', 'boolean', 'Disease Positive',
   'FeLV/FIV positive', NULL,
   ARRAY['felv', 'fiv', 'positive', 'leukemia'], 5),

  ('disease_type', 'cat', 'enum', 'Disease Type',
   'Type of disease if positive',
   ARRAY['felv', 'fiv', 'both', 'none', 'unknown'],
   ARRAY['felv positive', 'fiv positive', 'felv/fiv'], 10),

  ('special_needs', 'cat', 'boolean', 'Special Needs',
   'Has special medical/care needs', NULL,
   ARRAY['special needs', 'medical', 'blind', 'deaf', 'amputee', 'diabetic', 'medication'], 30),

  ('estimated_age', 'cat', 'enum', 'Estimated Age',
   'Age category',
   ARRAY['kitten', 'young', 'adult', 'senior', 'unknown'],
   ARRAY['kitten', 'young', 'adult', 'senior', 'old', 'elderly', 'baby'], 35),

  ('temperament', 'cat', 'enum', 'Temperament',
   'Behavior temperament',
   ARRAY['friendly', 'shy', 'feral', 'aggressive', 'unknown'],
   ARRAY['friendly', 'shy', 'feral', 'aggressive', 'scared', 'timid', 'mean'], 40),

  -- ============================================================
  -- REQUEST ATTRIBUTES
  -- ============================================================
  ('has_kittens', 'request', 'boolean', 'Has Kittens',
   'Kittens involved in this request', NULL,
   ARRAY['kitten', 'kittens', 'babies', 'litter'], 10),

  ('has_pregnant', 'request', 'boolean', 'Pregnant Cat',
   'Pregnant cat involved', NULL,
   ARRAY['pregnant', 'expecting', 'about to give birth', 'looks pregnant'], 15),

  ('is_emergency', 'request', 'boolean', 'Emergency',
   'Emergency situation', NULL,
   ARRAY['emergency', 'urgent', 'injured', 'dying', 'hit by car', 'attacked'], 5),

  ('caller_relationship', 'request', 'enum', 'Caller Relationship',
   'Caller relation to cats',
   ARRAY['owner', 'feeder', 'neighbor', 'property_manager', 'passerby', 'unknown'],
   ARRAY['my cat', 'i feed', 'neighbor', 'property manager', 'landlord', 'just saw'], 30),

  ('urgency_level', 'request', 'enum', 'Urgency',
   'How urgent is this request',
   ARRAY['critical', 'high', 'medium', 'low', 'unknown'],
   ARRAY['asap', 'urgent', 'when possible', 'no rush'], 25),

  ('has_hostile_environment', 'request', 'boolean', 'Hostile Environment',
   'Location has hostile people or dangerous conditions', NULL,
   ARRAY['hostile', 'angry neighbor', 'threatening', 'dangerous area', 'unsafe'], 8),

  ('involves_hoarding', 'request', 'boolean', 'Hoarding Situation',
   'Request involves a hoarding situation', NULL,
   ARRAY['hoarding', 'hoarder', 'too many cats', '50+ cats', '100 cats', 'overwhelmed'], 7)
ON CONFLICT (attribute_key) DO UPDATE SET
  description = EXCLUDED.description,
  extraction_keywords = EXCLUDED.extraction_keywords,
  priority = EXCLUDED.priority;

-- ============================================================
-- ENTITY ATTRIBUTES TABLE - Stores the actual values
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.entity_attributes (
  attribute_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,   -- 'place', 'person', 'cat', 'request'
  entity_id UUID NOT NULL,     -- FK to the entity
  attribute_key TEXT NOT NULL REFERENCES trapper.entity_attribute_definitions(attribute_key),
  attribute_value JSONB NOT NULL,  -- The value (schema depends on data_type)
  confidence NUMERIC(3,2),     -- AI confidence (0.0 - 1.0)
  source_type TEXT NOT NULL,   -- 'ai_extracted', 'manual', 'computed', 'inferred'
  source_text TEXT,            -- Original text that led to this extraction
  source_system TEXT,          -- 'clinichq', 'airtable', 'google_maps', 'request_notes', 'web_intake'
  source_record_id TEXT,       -- ID of source record
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  extracted_by TEXT,           -- 'claude_haiku', 'claude_sonnet', 'staff:{name}', 'system'
  superseded_at TIMESTAMPTZ,   -- When this value was replaced by newer extraction
  superseded_by UUID           -- ID of the attribute that replaced this one
);

-- Unique constraint: only one active value per entity+attribute
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_attr_unique_active
ON trapper.entity_attributes(entity_type, entity_id, attribute_key)
WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_entity_attributes_entity ON trapper.entity_attributes(entity_type, entity_id) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entity_attributes_key ON trapper.entity_attributes(attribute_key) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entity_attributes_value ON trapper.entity_attributes USING GIN (attribute_value) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entity_attributes_source ON trapper.entity_attributes(source_system) WHERE superseded_at IS NULL;

-- ============================================================
-- EXTRACTION JOBS TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.attribute_extraction_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system TEXT NOT NULL,  -- 'clinichq', 'airtable', 'google_maps', etc.
  entity_type TEXT NOT NULL,    -- 'place', 'person', 'cat', 'request'
  batch_size INT,
  records_processed INT DEFAULT 0,
  records_with_extractions INT DEFAULT 0,
  attributes_extracted INT DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  model_used TEXT,              -- 'claude-3-haiku', 'claude-sonnet-4', etc.
  cost_estimate_usd NUMERIC(10,4),
  notes TEXT
);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Function to get all current attributes for an entity
CREATE OR REPLACE FUNCTION trapper.get_entity_attributes(p_entity_type TEXT, p_entity_id UUID)
RETURNS JSONB AS $$
  SELECT COALESCE(
    jsonb_object_agg(
      ea.attribute_key,
      jsonb_build_object(
        'value', ea.attribute_value,
        'confidence', ea.confidence,
        'source', ea.source_type,
        'source_system', ea.source_system,
        'extracted_at', ea.extracted_at
      )
    ),
    '{}'::jsonb
  )
  FROM trapper.entity_attributes ea
  WHERE ea.entity_type = p_entity_type
    AND ea.entity_id = p_entity_id
    AND ea.superseded_at IS NULL;
$$ LANGUAGE sql STABLE;

-- Function to set an attribute (handles superseding old values)
CREATE OR REPLACE FUNCTION trapper.set_entity_attribute(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_attribute_key TEXT,
  p_value JSONB,
  p_confidence NUMERIC DEFAULT 0.8,
  p_source_type TEXT DEFAULT 'ai_extracted',
  p_source_text TEXT DEFAULT NULL,
  p_source_system TEXT DEFAULT NULL,
  p_source_record_id TEXT DEFAULT NULL,
  p_extracted_by TEXT DEFAULT 'system'
) RETURNS UUID AS $$
DECLARE
  v_new_id UUID;
  v_old_id UUID;
  v_old_confidence NUMERIC;
BEGIN
  -- Find existing active attribute
  SELECT attribute_id, confidence INTO v_old_id, v_old_confidence
  FROM trapper.entity_attributes
  WHERE entity_type = p_entity_type
    AND entity_id = p_entity_id
    AND attribute_key = p_attribute_key
    AND superseded_at IS NULL;

  -- Only update if new confidence is higher or equal, or if no existing value
  IF v_old_id IS NULL OR p_confidence >= COALESCE(v_old_confidence, 0) THEN
    -- Insert new attribute
    INSERT INTO trapper.entity_attributes (
      entity_type, entity_id, attribute_key, attribute_value,
      confidence, source_type, source_text, source_system, source_record_id, extracted_by
    ) VALUES (
      p_entity_type, p_entity_id, p_attribute_key, p_value,
      p_confidence, p_source_type, p_source_text, p_source_system, p_source_record_id, p_extracted_by
    ) RETURNING attribute_id INTO v_new_id;

    -- Supersede old value if exists
    IF v_old_id IS NOT NULL THEN
      UPDATE trapper.entity_attributes
      SET superseded_at = NOW(), superseded_by = v_new_id
      WHERE attribute_id = v_old_id;
    END IF;

    RETURN v_new_id;
  END IF;

  -- Return old ID if we didn't update (new confidence was lower)
  RETURN v_old_id;
END;
$$ LANGUAGE plpgsql;

-- Function to check if entity has a specific boolean attribute
CREATE OR REPLACE FUNCTION trapper.entity_has_attribute(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_attribute_key TEXT
) RETURNS BOOLEAN AS $$
  SELECT COALESCE((
    SELECT (ea.attribute_value)::boolean
    FROM trapper.entity_attributes ea
    WHERE ea.entity_type = p_entity_type
      AND ea.entity_id = p_entity_id
      AND ea.attribute_key = p_attribute_key
      AND ea.superseded_at IS NULL
  ), false);
$$ LANGUAGE sql STABLE;

-- ============================================================
-- CONVENIENCE VIEWS
-- ============================================================

-- View: Place flags (most commonly queried)
CREATE OR REPLACE VIEW trapper.v_place_attributes AS
SELECT
  p.place_id,
  p.formatted_address,
  p.service_zone,
  trapper.entity_has_attribute('place', p.place_id, 'has_kitten_history') as has_kitten_history,
  trapper.entity_has_attribute('place', p.place_id, 'has_disease_history') as has_disease_history,
  trapper.entity_has_attribute('place', p.place_id, 'has_mortality_history') as has_mortality_history,
  trapper.entity_has_attribute('place', p.place_id, 'feeder_present') as feeder_present,
  trapper.entity_has_attribute('place', p.place_id, 'has_breeding_activity') as has_breeding_activity,
  trapper.entity_has_attribute('place', p.place_id, 'has_relocation_history') as has_relocation_history,
  (SELECT ea.attribute_value->>'value' FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'place' AND ea.entity_id = p.place_id
   AND ea.attribute_key = 'colony_status' AND ea.superseded_at IS NULL) as colony_status,
  (SELECT (ea.attribute_value)::int FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'place' AND ea.entity_id = p.place_id
   AND ea.attribute_key = 'estimated_colony_size' AND ea.superseded_at IS NULL) as estimated_colony_size,
  (SELECT ea.attribute_value->>'value' FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'place' AND ea.entity_id = p.place_id
   AND ea.attribute_key = 'property_type' AND ea.superseded_at IS NULL) as property_type
FROM trapper.places p
WHERE p.merged_into_place_id IS NULL;

-- View: Person flags
CREATE OR REPLACE VIEW trapper.v_person_attributes AS
SELECT
  pe.person_id,
  pe.display_name,
  trapper.entity_has_attribute('person', pe.person_id, 'is_volunteer') as is_volunteer,
  trapper.entity_has_attribute('person', pe.person_id, 'is_feeder') as is_feeder,
  trapper.entity_has_attribute('person', pe.person_id, 'is_trapper') as is_trapper,
  trapper.entity_has_attribute('person', pe.person_id, 'safety_concern') as safety_concern,
  trapper.entity_has_attribute('person', pe.person_id, 'provides_barn_homes') as provides_barn_homes,
  (SELECT ea.attribute_value->>'value' FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'person' AND ea.entity_id = pe.person_id
   AND ea.attribute_key = 'responsiveness' AND ea.superseded_at IS NULL) as responsiveness
FROM trapper.sot_people pe
WHERE pe.merged_into_person_id IS NULL;

-- View: Cat attributes
CREATE OR REPLACE VIEW trapper.v_cat_attributes AS
SELECT
  c.cat_id,
  c.display_name,
  trapper.entity_has_attribute('cat', c.cat_id, 'is_feral') as is_feral,
  trapper.entity_has_attribute('cat', c.cat_id, 'is_friendly') as is_friendly,
  trapper.entity_has_attribute('cat', c.cat_id, 'has_disease') as has_disease,
  trapper.entity_has_attribute('cat', c.cat_id, 'special_needs') as special_needs,
  (SELECT ea.attribute_value->>'value' FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'cat' AND ea.entity_id = c.cat_id
   AND ea.attribute_key = 'disease_type' AND ea.superseded_at IS NULL) as disease_type,
  (SELECT ea.attribute_value->>'value' FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'cat' AND ea.entity_id = c.cat_id
   AND ea.attribute_key = 'temperament' AND ea.superseded_at IS NULL) as temperament,
  (SELECT ea.attribute_value->>'value' FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'cat' AND ea.entity_id = c.cat_id
   AND ea.attribute_key = 'estimated_age' AND ea.superseded_at IS NULL) as estimated_age
FROM trapper.sot_cats c
WHERE c.merged_into_cat_id IS NULL;

-- View: Request attributes
CREATE OR REPLACE VIEW trapper.v_request_attributes AS
SELECT
  r.request_id,
  r.summary,
  r.status,
  trapper.entity_has_attribute('request', r.request_id, 'has_kittens') as has_kittens,
  trapper.entity_has_attribute('request', r.request_id, 'has_pregnant') as has_pregnant,
  trapper.entity_has_attribute('request', r.request_id, 'is_emergency') as is_emergency,
  trapper.entity_has_attribute('request', r.request_id, 'has_hostile_environment') as has_hostile_environment,
  trapper.entity_has_attribute('request', r.request_id, 'involves_hoarding') as involves_hoarding,
  (SELECT ea.attribute_value->>'value' FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'request' AND ea.entity_id = r.request_id
   AND ea.attribute_key = 'caller_relationship' AND ea.superseded_at IS NULL) as caller_relationship,
  (SELECT ea.attribute_value->>'value' FROM trapper.entity_attributes ea
   WHERE ea.entity_type = 'request' AND ea.entity_id = r.request_id
   AND ea.attribute_key = 'urgency_level' AND ea.superseded_at IS NULL) as urgency_level
FROM trapper.sot_requests r;

-- View: Extraction job history
CREATE OR REPLACE VIEW trapper.v_extraction_job_history AS
SELECT
  job_id,
  source_system,
  entity_type,
  records_processed,
  records_with_extractions,
  attributes_extracted,
  ROUND(100.0 * records_with_extractions / NULLIF(records_processed, 0), 1) as extraction_rate_pct,
  model_used,
  cost_estimate_usd,
  started_at,
  completed_at,
  EXTRACT(EPOCH FROM (completed_at - started_at))::INT as duration_seconds,
  error_message
FROM trapper.attribute_extraction_jobs
ORDER BY started_at DESC;

-- View: Attribute coverage by entity type
CREATE OR REPLACE VIEW trapper.v_attribute_coverage AS
SELECT
  entity_type,
  attribute_key,
  COUNT(*) as total_extracted,
  COUNT(*) FILTER (WHERE confidence >= 0.8) as high_confidence,
  COUNT(*) FILTER (WHERE confidence >= 0.5 AND confidence < 0.8) as medium_confidence,
  COUNT(*) FILTER (WHERE confidence < 0.5) as low_confidence,
  ROUND(AVG(confidence), 2) as avg_confidence,
  COUNT(DISTINCT source_system) as source_count,
  MAX(extracted_at) as last_extracted
FROM trapper.entity_attributes
WHERE superseded_at IS NULL
GROUP BY entity_type, attribute_key
ORDER BY entity_type, total_extracted DESC;

-- ============================================================
-- ADD TO TIPPY CATALOG
-- ============================================================

INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
VALUES
  ('v_place_attributes', 'entity', 'AI-extracted attributes for places (kitten history, disease, feeders, etc.)',
   ARRAY['place_id', 'formatted_address'],
   ARRAY['has_kitten_history', 'has_disease_history', 'feeder_present', 'colony_status', 'service_zone'],
   ARRAY['Which places have kitten history?', 'Where are disease-risk locations?', 'Show places with active feeders', 'Find all farm properties']),

  ('v_person_attributes', 'entity', 'AI-extracted attributes for people (volunteer, feeder, safety concern, etc.)',
   ARRAY['person_id', 'display_name'],
   ARRAY['is_volunteer', 'is_feeder', 'is_trapper', 'safety_concern'],
   ARRAY['Who are the volunteers?', 'Which clients have safety concerns?', 'Who are the feeders?', 'Show people who provide barn homes']),

  ('v_cat_attributes', 'entity', 'AI-extracted attributes for cats (feral, friendly, disease status, etc.)',
   ARRAY['cat_id', 'display_name'],
   ARRAY['is_feral', 'is_friendly', 'has_disease', 'temperament'],
   ARRAY['Which cats are friendly?', 'Show FeLV positive cats', 'Find feral cats', 'List special needs cats']),

  ('v_request_attributes', 'entity', 'AI-extracted attributes for requests (has kittens, emergency, hoarding, etc.)',
   ARRAY['request_id', 'summary'],
   ARRAY['has_kittens', 'is_emergency', 'involves_hoarding', 'urgency_level'],
   ARRAY['Which requests involve kittens?', 'Show emergency requests', 'Find hoarding situations']),

  ('v_attribute_coverage', 'quality', 'Statistics on AI attribute extraction coverage by entity type and attribute',
   ARRAY['entity_type', 'attribute_key'],
   ARRAY['entity_type'],
   ARRAY['How much data has been extracted?', 'Which attributes have low coverage?', 'Show extraction statistics']),

  ('v_extraction_job_history', 'processing', 'History of AI extraction jobs with performance metrics',
   ARRAY['job_id', 'source_system'],
   ARRAY['source_system', 'entity_type'],
   ARRAY['When was the last extraction run?', 'How many records were processed?', 'Show extraction job history'])
ON CONFLICT (view_name) DO UPDATE SET
  description = EXCLUDED.description,
  key_columns = EXCLUDED.key_columns,
  filter_columns = EXCLUDED.filter_columns,
  example_questions = EXCLUDED.example_questions;

\echo '=== MIG_710 Complete ==='
\echo 'Created: entity_attribute_definitions (29 attributes), entity_attributes table'
\echo 'Functions: get_entity_attributes(), set_entity_attribute(), entity_has_attribute()'
\echo 'Views: v_place_attributes, v_person_attributes, v_cat_attributes, v_request_attributes'
\echo 'Views: v_attribute_coverage, v_extraction_job_history'
