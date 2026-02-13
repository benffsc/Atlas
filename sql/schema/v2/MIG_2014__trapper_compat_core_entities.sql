-- MIG_2014: Trapper Compatibility Layer - Core Entities
--
-- Purpose: Create views in trapper schema that point to V2 tables
-- This allows existing V1 code to work while using V2 data
--
-- IMPORTANT: This is a TEMPORARY bridge. Long-term plan is to migrate
-- all code to use V2 schemas directly, then drop these views.
--
-- Column Mapping Key (V2 → V1 expected):
-- - sot.cats: altered_status → is_altered, deceased_at → deceased_date
-- - sot.addresses: postal_code → zip, latitude → lat, longitude → lng
-- - sot.places: sot_address_id → address_id, unit_identifier → unit_number
-- - sot.person_identifiers: id → identifier_id
-- - sot.cat_identifiers: id → identifier_id
-- - sot.person_place: id → relationship_id
-- - sot.person_cat: id → relationship_id
-- - sot.cat_place: id → relationship_id
-- - ops.appointments: service_type → procedure_type
--
-- Created: 2026-02-12

\echo ''
\echo '=============================================='
\echo '  MIG_2014: Trapper Compatibility Layer'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CORE ENTITY VIEWS
-- ============================================================================

\echo '1. Creating core entity compatibility views...'

-- People (direct mapping, V2 has same columns)
CREATE OR REPLACE VIEW trapper.sot_people AS
SELECT
  person_id,
  first_name,
  last_name,
  display_name,
  primary_email,
  primary_phone,
  primary_address_id,
  is_organization,
  merged_into_person_id,
  source_system,
  source_record_id,
  created_at,
  updated_at
FROM sot.people;

-- Cats (V2 uses different column names)
CREATE OR REPLACE VIEW trapper.sot_cats AS
SELECT
  cat_id,
  microchip,
  name,
  sex,
  color,  -- V2 has color column
  breed,
  NULL::DATE as birth_date,  -- V2 doesn't have birth_date
  CASE
    WHEN altered_status IN ('spayed', 'neutered', 'altered') THEN TRUE
    ELSE FALSE
  END as is_altered,
  NULL::DATE as altered_date,  -- V2 doesn't track altered_date separately
  is_deceased,
  deceased_at::DATE as deceased_date,  -- V2 uses deceased_at (timestamptz)
  merged_into_cat_id,
  source_system,
  source_record_id,
  created_at,
  updated_at
FROM sot.cats;

-- Addresses (V2 uses different column names)
CREATE OR REPLACE VIEW trapper.sot_addresses AS
SELECT
  address_id,
  raw_input,
  display_address,
  street_number,
  street_name,
  unit_number,
  city,
  state,
  postal_code as zip,  -- V2 uses postal_code
  country,
  latitude as lat,     -- V2 uses latitude
  longitude as lng,    -- V2 uses longitude
  geocoding_status as geocode_status,  -- V2 uses geocoding_status
  source_system,
  created_at,
  updated_at
FROM sot.addresses;

-- Places (with computed columns V1 expects)
CREATE OR REPLACE VIEW trapper.places AS
SELECT
  p.place_id,
  COALESCE(p.sot_address_id, p.address_id) as address_id,  -- V2 has both
  p.display_name,
  a.display_address,
  a.latitude as lat,
  a.longitude as lng,
  p.parent_place_id,
  p.unit_identifier as unit_number,  -- V2 uses unit_identifier
  p.is_address_backed,
  p.merged_into_place_id,
  p.source_system,
  NULL::TEXT as source_record_id,  -- V2 doesn't have this
  p.created_at,
  p.updated_at,
  -- V1-expected columns
  a.display_address as full_address,
  a.street_number,
  a.street_name,
  a.city,
  a.state,
  a.postal_code as zip,
  CASE
    WHEN a.latitude IS NOT NULL AND a.longitude IS NOT NULL
    THEN ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)
    ELSE NULL
  END as coordinates,
  -- Placeholder columns that V1 code might expect
  FALSE as is_multi_unit,
  NULL::UUID as primary_context_id,
  'active'::TEXT as status
FROM sot.places p
LEFT JOIN sot.addresses a ON a.address_id = COALESCE(p.sot_address_id, p.address_id);

\echo '   Created: sot_people, sot_cats, sot_addresses, places'

-- ============================================================================
-- 2. IDENTIFIER VIEWS
-- ============================================================================

\echo '2. Creating identifier compatibility views...'

CREATE OR REPLACE VIEW trapper.person_identifiers AS
SELECT
  id as identifier_id,  -- V2 uses 'id'
  person_id,
  id_type,
  id_value_raw,
  id_value_norm,
  confidence,
  source_system,
  created_at
FROM sot.person_identifiers;

CREATE OR REPLACE VIEW trapper.cat_identifiers AS
SELECT
  id as identifier_id,  -- V2 uses 'id'
  cat_id,
  id_type,
  id_value,
  1.0::NUMERIC as confidence,  -- V2 cat_identifiers doesn't have confidence, default to 1.0
  source_system,
  created_at
FROM sot.cat_identifiers;

\echo '   Created: person_identifiers, cat_identifiers'

-- ============================================================================
-- 3. RELATIONSHIP VIEWS
-- ============================================================================

\echo '3. Creating relationship compatibility views...'

CREATE OR REPLACE VIEW trapper.person_place_relationships AS
SELECT
  id as relationship_id,  -- V2 uses 'id'
  person_id,
  place_id,
  relationship_type,
  confidence,
  evidence_type,
  source_system,
  created_at,
  created_at as updated_at  -- V2 doesn't have updated_at, use created_at
FROM sot.person_place;

CREATE OR REPLACE VIEW trapper.person_cat_relationships AS
SELECT
  id as relationship_id,  -- V2 uses 'id'
  person_id,
  cat_id,
  relationship_type,
  confidence,
  evidence_type,
  source_system,
  created_at,
  created_at as updated_at  -- V2 doesn't have updated_at, use created_at
FROM sot.person_cat;

CREATE OR REPLACE VIEW trapper.cat_place_relationships AS
SELECT
  id as relationship_id,  -- V2 uses 'id'
  cat_id,
  place_id,
  relationship_type,
  confidence,
  evidence_type,
  source_system,
  created_at,
  created_at as updated_at  -- V2 doesn't have updated_at, use created_at
FROM sot.cat_place;

\echo '   Created: person_place_relationships, person_cat_relationships, cat_place_relationships'

-- ============================================================================
-- 4. OPS WORKFLOW VIEWS
-- ============================================================================

\echo '4. Creating OPS workflow compatibility views...'

-- Requests (map V2 columns to V1 expected names)
CREATE OR REPLACE VIEW trapper.sot_requests AS
SELECT
  request_id,
  requester_person_id,
  place_id,
  status,
  priority,
  NULL::TEXT as request_type,  -- V2 doesn't have request_type
  estimated_cat_count,
  source_system,
  source_record_id,
  created_at,
  updated_at,
  resolved_at,
  -- Placeholder columns
  notes,
  internal_notes,
  NULL::UUID as assigned_to_staff_id
FROM ops.requests;

-- Appointments (map V2 columns to V1 expected names)
CREATE OR REPLACE VIEW trapper.sot_appointments AS
SELECT
  appointment_id,
  cat_id,
  person_id as inferred_person_id,  -- V2 uses person_id
  COALESCE(place_id, inferred_place_id) as place_id,
  appointment_date,
  service_type as procedure_type,  -- V2 uses service_type
  owner_first_name,
  owner_last_name,
  owner_email,
  owner_phone,
  owner_address,
  resolution_status,
  source_system,
  source_record_id,
  created_at,
  updated_at
FROM ops.appointments;

-- Web Intake Submissions
CREATE OR REPLACE VIEW trapper.web_intake_submissions AS
SELECT
  submission_id,
  person_id,
  place_id,
  request_id,
  status,
  NULL::JSONB as payload,  -- V2 stores structured fields, not payload
  ip_address as source_ip,
  submitted_at,
  reviewed_at as processed_at,
  created_at
FROM ops.intake_submissions;

-- Journal Entries
CREATE OR REPLACE VIEW trapper.journal_entries AS
SELECT
  entry_id as id,
  entry_type as kind,
  content,
  NULL::UUID as primary_person_id,  -- V2 might not have this
  NULL::UUID as primary_cat_id,
  place_id as primary_place_id,
  NULL::UUID as primary_request_id,
  NULL::UUID as primary_submission_id,
  author_person_id as created_by_staff_id,
  FALSE as is_archived,
  created_at,
  updated_at
FROM ops.journal_entries;

-- Request Trapper Assignments
CREATE OR REPLACE VIEW trapper.request_trapper_assignments AS
SELECT
  id as assignment_id,
  request_id,
  trapper_person_id,
  assigned_at,
  assigned_by as assigned_by_staff_id,
  completed_at as unassigned_at,
  status
FROM ops.request_trapper_assignments;

-- Google Map Entries
CREATE OR REPLACE VIEW trapper.google_map_entries AS
SELECT
  entry_id,
  place_id,
  linked_place_id,
  NULL::TEXT as google_place_id,  -- V2 doesn't have this
  kml_name as name,
  NULL::TEXT as formatted_address,
  lat,
  lng,
  NULL::NUMERIC as rating,
  NULL::INTEGER as user_ratings_total,
  NULL::TEXT[] as types,
  ai_summary,
  NULL::TEXT as classification,
  NULL::TEXT as link_status,
  'google_maps'::TEXT as source_system,
  created_at,
  created_at as updated_at
FROM ops.google_map_entries;

-- Person Roles
CREATE OR REPLACE VIEW trapper.person_roles AS
SELECT
  id as role_id,
  person_id,
  role,
  role_status,
  source_system,
  created_at,
  created_at as updated_at
FROM ops.person_roles;

\echo '   Created: sot_requests, sot_appointments, web_intake_submissions, journal_entries, request_trapper_assignments, google_map_entries, person_roles'

-- ============================================================================
-- 5. SOFT BLACKLIST VIEW
-- ============================================================================

\echo '5. Creating soft blacklist compatibility view...'

CREATE OR REPLACE VIEW trapper.data_engine_soft_blacklist AS
SELECT
  identifier_norm,
  identifier_type,
  reason,
  require_name_similarity,
  created_at
FROM sot.soft_blacklist;

\echo '   Created: data_engine_soft_blacklist'

-- ============================================================================
-- 6. MATCH DECISIONS VIEW
-- ============================================================================

\echo '6. Creating match decisions compatibility view...'

CREATE OR REPLACE VIEW trapper.data_engine_match_decisions AS
SELECT
  decision_id,
  source_system,
  incoming_email,
  incoming_phone,
  incoming_name,
  top_candidate_person_id,
  top_candidate_score,
  decision_type,
  resulting_person_id,
  score_breakdown,
  created_at
FROM sot.match_decisions;

\echo '   Created: data_engine_match_decisions'

-- ============================================================================
-- 7. PLACE CONTEXTS VIEW
-- ============================================================================

\echo '7. Creating place contexts compatibility view...'

CREATE OR REPLACE VIEW trapper.place_contexts AS
SELECT
  id as context_id,
  place_id,
  context_type,
  NULL::TEXT as context_value,  -- V2 structure is different
  confidence,
  valid_from,
  valid_to as valid_until,
  source_system,
  created_at,
  updated_at
FROM sot.place_contexts;

\echo '   Created: place_contexts'

-- ============================================================================
-- 8. COLONIES VIEW (from sot.colonies)
-- ============================================================================

\echo '8. Creating colonies compatibility view...'

CREATE OR REPLACE VIEW trapper.colonies AS
SELECT
  colony_id,
  name,
  description,
  colony_status as status,
  colony_type,
  estimated_population,
  estimated_altered,
  last_count_date,
  count_method,
  created_by_staff_id,
  primary_caretaker_id,
  is_verified,
  needs_attention,
  attention_reason,
  watch_list,
  watch_list_reason,
  service_zone,
  merged_into_colony_id,
  source_system,
  source_record_id,
  created_at,
  updated_at
FROM sot.colonies;

\echo '   Created: colonies'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Compatibility views created:'
SELECT
  schemaname,
  viewname,
  'points to ' ||
    CASE
      WHEN viewname LIKE 'sot_%' THEN 'sot.' || REPLACE(viewname, 'sot_', '')
      WHEN viewname = 'places' THEN 'sot.places + sot.addresses'
      WHEN viewname IN ('web_intake_submissions', 'journal_entries', 'request_trapper_assignments', 'google_map_entries', 'person_roles') THEN 'ops.*'
      WHEN viewname LIKE 'person_%' OR viewname LIKE 'cat_%' THEN 'sot.*'
      WHEN viewname LIKE 'data_engine_%' THEN 'sot.*'
      ELSE 'various'
    END as target
FROM pg_views
WHERE schemaname = 'trapper'
ORDER BY viewname;

\echo ''
\echo '=============================================='
\echo '  MIG_2014 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created compatibility views for:'
\echo '  - Core entities: sot_people, sot_cats, places, sot_addresses'
\echo '  - Identifiers: person_identifiers, cat_identifiers'
\echo '  - Relationships: person_place, person_cat, cat_place'
\echo '  - OPS workflow: requests, appointments, intakes, journals'
\echo '  - Data engine: soft_blacklist, match_decisions'
\echo '  - Ecology: colonies'
\echo ''
\echo 'Existing V1 code can now query trapper.* and get V2 data.'
\echo ''
