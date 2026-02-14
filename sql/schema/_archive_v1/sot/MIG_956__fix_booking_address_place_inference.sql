\echo ''
\echo '=============================================='
\echo 'MIG_956: Fix Booking Address Place Inference'
\echo '=============================================='
\echo ''
\echo 'Problem: Appointments are inferred to person_place (home address) instead of'
\echo 'booking_address (colony site). This happens because Step 0 only runs on'
\echo 'appointments with inferred_place_id IS NULL, but Step 2 (person_place) already'
\echo 'set it during a previous run.'
\echo ''
\echo 'Solution: Identify appointments where booking address would match a different'
\echo 'place than currently inferred, clear their inferred_place_id, and re-run.'
\echo ''

-- ============================================================================
-- PART 1: Identify and fix mis-inferred appointments
-- ============================================================================

\echo '1. Identifying appointments where booking address matches a different place...'

-- First, let's see what we're about to fix
SELECT
  a.client_address,
  current_place.formatted_address as currently_inferred_to,
  correct_place.formatted_address as should_be_inferred_to,
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
LEFT JOIN trapper.places current_place ON
  current_place.place_id = a.inferred_place_id
WHERE a.inferred_place_id IS NOT NULL
  AND a.inferred_place_id != correct_place.place_id
  AND a.inferred_place_source = 'person_place'  -- Only fix person_place inferences
GROUP BY a.client_address, current_place.formatted_address, correct_place.formatted_address
ORDER BY COUNT(*) DESC
LIMIT 20;

\echo ''
\echo '2. Clearing inferred_place_id for mis-inferred appointments...'

-- Clear inferred_place_id where booking address would match a different (correct) place
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
    AND a.inferred_place_source = 'person_place'
)
UPDATE trapper.sot_appointments a
SET
  inferred_place_id = NULL,
  inferred_place_source = NULL
FROM mis_inferred m
WHERE a.appointment_id = m.appointment_id;

\echo 'Cleared inferred_place_id for appointments that will be re-matched.'

-- ============================================================================
-- PART 2: Re-run place inference (Step 0 will now match booking addresses)
-- ============================================================================

\echo ''
\echo '3. Re-running infer_appointment_places() to apply correct booking address matches...'

SELECT * FROM trapper.infer_appointment_places();

-- ============================================================================
-- PART 3: Re-run cat-place linking for affected appointments
-- ============================================================================

\echo ''
\echo '4. Re-running cat-place linking for appointments that were re-inferred...'

-- First, remove stale cat-place relationships that came from the wrong inferred places
-- We'll only remove links that came from appointment-based linking, not verified data
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

\echo 'Removed stale cat-place links that pointed to wrong places.'

-- Now re-run cat linking
\echo ''
\echo '5. Running link_cats_to_appointment_places()...'

SELECT * FROM trapper.link_cats_to_appointment_places();

-- ============================================================================
-- PART 4: Verification
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'
\echo ''
\echo 'Walker Rd places and linked cats after fix:'

SELECT
  p.formatted_address,
  COUNT(DISTINCT cpr.cat_id) as linked_cats
FROM trapper.places p
LEFT JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
WHERE p.formatted_address ILIKE '%Walker Rd%' AND p.formatted_address ILIKE '%Petaluma%'
  AND p.merged_into_place_id IS NULL
GROUP BY p.formatted_address
ORDER BY p.formatted_address;

\echo ''
\echo 'Appointments by inferred_place_source for Walker Rd:'

SELECT
  inferred_place_source,
  COUNT(*) as appointments
FROM trapper.sot_appointments
WHERE client_address ILIKE '%Walker%'
GROUP BY inferred_place_source
ORDER BY COUNT(*) DESC;

\echo ''
\echo '=============================================='
\echo 'MIG_956 Complete!'
\echo '=============================================='
\echo ''
