\echo '=== MIG_875: Source System Authority Map ==='
\echo 'Establishes which system is authoritative for each entity/concept.'
\echo 'Enables Tippy + code to route "show me fosters" vs "show me foster cats" correctly.'
\echo ''

-- ============================================================================
-- 1. ADD authority_domains TO orchestrator_sources
-- ============================================================================

\echo '--- Step 1: Add authority_domains column ---'

ALTER TABLE trapper.orchestrator_sources
  ADD COLUMN IF NOT EXISTS authority_domains JSONB;

COMMENT ON COLUMN trapper.orchestrator_sources.authority_domains IS
  'JSONB describing what entity types/concepts this source is authoritative for.
   Keys: entities (array), concepts (array), not_authoritative_for (array).
   Used by Tippy and code to route queries to the right source.';

-- ============================================================================
-- 2. POPULATE authority_domains FOR ALL SOURCES
-- ============================================================================

\echo '--- Step 2: Populating authority domains ---'

-- ClinicHQ: Core clinic system — authoritative for clients, TNR, medical, microchips
UPDATE trapper.orchestrator_sources
SET authority_domains = '{
  "entities": ["clinic_clients", "appointments", "medical_records", "microchips", "cat_records"],
  "concepts": ["TNR_procedures", "spay_neuter", "ear_tipping", "vaccinations", "owner_identity"],
  "not_authoritative_for": ["volunteers", "program_outcomes", "volunteer_management"]
}'::jsonb
WHERE source_system = 'clinichq';

-- VolunteerHub: Volunteer management — authoritative for volunteer PEOPLE
UPDATE trapper.orchestrator_sources
SET authority_domains = '{
  "entities": ["volunteer_people", "user_groups", "group_memberships"],
  "concepts": ["trappers", "foster_parents", "clinic_volunteers", "volunteer_hours", "volunteer_status"],
  "not_authoritative_for": ["animals", "outcomes", "clinic_data", "medical_records"],
  "user_group_hierarchy": {
    "parent": "Approved Volunteer",
    "subgroups": ["Approved Trappers", "Approved Foster Parent", "Clinic Volunteers"]
  }
}'::jsonb
WHERE source_system = 'volunteerhub';

-- ShelterLuv: Program animals + outcomes — authoritative for animal programs
UPDATE trapper.orchestrator_sources
SET authority_domains = '{
  "entities": ["program_animals", "outcome_events", "intake_events"],
  "concepts": ["foster_cats", "adopted_cats", "relocated_cats", "animal_intake", "animal_outcomes", "transfers", "mortality"],
  "not_authoritative_for": ["volunteer_people", "clinic_procedures", "TNR_data"]
}'::jsonb
WHERE source_system = 'shelterluv';

-- Airtable: Legacy workflows + public submissions
UPDATE trapper.orchestrator_sources
SET authority_domains = '{
  "entities": ["trapping_requests", "appointment_requests", "legacy_trappers"],
  "concepts": ["public_intake", "request_lifecycle", "legacy_workflows"],
  "not_authoritative_for": ["volunteer_management", "clinic_data", "program_outcomes"]
}'::jsonb
WHERE source_system = 'airtable';

-- PetLink: Microchip registry
UPDATE trapper.orchestrator_sources
SET authority_domains = '{
  "entities": ["microchip_registrations"],
  "concepts": ["pet_registration", "owner_contact_from_chip"],
  "not_authoritative_for": ["volunteers", "outcomes", "clinic_procedures"]
}'::jsonb
WHERE source_system = 'petlink';

-- Client Survey
UPDATE trapper.orchestrator_sources
SET authority_domains = '{
  "entities": ["survey_responses"],
  "concepts": ["post_service_feedback", "colony_counts_reported"],
  "not_authoritative_for": ["volunteers", "outcomes", "clinic_procedures"]
}'::jsonb
WHERE source_system = 'client_survey';

-- Web Intake
UPDATE trapper.orchestrator_sources
SET authority_domains = '{
  "entities": ["intake_submissions"],
  "concepts": ["public_requests", "self_reported_colony_data"],
  "not_authoritative_for": ["volunteers", "outcomes", "clinic_procedures"]
}'::jsonb
WHERE source_system = 'web_intake';

-- ============================================================================
-- 3. CREATE source_semantic_queries TABLE
-- ============================================================================

\echo '--- Step 3: Creating source_semantic_queries table ---'

CREATE TABLE IF NOT EXISTS trapper.source_semantic_queries (
  query_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_key TEXT NOT NULL UNIQUE,
  user_phrase TEXT NOT NULL,
  means TEXT NOT NULL,
  authoritative_source TEXT NOT NULL,
  query_hint TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.source_semantic_queries IS
  'Maps natural language queries to their authoritative data source.
   Used by Tippy to route "show me fosters" to VolunteerHub (people)
   vs "show me foster cats" to ShelterLuv (outcomes).';

-- Populate semantic queries
INSERT INTO trapper.source_semantic_queries (query_key, user_phrase, means, authoritative_source, query_hint, notes) VALUES
  ('fosters', 'Show me fosters', 'Foster PEOPLE (approved volunteers)', 'volunteerhub',
   'Query volunteerhub_volunteers joined to volunteerhub_group_memberships where group = ''Approved Foster Parent''',
   'NOT ShelterLuv. SL has foster CATS (outcome events), not foster PEOPLE.'),

  ('foster_cats', 'Show me foster cats', 'Cats currently in foster placement', 'shelterluv',
   'Query person_cat_relationships WHERE relationship_type = ''foster'' AND source_system = ''shelterluv''',
   'From ShelterLuv Outcome.Foster events. The PEOPLE who foster come from VolunteerHub.'),

  ('trappers', 'Show me trappers', 'Trapper PEOPLE (approved volunteers)', 'volunteerhub',
   'Query volunteerhub_volunteers joined to volunteerhub_group_memberships where group = ''Approved Trappers''',
   'VolunteerHub is authoritative for trapper people. Airtable has legacy trapper roster.'),

  ('adopters', 'Show me adopters', 'People who adopted cats from FFSC', 'shelterluv',
   'Query person_cat_relationships WHERE relationship_type = ''adopter'' AND source_system = ''shelterluv''',
   'From ShelterLuv Outcome.Adoption events.'),

  ('relo_spots', 'Show me relo spots', 'Relocation destination places on map', 'shelterluv',
   'Query place_contexts WHERE context_type = ''relocation_destination''',
   'From ShelterLuv Outcome.Adoption events with Subtype = ''Relocation''.'),

  ('volunteers', 'Show me volunteers', 'All approved volunteers', 'volunteerhub',
   'Query volunteerhub_volunteers joined to volunteerhub_group_memberships where parent group = ''Approved Volunteer''',
   'VolunteerHub organizes volunteers under Approved Volunteer parent group.'),

  ('clinic_volunteers', 'Show me clinic volunteers', 'Clinic volunteer PEOPLE', 'volunteerhub',
   'Query volunteerhub_volunteers joined to volunteerhub_group_memberships where group = ''Clinic Volunteers''',
   'VolunteerHub group, not ClinicHQ.'),

  ('owners', 'Show me owners', 'Cat owners (clinic clients)', 'clinichq',
   'Query person_cat_relationships WHERE relationship_type = ''owner'' AND source_system = ''clinichq''',
   'ClinicHQ is authoritative for owner/client identity. 27,001 owner relationships.'),

  ('intake_animals', 'Show me intake/animals entering program', 'Animals taken into FFSC programs', 'shelterluv',
   'Query cat_intake_events or staged_records WHERE source_table = ''events'' AND payload->>''Type'' LIKE ''Intake.%''',
   'From ShelterLuv Intake.* events (FeralWildlife, OwnerSurrender, Stray, etc.).')

ON CONFLICT (query_key) DO UPDATE SET
  user_phrase = EXCLUDED.user_phrase,
  means = EXCLUDED.means,
  authoritative_source = EXCLUDED.authoritative_source,
  query_hint = EXCLUDED.query_hint,
  notes = EXCLUDED.notes;

-- ============================================================================
-- 4. CREATE v_source_authority_map VIEW
-- ============================================================================

\echo '--- Step 4: Creating v_source_authority_map view ---'

CREATE OR REPLACE VIEW trapper.v_source_authority_map AS
SELECT
  os.source_system,
  os.display_name,
  os.is_active,
  os.authority_domains->>'entities' AS authoritative_entities,
  os.authority_domains->>'concepts' AS authoritative_concepts,
  os.authority_domains->>'not_authoritative_for' AS not_authoritative_for,
  os.ingest_method,
  os.ingest_frequency,
  os.last_ingest_at,
  os.total_records_ingested
FROM trapper.orchestrator_sources os
WHERE os.authority_domains IS NOT NULL
ORDER BY os.source_system;

COMMENT ON VIEW trapper.v_source_authority_map IS
  'Shows which system is authoritative for which entity types and concepts.
   Used by Tippy to route queries to the correct data source.';

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

\echo ''
\echo '--- Verification ---'

\echo 'Authority map:'
SELECT source_system,
  jsonb_array_length(authority_domains->'entities') as entity_count,
  jsonb_array_length(authority_domains->'concepts') as concept_count
FROM trapper.orchestrator_sources
WHERE authority_domains IS NOT NULL
ORDER BY source_system;

\echo ''
\echo 'Semantic queries:'
SELECT query_key, authoritative_source, means FROM trapper.source_semantic_queries ORDER BY query_key;

\echo ''
\echo '=== MIG_875 Complete ==='
\echo 'Source System Authority Map established.'
\echo ''
\echo 'Key rule: "fosters" = VolunteerHub people, "foster cats" = ShelterLuv outcomes'
\echo 'Key rule: "trappers" = VolunteerHub people, "adopters" = ShelterLuv outcomes'
\echo 'Key rule: ClinicHQ = core clinic data, VolunteerHub = volunteer people, ShelterLuv = program animals + outcomes'
