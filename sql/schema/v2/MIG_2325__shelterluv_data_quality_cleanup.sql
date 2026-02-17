-- ============================================================================
-- MIG_2325: ShelterLuv Data Quality Cleanup
-- ============================================================================
-- Issue: 473 ShelterLuv cats without microchips have:
--   - No appointments (never came to clinic)
--   - No person links
--   - Low FFSC-A IDs (old records from 1106-27952)
--   - Not in current ShelterLuv API (likely deleted/archived)
--
-- Many have junk patterns in names:
--   - "Unknown", "Test Cat", "To Dogwood"
--   - Breed descriptions: "DSH Brown tabby w/ white Male"
--   - Addresses as names: "111 Sebastopol Road"
--   - Procedures in names: "Angela Tejada dental"
--
-- This migration marks:
--   - Clear garbage → data_quality = 'garbage'
--   - Ambiguous records → data_quality = 'needs_review'
--
-- Usage: psql -f MIG_2325__shelterluv_data_quality_cleanup.sql
-- ============================================================================

\echo '=== MIG_2325: ShelterLuv Data Quality Cleanup ==='
\echo ''

BEGIN;

-- ============================================================================
-- Phase 1: Mark clear garbage
-- ============================================================================

\echo 'Phase 1: Marking clear garbage records...'

UPDATE sot.cats
SET
    data_quality = 'garbage',
    updated_at = NOW()
WHERE source_system = 'shelterluv'
  AND merged_into_cat_id IS NULL
  AND microchip IS NULL
  AND (
    -- Unknown/unnamed
    name = 'Unknown' OR name ILIKE 'Unnamed%'
    -- Test cats
    OR name ILIKE 'Test%Cat%' OR name ILIKE 'Test %'
    -- Transfer destinations (not actual cats)
    OR name ILIKE 'To %' OR name ILIKE 'Transfer%'
    -- Addresses used as names
    OR name ~ '^\d+\s.*(Rd|Road|St|Street|Ave|Avenue|Ln|Lane|Dr|Drive|Way|Ct|Court)'
  )
  -- Only if no appointments (never came to clinic)
  AND NOT EXISTS (
    SELECT 1 FROM ops.appointments a WHERE a.cat_id = cats.cat_id
  );

-- ============================================================================
-- Phase 2: Mark needs_review records
-- ============================================================================

\echo ''
\echo 'Phase 2: Marking needs_review records...'

UPDATE sot.cats
SET
    data_quality = 'needs_review',
    updated_at = NOW()
WHERE source_system = 'shelterluv'
  AND merged_into_cat_id IS NULL
  AND microchip IS NULL
  AND data_quality NOT IN ('garbage')
  AND (
    -- Breed descriptions used as names
    name ILIKE 'DSH %' OR name ILIKE 'DMH %' OR name ILIKE 'DLH %'
    -- Procedure/medical info in name
    OR name ILIKE '%dental%' OR name ILIKE '%enucleation%'
    OR name ILIKE '%amputation%' OR name ILIKE '%injury%' OR name ILIKE '%abscess%'
    OR name ILIKE '%pinnectomy%'
    -- Status descriptors
    OR name ILIKE '%abandoned%' OR name ILIKE '%lost%' OR name ILIKE '%stray%'
    -- Owner name appended pattern: "Name" Lastname
    OR (name ~ '^"[^"]+"\s+[A-Z]' AND LENGTH(name) > 20)
  )
  -- Only if no appointments
  AND NOT EXISTS (
    SELECT 1 FROM ops.appointments a WHERE a.cat_id = cats.cat_id
  );

-- ============================================================================
-- Phase 3: Mark remaining orphan ShelterLuv cats as needs_review
-- ============================================================================

\echo ''
\echo 'Phase 3: Marking remaining orphan ShelterLuv cats...'

-- Cats with no microchip, no appointments, no person links = orphan data
UPDATE sot.cats
SET
    data_quality = 'needs_review',
    updated_at = NOW()
WHERE source_system = 'shelterluv'
  AND merged_into_cat_id IS NULL
  AND microchip IS NULL
  AND data_quality NOT IN ('garbage', 'needs_review')
  -- No appointments
  AND NOT EXISTS (
    SELECT 1 FROM ops.appointments a WHERE a.cat_id = cats.cat_id
  )
  -- No person links
  AND NOT EXISTS (
    SELECT 1 FROM sot.person_cat pc WHERE pc.cat_id = cats.cat_id
  )
  -- Not in current ShelterLuv API (old sl_animal_ format)
  AND shelterluv_animal_id LIKE 'sl_animal_%';

-- ============================================================================
-- Phase 4: Verification
-- ============================================================================

\echo ''
\echo 'Phase 4: Verification...'

DO $$
DECLARE
    v_garbage INTEGER;
    v_needs_review INTEGER;
    v_active INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_garbage
    FROM sot.cats
    WHERE source_system = 'shelterluv' AND merged_into_cat_id IS NULL AND data_quality = 'garbage';

    SELECT COUNT(*) INTO v_needs_review
    FROM sot.cats
    WHERE source_system = 'shelterluv' AND merged_into_cat_id IS NULL AND data_quality = 'needs_review';

    SELECT COUNT(*) INTO v_active
    FROM sot.cats
    WHERE source_system = 'shelterluv' AND merged_into_cat_id IS NULL
      AND COALESCE(data_quality, 'good') NOT IN ('garbage', 'needs_review');

    RAISE NOTICE '=== MIG_2325 Verification ===';
    RAISE NOTICE 'ShelterLuv cats marked garbage: %', v_garbage;
    RAISE NOTICE 'ShelterLuv cats marked needs_review: %', v_needs_review;
    RAISE NOTICE 'ShelterLuv cats active (good quality): %', v_active;
END;
$$;

\echo ''
\echo 'Sample garbage records:'
SELECT cat_id, name, data_quality
FROM sot.cats
WHERE source_system = 'shelterluv' AND data_quality = 'garbage'
LIMIT 5;

\echo ''
\echo 'Sample needs_review records:'
SELECT cat_id, name, data_quality
FROM sot.cats
WHERE source_system = 'shelterluv' AND data_quality = 'needs_review'
LIMIT 5;

COMMIT;

\echo ''
\echo '=============================================='
\echo 'MIG_2325 Complete!'
\echo '=============================================='
\echo ''
\echo 'Records marked as garbage:'
\echo '  - Unknown/Unnamed cats'
\echo '  - Test cats'
\echo '  - Transfer destinations (not actual cats)'
\echo '  - Addresses used as cat names'
\echo ''
\echo 'Records marked as needs_review:'
\echo '  - Breed descriptions as names (DSH, DMH, DLH)'
\echo '  - Procedure info in names (dental, amputation)'
\echo '  - Owner names appended'
\echo '  - Orphan SL cats (no chip, no appts, no person links)'
\echo ''
\echo 'These records are now filtered from:'
\echo '  - v_cat_list view'
\echo '  - Map pins (v_map_atlas_pins)'
\echo '  - Search results (search_unified)'
\echo ''
