-- MIG_2305: Fix Cat-Place Relationship Type Semantic Confusion
-- Date: 2026-02-14
--
-- Problem: link_cats_to_appointment_places() creates 'appointment_site' relationships
-- using inferred_place_id, but inferred_place_id IS the owner's home address, NOT the
-- clinic where the appointment happened.
--
-- Result: 30,324 cats have 'appointment_site' relationships to residential addresses,
-- but only 2,626 have 'home' relationships. Disease computation correctly filters to
-- residential types, so it only finds 12 places instead of the expected ~20+.
--
-- Root cause:
--   - appointments.inferred_place_id = owner's residential address (where cat lives)
--   - 'appointment_site' should mean the CLINIC (1814/1820 Empire Industrial)
--   - The function was mislabeling residential addresses as appointment sites
--
-- Fix:
--   1. Update existing appointment_site records to 'home' WHERE the place matches
--      the owner's residential address from person_place
--   2. Update link_cats_to_appointment_places() to use 'home' relationship type
--      since inferred_place_id IS the owner's home

\echo ''
\echo '=============================================='
\echo '  MIG_2305: Fix Cat-Place Relationship Types'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. ANALYZE CURRENT STATE
-- ============================================================================

\echo '1. Current relationship type distribution:'
SELECT relationship_type, COUNT(*) as records
FROM sot.cat_place
GROUP BY relationship_type
ORDER BY records DESC;

\echo ''
\echo '2. Positive cats by relationship type (before fix):'
SELECT
  cp.relationship_type,
  COUNT(DISTINCT tr.cat_id) as positive_cats,
  COUNT(DISTINCT cp.place_id) as unique_places
FROM ops.cat_test_results tr
JOIN sot.cat_place cp ON cp.cat_id = tr.cat_id
WHERE tr.result = 'positive'
GROUP BY cp.relationship_type
ORDER BY positive_cats DESC;

-- ============================================================================
-- 2. UPDATE EXISTING appointment_site TO home WHERE APPROPRIATE
-- ============================================================================

\echo ''
\echo '3. Updating appointment_site to home where place matches owner residence...'

-- Create a temp table to track what we're updating
CREATE TEMP TABLE cat_place_updates AS
WITH appointment_site_records AS (
  SELECT cp.cat_id, cp.place_id
  FROM sot.cat_place cp
  WHERE cp.relationship_type = 'appointment_site'
),
owner_residential_places AS (
  -- Get places where the cat's owner lives
  SELECT DISTINCT
    pc.cat_id,
    pp.place_id
  FROM sot.person_cat pc
  JOIN sot.person_place pp ON pp.person_id = pc.person_id
    AND pp.relationship_type IN ('resident', 'owner', 'requester')
  WHERE pc.relationship_type IN ('owner', 'adopter', 'caretaker', 'foster', 'colony_caretaker')
)
SELECT asr.cat_id, asr.place_id
FROM appointment_site_records asr
JOIN owner_residential_places orp
  ON asr.cat_id = orp.cat_id AND asr.place_id = orp.place_id;

-- Count before update
SELECT COUNT(*) as records_to_update FROM cat_place_updates;

-- Update the relationship type
UPDATE sot.cat_place cp
SET relationship_type = 'home',
    updated_at = NOW()
FROM cat_place_updates u
WHERE cp.cat_id = u.cat_id
  AND cp.place_id = u.place_id
  AND cp.relationship_type = 'appointment_site';

\echo '   Updated relationship types to home'

-- ============================================================================
-- 3. UPDATE THE FUNCTION TO USE CORRECT SEMANTICS
-- ============================================================================

\echo ''
\echo '4. Updating link_cats_to_appointment_places() to use correct relationship type...'

-- The function should create 'home' relationships since inferred_place_id IS the owner's home
CREATE OR REPLACE FUNCTION sot.link_cats_to_appointment_places()
RETURNS TABLE(cats_linked integer)
LANGUAGE plpgsql AS $function$
DECLARE
    v_total INT := 0;
    v_result UUID;
    v_cat_id UUID;
    v_place_id UUID;
BEGIN
    -- Link cats to places using the pre-computed inferred_place_id from appointments.
    -- IMPORTANT: inferred_place_id is the OWNER'S HOME ADDRESS, not the clinic.
    -- This creates 'home' relationships because:
    -- 1. inferred_place_id comes from geocoding the owner's address on the appointment
    -- 2. It represents WHERE THE CAT LIVES, not where it was tested
    -- 3. The clinic (1814/1820 Empire Industrial) is where appointments HAPPEN,
    --    but inferred_place_id points to the residential pickup/return location

    FOR v_cat_id, v_place_id IN
        WITH appointment_places AS (
            SELECT DISTINCT ON (a.cat_id)
                a.cat_id,
                COALESCE(a.inferred_place_id, a.place_id) AS place_id
            FROM ops.appointments a
            WHERE a.cat_id IS NOT NULL
              AND COALESCE(a.inferred_place_id, a.place_id) IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM sot.cats sc
                  WHERE sc.cat_id = a.cat_id AND sc.merged_into_cat_id IS NULL
              )
              -- V2: Exclude clinic/blacklisted places
              AND sot.should_compute_disease_for_place(COALESCE(a.inferred_place_id, a.place_id))
            ORDER BY a.cat_id, a.appointment_date DESC  -- most recent appointment wins
        )
        SELECT ap.cat_id, ap.place_id
        FROM appointment_places ap
        JOIN sot.places pl ON pl.place_id = ap.place_id
          AND pl.merged_into_place_id IS NULL
        WHERE NOT EXISTS (
            SELECT 1 FROM sot.cat_place cp
            WHERE cp.cat_id = ap.cat_id
              AND cp.place_id = ap.place_id
              -- Only skip if same relationship type exists
              AND cp.relationship_type = 'home'
        )
    LOOP
        v_result := sot.link_cat_to_place(
            p_cat_id := v_cat_id,
            p_place_id := v_place_id,
            -- FIX: Use 'home' since inferred_place_id IS the owner's residential address
            p_relationship_type := 'home',
            p_evidence_type := 'appointment',
            p_source_system := 'atlas',
            p_source_table := 'link_cats_to_appointment_places',
            p_confidence := 'high'
        );
        IF v_result IS NOT NULL THEN
            v_total := v_total + 1;
        END IF;
    END LOOP;

    cats_linked := v_total;
    RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION sot.link_cats_to_appointment_places IS
'Links cats to residential places using inferred_place_id from appointments.
FIX (MIG_2305): Creates ''home'' relationships (not ''appointment_site'') because
inferred_place_id IS the owner''s home address, not the clinic.';

-- ============================================================================
-- 4. RE-RUN DISEASE COMPUTATION
-- ============================================================================

\echo ''
\echo '5. Re-running disease computation with fixed relationship types...'

-- Refresh the disease computation now that we have proper home relationships
SELECT ops.compute_place_disease_status();

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Relationship type distribution (after fix):'
SELECT relationship_type, COUNT(*) as records
FROM sot.cat_place
GROUP BY relationship_type
ORDER BY records DESC;

\echo ''
\echo 'Positive cats by relationship type (after fix):'
SELECT
  cp.relationship_type,
  COUNT(DISTINCT tr.cat_id) as positive_cats,
  COUNT(DISTINCT cp.place_id) as unique_places
FROM ops.cat_test_results tr
JOIN sot.cat_place cp ON cp.cat_id = tr.cat_id
WHERE tr.result = 'positive'
GROUP BY cp.relationship_type
ORDER BY positive_cats DESC;

\echo ''
\echo 'Disease status count (after fix):'
SELECT
  status,
  COUNT(*) as places,
  SUM(positive_cat_count) as total_positive_cats
FROM ops.place_disease_status
GROUP BY status
ORDER BY places DESC;

\echo ''
\echo 'Sample disease locations:'
SELECT
  p.display_name,
  pds.disease_type_key,
  pds.status,
  pds.positive_cat_count
FROM ops.place_disease_status pds
JOIN sot.places p ON p.place_id = pds.place_id
WHERE pds.status = 'confirmed_active'
ORDER BY pds.positive_cat_count DESC
LIMIT 10;

\echo ''
\echo '=============================================='
\echo '  MIG_2305 Complete!'
\echo '=============================================='
\echo ''
\echo 'Fixed:'
\echo '  - Updated appointment_site relationships to home where place matches owner residence'
\echo '  - Fixed link_cats_to_appointment_places() to use home relationship type'
\echo '  - Re-ran disease computation with corrected relationship types'
\echo ''

DROP TABLE IF EXISTS cat_place_updates;
