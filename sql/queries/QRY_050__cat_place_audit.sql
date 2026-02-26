-- QRY_050: Cat-Place Link Audit vs Appointment Data
-- Purpose: Compare cat-place links to source appointment data to find discrepancies
-- Created: 2026-02-21 (DATA_GAP audit)
--
-- This audit identifies:
-- 1. Cats with appointments but no cat_place links
-- 2. Cat-place links that don't match appointment inferred_place_id
-- 3. Relationship type mismatches (home vs appointment_site)
-- 4. COALESCE fallback issues (where inferred_place_id was NULL)

\echo ''
\echo '=============================================='
\echo '  QRY_050: Cat-Place Link Audit'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. OVERVIEW STATISTICS
-- ============================================================================

\echo '1. Overview Statistics'
\echo '----------------------'

WITH stats AS (
  SELECT
    (SELECT COUNT(DISTINCT cat_id) FROM sot.cats WHERE merged_into_cat_id IS NULL) as total_cats,
    (SELECT COUNT(DISTINCT cat_id) FROM ops.appointments WHERE cat_id IS NOT NULL) as cats_with_appointments,
    (SELECT COUNT(DISTINCT cat_id) FROM sot.cat_place) as cats_with_place_links,
    (SELECT COUNT(*) FROM sot.cat_place) as total_cat_place_edges,
    (SELECT COUNT(*) FROM ops.appointments WHERE inferred_place_id IS NOT NULL) as appointments_with_inferred_place,
    (SELECT COUNT(*) FROM ops.appointments WHERE inferred_place_id IS NULL AND cat_id IS NOT NULL) as appointments_missing_inferred_place
)
SELECT
  total_cats,
  cats_with_appointments,
  cats_with_place_links,
  ROUND(100.0 * cats_with_place_links / NULLIF(total_cats, 0), 1) as pct_cats_with_links,
  total_cat_place_edges,
  appointments_with_inferred_place,
  appointments_missing_inferred_place,
  ROUND(100.0 * appointments_with_inferred_place /
    NULLIF(appointments_with_inferred_place + appointments_missing_inferred_place, 0), 1) as pct_appointments_with_place
FROM stats;

-- ============================================================================
-- 2. CAT-PLACE RELATIONSHIP TYPE DISTRIBUTION
-- ============================================================================

\echo ''
\echo '2. Relationship Type Distribution'
\echo '----------------------------------'

SELECT
  relationship_type,
  COUNT(*) as edges,
  COUNT(DISTINCT cat_id) as unique_cats,
  COUNT(DISTINCT place_id) as unique_places
FROM sot.cat_place
GROUP BY relationship_type
ORDER BY edges DESC;

-- ============================================================================
-- 3. CATS WITH APPOINTMENTS BUT NO CAT_PLACE LINK
-- ============================================================================

\echo ''
\echo '3. Cats with Appointments but No Place Link'
\echo '--------------------------------------------'

SELECT COUNT(DISTINCT a.cat_id) as cats_with_appointments_no_link
FROM ops.appointments a
JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
WHERE a.cat_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = a.cat_id
  );

-- Breakdown by appointment characteristics
\echo ''
\echo '   Breakdown of unlinked cats:'

SELECT
  CASE
    WHEN a.inferred_place_id IS NULL AND a.place_id IS NULL THEN 'No place at all'
    WHEN a.inferred_place_id IS NULL AND a.place_id IS NOT NULL THEN 'Only clinic place_id (no inferred)'
    WHEN a.inferred_place_id IS NOT NULL THEN 'Has inferred_place_id but no link'
  END as reason,
  COUNT(DISTINCT a.cat_id) as unlinked_cats
FROM ops.appointments a
JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
WHERE a.cat_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = a.cat_id
  )
GROUP BY 1
ORDER BY unlinked_cats DESC;

-- ============================================================================
-- 4. COALESCE FALLBACK AUDIT
-- ============================================================================

\echo ''
\echo '4. COALESCE Fallback Audit (where inferred_place_id was NULL)'
\echo '-------------------------------------------------------------'

-- Check if any cat_place links were created using place_id (clinic) instead of inferred_place_id
WITH appointment_based_links AS (
  SELECT
    cp.cat_id,
    cp.place_id as linked_place_id,
    cp.relationship_type,
    a.inferred_place_id,
    a.place_id as appointment_place_id,
    p.place_kind,
    p.display_name as place_name
  FROM sot.cat_place cp
  JOIN ops.appointments a ON a.cat_id = cp.cat_id
  JOIN sot.places p ON p.place_id = cp.place_id
  WHERE cp.source_table = 'link_cats_to_appointment_places'
    AND COALESCE(cp.place_id, 'x') != COALESCE(a.inferred_place_id, 'y')
)
SELECT
  COUNT(*) as mismatched_links,
  COUNT(DISTINCT cat_id) as affected_cats,
  COUNT(*) FILTER (WHERE place_kind = 'clinic') as clinic_fallbacks
FROM appointment_based_links;

-- ============================================================================
-- 5. CLINIC PLACE LEAKAGE CHECK
-- ============================================================================

\echo ''
\echo '5. Clinic Place Leakage Check'
\echo '------------------------------'

-- Check for cats linked to known clinic addresses
SELECT
  p.display_name,
  p.formatted_address,
  COUNT(DISTINCT cp.cat_id) as cats_linked,
  cp.relationship_type
FROM sot.cat_place cp
JOIN sot.places p ON p.place_id = cp.place_id
WHERE p.place_kind = 'clinic'
   OR p.formatted_address ILIKE '%1814%Empire Industrial%'
   OR p.formatted_address ILIKE '%1820%Empire Industrial%'
   OR p.formatted_address ILIKE '%845 Todd%'
GROUP BY p.display_name, p.formatted_address, cp.relationship_type
ORDER BY cats_linked DESC
LIMIT 10;

-- ============================================================================
-- 6. APPOINTMENT vs CAT_PLACE CONSISTENCY
-- ============================================================================

\echo ''
\echo '6. Appointment vs Cat-Place Consistency'
\echo '----------------------------------------'

-- For each cat, compare most recent appointment's inferred_place_id to cat_place links
WITH cat_latest_appointment AS (
  SELECT DISTINCT ON (a.cat_id)
    a.cat_id,
    a.inferred_place_id as appt_place,
    a.appointment_date
  FROM ops.appointments a
  WHERE a.cat_id IS NOT NULL
    AND a.inferred_place_id IS NOT NULL
  ORDER BY a.cat_id, a.appointment_date DESC
),
cat_home_links AS (
  SELECT DISTINCT ON (cp.cat_id)
    cp.cat_id,
    cp.place_id as linked_place
  FROM sot.cat_place cp
  WHERE cp.relationship_type = 'home'
  ORDER BY cp.cat_id, cp.confidence DESC
)
SELECT
  COUNT(*) as cats_checked,
  COUNT(*) FILTER (WHERE cla.appt_place = chl.linked_place) as matching,
  COUNT(*) FILTER (WHERE cla.appt_place != chl.linked_place) as mismatched,
  COUNT(*) FILTER (WHERE chl.linked_place IS NULL) as missing_home_link,
  ROUND(100.0 * COUNT(*) FILTER (WHERE cla.appt_place = chl.linked_place) / NULLIF(COUNT(*), 0), 1) as match_pct
FROM cat_latest_appointment cla
LEFT JOIN cat_home_links chl ON chl.cat_id = cla.cat_id;

-- ============================================================================
-- 7. PERSON-CHAIN vs APPOINTMENT-BASED LINK CONFLICT
-- ============================================================================

\echo ''
\echo '7. Person-Chain vs Appointment Link Conflicts'
\echo '----------------------------------------------'

-- Find cats with both appointment-based and person-chain links to DIFFERENT places
WITH cat_link_sources AS (
  SELECT
    cat_id,
    place_id,
    source_table,
    relationship_type
  FROM sot.cat_place
  WHERE source_table IN ('link_cats_to_appointment_places', 'link_cats_to_places')
)
SELECT
  COUNT(DISTINCT appt.cat_id) as cats_with_conflicts
FROM cat_link_sources appt
JOIN cat_link_sources person ON person.cat_id = appt.cat_id
  AND appt.source_table = 'link_cats_to_appointment_places'
  AND person.source_table = 'link_cats_to_places'
  AND appt.place_id != person.place_id;

-- Show sample conflicts
\echo ''
\echo '   Sample conflicts (first 10):'

SELECT
  c.name as cat_name,
  c.microchip,
  appt.place_id as appt_place_id,
  p1.display_name as appt_place_name,
  person.place_id as person_place_id,
  p2.display_name as person_place_name
FROM sot.cat_place appt
JOIN sot.cat_place person ON person.cat_id = appt.cat_id
  AND appt.source_table = 'link_cats_to_appointment_places'
  AND person.source_table = 'link_cats_to_places'
  AND appt.place_id != person.place_id
JOIN sot.cats c ON c.cat_id = appt.cat_id
JOIN sot.places p1 ON p1.place_id = appt.place_id
JOIN sot.places p2 ON p2.place_id = person.place_id
LIMIT 10;

-- ============================================================================
-- 8. FRAGILE FUNCTION INDICATORS
-- ============================================================================

\echo ''
\echo '8. Fragile Function Indicators'
\echo '-------------------------------'

-- Check for NULLs in critical fields that could cause silent failures
\echo '   Appointments with NULL resolved_person_id but have owner_email:'
SELECT COUNT(*) as count
FROM ops.appointments
WHERE resolved_person_id IS NULL
  AND owner_email IS NOT NULL
  AND owner_email NOT LIKE '%noemail%'
  AND owner_email NOT LIKE '%forgottenfelines%';

\echo ''
\echo '   Person-place records with NULL confidence:'
SELECT COUNT(*) as count
FROM sot.person_place
WHERE confidence IS NULL;

\echo ''
\echo '   Cat-place records with source_table = NULL:'
SELECT COUNT(*) as count
FROM sot.cat_place
WHERE source_table IS NULL;

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  AUDIT COMPLETE'
\echo '=============================================='
\echo ''
\echo 'Key metrics to monitor:'
\echo '  - Cats with appointments but no place links'
\echo '  - Clinic place leakage (cats linked to 1814/1820 Empire Industrial)'
\echo '  - Appointment vs cat_place consistency percentage'
\echo '  - Person-chain vs appointment link conflicts'
\echo ''
