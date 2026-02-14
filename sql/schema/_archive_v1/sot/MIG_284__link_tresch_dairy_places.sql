-- MIG_284: Link Tresch Dairy Places & Update Request Data
--
-- Context: Tresch Dairy is a single dairy operation spanning two parcels:
--   - 1054 Walker Rd (place_id: 95509b31-771c-4f7d-8920-29abe39ecf66)
--   - 1170 Walker Rd (place_id: a1f6e0eb-eed3-48e2-92b4-78d1fbac5122)
--
-- Current Stats (2026-01-17):
--   - 2 requests, 164 cats linked across both addresses
--   - Places are NOT linked (appear as separate sites)
--   - Per trapper: ~65 cats fixed, only ~3 unfixed males remain
--
-- This migration:
--   1. Links the two places as 'same_colony_site'
--   2. Updates request status to 'on_hold' with reason 'monitoring'
--   3. Adds field observation capturing current colony state
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_284__link_tresch_dairy_places.sql

\echo ''
\echo 'MIG_284: Link Tresch Dairy Places'
\echo '=================================='
\echo ''

-- Verify places exist
\echo 'Verifying places exist...'
SELECT place_id, display_name, formatted_address
FROM trapper.places
WHERE place_id IN (
  '95509b31-771c-4f7d-8920-29abe39ecf66',
  'a1f6e0eb-eed3-48e2-92b4-78d1fbac5122'
);

-- Step 1: Link places as same colony site
\echo ''
\echo 'Step 1: Linking places as same colony site...'

INSERT INTO trapper.place_place_edges (place_id_a, place_id_b, relationship_type_id, direction, note, created_by)
SELECT
  '95509b31-771c-4f7d-8920-29abe39ecf66'::uuid,
  'a1f6e0eb-eed3-48e2-92b4-78d1fbac5122'::uuid,
  id,
  'bidirectional',
  'Tresch Dairy - single dairy operation spanning two parcels. Cats move freely between addresses.',
  'migration_284'
FROM trapper.relationship_types
WHERE code = 'same_colony_site'
ON CONFLICT DO NOTHING;

-- Step 2: Update 1170 Walker Rd request with operational data and put on hold
\echo ''
\echo 'Step 2: Updating 1170 Walker Rd request...'

UPDATE trapper.sot_requests
SET
  permission_status = 'granted',
  traps_overnight_safe = FALSE,
  access_without_contact = TRUE,
  access_notes = 'Open ranch property, can access without notifying',
  status = 'on_hold',
  hold_reason = 'monitoring',
  hold_reason_notes = 'Majority of cats fixed (~65). Only ~3 unfixed males remain. Site nearly complete - monitoring status. Will return to complete.',
  hold_started_at = NOW(),
  updated_at = NOW()
WHERE request_id = '36331e8e-e480-4d18-b7ae-d6767ddece08';

-- Step 3: Update 1054 Walker Rd request similarly
\echo ''
\echo 'Step 3: Updating 1054 Walker Rd request...'

UPDATE trapper.sot_requests
SET
  permission_status = 'granted',
  traps_overnight_safe = FALSE,
  access_without_contact = TRUE,
  access_notes = 'Open ranch property, can access without notifying',
  status = 'on_hold',
  hold_reason = 'monitoring',
  hold_reason_notes = 'Site nearly complete. Only handful of unfixed cats remain per trapper. Linked with 1170 Walker Rd as same colony site. Monitoring status.',
  hold_started_at = NOW(),
  updated_at = NOW()
WHERE request_id = '31e1ce8d-58d6-484a-af00-c0ddf66eeec1';

-- Step 4: Add current field observation (captures "3 males remaining" intel)
\echo ''
\echo 'Step 4: Adding field observation for current colony state...'

INSERT INTO trapper.place_colony_estimates (
  place_id,
  total_cats,
  altered_count,
  unaltered_count,
  source_type,
  observation_date,
  is_firsthand,
  notes,
  source_system,
  created_by
)
VALUES (
  'a1f6e0eb-eed3-48e2-92b4-78d1fbac5122',  -- 1170 Walker Rd
  68,  -- 65 fixed + ~3 remaining
  65,
  3,
  'trapper_site_visit',
  CURRENT_DATE,
  TRUE,
  'Per trapper observation 2026-01: ~3 unfixed males remaining. Colony nearly complete. Site linked with 1054 Walker Rd as single dairy operation.',
  'web_app',
  'migration_284'
)
ON CONFLICT DO NOTHING;

-- Step 5: Log the changes
\echo ''
\echo 'Step 5: Logging changes to entity_edits...'

INSERT INTO trapper.entity_edits (entity_type, entity_id, field_name, old_value, new_value, edited_by, edit_source, edit_reason)
VALUES
  ('place', '95509b31-771c-4f7d-8920-29abe39ecf66', 'place_edges', NULL,
   '{"action": "linked", "related_place": "a1f6e0eb-eed3-48e2-92b4-78d1fbac5122", "relationship": "same_colony_site"}'::jsonb,
   'migration_284', 'migration', 'Tresch Dairy multi-parcel site linking'),
  ('request', '36331e8e-e480-4d18-b7ae-d6767ddece08', 'status', '"in_progress"', '"on_hold"'::jsonb,
   'migration_284', 'migration', 'Colony nearly complete, moved to monitoring'),
  ('request', '31e1ce8d-58d6-484a-af00-c0ddf66eeec1', 'status', '"in_progress"', '"on_hold"'::jsonb,
   'migration_284', 'migration', 'Colony nearly complete, moved to monitoring');

-- Verify results
\echo ''
\echo 'Verification: Place links created'
SELECT
  ppe.edge_id,
  pa.formatted_address as place_a,
  pb.formatted_address as place_b,
  rt.label as relationship,
  ppe.note
FROM trapper.place_place_edges ppe
JOIN trapper.places pa ON pa.place_id = ppe.place_id_a
JOIN trapper.places pb ON pb.place_id = ppe.place_id_b
JOIN trapper.relationship_types rt ON rt.id = ppe.relationship_type_id
WHERE ppe.place_id_a = '95509b31-771c-4f7d-8920-29abe39ecf66'
   OR ppe.place_id_b = '95509b31-771c-4f7d-8920-29abe39ecf66';

\echo ''
\echo 'Verification: Request status updates'
SELECT request_id, status, hold_reason, hold_reason_notes
FROM trapper.sot_requests
WHERE request_id IN (
  '36331e8e-e480-4d18-b7ae-d6767ddece08',
  '31e1ce8d-58d6-484a-af00-c0ddf66eeec1'
);

\echo ''
\echo 'MIG_284 Complete!'
\echo '================='
\echo ''
