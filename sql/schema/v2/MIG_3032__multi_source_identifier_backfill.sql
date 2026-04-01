-- MIG_3032: Multi-Source Identifier Backfill
--
-- Problem: confirm_identifier() (MIG_3025) was added to data_engine_resolve_identity()
-- and sync_person_identifiers trigger (MIG_3019), but identifiers created BEFORE those
-- migrations still have empty source_systems arrays and confirmation_count=1.
--
-- This migration:
-- 1. Retroactively calls confirm_identifier() for identifiers that can be cross-referenced
--    across ClinicHQ appointments, ShelterLuv raw data, and VolunteerHub volunteers
-- 2. Ensures all existing identifiers have at least their original source_system populated
--
-- Result: source_systems arrays get populated, enabling multi-source confidence scoring.
--
-- Created: 2026-03-31

\echo ''
\echo '=============================================='
\echo '  MIG_3032: Multi-Source Identifier Backfill'
\echo '=============================================='
\echo ''

-- ============================================================================
-- Step 1: Backfill source_systems for identifiers with known source
-- ============================================================================

\echo 'Step 1: Populating source_systems from person source_system...'

-- People created by ClinicHQ ingest
UPDATE sot.person_identifiers pi
SET source_systems = ARRAY['clinichq'],
    confirmation_count = GREATEST(confirmation_count, 1)
FROM sot.people p
WHERE pi.person_id = p.person_id
  AND p.source_system = 'clinichq'
  AND (pi.source_systems IS NULL OR pi.source_systems = '{}')
  AND pi.confidence >= 0.5;

-- People created by ShelterLuv
UPDATE sot.person_identifiers pi
SET source_systems = ARRAY['shelterluv'],
    confirmation_count = GREATEST(confirmation_count, 1)
FROM sot.people p
WHERE pi.person_id = p.person_id
  AND p.source_system = 'shelterluv'
  AND (pi.source_systems IS NULL OR pi.source_systems = '{}')
  AND pi.confidence >= 0.5;

-- People created by VolunteerHub
UPDATE sot.person_identifiers pi
SET source_systems = ARRAY['volunteerhub'],
    confirmation_count = GREATEST(confirmation_count, 1)
FROM sot.people p
WHERE pi.person_id = p.person_id
  AND p.source_system = 'volunteerhub'
  AND (pi.source_systems IS NULL OR pi.source_systems = '{}')
  AND pi.confidence >= 0.5;

-- People from web_intake, atlas_ui, airtable, petlink
UPDATE sot.person_identifiers pi
SET source_systems = ARRAY[p.source_system],
    confirmation_count = GREATEST(confirmation_count, 1)
FROM sot.people p
WHERE pi.person_id = p.person_id
  AND p.source_system IN ('web_intake', 'atlas_ui', 'airtable', 'petlink')
  AND (pi.source_systems IS NULL OR pi.source_systems = '{}')
  AND pi.confidence >= 0.5;

\echo 'Done. Checking baseline...'

SELECT
  COUNT(*) FILTER (WHERE source_systems IS NOT NULL AND array_length(source_systems, 1) > 0) as has_source,
  COUNT(*) FILTER (WHERE source_systems IS NULL OR source_systems = '{}') as missing_source,
  COUNT(*) as total
FROM sot.person_identifiers
WHERE confidence >= 0.5;

-- ============================================================================
-- Step 2: Cross-reference ClinicHQ emails against ShelterLuv
-- ============================================================================

\echo ''
\echo 'Step 2: Cross-referencing ClinicHQ ↔ ShelterLuv emails...'

-- Find emails that exist in BOTH ClinicHQ appointments AND ShelterLuv raw data
-- and call confirm_identifier() to add the second source

DO $$
DECLARE
  v_cross RECORD;
  v_confirmed INT := 0;
  v_result UUID;
BEGIN
  FOR v_cross IN
    -- ShelterLuv emails that match existing ClinicHQ-sourced identifiers
    SELECT DISTINCT
      pi.person_id,
      pi.id_type,
      pi.id_value_raw,
      pi.id_value_norm
    FROM sot.person_identifiers pi
    JOIN sot.people p ON p.person_id = pi.person_id
    WHERE pi.id_type = 'email'
      AND pi.confidence >= 0.5
      AND pi.id_value_norm IS NOT NULL
      AND NOT ('shelterluv' = ANY(COALESCE(pi.source_systems, '{}')))
      AND EXISTS (
        SELECT 1 FROM ops.staged_records sr
        WHERE sr.source_system = 'shelterluv'
          AND sr.source_table = 'people'
          AND LOWER(TRIM(sr.payload->>'Email')) = pi.id_value_norm
      )
  LOOP
    v_result := sot.confirm_identifier(
      v_cross.person_id,
      v_cross.id_type,
      v_cross.id_value_raw,
      v_cross.id_value_norm,
      'shelterluv',
      0.9  -- High confidence for cross-system match
    );
    IF v_result IS NOT NULL THEN
      v_confirmed := v_confirmed + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Cross-referenced % email identifiers (ClinicHQ → ShelterLuv)', v_confirmed;
END $$;

-- ============================================================================
-- Step 3: Cross-reference ClinicHQ phones against ShelterLuv
-- ============================================================================

\echo 'Step 3: Cross-referencing ClinicHQ ↔ ShelterLuv phones...'

DO $$
DECLARE
  v_cross RECORD;
  v_confirmed INT := 0;
  v_result UUID;
  v_sl_phone TEXT;
BEGIN
  FOR v_cross IN
    SELECT DISTINCT
      pi.person_id,
      pi.id_type,
      pi.id_value_raw,
      pi.id_value_norm
    FROM sot.person_identifiers pi
    WHERE pi.id_type = 'phone'
      AND pi.confidence >= 0.5
      AND pi.id_value_norm IS NOT NULL
      AND NOT ('shelterluv' = ANY(COALESCE(pi.source_systems, '{}')))
      AND EXISTS (
        SELECT 1 FROM ops.staged_records sr
        WHERE sr.source_system = 'shelterluv'
          AND sr.source_table = 'people'
          AND REGEXP_REPLACE(COALESCE(sr.payload->>'Phone', ''), '[^0-9]', '', 'g') = pi.id_value_norm
      )
  LOOP
    v_result := sot.confirm_identifier(
      v_cross.person_id,
      v_cross.id_type,
      v_cross.id_value_raw,
      v_cross.id_value_norm,
      'shelterluv',
      0.9
    );
    IF v_result IS NOT NULL THEN
      v_confirmed := v_confirmed + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Cross-referenced % phone identifiers (ClinicHQ → ShelterLuv)', v_confirmed;
END $$;

-- ============================================================================
-- Step 4: Cross-reference against VolunteerHub
-- ============================================================================

\echo 'Step 4: Cross-referencing against VolunteerHub...'

DO $$
DECLARE
  v_cross RECORD;
  v_confirmed INT := 0;
  v_result UUID;
BEGIN
  FOR v_cross IN
    SELECT DISTINCT
      pi.person_id,
      pi.id_type,
      pi.id_value_raw,
      pi.id_value_norm
    FROM sot.person_identifiers pi
    WHERE pi.id_type = 'email'
      AND pi.confidence >= 0.5
      AND pi.id_value_norm IS NOT NULL
      AND NOT ('volunteerhub' = ANY(COALESCE(pi.source_systems, '{}')))
      AND EXISTS (
        SELECT 1 FROM source.volunteerhub_volunteers vh
        WHERE LOWER(TRIM(vh.email)) = pi.id_value_norm
      )
  LOOP
    v_result := sot.confirm_identifier(
      v_cross.person_id,
      v_cross.id_type,
      v_cross.id_value_raw,
      v_cross.id_value_norm,
      'volunteerhub',
      0.9
    );
    IF v_result IS NOT NULL THEN
      v_confirmed := v_confirmed + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Cross-referenced % email identifiers (→ VolunteerHub)', v_confirmed;
END $$;

-- ============================================================================
-- Step 5: Verification
-- ============================================================================

\echo ''
\echo 'Verification — Multi-source identifier distribution:'

SELECT
  array_length(source_systems, 1) as source_count,
  COUNT(*) as identifier_count
FROM sot.person_identifiers
WHERE confidence >= 0.5
  AND source_systems IS NOT NULL
  AND array_length(source_systems, 1) > 0
GROUP BY 1
ORDER BY 1;

\echo ''
\echo 'Top multi-source identifiers (should now have 2+ sources):'

SELECT
  pi.id_type,
  pi.id_value_norm,
  pi.source_systems,
  pi.confirmation_count,
  pi.last_confirmed_at,
  p.display_name
FROM sot.person_identifiers pi
JOIN sot.people p ON p.person_id = pi.person_id
WHERE array_length(pi.source_systems, 1) > 1
  AND pi.confidence >= 0.5
ORDER BY array_length(pi.source_systems, 1) DESC, pi.confirmation_count DESC
LIMIT 20;

\echo ''
\echo 'MIG_3032 complete — Multi-source identifier backfill'
\echo ''
