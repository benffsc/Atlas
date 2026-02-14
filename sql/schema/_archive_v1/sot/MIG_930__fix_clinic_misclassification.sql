-- ============================================================================
-- MIG_930: Fix Clinic Misclassification (DATA_GAP_019)
-- ============================================================================
-- Problem: 1,335 places incorrectly marked with place_kind = 'clinic'
--          These are residential addresses where cat owners live, not clinics.
--
-- Root Cause: MIG_464 inferred "clinic" from places with 5+ appointments,
--             but appointments link to owner addresses, not clinic location.
--
-- Solution:
--   1. Create whitelist of actual clinic addresses
--   2. Clear place_kind = 'clinic' from non-whitelisted places
--   3. End erroneous clinic contexts
-- ============================================================================

\echo '=== MIG_930: Fix Clinic Misclassification ==='
\echo ''

-- ============================================================================
-- Phase 1: Create known_clinic_addresses whitelist
-- ============================================================================

\echo 'Phase 1: Creating known clinic addresses whitelist...'

CREATE TABLE IF NOT EXISTS trapper.known_clinic_addresses (
  id SERIAL PRIMARY KEY,
  address_pattern TEXT NOT NULL UNIQUE,
  clinic_name TEXT NOT NULL,
  place_id UUID REFERENCES trapper.places(place_id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.known_clinic_addresses IS
'Whitelist of actual veterinary clinic addresses.
Only places matching these patterns should have place_kind = clinic.
Used by MIG_930 to fix clinic misclassification (DATA_GAP_019).';

-- Insert known clinics
INSERT INTO trapper.known_clinic_addresses (address_pattern, clinic_name, notes) VALUES
  ('845 Todd Road%', 'FFSC Clinic', 'Main Forgotten Felines clinic'),
  ('845 Todd Rd%', 'FFSC Clinic', 'Alternative format'),
  ('845 Todd%Santa Rosa%', 'FFSC Clinic', 'Full address format')
ON CONFLICT (address_pattern) DO NOTHING;

SELECT 'Known clinic addresses:' as info, COUNT(*) as count
FROM trapper.known_clinic_addresses;

-- ============================================================================
-- Phase 2: Count before cleanup
-- ============================================================================

\echo ''
\echo 'Phase 2: Counting current clinic classifications...'

SELECT 'Before cleanup - places with place_kind = clinic:' as info,
       COUNT(*) as count
FROM trapper.places
WHERE place_kind = 'clinic'
  AND merged_into_place_id IS NULL;

SELECT 'Before cleanup - active clinic contexts:' as info,
       COUNT(*) as count
FROM trapper.place_contexts
WHERE context_type = 'clinic'
  AND valid_to IS NULL;

-- ============================================================================
-- Phase 3: Clear erroneous clinic place_kind
-- ============================================================================

\echo ''
\echo 'Phase 3: Clearing erroneous clinic place_kind...'

WITH clinics_to_fix AS (
  SELECT p.place_id, p.formatted_address
  FROM trapper.places p
  WHERE p.place_kind = 'clinic'
    AND NOT EXISTS (
      SELECT 1 FROM trapper.known_clinic_addresses kca
      WHERE p.formatted_address ILIKE kca.address_pattern
    )
)
UPDATE trapper.places p
SET place_kind = 'unknown'
FROM clinics_to_fix ctf
WHERE p.place_id = ctf.place_id;

SELECT 'Places fixed (place_kind cleared):' as info,
       (SELECT COUNT(*) FROM trapper.places
        WHERE place_kind = 'clinic' AND merged_into_place_id IS NULL) as remaining_clinics;

-- ============================================================================
-- Phase 4: End erroneous clinic contexts
-- ============================================================================

\echo ''
\echo 'Phase 4: Ending erroneous clinic contexts...'

WITH contexts_to_end AS (
  SELECT pc.context_id
  FROM trapper.place_contexts pc
  JOIN trapper.places p ON p.place_id = pc.place_id
  WHERE pc.context_type = 'clinic'
    AND pc.valid_to IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM trapper.known_clinic_addresses kca
      WHERE p.formatted_address ILIKE kca.address_pattern
    )
)
UPDATE trapper.place_contexts pc
SET valid_to = CURRENT_DATE,
    evidence_notes = COALESCE(evidence_notes || ' | ', '') || 'MIG_930: DATA_GAP_019 cleanup'
FROM contexts_to_end cte
WHERE pc.context_id = cte.context_id;

SELECT 'Clinic contexts ended:' as info,
       COUNT(*) as count
FROM trapper.place_contexts
WHERE context_type = 'clinic'
  AND evidence_notes LIKE '%MIG_930%';

-- ============================================================================
-- Phase 5: Verify actual clinics still have clinic kind
-- ============================================================================

\echo ''
\echo 'Phase 5: Ensuring actual clinics have proper classification...'

-- Update actual clinic places to have clinic kind
UPDATE trapper.places p
SET place_kind = 'clinic'
FROM trapper.known_clinic_addresses kca
WHERE p.formatted_address ILIKE kca.address_pattern
  AND p.place_kind != 'clinic';

-- Link clinic place_ids to whitelist
UPDATE trapper.known_clinic_addresses kca
SET place_id = p.place_id
FROM trapper.places p
WHERE p.formatted_address ILIKE kca.address_pattern
  AND kca.place_id IS NULL;

-- ============================================================================
-- Phase 6: Create helper view for future clinic identification
-- ============================================================================

\echo ''
\echo 'Phase 6: Creating clinic verification view...'

CREATE OR REPLACE VIEW trapper.v_clinic_places AS
SELECT
  p.place_id,
  p.formatted_address,
  p.place_kind,
  kca.clinic_name,
  kca.notes as clinic_notes,
  CASE WHEN kca.id IS NOT NULL THEN TRUE ELSE FALSE END as is_known_clinic
FROM trapper.places p
LEFT JOIN trapper.known_clinic_addresses kca
  ON p.formatted_address ILIKE kca.address_pattern
WHERE p.place_kind = 'clinic' OR kca.id IS NOT NULL;

COMMENT ON VIEW trapper.v_clinic_places IS
'Shows places classified as clinics and verifies they are in the whitelist.
Any row with is_known_clinic = FALSE should be investigated.';

-- ============================================================================
-- Verification
-- ============================================================================

\echo ''
\echo 'Final verification:'

SELECT 'After cleanup - places with place_kind = clinic:' as info,
       COUNT(*) as count
FROM trapper.places
WHERE place_kind = 'clinic'
  AND merged_into_place_id IS NULL;

SELECT 'After cleanup - active clinic contexts:' as info,
       COUNT(*) as count
FROM trapper.place_contexts
WHERE context_type = 'clinic'
  AND valid_to IS NULL;

SELECT 'Clinic places:' as header;
SELECT place_id, formatted_address, clinic_name, is_known_clinic
FROM trapper.v_clinic_places;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_930 Complete!'
\echo '=============================================='
\echo ''
\echo 'DATA_GAP_019: Clinic Misclassification - FIXED'
\echo ''
\echo 'Changes made:'
\echo '  1. Created known_clinic_addresses whitelist table'
\echo '  2. Cleared place_kind = clinic from non-whitelisted places'
\echo '  3. Ended erroneous clinic contexts'
\echo '  4. Created v_clinic_places verification view'
\echo ''
\echo 'Only actual clinics (845 Todd Road) now have clinic classification.'
\echo ''
