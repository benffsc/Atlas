\echo ''
\echo '=============================================='
\echo 'MIG_556: Fix Carl Draper Duplicates'
\echo '=============================================='
\echo ''
\echo 'Problem: 39 Carl Draper records from ClinicHQ'
\echo '(created before Data Engine identity resolution)'
\echo ''

BEGIN;

-- ============================================================================
-- PART 1: Find the canonical Carl Draper
-- ============================================================================

\echo 'Finding canonical Carl Draper...'

-- Score each Carl Draper by data richness
CREATE TEMP TABLE tmp_carl_candidates AS
SELECT
  p.person_id,
  p.display_name,
  p.data_source,
  p.created_at,
  -- Score by relationships and roles
  (SELECT COUNT(*) FROM trapper.person_roles pr WHERE pr.person_id = p.person_id) as role_count,
  (SELECT COUNT(*) FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id) as identifier_count,
  (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.trapper_person_id = p.person_id) as trapper_appt_count,
  (SELECT COUNT(*) FROM trapper.request_trapper_assignments rta WHERE rta.trapper_person_id = p.person_id) as assignment_count,
  (SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.requester_person_id = p.person_id) as request_count
FROM trapper.sot_people p
WHERE LOWER(p.display_name) = 'carl draper'
  AND p.merged_into_person_id IS NULL;

-- Select canonical: prefer one with roles, then most identifiers, then oldest
CREATE TEMP TABLE tmp_canonical_carl AS
SELECT person_id as canonical_id
FROM tmp_carl_candidates
ORDER BY
  role_count DESC,
  identifier_count DESC,
  trapper_appt_count DESC,
  assignment_count DESC,
  created_at ASC
LIMIT 1;

-- Show what we found
\echo 'Carl Draper candidates:'
SELECT person_id, display_name, data_source, role_count, identifier_count, created_at::date
FROM tmp_carl_candidates
ORDER BY role_count DESC, identifier_count DESC, created_at ASC
LIMIT 10;

\echo ''
\echo 'Selected canonical Carl Draper:'
SELECT c.canonical_id, p.display_name, p.data_source, p.created_at::date
FROM tmp_canonical_carl c
JOIN trapper.sot_people p ON p.person_id = c.canonical_id;

-- ============================================================================
-- PART 2: Get duplicates to merge
-- ============================================================================

\echo ''
\echo 'Identifying duplicates to merge...'

CREATE TEMP TABLE tmp_carl_duplicates AS
SELECT person_id as duplicate_id
FROM trapper.sot_people p
WHERE LOWER(p.display_name) = 'carl draper'
  AND p.merged_into_person_id IS NULL
  AND p.person_id != (SELECT canonical_id FROM tmp_canonical_carl);

\echo 'Found duplicates to merge:'
SELECT COUNT(*) as duplicate_count FROM tmp_carl_duplicates;

-- ============================================================================
-- PART 3: Merge all duplicates into canonical
-- ============================================================================

\echo ''
\echo 'Merging duplicates into canonical Carl Draper...'

DO $$
DECLARE
  v_canonical UUID;
  v_duplicate UUID;
  v_merged_count INT := 0;
BEGIN
  SELECT canonical_id INTO v_canonical FROM tmp_canonical_carl;

  IF v_canonical IS NULL THEN
    RAISE NOTICE 'No canonical Carl Draper found - nothing to merge';
    RETURN;
  END IF;

  FOR v_duplicate IN SELECT duplicate_id FROM tmp_carl_duplicates
  LOOP
    BEGIN
      PERFORM trapper.merge_people(v_duplicate, v_canonical, 'MIG_556_duplicate_cleanup', 'migration');
      v_merged_count := v_merged_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to merge %: %', v_duplicate, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Successfully merged % duplicates into canonical Carl Draper %', v_merged_count, v_canonical;
END $$;

-- ============================================================================
-- PART 4: Ensure trapper role exists
-- ============================================================================

\echo ''
\echo 'Ensuring Carl Draper has trapper role...'

INSERT INTO trapper.person_roles (
  person_id, role, trapper_type, role_status,
  source_system, notes, started_at
)
SELECT
  canonical_id,
  'trapper',
  'ffsc_trapper',  -- "Legacy Trapper" maps to ffsc_trapper
  'active',
  'airtable',
  'Legacy Trapper - fixed via MIG_556',
  NOW()
FROM tmp_canonical_carl
ON CONFLICT (person_id, role)
DO UPDATE SET
  trapper_type = 'ffsc_trapper',
  role_status = 'active',
  notes = COALESCE(trapper.person_roles.notes, '') || ' [MIG_556: confirmed as Legacy Trapper]',
  updated_at = NOW();

-- ============================================================================
-- PART 5: Fix phone identifier (remove from Patricia Elder if wrongly linked)
-- ============================================================================

\echo ''
\echo 'Checking phone identifier 7072927680...'

-- Show current state
SELECT p.display_name, pi.id_value_norm, pi.source_system
FROM trapper.person_identifiers pi
JOIN trapper.sot_people p ON p.person_id = pi.person_id
WHERE pi.id_value_norm = '7072927680';

-- Add phone to Carl if not already there
INSERT INTO trapper.person_identifiers (
  person_id, id_type, id_value_norm, id_value_raw,
  source_system, confidence
)
SELECT
  canonical_id,
  'phone',
  '7072927680',
  '(707) 292-7680',
  'airtable',
  0.9  -- Slightly lower confidence since it may be shared
FROM tmp_canonical_carl
WHERE NOT EXISTS (
  SELECT 1 FROM trapper.person_identifiers pi
  WHERE pi.person_id = (SELECT canonical_id FROM tmp_canonical_carl)
    AND pi.id_type = 'phone'
    AND pi.id_value_norm = '7072927680'
);

-- Note: We don't remove from Patricia Elder - phone may legitimately be shared
-- The soft blacklist will handle this in future identity resolution

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'Verification'
\echo '=============================================='

\echo ''
\echo 'Carl Draper records after merge (should be 1 canonical + N merged):'
SELECT
  person_id,
  display_name,
  merged_into_person_id IS NOT NULL as is_merged,
  data_source
FROM trapper.sot_people
WHERE LOWER(display_name) = 'carl draper'
ORDER BY merged_into_person_id NULLS FIRST;

\echo ''
\echo 'Carl Draper roles:'
SELECT p.display_name, pr.role, pr.trapper_type, pr.role_status
FROM trapper.person_roles pr
JOIN trapper.sot_people p ON p.person_id = pr.person_id
WHERE LOWER(p.display_name) = 'carl draper'
  AND p.merged_into_person_id IS NULL;

\echo ''
\echo 'Phone 7072927680 now linked to:'
SELECT p.display_name, pi.id_value_norm, pi.source_system
FROM trapper.person_identifiers pi
JOIN trapper.sot_people p ON p.person_id = pi.person_id
WHERE pi.id_value_norm = '7072927680'
  AND p.merged_into_person_id IS NULL;

-- Cleanup temp tables
DROP TABLE IF EXISTS tmp_carl_candidates;
DROP TABLE IF EXISTS tmp_canonical_carl;
DROP TABLE IF EXISTS tmp_carl_duplicates;

\echo ''
\echo '=============================================='
\echo 'MIG_556 Complete!'
\echo '=============================================='
