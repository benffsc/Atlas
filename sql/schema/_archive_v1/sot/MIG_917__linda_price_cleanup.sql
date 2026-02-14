-- ============================================================================
-- MIG_917: Linda Price / Location-as-Person Cleanup (DATA_GAP_010)
-- ============================================================================
-- Problem: Location names became person records, and real person Linda Price
--          was merged INTO a location-named record ("The Villages").
--
-- Affected Records:
--   - "Golden Gate Transit SR" (ea51a767-259a-42e0-b5f5-2ddceadae4cc)
--     21 cats linked as caretaker, has Linda's phone/email
--   - "The Villages" (05e5ee06-ce20-404b-9ec9-876576a78fb2)
--     16 records merged into it, including 2 Linda Price records
--   - Linda Price records merged into The Villages:
--     3e8c952c-4c12-49ca-ac22-1c95f23b6f7d
--     dde71ef2-89aa-4bee-a555-ad5bd387ad86
--
-- Root Cause:
--   ClinicHQ staff entered location names in Owner First Name field
--   ("Golden Gate Transit SR", "The Villages") for trapping sites.
--   These became person records instead of place references.
--
-- Solution:
--   1. Unmerge Linda Price records from The Villages
--   2. Create/find canonical Linda Price with correct identifiers
--   3. Reassign cats from Golden Gate Transit SR to Linda Price
--   4. Delete location-as-person records
--   5. Set up correct person-place relationships for Linda
--
-- Linda's Info (from VolunteerHub):
--   Email: forestlvr@sbcglobal.net
--   Phone: 707-490-2735
--   Home: 100 Winchester Drive, Santa Rosa, CA 95401
--   Traps at: Golden Gate Transit (3225 Industrial Drive)
--             The Villages Apts (2980 Bay Village Circle)
-- ============================================================================

\echo '=== MIG_917: Linda Price / Location-as-Person Cleanup ==='
\echo ''

-- ============================================================================
-- Phase 1: Capture current state
-- ============================================================================

\echo 'Phase 1: Capturing current state...'

SELECT 'Location-as-person records:' as info;
SELECT person_id, display_name, merged_into_person_id
FROM trapper.sot_people
WHERE person_id IN (
  'ea51a767-259a-42e0-b5f5-2ddceadae4cc',  -- Golden Gate Transit SR
  '05e5ee06-ce20-404b-9ec9-876576a78fb2'   -- The Villages
);

SELECT 'Records merged into The Villages:' as info;
SELECT person_id, display_name, merged_into_person_id
FROM trapper.sot_people
WHERE merged_into_person_id = '05e5ee06-ce20-404b-9ec9-876576a78fb2';

SELECT 'Cats linked to Golden Gate Transit SR:' as info;
SELECT COUNT(DISTINCT cat_id) as cat_count
FROM trapper.person_cat_relationships
WHERE person_id = 'ea51a767-259a-42e0-b5f5-2ddceadae4cc';

-- ============================================================================
-- Phase 2: Unmerge Linda Price records from The Villages
-- ============================================================================

\echo ''
\echo 'Phase 2: Unmerging Linda Price records from The Villages...'

-- Check if undo_person_merge function exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'undo_person_merge'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper')
  ) THEN
    -- Unmerge the two Linda Price records
    PERFORM trapper.undo_person_merge('3e8c952c-4c12-49ca-ac22-1c95f23b6f7d');
    PERFORM trapper.undo_person_merge('dde71ef2-89aa-4bee-a555-ad5bd387ad86');
    RAISE NOTICE 'Unmerged Linda Price records from The Villages';
  ELSE
    -- Manual unmerge if function doesn't exist
    UPDATE trapper.sot_people
    SET merged_into_person_id = NULL,
        merged_at = NULL,
        merge_reason = NULL
    WHERE person_id IN (
      '3e8c952c-4c12-49ca-ac22-1c95f23b6f7d',
      'dde71ef2-89aa-4bee-a555-ad5bd387ad86'
    );
    RAISE NOTICE 'Manually cleared merge flags for Linda Price records';
  END IF;
END $$;

-- ============================================================================
-- Phase 3: Create/Find canonical Linda Price with correct identifiers
-- ============================================================================

\echo ''
\echo 'Phase 3: Creating/finding canonical Linda Price record...'

-- First check if Linda Price exists unmerged
DO $$
DECLARE
  v_linda_id UUID;
BEGIN
  -- Try to find existing Linda Price
  SELECT person_id INTO v_linda_id
  FROM trapper.sot_people
  WHERE display_name = 'Linda Price'
    AND merged_into_person_id IS NULL
  LIMIT 1;

  IF v_linda_id IS NULL THEN
    -- Create new Linda Price record
    SELECT trapper.find_or_create_person(
      'forestlvr@sbcglobal.net',
      '7074902735',
      'Linda',
      'Price',
      '100 Winchester Drive, Santa Rosa, CA 95401',
      'atlas_ui'
    ) INTO v_linda_id;
    RAISE NOTICE 'Created new Linda Price record: %', v_linda_id;
  ELSE
    RAISE NOTICE 'Found existing Linda Price record: %', v_linda_id;

    -- Ensure correct identifiers exist
    INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system, source_table)
    VALUES
      (v_linda_id, 'email', 'forestlvr@sbcglobal.net', 'forestlvr@sbcglobal.net', 'atlas_ui', 'mig_917'),
      (v_linda_id, 'phone', '7074902735', '707-490-2735', 'atlas_ui', 'mig_917')
    ON CONFLICT (id_type, id_value_norm) DO NOTHING;
  END IF;
END $$;

-- Show the canonical Linda
SELECT 'Canonical Linda Price:' as info;
SELECT p.person_id, p.display_name, pi.id_type, pi.id_value_norm
FROM trapper.sot_people p
LEFT JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
WHERE p.display_name = 'Linda Price'
  AND p.merged_into_person_id IS NULL;

-- ============================================================================
-- Phase 4: Reassign cats from Golden Gate Transit SR to Linda Price
-- ============================================================================

\echo ''
\echo 'Phase 4: Reassigning cats from Golden Gate Transit SR to Linda Price...'

WITH linda AS (
  SELECT person_id FROM trapper.sot_people
  WHERE display_name = 'Linda Price'
    AND merged_into_person_id IS NULL
  LIMIT 1
),
updated AS (
  UPDATE trapper.person_cat_relationships pcr
  SET person_id = linda.person_id
  FROM linda
  WHERE pcr.person_id = 'ea51a767-259a-42e0-b5f5-2ddceadae4cc'
  RETURNING pcr.person_cat_id
)
SELECT COUNT(*) as cats_reassigned FROM updated;

-- ============================================================================
-- Phase 5: Log location-as-person records to entity_edits
-- ============================================================================

\echo ''
\echo 'Phase 5: Logging location-as-person records to entity_edits...'

INSERT INTO trapper.entity_edits (
  entity_type, entity_id, edit_type, field_name,
  old_value, edited_by, edit_source, reason
)
SELECT
  'person', p.person_id, 'delete', 'full_record',
  jsonb_build_object(
    'person_id', p.person_id,
    'display_name', p.display_name,
    'created_at', p.created_at,
    'identifiers', (
      SELECT jsonb_agg(jsonb_build_object('type', pi.id_type, 'value', pi.id_value_norm))
      FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id
    )
  ),
  'system:MIG_917',
  'migration',
  'Location name removed from people table - DATA_GAP_010'
FROM trapper.sot_people p
WHERE p.person_id IN (
  'ea51a767-259a-42e0-b5f5-2ddceadae4cc',  -- Golden Gate Transit SR
  '05e5ee06-ce20-404b-9ec9-876576a78fb2'   -- The Villages
);

-- ============================================================================
-- Phase 6: Delete location-as-person relationships
-- ============================================================================

\echo ''
\echo 'Phase 6: Deleting location-as-person relationships...'

-- Delete remaining cat relationships (should be 0 after reassignment)
DELETE FROM trapper.person_cat_relationships
WHERE person_id IN (
  'ea51a767-259a-42e0-b5f5-2ddceadae4cc',
  '05e5ee06-ce20-404b-9ec9-876576a78fb2'
);

-- Delete place relationships
DELETE FROM trapper.person_place_relationships
WHERE person_id IN (
  'ea51a767-259a-42e0-b5f5-2ddceadae4cc',
  '05e5ee06-ce20-404b-9ec9-876576a78fb2'
);

-- Delete identifiers
DELETE FROM trapper.person_identifiers
WHERE person_id IN (
  'ea51a767-259a-42e0-b5f5-2ddceadae4cc',
  '05e5ee06-ce20-404b-9ec9-876576a78fb2'
);

-- Clear request references
UPDATE trapper.sot_requests
SET requester_person_id = NULL
WHERE requester_person_id IN (
  'ea51a767-259a-42e0-b5f5-2ddceadae4cc',
  '05e5ee06-ce20-404b-9ec9-876576a78fb2'
);

-- Delete person roles if any
DELETE FROM trapper.person_roles
WHERE person_id IN (
  'ea51a767-259a-42e0-b5f5-2ddceadae4cc',
  '05e5ee06-ce20-404b-9ec9-876576a78fb2'
);

-- ============================================================================
-- Phase 7: Delete location-as-person records
-- ============================================================================

\echo ''
\echo 'Phase 7: Deleting location-as-person records...'

DELETE FROM trapper.sot_people
WHERE person_id IN (
  'ea51a767-259a-42e0-b5f5-2ddceadae4cc',  -- Golden Gate Transit SR
  '05e5ee06-ce20-404b-9ec9-876576a78fb2'   -- The Villages
);

-- ============================================================================
-- Phase 8: Set up correct person-place relationships for Linda
-- ============================================================================

\echo ''
\echo 'Phase 8: Setting up correct person-place relationships for Linda...'

WITH linda AS (
  SELECT person_id FROM trapper.sot_people
  WHERE display_name = 'Linda Price'
    AND merged_into_person_id IS NULL
  LIMIT 1
),
places AS (
  SELECT place_id, formatted_address,
    CASE
      WHEN formatted_address ILIKE '%100 Winchester%' THEN 'resident'
      WHEN formatted_address ILIKE '%3225 Industrial%' THEN 'contact'
      WHEN formatted_address ILIKE '%2980 Bay Village%' THEN 'contact'
    END as role
  FROM trapper.places
  WHERE (formatted_address ILIKE '%100 Winchester%Santa Rosa%'
     OR formatted_address = '3225 Industrial Drive, Santa Rosa, CA 95403'
     OR formatted_address ILIKE '%2980 Bay Village%Santa Rosa%')
    AND merged_into_place_id IS NULL
),
inserted AS (
  INSERT INTO trapper.person_place_relationships (
    person_id, place_id, role, confidence, source_system, source_table
  )
  SELECT
    linda.person_id,
    places.place_id,
    places.role::trapper.person_place_role,
    0.9,
    'atlas_ui',
    'mig_917_data_gap_010'
  FROM linda, places
  WHERE places.role IS NOT NULL
  ON CONFLICT DO NOTHING
  RETURNING person_place_id
)
SELECT COUNT(*) as relationships_created FROM inserted;

-- ============================================================================
-- Phase 9: Verify final state
-- ============================================================================

\echo ''
\echo 'Phase 9: Verifying final state...'

SELECT 'Location-as-person records (should be 0):' as info;
SELECT person_id, display_name
FROM trapper.sot_people
WHERE display_name IN ('Golden Gate Transit SR', 'The Villages');

SELECT 'Linda Price identifiers:' as info;
SELECT p.display_name, pi.id_type, pi.id_value_norm
FROM trapper.sot_people p
LEFT JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
WHERE p.display_name = 'Linda Price'
  AND p.merged_into_person_id IS NULL;

SELECT 'Linda Price cats:' as info;
SELECT COUNT(DISTINCT pcr.cat_id) as cat_count
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_people p ON p.person_id = pcr.person_id
WHERE p.display_name = 'Linda Price'
  AND p.merged_into_person_id IS NULL;

SELECT 'Linda Price place relationships:' as info;
SELECT pl.formatted_address, ppr.role
FROM trapper.person_place_relationships ppr
JOIN trapper.places pl ON pl.place_id = ppr.place_id
JOIN trapper.sot_people p ON p.person_id = ppr.person_id
WHERE p.display_name = 'Linda Price'
  AND p.merged_into_person_id IS NULL;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_917 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Unmerged Linda Price records from The Villages'
\echo '  2. Created/verified canonical Linda Price with correct identifiers'
\echo '  3. Reassigned cats from Golden Gate Transit SR to Linda Price'
\echo '  4. Logged location-as-person records to entity_edits'
\echo '  5. Deleted Golden Gate Transit SR and The Villages person records'
\echo '  6. Created person-place relationships for Linda:'
\echo '     - 100 Winchester Drive (resident - home)'
\echo '     - 3225 Industrial Drive (contact - Golden Gate Transit site)'
\echo '     - 2980 Bay Village Circle (contact - The Villages site)'
\echo ''
\echo 'DATA_GAP_010: Linda Price / Location-as-Person - CLEANED'
\echo ''
\echo 'New Invariant:'
\echo '  INV-18: Location names must not create person records'
\echo ''
