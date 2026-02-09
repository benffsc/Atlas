\echo ''
\echo '=============================================================================='
\echo 'MIG_958: Comprehensive Booking Address Fix (All Source Types)'
\echo '=============================================================================='
\echo ''
\echo 'Problem: MIG_956 only fixed person_place inferences. There are still 242'
\echo 'appointments linked via org_mapping, owner_account, etc. that should be at'
\echo 'their booking address instead.'
\echo ''
\echo 'Examples:'
\echo '  - 2776 Sullivan Road → wrongly at 165 Gold Ridge Rd (org_mapping)'
\echo '  - 137 Marine View Dr → wrongly at 4000 Dillon Beach Rd (org_mapping)'
\echo ''
\echo 'Solution: Clear ALL mis-inferred appointments (regardless of source) and re-run.'
\echo ''

-- ============================================================================
-- PART 1: Show what we're fixing
-- ============================================================================

\echo '1. Appointments by source that will be fixed:'

SELECT
  a.inferred_place_source,
  COUNT(*) as appointments
FROM trapper.sot_appointments a
JOIN trapper.staged_records sr ON
  sr.source_system = 'clinichq'
  AND sr.source_table = 'owner_info'
  AND sr.payload->>'Number' = a.appointment_number
  AND LENGTH(TRIM(COALESCE(sr.payload->>'Owner Address', ''))) > 10
JOIN trapper.places correct_place ON
  correct_place.normalized_address = trapper.normalize_address(sr.payload->>'Owner Address')
  AND correct_place.merged_into_place_id IS NULL
WHERE a.inferred_place_id IS NOT NULL
  AND a.inferred_place_id != correct_place.place_id
GROUP BY a.inferred_place_source
ORDER BY COUNT(*) DESC;

-- ============================================================================
-- PART 2: Clear ALL mis-inferred appointments (any source)
-- ============================================================================

\echo ''
\echo '2. Clearing inferred_place_id for ALL mis-inferred appointments...'

WITH mis_inferred AS (
  SELECT DISTINCT a.appointment_id, correct_place.place_id as correct_place_id
  FROM trapper.sot_appointments a
  JOIN trapper.staged_records sr ON
    sr.source_system = 'clinichq'
    AND sr.source_table = 'owner_info'
    AND sr.payload->>'Number' = a.appointment_number
    AND LENGTH(TRIM(COALESCE(sr.payload->>'Owner Address', ''))) > 10
  JOIN trapper.places correct_place ON
    correct_place.normalized_address = trapper.normalize_address(sr.payload->>'Owner Address')
    AND correct_place.merged_into_place_id IS NULL
  WHERE a.inferred_place_id IS NOT NULL
    AND a.inferred_place_id != correct_place.place_id
    -- Fix ALL source types, not just person_place
)
UPDATE trapper.sot_appointments a
SET
  inferred_place_id = NULL,
  inferred_place_source = NULL
FROM mis_inferred m
WHERE a.appointment_id = m.appointment_id;

\echo 'Cleared inferred_place_id for all mis-inferred appointments.'

-- ============================================================================
-- PART 3: Re-run place inference (booking_address will now be matched)
-- ============================================================================

\echo ''
\echo '3. Re-running infer_appointment_places()...'

SELECT * FROM trapper.infer_appointment_places();

-- ============================================================================
-- PART 4: Re-run cat-place linking
-- ============================================================================

\echo ''
\echo '4. Re-running cat-place linking...'

-- Remove stale cat-place links from appointments we just fixed
WITH cats_to_relink AS (
  SELECT DISTINCT a.cat_id, a.inferred_place_id
  FROM trapper.sot_appointments a
  WHERE a.inferred_place_source = 'booking_address'
    AND a.cat_id IS NOT NULL
    AND a.inferred_place_id IS NOT NULL
)
DELETE FROM trapper.cat_place_relationships cpr
USING cats_to_relink c
WHERE cpr.cat_id = c.cat_id
  AND cpr.place_id != c.inferred_place_id
  AND cpr.relationship_type = 'appointment_site'
  AND cpr.source_system = 'clinichq';

\echo '5. Running link_cats_to_appointment_places()...'

SELECT * FROM trapper.link_cats_to_appointment_places();

-- ============================================================================
-- PART 5: Verification
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'
\echo ''
\echo 'Remaining mis-inferred appointments (should be 0 or very low):'

SELECT COUNT(*) as remaining_mis_inferred
FROM trapper.sot_appointments a
JOIN trapper.staged_records sr ON
  sr.source_system = 'clinichq'
  AND sr.source_table = 'owner_info'
  AND sr.payload->>'Number' = a.appointment_number
  AND LENGTH(TRIM(COALESCE(sr.payload->>'Owner Address', ''))) > 10
JOIN trapper.places correct_place ON
  correct_place.normalized_address = trapper.normalize_address(sr.payload->>'Owner Address')
  AND correct_place.merged_into_place_id IS NULL
WHERE a.inferred_place_id IS NOT NULL
  AND a.inferred_place_id != correct_place.place_id;

\echo ''
\echo 'Distribution by inferred_place_source (after fix):'

SELECT
  inferred_place_source,
  COUNT(*) as appointments
FROM trapper.sot_appointments
WHERE inferred_place_id IS NOT NULL
GROUP BY inferred_place_source
ORDER BY COUNT(*) DESC;

\echo ''
\echo '=============================================================================='
\echo 'MIG_958 Complete!'
\echo '=============================================================================='
\echo ''
