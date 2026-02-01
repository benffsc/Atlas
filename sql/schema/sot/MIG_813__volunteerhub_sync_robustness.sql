\echo '=== MIG_813: VolunteerHub Sync Robustness ==='
\echo 'Consolidates runtime fixes + adds trusted source skeleton infrastructure'
\echo ''
\echo 'Fixes:'
\echo '  1. entity_edits: add volunteerhub_sync to edit_source CHECK'
\echo '  2. sync_volunteer_group_memberships: edit_type update → link/unlink'
\echo '  3. internal_account_types: POTL pattern contains → starts_with'
\echo '  4. volunteerhub_volunteers.email: drop NOT NULL'
\echo '  5. NEW: trusted source skeleton person creation'
\echo '  6. NEW: match_volunteerhub_volunteer enhanced with staff lookup + skeleton fallback'
\echo '  7. NEW: enrich_skeleton_people() periodic merger'

-- ============================================================================
-- 1. entity_edits CHECK: add 'volunteerhub_sync' to edit_source
-- ============================================================================
\echo '--- 1. Adding volunteerhub_sync to entity_edits edit_source CHECK ---'

ALTER TABLE trapper.entity_edits DROP CONSTRAINT IF EXISTS entity_edits_edit_source_check;
ALTER TABLE trapper.entity_edits ADD CONSTRAINT entity_edits_edit_source_check
  CHECK (edit_source = ANY (ARRAY[
    'web_ui', 'api', 'migration', 'script', 'system', 'import',
    'trapper_report', 'volunteerhub_sync'
  ]));

-- ============================================================================
-- 2. sync_volunteer_group_memberships: fix edit_type values
-- ============================================================================
\echo '--- 2. Fixing sync_volunteer_group_memberships edit_type ---'

CREATE OR REPLACE FUNCTION trapper.sync_volunteer_group_memberships(
  p_volunteerhub_id TEXT,
  p_current_group_uids TEXT[]
) RETURNS JSONB
LANGUAGE plpgsql AS $function$
DECLARE
  v_joined TEXT[] := '{}';
  v_left TEXT[] := '{}';
  v_uid TEXT;
  v_group_name TEXT;
  v_person_id UUID;
BEGIN
  SELECT matched_person_id INTO v_person_id
  FROM trapper.volunteerhub_volunteers
  WHERE volunteerhub_id = p_volunteerhub_id;

  -- Find groups the volunteer LEFT (active membership not in current list)
  FOR v_uid, v_group_name IN
    SELECT vgm.user_group_uid, vug.name
    FROM trapper.volunteerhub_group_memberships vgm
    JOIN trapper.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
    WHERE vgm.volunteerhub_id = p_volunteerhub_id
      AND vgm.left_at IS NULL
      AND vgm.user_group_uid != ALL(COALESCE(p_current_group_uids, '{}'))
  LOOP
    UPDATE trapper.volunteerhub_group_memberships
    SET left_at = NOW(), updated_at = NOW()
    WHERE volunteerhub_id = p_volunteerhub_id
      AND user_group_uid = v_uid
      AND left_at IS NULL;

    v_left := array_append(v_left, v_group_name);

    IF v_person_id IS NOT NULL THEN
      INSERT INTO trapper.entity_edits (
        entity_type, entity_id, edit_type, field_name, old_value, new_value,
        edit_source, reason, edited_by
      ) VALUES (
        'person', v_person_id, 'unlink',
        'volunteerhub_group_membership',
        to_jsonb(v_group_name), NULL::jsonb,
        'volunteerhub_sync',
        'Left VH group: ' || v_group_name,
        'system'
      );
    END IF;
  END LOOP;

  -- Find groups the volunteer JOINED (in current list but no active membership)
  FOREACH v_uid IN ARRAY COALESCE(p_current_group_uids, '{}')
  LOOP
    SELECT name INTO v_group_name
    FROM trapper.volunteerhub_user_groups
    WHERE user_group_uid = v_uid;

    IF NOT FOUND THEN CONTINUE; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM trapper.volunteerhub_group_memberships
      WHERE volunteerhub_id = p_volunteerhub_id
        AND user_group_uid = v_uid
        AND left_at IS NULL
    ) THEN
      INSERT INTO trapper.volunteerhub_group_memberships (
        volunteerhub_id, user_group_uid, joined_at, source
      ) VALUES (
        p_volunteerhub_id, v_uid, NOW(), 'api_sync'
      );

      v_joined := array_append(v_joined, v_group_name);

      IF v_person_id IS NOT NULL THEN
        INSERT INTO trapper.entity_edits (
          entity_type, entity_id, edit_type, field_name, old_value, new_value,
          edit_source, reason, edited_by
        ) VALUES (
          'person', v_person_id, 'link',
          'volunteerhub_group_membership',
          NULL::jsonb, to_jsonb(v_group_name),
          'volunteerhub_sync',
          'Joined VH group: ' || v_group_name,
          'system'
        );
      END IF;
    END IF;
  END LOOP;

  UPDATE trapper.volunteerhub_volunteers
  SET user_group_uids = p_current_group_uids,
      last_api_sync_at = NOW()
  WHERE volunteerhub_id = p_volunteerhub_id;

  RETURN JSONB_BUILD_OBJECT(
    'joined', to_jsonb(v_joined),
    'left', to_jsonb(v_left)
  );
END;
$function$;

COMMENT ON FUNCTION trapper.sync_volunteer_group_memberships(text, text[]) IS
  'MIG_813: Fixed edit_type update→link/unlink for entity_edits compliance';

-- ============================================================================
-- 3. Fix POTL internal account pattern (was matching "Spotleson")
-- ============================================================================
\echo '--- 3. Fixing POTL internal account pattern ---'

UPDATE trapper.internal_account_types
SET pattern_type = 'starts_with'
WHERE account_pattern = 'potl' AND pattern_type = 'contains';

-- ============================================================================
-- 4. volunteerhub_volunteers.email: allow NULL
-- ============================================================================
\echo '--- 4. Allowing NULL email in volunteerhub_volunteers ---'

ALTER TABLE trapper.volunteerhub_volunteers ALTER COLUMN email DROP NOT NULL;

-- ============================================================================
-- 5. Trusted Source Skeleton Infrastructure
-- ============================================================================
\echo '--- 5. Creating trusted source skeleton infrastructure ---'

-- Trusted source registry: which source systems allow skeleton creation?
-- Only VH and ShelterLuv — these have staff-curated real people.
-- ClinicHQ is excluded: too many non-real entries (Cat Lady, Unknown, etc.)
CREATE TABLE IF NOT EXISTS trapper.trusted_person_sources (
  source_system TEXT PRIMARY KEY,
  allow_skeleton_creation BOOLEAN NOT NULL DEFAULT FALSE,
  allow_name_matching BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO trapper.trusted_person_sources (source_system, allow_skeleton_creation, allow_name_matching, description)
VALUES
  ('volunteerhub', TRUE, TRUE, 'Staff-curated volunteer signups. Real people with verified identities.'),
  ('shelterluv', TRUE, TRUE, 'Adoption/foster management. Real people with verified identities.'),
  ('clinichq', FALSE, FALSE, 'Clinic intake data. Contains many non-real entries (Cat Lady, Unknown, test accounts).'),
  ('airtable', FALSE, FALSE, 'Legacy imported data. Mixed quality.'),
  ('web_intake', FALSE, FALSE, 'Public intake forms. Unverified, could be anyone.'),
  ('atlas_ui', FALSE, FALSE, 'Staff-entered data. Already high quality.')
ON CONFLICT (source_system) DO NOTHING;

COMMENT ON TABLE trapper.trusted_person_sources IS
  'MIG_813: Registry of source systems that allow skeleton person creation (no email/phone).
   Only curated systems like VH and ShelterLuv qualify. ClinicHQ excluded due to garbage data.';

-- Function: Create a skeleton person from a trusted source
CREATE OR REPLACE FUNCTION trapper.create_skeleton_person(
  p_first_name TEXT,
  p_last_name TEXT,
  p_address TEXT DEFAULT NULL,
  p_source_system TEXT DEFAULT 'volunteerhub',
  p_source_record_id TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql AS $function$
DECLARE
  v_person_id UUID;
  v_display_name TEXT;
  v_place_id UUID;
  v_is_trusted BOOLEAN;
BEGIN
  -- Verify this is a trusted source
  SELECT allow_skeleton_creation INTO v_is_trusted
  FROM trapper.trusted_person_sources
  WHERE source_system = p_source_system;

  IF NOT COALESCE(v_is_trusted, FALSE) THEN
    RAISE EXCEPTION 'Source system % is not trusted for skeleton creation', p_source_system;
  END IF;

  -- Build display name
  v_display_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));
  IF v_display_name = '' THEN
    RAISE EXCEPTION 'Cannot create skeleton person without a name';
  END IF;

  -- Reject internal accounts and org names
  IF trapper.is_internal_account(v_display_name) THEN
    RETURN NULL;
  END IF;
  IF trapper.is_organization_name(v_display_name) THEN
    RETURN NULL;
  END IF;

  -- Create the person in sot_people with skeleton quality marker
  INSERT INTO trapper.sot_people (
    display_name,
    data_source,
    data_quality,
    entity_type,
    is_canonical
  ) VALUES (
    v_display_name,
    p_source_system::trapper.data_source,
    'skeleton',  -- Clearly marked: no contact info, name only
    'individual',
    FALSE  -- Not canonical until enriched with contact info
  )
  RETURNING person_id INTO v_person_id;

  -- If we have an address, create a place and link it
  IF p_address IS NOT NULL AND TRIM(p_address) != '' AND TRIM(p_address) != ', , ,' THEN
    v_place_id := trapper.find_or_create_place_deduped(
      p_address, NULL, NULL, NULL, p_source_system
    );

    IF v_place_id IS NOT NULL THEN
      INSERT INTO trapper.person_place_relationships (
        person_id, place_id, role, source_system, confidence, note
      ) VALUES (
        v_person_id, v_place_id, 'resident', p_source_system, 0.70,
        'Skeleton person from ' || p_source_system || ' — no contact info'
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Log the creation
  INSERT INTO trapper.entity_edits (
    entity_type, entity_id, edit_type, field_name,
    new_value, edit_source, reason, edited_by
  ) VALUES (
    'person', v_person_id, 'create', 'skeleton_person',
    jsonb_build_object(
      'name', v_display_name,
      'source', p_source_system,
      'source_record_id', p_source_record_id,
      'has_address', p_address IS NOT NULL AND TRIM(p_address) != ''
    ),
    'volunteerhub_sync',
    COALESCE(p_notes, 'Skeleton person from ' || p_source_system || ' — awaiting contact info enrichment'),
    'system'
  );

  RAISE NOTICE 'Created skeleton person % (%) from %', v_person_id, v_display_name, p_source_system;
  RETURN v_person_id;
END;
$function$;

COMMENT ON FUNCTION trapper.create_skeleton_person(text, text, text, text, text, text) IS
  'MIG_813: Creates a skeleton person record from a trusted source (VH, ShelterLuv).
   Skeleton = name only, no email/phone. data_quality = skeleton, is_canonical = false.
   When contact info arrives from ANY source, enrich_skeleton_people() merges them.
   Blocked for untrusted sources (clinichq, web_intake, etc.).';

-- ============================================================================
-- 6. Enhanced match_volunteerhub_volunteer with staff lookup + skeleton fallback
-- ============================================================================
\echo '--- 6. Enhancing match_volunteerhub_volunteer ---'

CREATE OR REPLACE FUNCTION trapper.match_volunteerhub_volunteer(p_volunteerhub_id text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_vol RECORD;
    v_result RECORD;
    v_person_id UUID;
    v_confidence NUMERIC;
    v_method TEXT;
    v_address TEXT;
BEGIN
    -- Get the volunteer record
    SELECT * INTO v_vol
    FROM trapper.volunteerhub_volunteers
    WHERE volunteerhub_id = p_volunteerhub_id;

    IF v_vol IS NULL THEN
        RETURN NULL;
    END IF;

    -- =====================================================================
    -- Strategy 1: Exact email match (highest confidence)
    -- =====================================================================
    IF v_vol.email_norm IS NOT NULL THEN
        SELECT sp.person_id INTO v_person_id
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = v_vol.email_norm
          AND sp.merged_into_person_id IS NULL
        LIMIT 1;

        IF v_person_id IS NOT NULL THEN
            v_confidence := 1.0;
            v_method := 'email';
        END IF;
    END IF;

    -- =====================================================================
    -- Strategy 2: Phone match
    -- =====================================================================
    IF v_person_id IS NULL AND v_vol.phone_norm IS NOT NULL AND LENGTH(v_vol.phone_norm) = 10 THEN
        SELECT sp.person_id INTO v_person_id
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
        WHERE pi.id_type = 'phone'
          AND pi.id_value_norm = v_vol.phone_norm
          AND sp.merged_into_person_id IS NULL
        LIMIT 1;

        IF v_person_id IS NOT NULL THEN
            v_confidence := 0.9;
            v_method := 'phone';
        END IF;
    END IF;

    -- =====================================================================
    -- Strategy 3: Data Engine (fuzzy matching / new person creation)
    -- Only if we have email or phone — data engine rejects without them
    -- =====================================================================
    IF v_person_id IS NULL AND (v_vol.email_norm IS NOT NULL OR (v_vol.phone_norm IS NOT NULL AND LENGTH(v_vol.phone_norm) = 10)) THEN
        SELECT * INTO v_result FROM trapper.data_engine_resolve_identity(
            p_email := v_vol.email,
            p_phone := v_vol.phone,
            p_first_name := v_vol.first_name,
            p_last_name := v_vol.last_name,
            p_address := v_vol.full_address,
            p_source_system := 'volunteerhub',
            p_staged_record_id := NULL,
            p_job_id := NULL
        );

        IF v_result.person_id IS NOT NULL THEN
            v_person_id := v_result.person_id;
            v_confidence := v_result.confidence_score;
            v_method := 'data_engine/' || COALESCE(v_result.decision_type, 'unknown');
        END IF;
    END IF;

    -- =====================================================================
    -- Strategy 4: Staff name match (for VH staff with no email in VH profile)
    -- High confidence because VH staff are known, curated list
    -- =====================================================================
    IF v_person_id IS NULL AND v_vol.first_name IS NOT NULL AND v_vol.last_name IS NOT NULL THEN
        SELECT sp.person_id INTO v_person_id
        FROM trapper.sot_people sp
        WHERE sp.is_system_account = TRUE
          AND sp.merged_into_person_id IS NULL
          AND LOWER(sp.display_name) = LOWER(TRIM(v_vol.first_name || ' ' || v_vol.last_name))
        LIMIT 1;

        IF v_person_id IS NOT NULL THEN
            v_confidence := 0.85;
            v_method := 'staff_name_match';
        END IF;
    END IF;

    -- =====================================================================
    -- Strategy 5: Skeleton creation (trusted source, no identifiers)
    -- VH is a trusted source — these are real people who signed up.
    -- Create a skeleton record that can be enriched later when contact info arrives.
    -- =====================================================================
    IF v_person_id IS NULL AND v_vol.first_name IS NOT NULL AND v_vol.last_name IS NOT NULL THEN
        -- Build address string
        v_address := CONCAT_WS(', ',
            NULLIF(TRIM(COALESCE(v_vol.address, '')), ''),
            NULLIF(TRIM(COALESCE(v_vol.city, '')), ''),
            NULLIF(TRIM(COALESCE(v_vol.state, '')), ''),
            NULLIF(TRIM(COALESCE(v_vol.zip, '')), '')
        );

        v_person_id := trapper.create_skeleton_person(
            p_first_name := v_vol.first_name,
            p_last_name := v_vol.last_name,
            p_address := v_address,
            p_source_system := 'volunteerhub',
            p_source_record_id := p_volunteerhub_id,
            p_notes := 'VH volunteer with no email/phone — skeleton until contact info acquired'
        );

        IF v_person_id IS NOT NULL THEN
            v_confidence := 0.0;  -- No confidence in identity yet
            v_method := 'skeleton_creation';
        END IF;
    END IF;

    -- =====================================================================
    -- Update the volunteer record with match result
    -- =====================================================================
    IF v_person_id IS NOT NULL THEN
        UPDATE trapper.volunteerhub_volunteers
        SET matched_person_id = v_person_id,
            matched_at = NOW(),
            match_confidence = v_confidence,
            match_method = v_method,
            sync_status = 'matched',
            synced_at = NOW()
        WHERE volunteerhub_id = p_volunteerhub_id;

        -- Add volunteer role if not exists
        INSERT INTO trapper.person_roles (person_id, role, role_status, source_system, source_record_id, started_at)
        VALUES (v_person_id, 'volunteer', 'active', 'volunteerhub', p_volunteerhub_id, CURRENT_DATE)
        ON CONFLICT (person_id, role) DO UPDATE SET
            role_status = 'active',
            updated_at = NOW();

        RAISE NOTICE 'Matched volunteer % to person % via % (confidence: %)',
            p_volunteerhub_id, v_person_id, v_method, v_confidence;
    ELSE
        UPDATE trapper.volunteerhub_volunteers
        SET sync_status = 'unmatched',
            synced_at = NOW()
        WHERE volunteerhub_id = p_volunteerhub_id;
    END IF;

    RETURN v_person_id;
END;
$function$;

COMMENT ON FUNCTION trapper.match_volunteerhub_volunteer(text) IS
  'MIG_813: Enhanced matching with 5 strategies:
   1. Email match (confidence 1.0)
   2. Phone match (confidence 0.9)
   3. Data Engine fuzzy match (requires email or phone)
   4. Staff name match (is_system_account=true, confidence 0.85)
   5. Skeleton creation (trusted source, confidence 0.0)
   Skeletons get data_quality=skeleton and are merged when contact info arrives.';

-- ============================================================================
-- 7. Skeleton Enrichment: merge skeletons when contact info arrives
-- ============================================================================
\echo '--- 7. Creating enrich_skeleton_people function ---'

CREATE OR REPLACE FUNCTION trapper.enrich_skeleton_people(p_batch_size INT DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql AS $function$
DECLARE
  v_skeleton RECORD;
  v_match_person_id UUID;
  v_enriched INT := 0;
  v_promoted INT := 0;
  v_merged INT := 0;
  v_skipped INT := 0;
  v_vh_vol RECORD;
BEGIN
  -- Find skeleton people who now have a VH record with email/phone
  FOR v_skeleton IN
    SELECT sp.person_id, sp.display_name,
           vv.volunteerhub_id, vv.email, vv.email_norm, vv.phone, vv.phone_norm,
           vv.first_name, vv.last_name
    FROM trapper.sot_people sp
    JOIN trapper.volunteerhub_volunteers vv ON vv.matched_person_id = sp.person_id
    WHERE sp.data_quality = 'skeleton'
      AND sp.merged_into_person_id IS NULL
      AND (vv.email_norm IS NOT NULL OR (vv.phone_norm IS NOT NULL AND LENGTH(vv.phone_norm) = 10))
    LIMIT p_batch_size
  LOOP
    -- This skeleton now has contact info from VH update!
    -- Check if an existing person already has this email/phone

    -- Try email match to another person
    IF v_skeleton.email_norm IS NOT NULL THEN
      SELECT sp.person_id INTO v_match_person_id
      FROM trapper.person_identifiers pi
      JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
      WHERE pi.id_type = 'email'
        AND pi.id_value_norm = v_skeleton.email_norm
        AND sp.person_id != v_skeleton.person_id
        AND sp.merged_into_person_id IS NULL
      LIMIT 1;
    END IF;

    -- Try phone match if no email match
    IF v_match_person_id IS NULL AND v_skeleton.phone_norm IS NOT NULL AND LENGTH(v_skeleton.phone_norm) = 10 THEN
      SELECT sp.person_id INTO v_match_person_id
      FROM trapper.person_identifiers pi
      JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
      WHERE pi.id_type = 'phone'
        AND pi.id_value_norm = v_skeleton.phone_norm
        AND sp.person_id != v_skeleton.person_id
        AND sp.merged_into_person_id IS NULL
      LIMIT 1;
    END IF;

    IF v_match_person_id IS NOT NULL THEN
      -- MERGE: skeleton INTO existing person (existing person is canonical)
      UPDATE trapper.sot_people
      SET merged_into_person_id = v_match_person_id,
          merged_at = NOW(),
          merge_reason = 'Skeleton enriched: contact info matched existing person'
      WHERE person_id = v_skeleton.person_id;

      -- Move VH volunteer link to the real person
      UPDATE trapper.volunteerhub_volunteers
      SET matched_person_id = v_match_person_id,
          match_method = 'skeleton_merged/' || COALESCE(
            CASE WHEN v_skeleton.email_norm IS NOT NULL THEN 'email' ELSE 'phone' END,
            'unknown'
          ),
          match_confidence = CASE WHEN v_skeleton.email_norm IS NOT NULL THEN 1.0 ELSE 0.9 END,
          matched_at = NOW()
      WHERE volunteerhub_id = v_skeleton.volunteerhub_id;

      -- Move roles to real person
      UPDATE trapper.person_roles
      SET person_id = v_match_person_id, updated_at = NOW()
      WHERE person_id = v_skeleton.person_id
        AND NOT EXISTS (
          SELECT 1 FROM trapper.person_roles pr2
          WHERE pr2.person_id = v_match_person_id AND pr2.role = person_roles.role
        );

      -- Move place relationships to real person
      UPDATE trapper.person_place_relationships
      SET person_id = v_match_person_id, updated_at = NOW()
      WHERE person_id = v_skeleton.person_id
        AND NOT EXISTS (
          SELECT 1 FROM trapper.person_place_relationships ppr2
          WHERE ppr2.person_id = v_match_person_id AND ppr2.place_id = person_place_relationships.place_id
        );

      -- Log the merge
      INSERT INTO trapper.entity_edits (
        entity_type, entity_id, edit_type, field_name,
        old_value, new_value, edit_source, reason, edited_by
      ) VALUES (
        'person', v_skeleton.person_id, 'merge', 'skeleton_enrichment',
        to_jsonb(v_skeleton.display_name),
        jsonb_build_object('merged_into', v_match_person_id, 'method', 'contact_info_match'),
        'volunteerhub_sync',
        'Skeleton person merged into existing: contact info now available',
        'system'
      );

      v_merged := v_merged + 1;
      RAISE NOTICE 'Merged skeleton % into existing person %', v_skeleton.person_id, v_match_person_id;

    ELSE
      -- PROMOTE: no existing match — add identifiers and promote to normal quality
      IF v_skeleton.email_norm IS NOT NULL THEN
        INSERT INTO trapper.person_identifiers (
          person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
        ) VALUES (
          v_skeleton.person_id, 'email', v_skeleton.email_norm, v_skeleton.email, 'volunteerhub', 0.9
        )
        ON CONFLICT (id_type, id_value_norm) DO NOTHING;
      END IF;

      IF v_skeleton.phone_norm IS NOT NULL AND LENGTH(v_skeleton.phone_norm) = 10 THEN
        INSERT INTO trapper.person_identifiers (
          person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
        ) VALUES (
          v_skeleton.person_id, 'phone', v_skeleton.phone_norm, v_skeleton.phone, 'volunteerhub', 0.9
        )
        ON CONFLICT (id_type, id_value_norm) DO NOTHING;
      END IF;

      -- Promote from skeleton to normal
      UPDATE trapper.sot_people
      SET data_quality = 'normal',
          is_canonical = TRUE,
          updated_at = NOW()
      WHERE person_id = v_skeleton.person_id;

      v_promoted := v_promoted + 1;
      RAISE NOTICE 'Promoted skeleton % to normal quality', v_skeleton.person_id;
    END IF;

    v_enriched := v_enriched + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'enriched', v_enriched,
    'promoted', v_promoted,
    'merged', v_merged,
    'skipped', v_skipped
  );
END;
$function$;

COMMENT ON FUNCTION trapper.enrich_skeleton_people(int) IS
  'MIG_813: Periodic enrichment for skeleton people.
   When a VH volunteer updates their profile with email/phone:
   - If email/phone matches existing person → merge skeleton INTO existing
   - If no match → promote skeleton to normal quality, add identifiers
   Called automatically by VH sync and cron processing.';

-- ============================================================================
-- Summary
-- ============================================================================
\echo ''
\echo '=== MIG_813 Complete ==='
\echo 'Fixed:'
\echo '  1. entity_edits edit_source CHECK: added volunteerhub_sync'
\echo '  2. sync_volunteer_group_memberships: edit_type update → link/unlink'
\echo '  3. POTL pattern: contains → starts_with (fixed Spotleson false positive)'
\echo '  4. volunteerhub_volunteers.email: nullable for VH users without email'
\echo '  5. trusted_person_sources: registry table for skeleton-allowed sources'
\echo '  6. create_skeleton_person(): creates name-only records from trusted sources'
\echo '  7. match_volunteerhub_volunteer: 5-strategy matching (email → phone → data_engine → staff → skeleton)'
\echo '  8. enrich_skeleton_people(): merges/promotes skeletons when contact info arrives'
\echo ''
\echo 'Enrichment lifecycle:'
\echo '  VH volunteer (no email) → skeleton person (data_quality=skeleton)'
\echo '  VH syncs again with email → enrich_skeleton_people() runs'
\echo '    → If email matches existing person: merge skeleton INTO existing'
\echo '    → If email is new: promote skeleton to normal, add identifiers'
\echo '  Clinic visit / request with same email → normal data_engine matching'
