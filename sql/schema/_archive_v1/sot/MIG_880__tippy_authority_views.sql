\echo '=== MIG_880: Register Authority + Intake Views in Tippy Catalog ==='
\echo ''

-- ============================================================================
-- 1. REGISTER NEW VIEWS
-- ============================================================================

\echo '--- Step 1: Registering views in Tippy catalog ---'

-- Source Authority Map view
INSERT INTO trapper.tippy_view_catalog (
  view_name, category, description, key_columns, filter_columns, example_questions, requires_filter, is_safe_for_ai
) VALUES (
  'v_source_authority_map', 'processing',
  'Shows which external system (ClinicHQ, VolunteerHub, ShelterLuv, Airtable) is authoritative for which entity types and concepts. Use this to understand data provenance and route queries correctly.',
  ARRAY['source_system', 'display_name', 'authoritative_entities', 'authoritative_concepts'],
  ARRAY['source_system'],
  ARRAY[
    'Which system tracks fosters?',
    'Where does adopter data come from?',
    'What is ShelterLuv authoritative for?',
    'Which system manages volunteers?'
  ],
  FALSE, TRUE
)
ON CONFLICT (view_name) DO UPDATE SET
  description = EXCLUDED.description,
  key_columns = EXCLUDED.key_columns,
  filter_columns = EXCLUDED.filter_columns,
  example_questions = EXCLUDED.example_questions;

-- Source Semantic Queries table (as a queryable view for Tippy)
CREATE OR REPLACE VIEW trapper.v_source_semantic_queries AS
SELECT
  query_key,
  user_phrase,
  means,
  authoritative_source,
  query_hint,
  notes
FROM trapper.source_semantic_queries
ORDER BY query_key;

COMMENT ON VIEW trapper.v_source_semantic_queries IS
  'Maps natural language queries to their authoritative data source.
   CRITICAL: "fosters" = VolunteerHub people, "foster cats" = ShelterLuv outcomes.';

INSERT INTO trapper.tippy_view_catalog (
  view_name, category, description, key_columns, filter_columns, example_questions, requires_filter, is_safe_for_ai
) VALUES (
  'v_source_semantic_queries', 'processing',
  'CRITICAL: Maps natural language queries to correct data sources. When staff says "show me fosters" they mean foster PEOPLE from VolunteerHub, NOT foster cats from ShelterLuv. Always check this view first to route queries correctly.',
  ARRAY['query_key', 'user_phrase', 'means', 'authoritative_source', 'query_hint'],
  ARRAY['query_key', 'authoritative_source'],
  ARRAY[
    'When someone says fosters what do they mean?',
    'Where should I look for trapper data?',
    'What does show me adopters mean?',
    'How do I find relo spots?'
  ],
  FALSE, TRUE
)
ON CONFLICT (view_name) DO UPDATE SET
  description = EXCLUDED.description,
  key_columns = EXCLUDED.key_columns,
  filter_columns = EXCLUDED.filter_columns,
  example_questions = EXCLUDED.example_questions;

-- Cat intake events summary view
CREATE OR REPLACE VIEW trapper.v_cat_intake_summary AS
SELECT
  cie.intake_type,
  cie.intake_subtype,
  COUNT(*) AS event_count,
  COUNT(DISTINCT cie.cat_id) AS distinct_cats,
  COUNT(cie.person_id) AS with_person,
  MIN(cie.intake_date) AS earliest_intake,
  MAX(cie.intake_date) AS latest_intake
FROM trapper.cat_intake_events cie
GROUP BY cie.intake_type, cie.intake_subtype
ORDER BY event_count DESC;

COMMENT ON VIEW trapper.v_cat_intake_summary IS
  'Summary of cat intake events by type and subtype.
   Shows when animals entered FFSC programs from ShelterLuv.';

INSERT INTO trapper.tippy_view_catalog (
  view_name, category, description, key_columns, filter_columns, example_questions, requires_filter, is_safe_for_ai
) VALUES (
  'v_cat_intake_summary', 'stats',
  'Summary of cat intake events by type. Shows how animals enter FFSC programs: FeralWildlife (community cats), FosterReturn, Transfer, Stray, OwnerSurrender, AdoptionReturn, etc.',
  ARRAY['intake_type', 'intake_subtype', 'event_count', 'distinct_cats'],
  ARRAY['intake_type'],
  ARRAY[
    'How many cats were intake as strays?',
    'How many owner surrenders have there been?',
    'What are the intake types?',
    'How many foster returns?'
  ],
  FALSE, TRUE
)
ON CONFLICT (view_name) DO UPDATE SET
  description = EXCLUDED.description,
  key_columns = EXCLUDED.key_columns,
  filter_columns = EXCLUDED.filter_columns,
  example_questions = EXCLUDED.example_questions;

-- ShelterLuv sync status (already exists, update description)
UPDATE trapper.tippy_view_catalog
SET description = 'ShelterLuv API sync health. Shows last sync time, pending records, and health status. Uses last_check_at (not last_sync_at) for accurate health — "checked_no_new_data" means cron ran but API had nothing new.'
WHERE view_name = 'v_shelterluv_sync_status';

-- ============================================================================
-- 2. VERIFICATION
-- ============================================================================

\echo ''
\echo '--- Verification ---'

\echo 'New views in Tippy catalog:'
SELECT view_name, category, is_safe_for_ai
FROM trapper.tippy_view_catalog
WHERE view_name IN ('v_source_authority_map', 'v_source_semantic_queries', 'v_cat_intake_summary')
ORDER BY view_name;

\echo ''
\echo 'Total Tippy views:'
SELECT COUNT(*) as total_views FROM trapper.tippy_view_catalog;

\echo ''
\echo '=== MIG_880 Complete ==='
\echo 'Registered authority + intake views in Tippy catalog.'
\echo 'Tippy can now route semantic queries to correct data sources.'
