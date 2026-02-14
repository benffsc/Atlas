\echo '=== MIG_871: Tag Foster Home Places ==='
\echo 'Goal: Tag active foster parents'' residential places with foster_home context.'
\echo 'VolunteerHub tracks 95 approved foster parents but their places were never'
\echo 'tagged as foster_home — making them invisible to foster-specific queries.'
\echo ''

-- ============================================================================
-- 1. DIAGNOSTIC: Current state
-- ============================================================================

\echo '--- Step 1: Diagnostic ---'

SELECT
  COUNT(DISTINCT pr.person_id) as active_fosters,
  COUNT(DISTINCT ppr.place_id) as foster_places,
  COUNT(DISTINCT CASE WHEN pc.context_type = 'foster_home' THEN ppr.place_id END) as already_tagged
FROM trapper.person_roles pr
JOIN trapper.sot_people sp ON sp.person_id = pr.person_id AND sp.merged_into_person_id IS NULL
LEFT JOIN trapper.person_place_relationships ppr
  ON ppr.person_id = pr.person_id AND ppr.role IN ('resident', 'owner')
LEFT JOIN trapper.place_contexts pc
  ON pc.place_id = ppr.place_id AND pc.context_type = 'foster_home' AND pc.valid_to IS NULL
WHERE pr.role = 'foster' AND pr.role_status = 'active';

-- ============================================================================
-- 2. BACKFILL: Tag existing foster parents' places
-- ============================================================================

\echo ''
\echo '--- Step 2: Tagging foster parents'' residential places ---'

DO $$
DECLARE
  v_rec RECORD;
  v_tagged INT := 0;
  v_skipped INT := 0;
BEGIN
  FOR v_rec IN
    SELECT DISTINCT ppr.place_id, sp.display_name, vv.volunteerhub_id
    FROM trapper.person_roles pr
    JOIN trapper.sot_people sp ON sp.person_id = pr.person_id
      AND sp.merged_into_person_id IS NULL
    JOIN trapper.person_place_relationships ppr ON ppr.person_id = pr.person_id
      AND ppr.role IN ('resident', 'owner')
    JOIN trapper.places pl ON pl.place_id = ppr.place_id
      AND pl.merged_into_place_id IS NULL
    LEFT JOIN trapper.volunteerhub_volunteers vv ON vv.matched_person_id = pr.person_id
    WHERE pr.role = 'foster'
      AND pr.role_status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM trapper.place_contexts pc
        WHERE pc.place_id = ppr.place_id
          AND pc.context_type = 'foster_home'
          AND pc.valid_to IS NULL
      )
  LOOP
    PERFORM trapper.assign_place_context(
      p_place_id := v_rec.place_id,
      p_context_type := 'foster_home',
      p_evidence_type := 'inferred',
      p_evidence_notes := 'Foster parent: ' || v_rec.display_name || ' (approved via VolunteerHub)',
      p_confidence := 0.85,
      p_source_system := 'volunteerhub',
      p_source_record_id := v_rec.volunteerhub_id,
      p_assigned_by := 'MIG_871'
    );
    v_tagged := v_tagged + 1;
  END LOOP;

  RAISE NOTICE 'Tagged % places as foster_home (% already tagged)', v_tagged, v_skipped;
END $$;

-- ============================================================================
-- 3. UPDATE link_vh_volunteer_to_place() to auto-tag foster_home
-- ============================================================================

\echo ''
\echo '--- Step 3: Updating link_vh_volunteer_to_place() for role-aware tagging ---'

CREATE OR REPLACE FUNCTION trapper.link_vh_volunteer_to_place(
  p_volunteerhub_id TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_vol RECORD;
  v_address TEXT;
  v_place_id UUID;
  v_has_foster_role BOOLEAN;
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
    -- MIG_871: Even if already linked, check for foster_home tagging
    SELECT EXISTS (
      SELECT 1 FROM trapper.person_roles pr
      WHERE pr.person_id = v_vol.matched_person_id
        AND pr.role = 'foster' AND pr.role_status = 'active'
    ) INTO v_has_foster_role;

    IF v_has_foster_role THEN
      -- Tag all residential places as foster_home
      FOR v_place_id IN
        SELECT ppr.place_id
        FROM trapper.person_place_relationships ppr
        WHERE ppr.person_id = v_vol.matched_person_id
          AND ppr.role IN ('resident', 'owner')
      LOOP
        PERFORM trapper.assign_place_context(
          p_place_id := v_place_id,
          p_context_type := 'foster_home',
          p_evidence_notes := 'Foster parent: ' || v_vol.display_name || ' (approved via VolunteerHub)',
          p_confidence := 0.85,
          p_source_system := 'volunteerhub',
          p_source_record_id := v_vol.volunteerhub_id,
          p_assigned_by := 'link_vh_volunteer_to_place'
        );
      END LOOP;
    END IF;

    RETURN jsonb_build_object('status', 'already_linked', 'person_id', v_vol.matched_person_id,
                              'foster_tagged', v_has_foster_role);
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

  -- MIG_871: If this person has an active foster role, also tag as foster_home
  SELECT EXISTS (
    SELECT 1 FROM trapper.person_roles pr
    WHERE pr.person_id = v_vol.matched_person_id
      AND pr.role = 'foster' AND pr.role_status = 'active'
  ) INTO v_has_foster_role;

  IF v_has_foster_role THEN
    PERFORM trapper.assign_place_context(
      p_place_id := v_place_id,
      p_context_type := 'foster_home',
      p_evidence_notes := 'Foster parent: ' || v_vol.display_name || ' (approved via VolunteerHub)',
      p_confidence := 0.85,
      p_source_system := 'volunteerhub',
      p_source_record_id := v_vol.volunteerhub_id,
      p_assigned_by := 'link_vh_volunteer_to_place'
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'linked',
    'person_id', v_vol.matched_person_id,
    'place_id', v_place_id,
    'address', v_address,
    'display_name', v_vol.display_name,
    'foster_tagged', v_has_foster_role
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_vh_volunteer_to_place IS
'Links a matched VH volunteer to their home place using VH address data.
Creates the place via find_or_create_place_deduped() if needed.
MIG_871: Also tags foster_home context if person has active foster role.
Skips PO boxes and empty addresses.
Created by MIG_834, updated by MIG_871.';

-- ============================================================================
-- 4. VERIFICATION
-- ============================================================================

\echo ''
\echo '--- Step 4: Verification ---'

SELECT
  COUNT(DISTINCT pr.person_id) as active_fosters,
  COUNT(DISTINCT ppr.place_id) as foster_places,
  COUNT(DISTINCT CASE WHEN pc.context_type = 'foster_home' THEN ppr.place_id END) as tagged_foster_home
FROM trapper.person_roles pr
JOIN trapper.sot_people sp ON sp.person_id = pr.person_id AND sp.merged_into_person_id IS NULL
LEFT JOIN trapper.person_place_relationships ppr
  ON ppr.person_id = pr.person_id AND ppr.role IN ('resident', 'owner')
LEFT JOIN trapper.place_contexts pc
  ON pc.place_id = ppr.place_id AND pc.context_type = 'foster_home' AND pc.valid_to IS NULL
WHERE pr.role = 'foster' AND pr.role_status = 'active';

-- Show some sample tagged places
\echo ''
\echo 'Sample foster home locations:'

SELECT
  sp.display_name as foster_parent,
  p.formatted_address,
  p.service_zone
FROM trapper.person_roles pr
JOIN trapper.sot_people sp ON sp.person_id = pr.person_id AND sp.merged_into_person_id IS NULL
JOIN trapper.person_place_relationships ppr ON ppr.person_id = pr.person_id
  AND ppr.role IN ('resident', 'owner')
JOIN trapper.places p ON p.place_id = ppr.place_id AND p.merged_into_place_id IS NULL
JOIN trapper.place_contexts pc ON pc.place_id = ppr.place_id
  AND pc.context_type = 'foster_home' AND pc.valid_to IS NULL
ORDER BY sp.display_name
LIMIT 10;

-- ============================================================================
-- 5. SUMMARY
-- ============================================================================

\echo ''
\echo '=== MIG_871 Complete ==='
\echo 'Changes:'
\echo '  1. Tagged all active foster parents'' residential places with foster_home context'
\echo '  2. Updated link_vh_volunteer_to_place() to auto-tag foster_home for foster role'
\echo ''
\echo 'Going forward:'
\echo '  - VH sync cron calls link_vh_volunteer_to_place() which now checks foster role'
\echo '  - New foster parents added via VH will have places auto-tagged'
\echo '  - Foster homes queryable via place_contexts (Tippy, map filters, etc.)'
