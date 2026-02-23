-- MIG_2488: Fix Trapper Source Rules
--
-- TRAPPER SOURCE AUTHORITY:
--   Tier 1: FFSC Trappers    → VolunteerHub ONLY (must be in "Approved Trappers" group)
--   Tier 2: Community Trappers → Airtable ONLY (signed community trapper contract)
--   Tier 3: Unofficial        → Derived from data patterns (repeated appearances without VH/Airtable)
--
-- PROBLEM: MIG_2486 incorrectly classified VolunteerHub "interested in trapping"
-- people as community_trapper. They should NOT be trappers at all unless they're
-- in an approved trapper group.
--
-- Created: 2026-02-23

\echo ''
\echo '=============================================='
\echo '  MIG_2488: Fix Trapper Source Rules'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. DELETE INCORRECT TRAPPER PROFILES
-- ============================================================================

\echo '1. Removing incorrectly classified trappers from VolunteerHub...'

-- Delete trapper_service_places first (FK constraint)
DELETE FROM sot.trapper_service_places tsp
WHERE tsp.source_system = 'volunteerhub'
  AND tsp.person_id IN (
    SELECT tp.person_id
    FROM sot.trapper_profiles tp
    WHERE tp.source_system = 'volunteerhub'
      AND tp.trapper_type = 'community_trapper'
  );

-- Delete the incorrect profiles
DELETE FROM sot.trapper_profiles tp
WHERE tp.source_system = 'volunteerhub'
  AND tp.trapper_type = 'community_trapper';

\echo 'Removed VolunteerHub community_trapper profiles (incorrect classification)'

-- ============================================================================
-- 2. VERIFY FFSC TRAPPERS ARE CORRECT
-- ============================================================================

\echo ''
\echo '2. Verifying FFSC trappers from VolunteerHub...'

-- These should be people in actual "Approved Trappers" or similar groups
SELECT
  COALESCE(p.display_name, p.first_name || ' ' || p.last_name) as trapper,
  tp.trapper_type,
  (SELECT string_agg(ug.name, ', ')
   FROM source.volunteerhub_volunteers vv
   JOIN source.volunteerhub_group_memberships gm ON gm.volunteerhub_id = vv.volunteerhub_id
   JOIN source.volunteerhub_user_groups ug ON ug.user_group_uid = gm.user_group_uid
   WHERE vv.matched_person_id = tp.person_id
     AND ug.name ILIKE '%trapper%'
  ) as trapper_groups
FROM sot.trapper_profiles tp
JOIN sot.people p ON p.person_id = tp.person_id
WHERE tp.source_system = 'volunteerhub'
  AND p.merged_into_person_id IS NULL
ORDER BY tp.trapper_type, p.display_name
LIMIT 15;

-- ============================================================================
-- 3. CHECK AIRTABLE FOR COMMUNITY TRAPPERS
-- ============================================================================

\echo ''
\echo '3. Checking Airtable for community trappers...'

-- Check if we have any Airtable trapper data
SELECT
  COUNT(*) as airtable_records,
  COUNT(*) FILTER (WHERE table_name = 'trappers') as trapper_records
FROM source.airtable_raw;

-- ============================================================================
-- 4. CREATE FUNCTION TO DERIVE TIER 3 TRAPPERS FROM DATA PATTERNS
-- ============================================================================

\echo ''
\echo '4. Creating function to detect unofficial trappers from data patterns...'

CREATE OR REPLACE FUNCTION sot.detect_unofficial_trappers(
  p_min_appointments INT DEFAULT 3,
  p_min_unique_places INT DEFAULT 2
)
RETURNS TABLE (
  person_id UUID,
  person_name TEXT,
  appointment_count INT,
  unique_places INT,
  evidence TEXT
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  -- Find people who:
  -- 1. Appear frequently in appointment data as bringing in cats
  -- 2. Are NOT in VolunteerHub approved trappers
  -- 3. Are NOT in Airtable community trappers
  -- 4. Have brought cats from multiple different places
  RETURN QUERY
  SELECT
    p.person_id,
    COALESCE(p.display_name, p.first_name || ' ' || p.last_name)::TEXT as person_name,
    COUNT(DISTINCT a.appointment_id)::INT as appointment_count,
    COUNT(DISTINCT COALESCE(a.inferred_place_id, a.place_id))::INT as unique_places,
    'Frequent in appointment data without VH/Airtable trapper status'::TEXT as evidence
  FROM sot.people p
  JOIN ops.appointments a ON a.person_id = p.person_id
  WHERE p.merged_into_person_id IS NULL
    -- Not already a trapper profile
    AND NOT EXISTS (
      SELECT 1 FROM sot.trapper_profiles tp WHERE tp.person_id = p.person_id
    )
    -- Not in VolunteerHub approved trappers
    AND NOT EXISTS (
      SELECT 1 FROM source.volunteerhub_volunteers vv
      JOIN source.volunteerhub_group_memberships gm ON gm.volunteerhub_id = vv.volunteerhub_id
      JOIN source.volunteerhub_user_groups ug ON ug.user_group_uid = gm.user_group_uid
      WHERE vv.matched_person_id = p.person_id
        AND (ug.name ILIKE '%approved trapper%' OR ug.atlas_trapper_type IS NOT NULL)
    )
    -- Has person_roles indicating they bring in cats (not just owner)
    AND EXISTS (
      SELECT 1 FROM sot.person_roles pr
      WHERE pr.person_id = p.person_id
        AND pr.role IN ('trapper', 'volunteer', 'caretaker')
    )
  GROUP BY p.person_id, p.display_name, p.first_name, p.last_name
  HAVING COUNT(DISTINCT a.appointment_id) >= p_min_appointments
     AND COUNT(DISTINCT COALESCE(a.inferred_place_id, a.place_id)) >= p_min_unique_places
  ORDER BY COUNT(DISTINCT a.appointment_id) DESC;
END;
$$;

COMMENT ON FUNCTION sot.detect_unofficial_trappers IS
'Detects Tier 3 (unofficial/legacy) trappers from data patterns.
These are people who frequently bring in cats from multiple places
but are NOT in VolunteerHub or Airtable as official trappers.
Example: Toni Price - remnant of old informal processes.';

-- ============================================================================
-- 5. SHOW POTENTIAL TIER 3 TRAPPERS
-- ============================================================================

\echo ''
\echo '5. Potential Tier 3 (unofficial) trappers detected from data patterns:'

SELECT * FROM sot.detect_unofficial_trappers(3, 2) LIMIT 10;

-- ============================================================================
-- 6. UPDATE TRAPPER CLASSIFICATION COMMENTS
-- ============================================================================

\echo ''
\echo '6. Updating table comments with source authority rules...'

COMMENT ON TABLE sot.trapper_profiles IS
'Extended profile for trappers. SOURCE AUTHORITY RULES:
- Tier 1 (FFSC Trappers): source_system = ''volunteerhub'' ONLY
  Must be in "Approved Trappers" VolunteerHub group. Represent FFSC.
- Tier 2 (Community Trappers): source_system = ''airtable'' ONLY
  Signed community trapper contract. Do NOT represent FFSC. Limited to specific areas.
- Tier 3 (Unofficial): source_system = ''atlas_inference''
  Derived from data patterns (frequent appointments, multiple places).
  Use detect_unofficial_trappers() to find candidates.';

-- ============================================================================
-- 7. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Trapper profiles by source and type (after fix):'
SELECT
  source_system,
  trapper_type,
  COUNT(*) as count
FROM sot.trapper_profiles
GROUP BY source_system, trapper_type
ORDER BY source_system, count DESC;

\echo ''
\echo 'Service places remaining:'
SELECT
  source_system,
  COUNT(*) as count
FROM sot.trapper_service_places
GROUP BY source_system;

\echo ''
\echo '=============================================='
\echo '  MIG_2488 COMPLETE'
\echo '=============================================='
\echo ''
\echo 'TRAPPER SOURCE AUTHORITY (documented in table comment):'
\echo '  Tier 1: FFSC Trappers    → VolunteerHub ONLY (Approved Trappers group)'
\echo '  Tier 2: Community Trappers → Airtable ONLY (signed contract)'
\echo '  Tier 3: Unofficial        → Derived from data patterns'
\echo ''
\echo 'Functions:'
\echo '  sot.detect_unofficial_trappers() - Find Tier 3 candidates from data'
\echo ''
