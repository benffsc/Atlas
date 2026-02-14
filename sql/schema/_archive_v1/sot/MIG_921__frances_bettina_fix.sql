-- ============================================================================
-- MIG_921: Frances Batey / Bettina Kirby Email Mixup Fix (DATA_GAP_014)
-- ============================================================================
-- Problem: Frances Batey's record has Bettina Kirby's email (bmkirby@yahoo.com)
--          incorrectly associated. 26 Bettina Kirby duplicates exist.
--
-- Root Cause: Identity resolution matched on email, merged Bettina's records
--             into Frances Batey's record.
--
-- Solution:
-- 1. Remove bmkirby@yahoo.com from Frances Batey
-- 2. Find/create canonical Bettina Kirby record
-- 3. Add email to Bettina's record
-- 4. Mark Bettina as inactive trapper
-- ============================================================================

\echo '=== MIG_921: Frances Batey / Bettina Kirby Email Mixup Fix ==='
\echo ''

-- ============================================================================
-- Phase 1: Capture current state
-- ============================================================================

\echo 'Phase 1: Capturing current state...'

SELECT 'Frances Batey current identifiers:' as info;
SELECT pi.id_type, pi.id_value_norm, pi.source_system
FROM trapper.sot_people p
JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
WHERE p.person_id = 'd8ad9ef4-07ac-44c3-8528-1a1a404ca4fa';

SELECT 'Bettina Kirby records:' as info;
SELECT person_id, display_name, merged_into_person_id IS NOT NULL as is_merged
FROM trapper.sot_people
WHERE display_name ILIKE '%bettina%kirby%'
LIMIT 10;

-- ============================================================================
-- Phase 2: Remove bmkirby@yahoo.com from Frances Batey
-- ============================================================================

\echo ''
\echo 'Phase 2: Removing Bettina email from Frances Batey...'

-- Log before delete
INSERT INTO trapper.entity_edits (
  entity_type, entity_id, edit_type, field_name, old_value, edited_by, edit_source, reason
)
SELECT
  'person_identifier',
  pi.identifier_id,
  'delete',
  'id_value_norm',
  jsonb_build_object('email', pi.id_value_norm, 'person', 'Frances Batey'),
  'system:MIG_921',
  'migration',
  'DATA_GAP_014: Email belongs to Bettina Kirby, not Frances Batey'
FROM trapper.person_identifiers pi
WHERE pi.person_id = 'd8ad9ef4-07ac-44c3-8528-1a1a404ca4fa'
  AND pi.id_value_norm = 'bmkirby@yahoo.com';

-- Delete the misattributed email
DELETE FROM trapper.person_identifiers
WHERE person_id = 'd8ad9ef4-07ac-44c3-8528-1a1a404ca4fa'
  AND id_value_norm = 'bmkirby@yahoo.com';

-- ============================================================================
-- Phase 3: Find or create canonical Bettina Kirby
-- ============================================================================

\echo ''
\echo 'Phase 3: Creating canonical Bettina Kirby record...'

-- Check if there's an unmerged Bettina with the trapper role
DO $$
DECLARE
  v_bettina_id UUID;
  v_trapper_bettina UUID;
BEGIN
  -- Find Bettina with trapper role (if any)
  SELECT p.person_id INTO v_trapper_bettina
  FROM trapper.sot_people p
  JOIN trapper.person_roles pr ON pr.person_id = p.person_id
  WHERE p.display_name ILIKE '%bettina%kirby%'
    AND pr.role = 'trapper'
  LIMIT 1;

  IF v_trapper_bettina IS NOT NULL THEN
    -- Unmerge her
    UPDATE trapper.sot_people
    SET merged_into_person_id = NULL, merged_at = NULL
    WHERE person_id = v_trapper_bettina;

    v_bettina_id := v_trapper_bettina;
    RAISE NOTICE 'Unmerged Bettina Kirby with trapper role: %', v_bettina_id;
  ELSE
    -- Find any Bettina and unmerge
    SELECT person_id INTO v_bettina_id
    FROM trapper.sot_people
    WHERE display_name ILIKE '%bettina%kirby%'
    LIMIT 1;

    IF v_bettina_id IS NOT NULL THEN
      UPDATE trapper.sot_people
      SET merged_into_person_id = NULL, merged_at = NULL
      WHERE person_id = v_bettina_id;
      RAISE NOTICE 'Unmerged Bettina Kirby: %', v_bettina_id;
    ELSE
      -- Create new Bettina
      INSERT INTO trapper.sot_people (display_name, data_source)
      VALUES ('Bettina Kirby', 'migration')
      RETURNING person_id INTO v_bettina_id;
      RAISE NOTICE 'Created new Bettina Kirby: %', v_bettina_id;
    END IF;
  END IF;

  -- Add email to Bettina
  INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system, source_table)
  VALUES (v_bettina_id, 'email', 'bmkirby@yahoo.com', 'bmkirby@yahoo.com', 'atlas_ui', 'mig_921')
  ON CONFLICT (id_type, id_value_norm) DO UPDATE SET person_id = v_bettina_id;

  -- Mark as inactive trapper
  INSERT INTO trapper.person_roles (person_id, role, role_status, source_system, notes)
  VALUES (v_bettina_id, 'trapper', 'inactive', 'atlas_ui', 'Former FFSC trapper - MIG_921')
  ON CONFLICT (person_id, role) DO UPDATE SET
    role_status = 'inactive',
    notes = 'Former FFSC trapper - MIG_921',
    updated_at = NOW();

  RAISE NOTICE 'Bettina Kirby setup complete: %', v_bettina_id;
END $$;

-- ============================================================================
-- Phase 4: Verify final state
-- ============================================================================

\echo ''
\echo 'Phase 4: Verifying final state...'

SELECT 'Frances Batey identifiers (should NOT have bmkirby):' as info;
SELECT pi.id_type, pi.id_value_norm
FROM trapper.sot_people p
JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
WHERE p.person_id = 'd8ad9ef4-07ac-44c3-8528-1a1a404ca4fa';

SELECT 'Bettina Kirby (should have bmkirby):' as info;
SELECT p.person_id, p.display_name, pi.id_value_norm, pr.role, pr.role_status
FROM trapper.sot_people p
LEFT JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id AND pi.id_type = 'email'
LEFT JOIN trapper.person_roles pr ON pr.person_id = p.person_id AND pr.role = 'trapper'
WHERE p.display_name ILIKE '%bettina%kirby%'
  AND p.merged_into_person_id IS NULL;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_921 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Removed bmkirby@yahoo.com from Frances Batey'
\echo '  2. Created/unmerged canonical Bettina Kirby record'
\echo '  3. Added email to Bettina''s record'
\echo '  4. Marked Bettina as inactive trapper'
\echo ''
\echo 'DATA_GAP_014: Frances Batey / Bettina Kirby - FIXED'
\echo ''
\echo 'Note: 22 cats on Frances Batey may need manual review'
\echo '      to determine which belong to Frances vs Bettina.'
\echo ''
