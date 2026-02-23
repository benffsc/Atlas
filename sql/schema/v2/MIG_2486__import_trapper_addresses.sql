-- MIG_2486: Import Trapper Addresses from VolunteerHub and Airtable
--
-- Populates sot.trapper_profiles and sot.trapper_service_places with:
-- 1. VolunteerHub volunteer home addresses (trappers who have matched person_ids)
-- 2. Airtable trappers with their address and common trapping locations
--
-- Created: 2026-02-23

\echo ''
\echo '=============================================='
\echo '  MIG_2486: Import Trapper Addresses'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. IMPORT VOLUNTEERHUB TRAPPERS' HOME ADDRESSES
-- ============================================================================

\echo '1. Importing VolunteerHub trapper home addresses...'

-- Find VolunteerHub volunteers who:
-- - Are in an "Approved" trapper group (via group memberships)
-- - Have a matched person_id
-- - Have an address on file
DO $$
DECLARE
  v_imported INTEGER := 0;
  v_profiles INTEGER := 0;
  v_skipped INTEGER := 0;
  rec RECORD;
  v_place_id UUID;
  v_trapper_type TEXT;
BEGIN
  FOR rec IN
    SELECT DISTINCT
      vv.volunteerhub_id,
      vv.matched_person_id,
      vv.display_name,
      vv.full_address,
      vv.address,
      vv.city,
      vv.state,
      vv.zip,
      -- Determine trapper type from group memberships
      CASE
        WHEN EXISTS (
          SELECT 1 FROM source.volunteerhub_group_memberships gm
          JOIN source.volunteerhub_user_groups ug ON ug.user_group_uid = gm.user_group_uid
          WHERE gm.volunteerhub_id = vv.volunteerhub_id
            AND ug.name ILIKE '%coordinator%'
        ) THEN 'ffsc_staff'
        WHEN EXISTS (
          SELECT 1 FROM source.volunteerhub_group_memberships gm
          JOIN source.volunteerhub_user_groups ug ON ug.user_group_uid = gm.user_group_uid
          WHERE gm.volunteerhub_id = vv.volunteerhub_id
            AND (ug.name ILIKE '%head trapper%' OR ug.atlas_trapper_type = 'head_trapper')
        ) THEN 'ffsc_volunteer'
        WHEN EXISTS (
          SELECT 1 FROM source.volunteerhub_group_memberships gm
          JOIN source.volunteerhub_user_groups ug ON ug.user_group_uid = gm.user_group_uid
          WHERE gm.volunteerhub_id = vv.volunteerhub_id
            AND (ug.name ILIKE '%approved trapper%' OR ug.atlas_trapper_type = 'ffsc_trapper')
        ) THEN 'ffsc_volunteer'
        ELSE 'community_trapper'
      END as trapper_type
    FROM source.volunteerhub_volunteers vv
    WHERE vv.matched_person_id IS NOT NULL
      AND vv.full_address IS NOT NULL
      AND vv.full_address != ''
      -- Must be in a trapper-related group
      AND EXISTS (
        SELECT 1 FROM source.volunteerhub_group_memberships gm
        JOIN source.volunteerhub_user_groups ug ON ug.user_group_uid = gm.user_group_uid
        WHERE gm.volunteerhub_id = vv.volunteerhub_id
          AND (
            ug.name ILIKE '%trapper%'
            OR ug.atlas_role = 'trapper'
            OR ug.atlas_trapper_type IS NOT NULL
          )
      )
      -- Not already in trapper_service_places
      AND NOT EXISTS (
        SELECT 1 FROM sot.trapper_service_places tsp
        WHERE tsp.person_id = vv.matched_person_id
          AND tsp.source_system = 'volunteerhub'
      )
  LOOP
    v_trapper_type := rec.trapper_type;

    -- Find or create place for trapper's address
    SELECT place_id INTO v_place_id
    FROM sot.places
    WHERE formatted_address ILIKE '%' || rec.address || '%'
      AND (rec.city IS NULL OR formatted_address ILIKE '%' || rec.city || '%')
    ORDER BY
      CASE WHEN formatted_address ILIKE rec.full_address THEN 0 ELSE 1 END
    LIMIT 1;

    IF v_place_id IS NULL AND rec.full_address IS NOT NULL THEN
      -- Create a new place for this address
      INSERT INTO sot.places (
        display_name,
        formatted_address,
        source_system
      ) VALUES (
        'Volunteer Home: ' || rec.display_name,
        rec.full_address,
        'volunteerhub'
      )
      RETURNING place_id INTO v_place_id;
    END IF;

    IF v_place_id IS NOT NULL THEN
      -- Create or update trapper profile
      INSERT INTO sot.trapper_profiles (
        person_id,
        trapper_type,
        is_active,
        notes,
        source_system
      ) VALUES (
        rec.matched_person_id,
        v_trapper_type,
        TRUE,
        'Imported from VolunteerHub',
        'volunteerhub'
      ) ON CONFLICT (person_id) DO UPDATE SET
        trapper_type = COALESCE(sot.trapper_profiles.trapper_type, EXCLUDED.trapper_type),
        updated_at = NOW();

      v_profiles := v_profiles + 1;

      -- Create service place link (home address)
      INSERT INTO sot.trapper_service_places (
        person_id,
        place_id,
        service_type,
        role,
        notes,
        source_system,
        evidence_type
      ) VALUES (
        rec.matched_person_id,
        v_place_id,
        'home_rescue', -- Home address
        NULL,
        'Home address from VolunteerHub',
        'volunteerhub',
        'system_import'
      ) ON CONFLICT (person_id, place_id) DO NOTHING;

      v_imported := v_imported + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'VolunteerHub: % profiles created/updated, % home addresses imported, % skipped (no place)',
    v_profiles, v_imported, v_skipped;
END $$;

-- ============================================================================
-- 2. IMPORT AIRTABLE TRAPPERS' ADDRESSES AND COMMON LOCATIONS
-- ============================================================================

\echo ''
\echo '2. Importing Airtable trapper addresses...'

DO $$
DECLARE
  v_imported INTEGER := 0;
  v_profiles INTEGER := 0;
  v_locations INTEGER := 0;
  rec RECORD;
  v_person_id UUID;
  v_place_id UUID;
  v_location TEXT;
  v_trapper_type TEXT;
  v_table_exists BOOLEAN;
BEGIN
  -- Check if source.airtable_raw has data (V2) or ops.staged_records has airtable (fallback)
  SELECT EXISTS(SELECT 1 FROM source.airtable_raw LIMIT 1) INTO v_table_exists;

  IF NOT v_table_exists THEN
    -- Try ops.staged_records
    SELECT EXISTS(
      SELECT 1 FROM ops.staged_records
      WHERE source_system = 'airtable' AND source_table = 'trappers'
      LIMIT 1
    ) INTO v_table_exists;
  END IF;

  IF NOT v_table_exists THEN
    RAISE NOTICE 'Airtable: No data found - run airtable_trappers_sync.mjs first';
    RETURN;
  END IF;

  -- Process Airtable trappers from source.airtable_raw
  FOR rec IN
    SELECT
      ar.record_id as airtable_record_id,
      ar.payload->>'Name' as display_name,
      ar.payload->>'Address' as address,
      ar.payload->>'Approval Status' as approval_status,
      ar.payload->'Common Trapping Locations' as common_locations,
      ar.payload->'Preferred Regions' as preferred_regions,
      pr.person_id
    FROM source.airtable_raw ar
    -- Link via person_roles (trappers have role='trapper')
    LEFT JOIN sot.person_roles pr
      ON pr.source_system = 'airtable'
      AND pr.source_record_id = ar.record_id
      AND pr.role = 'trapper'
    WHERE ar.table_name = 'trappers'
      AND (
        ar.payload->>'Address' IS NOT NULL
        OR jsonb_array_length(COALESCE(ar.payload->'Common Trapping Locations', '[]'::jsonb)) > 0
      )
  LOOP
    v_person_id := rec.person_id;

    -- Skip if no person linked
    IF v_person_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Determine trapper type
    v_trapper_type := CASE
      WHEN rec.approval_status ILIKE '%coordinator%' THEN 'ffsc_staff'
      WHEN rec.approval_status ILIKE '%head%' THEN 'ffsc_volunteer'
      WHEN rec.approval_status ILIKE '%approved%' OR rec.approval_status ILIKE '%legacy%' THEN 'ffsc_volunteer'
      ELSE 'community_trapper'
    END;

    -- Create/update trapper profile
    INSERT INTO sot.trapper_profiles (
      person_id,
      trapper_type,
      is_active,
      notes,
      source_system
    ) VALUES (
      v_person_id,
      v_trapper_type,
      TRUE,
      'Imported from Airtable trappers list',
      'airtable'
    ) ON CONFLICT (person_id) DO UPDATE SET
      trapper_type = COALESCE(sot.trapper_profiles.trapper_type, EXCLUDED.trapper_type),
      updated_at = NOW();

    v_profiles := v_profiles + 1;

    -- Import home address if available
    IF rec.address IS NOT NULL AND rec.address != '' THEN
      -- Find or create place
      SELECT place_id INTO v_place_id
      FROM sot.places
      WHERE formatted_address ILIKE '%' || rec.address || '%'
      ORDER BY
        CASE WHEN formatted_address ILIKE rec.address THEN 0 ELSE 1 END
      LIMIT 1;

      IF v_place_id IS NULL THEN
        INSERT INTO sot.places (
          display_name,
          formatted_address,
          source_system
        ) VALUES (
          'Trapper Home: ' || rec.display_name,
          rec.address,
          'airtable'
        )
        RETURNING place_id INTO v_place_id;
      END IF;

      IF v_place_id IS NOT NULL THEN
        INSERT INTO sot.trapper_service_places (
          person_id,
          place_id,
          service_type,
          role,
          notes,
          source_system,
          evidence_type
        ) VALUES (
          v_person_id,
          v_place_id,
          'home_rescue',
          NULL,
          'Home address from Airtable',
          'airtable',
          'system_import'
        ) ON CONFLICT (person_id, place_id) DO NOTHING;

        v_imported := v_imported + 1;
      END IF;
    END IF;

    -- Import common trapping locations
    IF rec.common_locations IS NOT NULL AND jsonb_array_length(rec.common_locations) > 0 THEN
      FOR v_location IN SELECT jsonb_array_elements_text(rec.common_locations)
      LOOP
        -- Try to find existing place by location name/address
        SELECT place_id INTO v_place_id
        FROM sot.places
        WHERE display_name ILIKE '%' || v_location || '%'
           OR formatted_address ILIKE '%' || v_location || '%'
        ORDER BY
          CASE WHEN display_name ILIKE v_location THEN 0
               WHEN formatted_address ILIKE v_location THEN 1
               ELSE 2
          END
        LIMIT 1;

        -- If found, link as service territory
        IF v_place_id IS NOT NULL THEN
          INSERT INTO sot.trapper_service_places (
            person_id,
            place_id,
            service_type,
            role,
            notes,
            source_system,
            evidence_type
          ) VALUES (
            v_person_id,
            v_place_id,
            'primary_territory',
            'colony_caretaker',
            'Common trapping location: ' || v_location,
            'airtable',
            'system_import'
          ) ON CONFLICT (person_id, place_id) DO NOTHING;

          v_locations := v_locations + 1;
        ELSE
          -- Log unmatched location for manual review
          RAISE NOTICE 'Could not match common location "%" for %', v_location, rec.display_name;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RAISE NOTICE 'Airtable: % profiles created/updated, % home addresses, % common locations imported',
    v_profiles, v_imported, v_locations;
END $$;

-- ============================================================================
-- 3. LINK TRAPPERS TO PLACES VIA REQUEST HISTORY
-- ============================================================================

\echo ''
\echo '3. Inferring service territories from request assignments...'

-- Trappers who have been assigned to 2+ requests at the same place
-- are likely regulars for that area
INSERT INTO sot.trapper_service_places (
  person_id,
  place_id,
  service_type,
  role,
  notes,
  source_system,
  evidence_type
)
SELECT
  rta.trapper_person_id,
  r.place_id,
  CASE
    WHEN COUNT(*) >= 5 THEN 'primary_territory'
    WHEN COUNT(*) >= 2 THEN 'regular'
    ELSE 'occasional'
  END,
  NULL,
  'Inferred from ' || COUNT(*) || ' request assignments at this location',
  'atlas_inference',
  'inferred'
FROM ops.request_trapper_assignments rta
JOIN ops.requests r ON r.request_id = rta.request_id
JOIN sot.people p ON p.person_id = rta.trapper_person_id
WHERE r.place_id IS NOT NULL
  AND p.merged_into_person_id IS NULL
  -- Skip if already has a service place link
  AND NOT EXISTS (
    SELECT 1 FROM sot.trapper_service_places tsp
    WHERE tsp.person_id = rta.trapper_person_id
      AND tsp.place_id = r.place_id
  )
GROUP BY rta.trapper_person_id, r.place_id
HAVING COUNT(*) >= 2;

-- ============================================================================
-- 4. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Trapper profiles by type:'
SELECT
  trapper_type,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE rescue_name IS NOT NULL) as with_rescue
FROM sot.trapper_profiles
GROUP BY trapper_type
ORDER BY count DESC;

\echo ''
\echo 'Service places by source:'
SELECT
  source_system,
  service_type,
  COUNT(*) as count
FROM sot.trapper_service_places
GROUP BY source_system, service_type
ORDER BY source_system, count DESC;

\echo ''
\echo 'Top trappers by coverage:'
SELECT
  COALESCE(p.display_name, p.first_name || ' ' || p.last_name) as trapper,
  tp.trapper_type,
  tp.rescue_name,
  COUNT(tsp.*) as service_places
FROM sot.trapper_profiles tp
JOIN sot.people p ON p.person_id = tp.person_id
LEFT JOIN sot.trapper_service_places tsp ON tsp.person_id = tp.person_id
WHERE p.merged_into_person_id IS NULL
GROUP BY p.person_id, p.display_name, p.first_name, p.last_name, tp.trapper_type, tp.rescue_name
ORDER BY COUNT(tsp.*) DESC
LIMIT 10;

\echo ''
\echo '=============================================='
\echo '  MIG_2486 COMPLETE'
\echo '=============================================='
\echo ''
\echo 'Imported trapper service territories from:'
\echo '  - VolunteerHub volunteer home addresses'
\echo '  - Airtable trappers list (addresses + common locations)'
\echo '  - Request assignment history (inferred territories)'
\echo ''
