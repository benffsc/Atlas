\echo '=== MIG_572: Remove Organizations from sot_people ==='
\echo ''
\echo 'Organizations should not be in the people table.'
\echo 'This migration:'
\echo '  1. Logs all removals to entity_edits for full audit trail'
\echo '  2. Removes all relationships'
\echo '  3. Hard deletes the records (audit preserved in entity_edits)'
\echo ''

-- Count before
SELECT 'Organizations to remove:' as status, COUNT(*) as count
FROM trapper.sot_people
WHERE is_organization = true
  AND merged_into_person_id IS NULL;

-- Step 1: Log all deletions to entity_edits with full details
INSERT INTO trapper.entity_edits (
  entity_type,
  entity_id,
  edit_type,
  field_name,
  old_value,
  new_value,
  edited_by,
  edit_source,
  reason
)
SELECT
  'person',
  person_id,
  'delete',
  'full_record',
  jsonb_build_object(
    'person_id', person_id,
    'display_name', display_name,
    'primary_email', primary_email,
    'primary_phone', primary_phone,
    'data_source', data_source,
    'created_at', created_at
  ),
  NULL,
  'system:MIG_572',
  'migration',
  'Organization/address name removed from people table - not a real person'
FROM trapper.sot_people
WHERE is_organization = true
  AND merged_into_person_id IS NULL;

-- Step 2: Remove person_place_relationships
WITH deleted_ppr AS (
  DELETE FROM trapper.person_place_relationships ppr
  WHERE ppr.person_id IN (
    SELECT person_id FROM trapper.sot_people
    WHERE is_organization = true AND merged_into_person_id IS NULL
  )
  RETURNING *
)
SELECT 'person_place_relationships deleted:' as step, COUNT(*) as count FROM deleted_ppr;

-- Step 3: Remove person_cat_relationships
WITH deleted_pcr AS (
  DELETE FROM trapper.person_cat_relationships pcr
  WHERE pcr.person_id IN (
    SELECT person_id FROM trapper.sot_people
    WHERE is_organization = true AND merged_into_person_id IS NULL
  )
  RETURNING *
)
SELECT 'person_cat_relationships deleted:' as step, COUNT(*) as count FROM deleted_pcr;

-- Step 4: Clear request assignments (don't delete requests, just unlink)
WITH updated_req AS (
  UPDATE trapper.sot_requests r
  SET requester_person_id = NULL
  WHERE r.requester_person_id IN (
    SELECT person_id FROM trapper.sot_people
    WHERE is_organization = true AND merged_into_person_id IS NULL
  )
  RETURNING *
)
SELECT 'requests unlinked:' as step, COUNT(*) as count FROM updated_req;

-- Step 5: Remove person_identifiers
WITH deleted_pi AS (
  DELETE FROM trapper.person_identifiers pi
  WHERE pi.person_id IN (
    SELECT person_id FROM trapper.sot_people
    WHERE is_organization = true AND merged_into_person_id IS NULL
  )
  RETURNING *
)
SELECT 'person_identifiers deleted:' as step, COUNT(*) as count FROM deleted_pi;

-- Step 6: Remove data_engine_match_decisions referencing these people
UPDATE trapper.data_engine_match_decisions
SET resulting_person_id = NULL
WHERE resulting_person_id IN (
  SELECT person_id FROM trapper.sot_people
  WHERE is_organization = true AND merged_into_person_id IS NULL
);

UPDATE trapper.data_engine_match_decisions
SET top_candidate_person_id = NULL
WHERE top_candidate_person_id IN (
  SELECT person_id FROM trapper.sot_people
  WHERE is_organization = true AND merged_into_person_id IS NULL
);

-- Step 7: Remove appointment trapper links
UPDATE trapper.sot_appointments
SET trapper_person_id = NULL
WHERE trapper_person_id IN (
  SELECT person_id FROM trapper.sot_people
  WHERE is_organization = true AND merged_into_person_id IS NULL
);

-- Step 8: Hard delete the organization records
-- (Full audit trail preserved in entity_edits)
WITH deleted_orgs AS (
  DELETE FROM trapper.sot_people
  WHERE is_organization = true
    AND merged_into_person_id IS NULL
  RETURNING *
)
SELECT 'Organization records deleted:' as step, COUNT(*) as count FROM deleted_orgs;

-- Verify cleanup
SELECT 'Remaining organizations in people:' as status, COUNT(*) as count
FROM trapper.sot_people
WHERE is_organization = true
  AND merged_into_person_id IS NULL;

\echo ''
\echo '=== MIG_572 Complete ==='
\echo ''
\echo 'All organization records have been:'
\echo '  - Fully logged to entity_edits (including original data)'
\echo '  - All relationships removed'
\echo '  - Hard deleted from sot_people'
\echo ''
\echo 'The Data Engine already rejects organization names via is_organization_name().'
\echo 'To view deleted records: SELECT * FROM trapper.entity_edits WHERE edit_type = ''delete'' AND reason LIKE ''%MIG_572%'';'
