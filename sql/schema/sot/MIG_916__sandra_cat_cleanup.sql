-- ============================================================================
-- MIG_916: Sandra Cat Relationship Cleanup (DATA_GAP_009)
-- ============================================================================
-- Problem: Sandra Brady has 1,253 cats and Sandra Nicander has 1,171 cats
--          linked as 'caretaker' due to FFSC organizational email matching.
--
-- Root Cause:
--   ClinicHQ appointments for community cats used info@forgottenfelines.com
--   Identity resolution matched to Sandra Brady's person record
--   All cats with that email got linked to her as caretaker
--
-- Solution:
--   Remove erroneous 'caretaker' relationships created via org email matching
--   Preserve any legitimate 'owner' relationships
--
-- Related: MIG_915 (fixes the bypass to prevent future occurrences)
-- ============================================================================

\echo '=== MIG_916: Sandra Cat Relationship Cleanup ==='
\echo ''

-- ============================================================================
-- Phase 1: Capture current state
-- ============================================================================

\echo 'Phase 1: Capturing current state...'

SELECT 'Sandra cat relationships BEFORE:' as info;
SELECT
  p.display_name,
  pcr.relationship_type,
  pcr.source_system,
  pcr.source_table,
  COUNT(DISTINCT pcr.cat_id) as cat_count
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_people p ON p.person_id = pcr.person_id
WHERE p.display_name IN ('Sandra Brady', 'Sandra Nicander')
GROUP BY p.display_name, pcr.relationship_type, pcr.source_system, pcr.source_table
ORDER BY p.display_name, cat_count DESC;

-- ============================================================================
-- Phase 2: Log to entity_edits before deletion
-- ============================================================================

\echo ''
\echo 'Phase 2: Logging relationships to entity_edits before deletion...'

WITH logged AS (
  INSERT INTO trapper.entity_edits (
    entity_type,
    entity_id,
    edit_type,
    field_name,
    old_value,
    edited_by,
    edit_source,
    reason
  )
  SELECT
    'person_cat_relationship',
    pcr.person_cat_id,
    'delete',
    'full_record',
    jsonb_build_object(
      'person_id', pcr.person_id,
      'person_name', p.display_name,
      'cat_id', pcr.cat_id,
      'relationship_type', pcr.relationship_type,
      'source_system', pcr.source_system,
      'source_table', pcr.source_table,
      'created_at', pcr.created_at
    ),
    'system:MIG_916',
    'migration',
    'Erroneous caretaker link via FFSC org email - DATA_GAP_009'
  FROM trapper.person_cat_relationships pcr
  JOIN trapper.sot_people p ON p.person_id = pcr.person_id
  WHERE p.display_name IN ('Sandra Brady', 'Sandra Nicander')
    AND pcr.relationship_type = 'caretaker'
  RETURNING entity_id
)
SELECT COUNT(*) as relationships_logged FROM logged;

-- ============================================================================
-- Phase 3: Delete erroneous caretaker relationships
-- ============================================================================

\echo ''
\echo 'Phase 3: Deleting erroneous caretaker relationships...'

WITH deleted AS (
  DELETE FROM trapper.person_cat_relationships pcr
  USING trapper.sot_people p
  WHERE p.person_id = pcr.person_id
    AND p.display_name IN ('Sandra Brady', 'Sandra Nicander')
    AND pcr.relationship_type = 'caretaker'
  RETURNING pcr.person_cat_id, pcr.cat_id, p.display_name
)
SELECT
  display_name,
  COUNT(*) as relationships_deleted,
  COUNT(DISTINCT cat_id) as unique_cats_unlinked
FROM deleted
GROUP BY display_name;

-- ============================================================================
-- Phase 4: Verify final state
-- ============================================================================

\echo ''
\echo 'Phase 4: Verifying final state...'

SELECT 'Sandra cat relationships AFTER:' as info;
SELECT
  p.display_name,
  pcr.relationship_type,
  pcr.source_system,
  COUNT(DISTINCT pcr.cat_id) as cat_count
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_people p ON p.person_id = pcr.person_id
WHERE p.display_name IN ('Sandra Brady', 'Sandra Nicander')
GROUP BY p.display_name, pcr.relationship_type, pcr.source_system
ORDER BY p.display_name, cat_count DESC;

-- Check if any owner relationships remain (legitimate)
SELECT 'Remaining owner relationships (legitimate):' as info;
SELECT
  p.display_name,
  COUNT(DISTINCT pcr.cat_id) as owner_cat_count
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_people p ON p.person_id = pcr.person_id
WHERE p.display_name IN ('Sandra Brady', 'Sandra Nicander')
  AND pcr.relationship_type = 'owner'
GROUP BY p.display_name;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_916 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Logged all caretaker relationships to entity_edits (audit trail)'
\echo '  2. Deleted caretaker relationships for Sandra Brady/Nicander'
\echo '  3. Preserved any legitimate owner relationships'
\echo ''
\echo 'DATA_GAP_009: Sandra Cat Pollution - CLEANED'
\echo ''
\echo 'Note: MIG_915 prevents future occurrences by blocking org emails'
\echo '      at the should_be_person() gate.'
\echo ''
