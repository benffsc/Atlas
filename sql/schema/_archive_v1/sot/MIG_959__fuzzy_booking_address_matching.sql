\echo ''
\echo '=============================================================================='
\echo 'MIG_959: Fuzzy Booking Address Matching for Remaining Gaps'
\echo '=============================================================================='
\echo ''
\echo 'Problem: 458 appointments have booking addresses that dont exactly match'
\echo 'any place due to minor variations:'
\echo '  - "1814 Empire Industrial Ct" vs "1814 Empire Industrial Court"'
\echo '  - Missing/extra suffixes (Sonoma, USA, Suite numbers)'
\echo '  - Slight zip code differences'
\echo ''

-- ============================================================================
-- PART 1: Fix appointments where street number + name matches a place
-- ============================================================================

\echo '1. Identifying appointments that can be matched via street number + name...'

-- Create a temp table with fuzzy matches
CREATE TEMP TABLE fuzzy_matches AS
WITH mismatched AS (
  SELECT DISTINCT
    a.appointment_id,
    a.client_address,
    -- Extract street number and name (first part before comma)
    SPLIT_PART(a.client_address, ',', 1) as street_part
  FROM trapper.sot_appointments a
  JOIN trapper.places p ON p.place_id = a.inferred_place_id
  WHERE a.client_address IS NOT NULL
    AND LENGTH(TRIM(a.client_address)) > 10
    AND trapper.normalize_address(a.client_address) != p.normalized_address
)
SELECT
  m.appointment_id,
  m.client_address,
  m.street_part,
  p.place_id as correct_place_id,
  p.formatted_address as correct_place_address
FROM mismatched m
JOIN trapper.places p ON
  p.formatted_address ILIKE m.street_part || '%'
  AND p.merged_into_place_id IS NULL
  -- Ensure same city by checking the city part matches
  AND (
    LOWER(SPLIT_PART(p.formatted_address, ',', 2)) LIKE '%' || LOWER(TRIM(SPLIT_PART(m.client_address, ',', 2))) || '%'
    OR LOWER(SPLIT_PART(m.client_address, ',', 2)) LIKE '%' || LOWER(TRIM(SPLIT_PART(p.formatted_address, ',', 2))) || '%'
  );

\echo ''
\echo 'Fuzzy matches found:'
SELECT
  client_address,
  correct_place_address,
  COUNT(*) as appointments
FROM fuzzy_matches
GROUP BY client_address, correct_place_address
ORDER BY COUNT(*) DESC
LIMIT 15;

-- ============================================================================
-- PART 2: Update appointments with fuzzy matches
-- ============================================================================

\echo ''
\echo '2. Updating appointments with fuzzy matches...'

UPDATE trapper.sot_appointments a
SET
  inferred_place_id = fm.correct_place_id,
  inferred_place_source = 'booking_address_fuzzy'
FROM fuzzy_matches fm
WHERE a.appointment_id = fm.appointment_id;

\echo ''
\echo '3. Re-running cat-place linking for updated appointments...'

-- Remove stale links and re-link
WITH cats_to_relink AS (
  SELECT DISTINCT a.cat_id, a.inferred_place_id
  FROM trapper.sot_appointments a
  WHERE a.inferred_place_source = 'booking_address_fuzzy'
    AND a.cat_id IS NOT NULL
    AND a.inferred_place_id IS NOT NULL
)
DELETE FROM trapper.cat_place_relationships cpr
USING cats_to_relink c
WHERE cpr.cat_id = c.cat_id
  AND cpr.place_id != c.inferred_place_id
  AND cpr.relationship_type = 'appointment_site'
  AND cpr.source_system = 'clinichq';

SELECT * FROM trapper.link_cats_to_appointment_places();

-- ============================================================================
-- PART 3: Verification
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Remaining true mismatches after fuzzy matching:'
SELECT COUNT(*) as remaining_true_mismatches
FROM trapper.sot_appointments a
JOIN trapper.places p ON p.place_id = a.inferred_place_id
WHERE a.client_address IS NOT NULL
  AND LENGTH(TRIM(a.client_address)) > 10
  AND trapper.normalize_address(a.client_address) != p.normalized_address
  AND a.inferred_place_source != 'booking_address_fuzzy';

\echo ''
\echo 'Distribution by inferred_place_source (after fix):'
SELECT
  inferred_place_source,
  COUNT(*) as appointments
FROM trapper.sot_appointments
WHERE inferred_place_id IS NOT NULL
GROUP BY inferred_place_source
ORDER BY COUNT(*) DESC;

DROP TABLE fuzzy_matches;

\echo ''
\echo '=============================================================================='
\echo 'MIG_959 Complete!'
\echo '=============================================================================='
\echo ''
