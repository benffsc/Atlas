-- ============================================================================
-- MIG_834: Link VH Volunteers to Their Home Places
-- ============================================================================
-- VolunteerHub volunteers with matched Atlas persons often have addresses
-- in VH but no person_place_relationships, making them invisible on the
-- Beacon map. This migration:
--   1. Creates link_vh_volunteer_to_place() to use VH address data
--   2. Backfills person_place_relationships for all matched volunteers
--   3. The VH sync cron will call this for newly matched volunteers
-- ============================================================================

\echo ''
\echo '============================================================'
\echo 'MIG_834: Link VH Volunteers to Their Home Places'
\echo '============================================================'
\echo ''

-- ============================================================================
-- Step 1: Create link_vh_volunteer_to_place() function
-- ============================================================================

\echo 'Step 1: Creating link_vh_volunteer_to_place()...'

CREATE OR REPLACE FUNCTION trapper.link_vh_volunteer_to_place(
  p_volunteerhub_id TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_vol RECORD;
  v_address TEXT;
  v_place_id UUID;
BEGIN
  -- Get the volunteer record
  SELECT vv.volunteerhub_id, vv.matched_person_id, vv.display_name,
         vv.address, vv.full_address
  INTO v_vol
  FROM trapper.volunteerhub_volunteers vv
  WHERE vv.volunteerhub_id = p_volunteerhub_id;

  IF v_vol IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found', 'volunteerhub_id', p_volunteerhub_id);
  END IF;

  IF v_vol.matched_person_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_matched', 'volunteerhub_id', p_volunteerhub_id);
  END IF;

  -- Check if already has a person_place_relationship
  IF EXISTS (
    SELECT 1 FROM trapper.person_place_relationships
    WHERE person_id = v_vol.matched_person_id
  ) THEN
    RETURN jsonb_build_object('status', 'already_linked', 'person_id', v_vol.matched_person_id);
  END IF;

  -- Get the best address: prefer full_address, fall back to address
  v_address := COALESCE(NULLIF(TRIM(v_vol.full_address), ''), NULLIF(TRIM(v_vol.address), ''));

  -- Skip empty, comma-only, PO box, and garbage addresses
  IF v_address IS NULL
     OR v_address ~ '^\s*,\s*(,\s*)*$'
     OR v_address ~* '^\s*p\.?o\.?\s+box'
     OR LENGTH(TRIM(v_address)) < 8
     OR v_address ~* '^[x]+$'
  THEN
    RETURN jsonb_build_object(
      'status', 'no_usable_address',
      'person_id', v_vol.matched_person_id,
      'address_raw', v_vol.address
    );
  END IF;

  -- Find or create the place
  v_place_id := trapper.find_or_create_place_deduped(
    p_formatted_address := v_address,
    p_display_name := NULL,
    p_lat := NULL,
    p_lng := NULL,
    p_source_system := 'volunteerhub'
  );

  IF v_place_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'place_creation_failed',
      'person_id', v_vol.matched_person_id,
      'address', v_address
    );
  END IF;

  -- Create person_place_relationship
  INSERT INTO trapper.person_place_relationships (
    person_id, place_id, role, source_system, source_table,
    source_row_id, valid_from, confidence, note, created_by
  ) VALUES (
    v_vol.matched_person_id,
    v_place_id,
    'resident',
    'volunteerhub',
    'volunteerhub_volunteers',
    v_vol.volunteerhub_id,
    CURRENT_DATE,
    0.75,
    'Auto-linked from VolunteerHub address',
    'link_vh_volunteer_to_place'
  )
  ON CONFLICT DO NOTHING;

  -- Tag the place as a volunteer_location
  PERFORM trapper.assign_place_context(
    p_place_id := v_place_id,
    p_context_type := 'volunteer_location',
    p_evidence_notes := 'VolunteerHub address for ' || v_vol.display_name,
    p_source_system := 'volunteerhub',
    p_source_record_id := v_vol.volunteerhub_id
  );

  RETURN jsonb_build_object(
    'status', 'linked',
    'person_id', v_vol.matched_person_id,
    'place_id', v_place_id,
    'address', v_address,
    'display_name', v_vol.display_name
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_vh_volunteer_to_place IS
'Links a matched VH volunteer to their home place using VH address data.
Creates the place via find_or_create_place_deduped() if needed.
Skips PO boxes and empty addresses.
Created by MIG_834.';

-- ============================================================================
-- Step 2: Dry run — preview who will be linked
-- ============================================================================

\echo ''
\echo 'Step 2: Preview — VH volunteers without place links:'

SELECT
  vv.display_name,
  vv.address AS vh_address,
  CASE
    WHEN vv.address IS NULL OR vv.address = '' THEN 'NO_ADDRESS'
    WHEN vv.address ~* '^\s*p\.?o\.?\s+box' THEN 'PO_BOX'
    ELSE 'WILL_LINK'
  END AS action
FROM trapper.volunteerhub_volunteers vv
JOIN trapper.sot_people sp ON sp.person_id = vv.matched_person_id
WHERE vv.matched_person_id IS NOT NULL
  AND sp.merged_into_person_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_place_relationships ppr
    WHERE ppr.person_id = vv.matched_person_id
  )
ORDER BY action, vv.display_name;

-- ============================================================================
-- Step 3: Backfill — link all matched VH volunteers to places
-- ============================================================================

\echo ''
\echo 'Step 3: Linking VH volunteers to their places...'

DO $$
DECLARE
  v_rec RECORD;
  v_result JSONB;
  v_linked INT := 0;
  v_skipped INT := 0;
BEGIN
  FOR v_rec IN
    SELECT vv.volunteerhub_id, vv.display_name
    FROM trapper.volunteerhub_volunteers vv
    JOIN trapper.sot_people sp ON sp.person_id = vv.matched_person_id
    WHERE vv.matched_person_id IS NOT NULL
      AND sp.merged_into_person_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_place_relationships ppr
        WHERE ppr.person_id = vv.matched_person_id
      )
    ORDER BY vv.display_name
  LOOP
    v_result := trapper.link_vh_volunteer_to_place(v_rec.volunteerhub_id);

    IF (v_result->>'status') = 'linked' THEN
      v_linked := v_linked + 1;
      RAISE NOTICE 'Linked: % → %', v_rec.display_name, v_result->>'address';
    ELSE
      v_skipped := v_skipped + 1;
      RAISE NOTICE 'Skipped: % (%)', v_rec.display_name, v_result->>'status';
    END IF;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE 'Done: % linked, % skipped', v_linked, v_skipped;
END $$;

-- ============================================================================
-- Step 4: Verification
-- ============================================================================

\echo ''
\echo 'Step 4: Verification — roled people without place links:'

SELECT COUNT(*) AS still_invisible
FROM trapper.person_roles pr
JOIN trapper.sot_people sp ON sp.person_id = pr.person_id
WHERE pr.role_status = 'active'
  AND sp.merged_into_person_id IS NULL
  AND pr.role IN ('volunteer', 'foster', 'trapper', 'caretaker', 'staff')
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_place_relationships ppr
    WHERE ppr.person_id = pr.person_id
  );

\echo ''
\echo 'Newly linked volunteers on map:'

SELECT sp.display_name,
  ARRAY_AGG(DISTINCT pr.role ORDER BY pr.role) AS roles,
  p.formatted_address
FROM trapper.person_place_relationships ppr
JOIN trapper.sot_people sp ON sp.person_id = ppr.person_id
JOIN trapper.person_roles pr ON pr.person_id = ppr.person_id AND pr.role_status = 'active'
JOIN trapper.places p ON p.place_id = ppr.place_id
WHERE ppr.source_system = 'volunteerhub'
  AND ppr.created_by = 'link_vh_volunteer_to_place'
GROUP BY sp.display_name, p.formatted_address
ORDER BY sp.display_name;

-- ============================================================================
-- Step 5: Summary
-- ============================================================================

\echo ''
\echo '============================================================'
\echo 'MIG_834 SUMMARY'
\echo '============================================================'
\echo ''
\echo 'CREATED:'
\echo '  - link_vh_volunteer_to_place(volunteerhub_id) function'
\echo '  - Backfilled place links for VH volunteers with addresses'
\echo ''
\echo 'PRINCIPLE:'
\echo '  VH volunteers should appear on the Beacon map at their'
\echo '  home address. VH address data is used to create/find the'
\echo '  place and link the person to it.'
\echo ''
\echo 'REMAINING:'
\echo '  People without VH addresses need manual address entry'
\echo '  to appear on the map.'
\echo ''
\echo 'INTEGRATION:'
\echo '  VH sync cron calls link_vh_volunteer_to_place() after'
\echo '  matching new volunteers.'
\echo ''
\echo '=== MIG_834 Complete ==='
