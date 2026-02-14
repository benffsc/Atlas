-- ============================================================================
-- MIG_702: Tippy Schema Documentation System
-- ============================================================================
-- Purpose: Comprehensive documentation for Tippy to understand the database
--
-- Tables:
-- 1. tippy_schema_docs - Detailed documentation for tables, views, functions
-- 2. tippy_concept_definitions - Key concepts and terminology
--
-- This enables Tippy to:
-- - Explain data patterns and relationships
-- - Understand key concepts (alteration rate, Chapman, etc.)
-- - Answer questions about data quality and limitations
-- ============================================================================

\echo '=== MIG_702: Tippy Schema Documentation ==='

-- ============================================================================
-- 1. Schema Documentation Table
-- ============================================================================
\echo 'Creating schema documentation table...'

CREATE TABLE IF NOT EXISTS trapper.tippy_schema_docs (
  doc_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type TEXT NOT NULL, -- 'table', 'view', 'function', 'concept', 'system'
  object_name TEXT NOT NULL,
  schema_name TEXT DEFAULT 'trapper',
  description TEXT NOT NULL,
  key_columns JSONB, -- For tables/views: { "column_name": "description" }
  relationships JSONB, -- Foreign keys, joins
  important_notes TEXT[], -- Data quality notes, gotchas
  example_queries TEXT[], -- SQL examples
  common_questions TEXT[], -- Questions staff might ask
  see_also TEXT[], -- Related objects
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (object_type, object_name, schema_name)
);

CREATE INDEX IF NOT EXISTS idx_tippy_schema_docs_type
ON trapper.tippy_schema_docs(object_type);

CREATE INDEX IF NOT EXISTS idx_tippy_schema_docs_name
ON trapper.tippy_schema_docs(object_name);

COMMENT ON TABLE trapper.tippy_schema_docs IS
'Comprehensive schema documentation for Tippy AI assistant. Contains detailed descriptions of tables, views, functions, and concepts.';

-- ============================================================================
-- 2. Concept Definitions Table
-- ============================================================================
\echo 'Creating concept definitions table...'

CREATE TABLE IF NOT EXISTS trapper.tippy_concept_definitions (
  concept_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_name TEXT NOT NULL UNIQUE,
  short_definition TEXT NOT NULL, -- One-sentence definition
  full_explanation TEXT, -- Detailed explanation
  formula TEXT, -- Mathematical formula if applicable
  example TEXT, -- Concrete example
  related_tables TEXT[], -- Tables that use this concept
  related_concepts TEXT[], -- Related concepts
  common_misunderstandings TEXT[], -- Things people get wrong
  source_citation TEXT, -- Academic source if applicable
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tippy_concepts_name
ON trapper.tippy_concept_definitions(concept_name);

COMMENT ON TABLE trapper.tippy_concept_definitions IS
'Definitions of key concepts used in Atlas/Beacon for Tippy to explain to staff.';

-- ============================================================================
-- 3. Populate Core Table Documentation
-- ============================================================================
\echo 'Populating core table documentation...'

INSERT INTO trapper.tippy_schema_docs (object_type, object_name, description, key_columns, relationships, important_notes, common_questions)
VALUES
  -- sot_requests
  ('table', 'sot_requests',
   'Service requests for TNR help. Each request represents a location needing trap-neuter-return services.',
   '{"request_id": "Primary key UUID", "place_id": "Location of the request", "status": "new/triaged/scheduled/in_progress/completed/on_hold/cancelled", "estimated_cat_count": "Cats still needing TNR (not total)", "cat_count_semantic": "Indicates if count is needs_tnr or legacy_total", "summary": "Brief description from requester", "resolved_at": "When completed or cancelled"}'::jsonb,
   '{"place_id": "FK to places.place_id", "requester_person_id": "FK to sot_people.person_id"}'::jsonb,
   ARRAY[
     'estimated_cat_count means cats STILL NEEDING TNR, not total cats',
     'Legacy requests (before MIG_534) have cat_count_semantic=legacy_total',
     'Always set resolved_at when changing to completed or cancelled',
     'Use request_trapper_assignments for trapper links, not single FK'
   ],
   ARRAY[
     'How many active requests are there?',
     'Which requests are on hold and why?',
     'What requests are in Santa Rosa?',
     'How long has this request been open?'
   ]),

  -- sot_cats
  ('table', 'sot_cats',
   'All cats with microchips seen at FFSC clinic. Ground truth for alterations.',
   '{"cat_id": "Primary key UUID", "display_name": "Cat name (may be placeholder)", "altered_status": "spayed/neutered/intact/unknown", "sex": "M/F/Unknown", "data_source": "Where record came from"}'::jsonb,
   '{"microchip": "Via cat_identifiers", "place": "Via cat_place_relationships", "appointments": "Via sot_appointments"}'::jsonb,
   ARRAY[
     'Microchip is the gold standard identifier',
     'altered_status comes from clinic procedures, not just claims',
     'Many cats have placeholder names like "Orange Cat"',
     '89% of appointments are linked to cats'
   ],
   ARRAY[
     'How many cats have been altered?',
     'What is the alteration rate at this address?',
     'How many cats came from this location?'
   ]),

  -- places
  ('table', 'places',
   'Physical locations/addresses. Each place is distinct - even adjacent addresses.',
   '{"place_id": "Primary key UUID", "formatted_address": "Full address string", "service_zone": "Geographic region (Santa Rosa, Petaluma, etc.)", "location": "PostGIS geography point", "merged_into_place_id": "If merged, points to canonical place"}'::jsonb,
   '{"parent_place_id": "For apartment units, points to main address", "requests": "Via sot_requests", "cats": "Via cat_place_relationships"}'::jsonb,
   ARRAY[
     'NEVER merge places without explicit user request',
     'Apartment units are separate places with parent_place_id',
     'Always check merged_into_place_id and redirect if set',
     'location is PostGIS geography, not geometry'
   ],
   ARRAY[
     'How many cats are linked to this address?',
     'What places have the most activity?',
     'What is the alteration rate at this place?'
   ]),

  -- sot_appointments
  ('table', 'sot_appointments',
   'Clinic appointments from ClinicHQ. Each appointment is one cat visit.',
   '{"appointment_id": "Primary key UUID", "cat_id": "FK to sot_cats", "appointment_date": "Date of clinic visit", "trapper_person_id": "Direct link to trapper who brought cat", "source_record_id": "ClinicHQ appointment ID"}'::jsonb,
   '{"cat_id": "FK to sot_cats", "trapper_person_id": "FK to sot_people"}'::jsonb,
   ARRAY[
     '89% of appointments are linked to cats (11% have no microchip/name match)',
     'trapper_person_id comes from phone number matching',
     'appointment_date is the ground truth for when cats were altered',
     'Source is ClinicHQ - this is verified clinic data'
   ],
   ARRAY[
     'How many appointments has this trapper had?',
     'When was this cat last seen at clinic?',
     'What cats came through on a specific date?'
   ]),

  -- cat_place_relationships
  ('table', 'cat_place_relationships',
   'Links cats to places where they were trapped/originated.',
   '{"cat_id": "FK to sot_cats", "place_id": "FK to places", "relationship_type": "appointment_site, trapping_site, etc.", "established_at": "When link was created"}'::jsonb,
   '{"cat_id": "FK to sot_cats", "place_id": "FK to places"}'::jsonb,
   ARRAY[
     'appointment_site links are inferred from owner contact matching',
     'A cat can be linked to multiple places over time',
     'This powers the "cats at this location" count'
   ],
   ARRAY[
     'What cats have been trapped at this address?',
     'How many unique locations has this cat been linked to?'
   ]),

  -- request_trapper_assignments
  ('table', 'request_trapper_assignments',
   'Links trappers to requests. Supports multiple trappers per request.',
   '{"request_id": "FK to sot_requests", "person_id": "FK to sot_people (trapper)", "assigned_at": "When assigned", "ended_at": "When unassigned (NULL if current)"}'::jsonb,
   '{"request_id": "FK to sot_requests", "person_id": "FK to sot_people"}'::jsonb,
   ARRAY[
     'Multiple trappers can be assigned to one request',
     'ended_at NULL means currently assigned',
     'Use v_request_current_trappers view for active assignments'
   ],
   ARRAY[
     'Who is assigned to this request?',
     'What requests has this trapper worked on?'
   ]),

  -- place_colony_estimates
  ('table', 'place_colony_estimates',
   'Colony size estimates from various sources. NOT the same as cats caught.',
   '{"estimate_id": "Primary key", "place_id": "Location", "total_cats": "Estimated colony size", "source_type": "How estimate was obtained", "confidence": "0-1 confidence score", "superseded_by_id": "If replaced by newer estimate"}'::jsonb,
   '{"place_id": "FK to places", "superseded_by_id": "FK to self for estimate history"}'::jsonb,
   ARRAY[
     'Colony SIZE is different from cats CAUGHT',
     'Multiple sources can provide estimates (surveys, requests, AI parsing)',
     'AI-parsed estimates have source_type ai_parsed',
     'Use v_place_colony_status for best current estimate'
   ],
   ARRAY[
     'What is the estimated colony size at this address?',
     'Where did this estimate come from?'
   ]),

  -- google_map_entries
  ('table', 'google_map_entries',
   'Historical Google Maps pins from years of FFSC field work. Qualitative notes.',
   '{"entry_id": "Primary key", "kml_name": "Pin name", "lat/lng": "Coordinates", "original_content": "Full notes text", "ai_summary": "AI-cleaned summary", "parsed_signals": "JSONB array of signals (breeding, mortality, etc.)", "parsed_cat_count": "Cat count if mentioned"}'::jsonb,
   NULL,
   ARRAY[
     'These are HISTORICAL notes, not current data',
     'parsed_signals contains categories like pregnant_nursing, mortality, relocated',
     'AI has summarized notes but originals preserved',
     'Great source for institutional knowledge about locations'
   ],
   ARRAY[
     'What Google Maps history is there for this area?',
     'Are there any breeding notes nearby?',
     'What historical context exists for this location?'
   ])

ON CONFLICT (object_type, object_name, schema_name) DO UPDATE SET
  description = EXCLUDED.description,
  key_columns = EXCLUDED.key_columns,
  relationships = EXCLUDED.relationships,
  important_notes = EXCLUDED.important_notes,
  common_questions = EXCLUDED.common_questions,
  updated_at = NOW();

-- ============================================================================
-- 4. Populate Key Concepts
-- ============================================================================
\echo 'Populating key concept definitions...'

INSERT INTO trapper.tippy_concept_definitions (
  concept_name, short_definition, full_explanation, formula, example,
  related_tables, related_concepts, common_misunderstandings, source_citation
)
VALUES
  ('alteration_rate',
   'Percentage of cats at a location that are spayed/neutered.',
   'The alteration rate is the key metric for TNR progress. It measures what proportion of cats at a location have been fixed. FFSC clinic data is the ground truth for alterations since FFSC is the only dedicated community cat clinic in Sonoma County.',
   'Alteration Rate = (Altered Cats at Location / Total Cats at Location) × 100',
   'If 15 cats are linked to an address and 12 have clinic records showing spay/neuter, the alteration rate is 80%.',
   ARRAY['sot_cats', 'cat_place_relationships', 'cat_procedures'],
   ARRAY['tnr_threshold', 'colony_size', 'ground_truth'],
   ARRAY[
     'External alterations (not at FFSC) are rare (~2%) and not tracked',
     'Alteration rate is location-specific, not countywide',
     'A high alteration rate (75%+) is needed for population decline'
   ],
   'Boone et al. 2019'),

  ('tnr_threshold',
   'The minimum alteration rate needed to reduce a cat population (75% per Boone et al. 2019).',
   'Research shows that approximately 75% of a colony must be altered to achieve population decline. Below 70%, the population may stabilize but not decline. Below 50%, population will likely continue growing due to reproduction.',
   NULL,
   '75% threshold: 10 cats total, need 8 altered. 70% stabilization: 10 cats, need 7 altered.',
   ARRAY['ref_ecological_parameters'],
   ARRAY['alteration_rate', 'colony_size', 'population_modeling'],
   ARRAY[
     '75% is for DECLINE, 70% is just stabilization',
     'Immigration can require even higher rates in some areas',
     'This assumes no significant immigration of new cats'
   ],
   'Boone et al. 2019 "Community cats: a life history model"'),

  ('chapman_estimator',
   'Mark-recapture formula for estimating colony size from eartip observations.',
   'The Chapman estimator is a modified Lincoln-Petersen formula that provides less biased estimates for small populations. In TNR context: "marked" cats are those with eartips (altered), and "recaptures" are eartipped cats seen during observation visits.',
   'N̂ = ((M + 1)(C + 1) / (R + 1)) - 1 where M = marked (altered), C = total observed, R = recaptures (eartipped observed)',
   'If 8 cats are altered (M=8), a site visit sees 12 cats total (C=12) with 6 eartipped (R=6), then N̂ = ((9)(13)/(7)) - 1 = 16 cats estimated.',
   ARRAY['site_observations', 'place_colony_estimates'],
   ARRAY['alteration_rate', 'colony_size', 'eartip_observation'],
   ARRAY[
     'Requires BOTH clinic data (M) AND field observation (C, R)',
     'More accurate than simple counts but needs good observation data',
     'Small sample sizes make estimates less reliable'
   ],
   'Chapman 1951, adapted for TNR by ASPCA'),

  ('colony_size',
   'Estimated total number of cats at a location, distinct from cats caught/altered.',
   'Colony size is an ESTIMATE of how many cats live at or frequent a location. This is different from cats "caught" or "altered" which are known quantities from clinic records. Colony estimates come from multiple sources: surveys, requests, AI-parsed notes, or Chapman mark-recapture.',
   NULL,
   'A colony might have 20 cats estimated, but only 12 have been caught and altered so far.',
   ARRAY['place_colony_estimates', 'v_place_colony_status'],
   ARRAY['alteration_rate', 'chapman_estimator', 'cats_needing_tnr'],
   ARRAY[
     'Colony size ≠ cats caught. Caught cats are verified, colony size is estimated.',
     'Multiple sources can give different estimates - use confidence scores',
     'Colony size changes over time due to births, deaths, and movement'
   ],
   NULL),

  ('ground_truth',
   'Data that is verified and reliable, as opposed to estimates or reports.',
   'In Atlas/Beacon, FFSC clinic data is ground truth because every cat seen at clinic is verified. This includes: microchips scanned, procedures performed, dates recorded. In contrast, colony size estimates, historical notes, and intake reports are NOT ground truth - they are valuable but unverified.',
   NULL,
   'Ground truth: "Cat with chip 123456 was spayed on 2024-06-15". Not ground truth: "Requester says there are about 15 cats".',
   ARRAY['sot_cats', 'sot_appointments', 'cat_procedures'],
   ARRAY['alteration_rate', 'colony_size'],
   ARRAY[
     'FFSC is the ONLY community cat clinic in Sonoma County',
     'External alterations are very rare (~2%) so can be ignored',
     'Self-reported data is valuable but not ground truth'
   ],
   NULL),

  ('cats_needing_tnr',
   'The field estimated_cat_count on requests, representing cats STILL unfixed, not total colony size.',
   'When staff records "5 cats" on a request, this means 5 cats that STILL NEED to be trapped and altered. This is NOT the same as colony size or total cats at the location. As cats are caught, this number should decrease.',
   NULL,
   'Request shows "3 cats needing TNR". After 2 are caught and altered, it should be updated to "1 cat needing TNR".',
   ARRAY['sot_requests'],
   ARRAY['colony_size', 'alteration_rate'],
   ARRAY[
     'This is different from colony_size which is total cats',
     'Legacy requests might have "total cats" instead - check cat_count_semantic',
     'UI should show "Cats Needing TNR" not "Estimated Cats"'
   ],
   NULL),

  ('service_zone',
   'Geographic regions used to organize TNR work in Sonoma County.',
   'Atlas divides Sonoma County into service zones for operational organization: Santa Rosa, Petaluma, West County, North County, South County, Sonoma Valley, and Other. These roughly correspond to areas with different volunteer networks and travel logistics.',
   NULL,
   'A request at "123 Main St, Petaluma" would be in the Petaluma service zone.',
   ARRAY['places', 'sot_requests', 'ref_sonoma_geography'],
   ARRAY[]::TEXT[],
   ARRAY[
     'Service zones are operational, not precise political boundaries',
     'Unincorporated areas may be in "Other" or nearby zone'
   ],
   NULL)

ON CONFLICT (concept_name) DO UPDATE SET
  short_definition = EXCLUDED.short_definition,
  full_explanation = EXCLUDED.full_explanation,
  formula = EXCLUDED.formula,
  example = EXCLUDED.example,
  related_tables = EXCLUDED.related_tables,
  related_concepts = EXCLUDED.related_concepts,
  common_misunderstandings = EXCLUDED.common_misunderstandings,
  source_citation = EXCLUDED.source_citation,
  updated_at = NOW();

-- ============================================================================
-- 5. Create Tippy Query Functions
-- ============================================================================
\echo 'Creating Tippy query functions...'

-- Get documentation for an object
CREATE OR REPLACE FUNCTION trapper.tippy_get_docs(p_object_name TEXT)
RETURNS JSONB AS $$
  SELECT to_jsonb(d.*)
  FROM trapper.tippy_schema_docs d
  WHERE d.object_name ILIKE p_object_name
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION trapper.tippy_get_docs(TEXT) IS
'Get schema documentation for a table, view, or function.';

-- Get concept definition
CREATE OR REPLACE FUNCTION trapper.tippy_get_concept(p_concept_name TEXT)
RETURNS JSONB AS $$
  SELECT to_jsonb(c.*)
  FROM trapper.tippy_concept_definitions c
  WHERE c.concept_name ILIKE '%' || p_concept_name || '%'
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION trapper.tippy_get_concept(TEXT) IS
'Get a concept definition by name (partial match).';

-- Search documentation
CREATE OR REPLACE FUNCTION trapper.tippy_search_docs(p_query TEXT)
RETURNS TABLE (
  object_type TEXT,
  object_name TEXT,
  description TEXT,
  relevance REAL
) AS $$
  SELECT
    d.object_type,
    d.object_name,
    d.description,
    ts_rank(
      to_tsvector('english', COALESCE(d.description, '') || ' ' || COALESCE(array_to_string(d.common_questions, ' '), '')),
      plainto_tsquery('english', p_query)
    ) as relevance
  FROM trapper.tippy_schema_docs d
  WHERE to_tsvector('english', COALESCE(d.description, '') || ' ' || COALESCE(array_to_string(d.common_questions, ' '), ''))
        @@ plainto_tsquery('english', p_query)
  ORDER BY relevance DESC
  LIMIT 10;
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION trapper.tippy_search_docs(TEXT) IS
'Full-text search across schema documentation.';

-- ============================================================================
-- 6. Add to Tippy View Catalog
-- ============================================================================
\echo 'Adding documentation tables to Tippy view catalog...'

INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
VALUES
  ('tippy_schema_docs', 'quality',
   'Documentation about database tables, views, and functions. Use this to understand the data model.',
   ARRAY['object_name', 'object_type', 'description'],
   ARRAY['object_type'],
   ARRAY[
     'Tell me about the sot_requests table',
     'What tables track cats?',
     'How does the places table work?'
   ]),

  ('tippy_concept_definitions', 'quality',
   'Definitions of key concepts like alteration rate, Chapman estimator, colony size, etc.',
   ARRAY['concept_name', 'short_definition', 'formula'],
   ARRAY[]::TEXT[],
   ARRAY[
     'What is alteration rate?',
     'How does the Chapman estimator work?',
     'What is the 75% threshold?',
     'What does ground truth mean?'
   ])

ON CONFLICT (view_name) DO UPDATE SET
  description = EXCLUDED.description,
  key_columns = EXCLUDED.key_columns,
  filter_columns = EXCLUDED.filter_columns,
  example_questions = EXCLUDED.example_questions;

-- ============================================================================
-- Summary
-- ============================================================================
\echo ''
\echo '=== MIG_702 Complete ==='
\echo 'Created:'
\echo '  - tippy_schema_docs (8 core table docs)'
\echo '  - tippy_concept_definitions (7 key concepts)'
\echo '  - tippy_get_docs(name) function'
\echo '  - tippy_get_concept(name) function'
\echo '  - tippy_search_docs(query) function'
\echo ''
\echo 'Usage:'
\echo '  -- Get docs for a table'
\echo '  SELECT trapper.tippy_get_docs(''sot_requests'');'
\echo ''
\echo '  -- Get a concept definition'
\echo '  SELECT trapper.tippy_get_concept(''alteration_rate'');'
\echo ''
\echo '  -- Search documentation'
\echo '  SELECT * FROM trapper.tippy_search_docs(''colony size'');'
