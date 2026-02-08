\echo ''
\echo '=============================================='
\echo 'MIG_950: Fix Stale Merged Entity References'
\echo '=============================================='
\echo ''
\echo 'Data Quality Audit found records pointing to merged entities.'
\echo 'These are NOT data loss - they are stale references that need updating.'
\echo ''
\echo 'Issue counts:'
\echo '  - cat_place_relationships → merged place: 7,295'
\echo '  - person_place_relationships → merged place: 1,188'
\echo '  - appointments → merged person: 592'
\echo '  - google_map_entries → merged place: 184'
\echo '  - place_colony_estimates → merged place: 122'
\echo '  - appointments → merged trapper: 77'
\echo '  - person_place_relationships → merged person: 70'
\echo ''

-- ============================================================================
-- PART 1: Fix cat_place_relationships
-- ============================================================================

\echo '1. Fixing cat_place_relationships pointing to merged places...'

WITH updates AS (
    UPDATE trapper.cat_place_relationships cpr
    SET place_id = p.merged_into_place_id
    FROM trapper.places p
    WHERE p.place_id = cpr.place_id
      AND p.merged_into_place_id IS NOT NULL
    RETURNING cpr.cat_place_relationship_id
)
SELECT COUNT(*) AS cat_place_relationships_fixed FROM updates;

-- ============================================================================
-- PART 2: Fix person_place_relationships
-- ============================================================================

\echo ''
\echo '2. Fixing person_place_relationships...'

-- Fix place references
WITH updates AS (
    UPDATE trapper.person_place_relationships ppr
    SET place_id = p.merged_into_place_id
    FROM trapper.places p
    WHERE p.place_id = ppr.place_id
      AND p.merged_into_place_id IS NOT NULL
    RETURNING ppr.relationship_id
)
SELECT COUNT(*) AS person_place_place_refs_fixed FROM updates;

-- Fix person references
WITH updates AS (
    UPDATE trapper.person_place_relationships ppr
    SET person_id = sp.merged_into_person_id
    FROM trapper.sot_people sp
    WHERE sp.person_id = ppr.person_id
      AND sp.merged_into_person_id IS NOT NULL
    RETURNING ppr.relationship_id
)
SELECT COUNT(*) AS person_place_person_refs_fixed FROM updates;

-- ============================================================================
-- PART 3: Fix appointments
-- ============================================================================

\echo ''
\echo '3. Fixing sot_appointments...'

-- Fix person_id
WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET person_id = sp.merged_into_person_id
    FROM trapper.sot_people sp
    WHERE sp.person_id = a.person_id
      AND sp.merged_into_person_id IS NOT NULL
    RETURNING a.appointment_id
)
SELECT COUNT(*) AS appointment_person_refs_fixed FROM updates;

-- Fix trapper_person_id
WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET trapper_person_id = sp.merged_into_person_id
    FROM trapper.sot_people sp
    WHERE sp.person_id = a.trapper_person_id
      AND sp.merged_into_person_id IS NOT NULL
    RETURNING a.appointment_id
)
SELECT COUNT(*) AS appointment_trapper_refs_fixed FROM updates;

-- ============================================================================
-- PART 4: Fix google_map_entries
-- ============================================================================

\echo ''
\echo '4. Fixing google_map_entries...'

-- Fix place_id
WITH updates AS (
    UPDATE trapper.google_map_entries gme
    SET place_id = p.merged_into_place_id
    FROM trapper.places p
    WHERE p.place_id = gme.place_id
      AND p.merged_into_place_id IS NOT NULL
    RETURNING gme.entry_id
)
SELECT COUNT(*) AS google_map_place_refs_fixed FROM updates;

-- ============================================================================
-- PART 5: Fix place_colony_estimates
-- ============================================================================

\echo ''
\echo '5. Fixing place_colony_estimates...'

WITH updates AS (
    UPDATE trapper.place_colony_estimates pce
    SET place_id = p.merged_into_place_id
    FROM trapper.places p
    WHERE p.place_id = pce.place_id
      AND p.merged_into_place_id IS NOT NULL
    RETURNING pce.estimate_id
)
SELECT COUNT(*) AS colony_estimate_refs_fixed FROM updates;

-- ============================================================================
-- PART 6: Fix person_identifiers
-- ============================================================================

\echo ''
\echo '6. Fixing person_identifiers...'

WITH updates AS (
    UPDATE trapper.person_identifiers pi
    SET person_id = sp.merged_into_person_id
    FROM trapper.sot_people sp
    WHERE sp.person_id = pi.person_id
      AND sp.merged_into_person_id IS NOT NULL
    RETURNING pi.identifier_id
)
SELECT COUNT(*) AS person_identifiers_fixed FROM updates;

-- ============================================================================
-- PART 7: Fix sot_requests
-- ============================================================================

\echo ''
\echo '7. Fixing sot_requests...'

-- Fix place_id
WITH updates AS (
    UPDATE trapper.sot_requests r
    SET place_id = p.merged_into_place_id
    FROM trapper.places p
    WHERE p.place_id = r.place_id
      AND p.merged_into_place_id IS NOT NULL
    RETURNING r.request_id
)
SELECT COUNT(*) AS request_place_refs_fixed FROM updates;

-- Fix requester_person_id
WITH updates AS (
    UPDATE trapper.sot_requests r
    SET requester_person_id = sp.merged_into_person_id
    FROM trapper.sot_people sp
    WHERE sp.person_id = r.requester_person_id
      AND sp.merged_into_person_id IS NOT NULL
    RETURNING r.request_id
)
SELECT COUNT(*) AS request_requester_refs_fixed FROM updates;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Remaining stale references (should all be 0):'

SELECT 'cat_place_relationships → merged' as check_name,
       COUNT(*) as remaining
FROM trapper.cat_place_relationships cpr
JOIN trapper.places p ON p.place_id = cpr.place_id
WHERE p.merged_into_place_id IS NOT NULL

UNION ALL

SELECT 'person_place_relationships → merged place', COUNT(*)
FROM trapper.person_place_relationships ppr
JOIN trapper.places p ON p.place_id = ppr.place_id
WHERE p.merged_into_place_id IS NOT NULL

UNION ALL

SELECT 'person_place_relationships → merged person', COUNT(*)
FROM trapper.person_place_relationships ppr
JOIN trapper.sot_people sp ON sp.person_id = ppr.person_id
WHERE sp.merged_into_person_id IS NOT NULL

UNION ALL

SELECT 'appointments → merged person', COUNT(*)
FROM trapper.sot_appointments a
JOIN trapper.sot_people sp ON sp.person_id = a.person_id
WHERE sp.merged_into_person_id IS NOT NULL

UNION ALL

SELECT 'google_map_entries → merged place', COUNT(*)
FROM trapper.google_map_entries gme
JOIN trapper.places p ON p.place_id = gme.place_id
WHERE p.merged_into_place_id IS NOT NULL

UNION ALL

SELECT 'place_colony_estimates → merged', COUNT(*)
FROM trapper.place_colony_estimates pce
JOIN trapper.places p ON p.place_id = pce.place_id
WHERE p.merged_into_place_id IS NOT NULL;

\echo ''
\echo '=============================================='
\echo 'MIG_950 Complete!'
\echo '=============================================='
\echo ''
\echo 'All stale references have been updated to point to canonical entities.'
\echo 'The soft-delete pattern (merged_into_*) now has clean pointers.'
\echo ''
