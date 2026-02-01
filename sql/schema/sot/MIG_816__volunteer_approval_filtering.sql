\echo '=== MIG_816: Volunteer Approval Filtering ==='
\echo ''
\echo 'Fixes premature volunteer role assignment bug.'
\echo 'Previously, match_volunteerhub_volunteer() (MIG_813) assigned role_status=active'
\echo 'immediately for ANY VolunteerHub user before group processing checked approval.'
\echo 'This caused applicants to show as active volunteers on the map.'
\echo ''
\echo 'Changes:'
\echo '  1. match_volunteerhub_volunteer() now assigns role_status=pending (not active)'
\echo '  2. process_volunteerhub_group_roles() upgrades to active ONLY if in approved group'
\echo '  3. Backfill: existing VH volunteers not in approved groups set to pending'
\echo ''

-- ============================================================================
-- 1. Recreate match_volunteerhub_volunteer with pending default
-- ============================================================================
\echo '--- 1. Recreating match_volunteerhub_volunteer (pending default) ---'

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

    -- Strategy 1: Exact email match (highest confidence)
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

    -- Strategy 2: Phone match
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

    -- Strategy 3: Data Engine (fuzzy matching / new person creation)
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

    -- Strategy 4: Staff name match
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

    -- Strategy 5: Skeleton creation
    IF v_person_id IS NULL AND v_vol.first_name IS NOT NULL AND v_vol.last_name IS NOT NULL THEN
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
            v_confidence := 0.0;
            v_method := 'skeleton_creation';
        END IF;
    END IF;

    -- Update the volunteer record with match result
    IF v_person_id IS NOT NULL THEN
        UPDATE trapper.volunteerhub_volunteers
        SET matched_person_id = v_person_id,
            matched_at = NOW(),
            match_confidence = v_confidence,
            match_method = v_method,
            sync_status = 'matched',
            synced_at = NOW()
        WHERE volunteerhub_id = p_volunteerhub_id;

        -- Add volunteer role as PENDING (upgraded to active by process_volunteerhub_group_roles if approved)
        INSERT INTO trapper.person_roles (person_id, role, role_status, source_system, source_record_id, started_at)
        VALUES (v_person_id, 'volunteer', 'pending', 'volunteerhub', p_volunteerhub_id, CURRENT_DATE)
        ON CONFLICT (person_id, role) DO UPDATE SET
            -- Don't downgrade active to pending (preserve manual or group-approved active status)
            role_status = CASE
                WHEN person_roles.role_status = 'active' THEN 'active'
                ELSE 'pending'
            END,
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
  'MIG_816: Match VolunteerHub volunteer to person. Assigns volunteer role as PENDING (not active). '
  'Active status is granted only by process_volunteerhub_group_roles() when the volunteer is in an approved group.';

-- ============================================================================
-- 2. Recreate process_volunteerhub_group_roles with approval-gated upgrade
-- ============================================================================
\echo '--- 2. Recreating process_volunteerhub_group_roles (approval-gated upgrade) ---'

CREATE OR REPLACE FUNCTION trapper.process_volunteerhub_group_roles(
  p_person_id UUID,
  p_volunteerhub_id TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_group RECORD;
  v_roles_assigned TEXT[] := '{}';
  v_existing_trapper_type TEXT;
  v_existing_source TEXT;
BEGIN
  IF p_person_id IS NULL OR p_volunteerhub_id IS NULL THEN
    RETURN JSONB_BUILD_OBJECT('error', 'person_id and volunteerhub_id are required');
  END IF;

  SELECT trapper_type, source_system
  INTO v_existing_trapper_type, v_existing_source
  FROM trapper.person_roles
  WHERE person_id = p_person_id
    AND role = 'trapper'
    AND role_status = 'active';

  FOR v_group IN
    SELECT vug.user_group_uid, vug.name, vug.atlas_role, vug.atlas_trapper_type
    FROM trapper.volunteerhub_group_memberships vgm
    JOIN trapper.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
    WHERE vgm.volunteerhub_id = p_volunteerhub_id
      AND vgm.left_at IS NULL
      AND vug.atlas_role IS NOT NULL
  LOOP
    IF v_group.atlas_role = 'trapper' THEN
      IF v_existing_trapper_type IN ('head_trapper', 'coordinator') THEN
        UPDATE trapper.person_roles
        SET role_status = 'active', updated_at = NOW()
        WHERE person_id = p_person_id AND role = 'trapper' AND role_status != 'active';
      ELSE
        INSERT INTO trapper.person_roles (
          person_id, role, trapper_type, role_status, source_system, source_record_id, started_at, notes
        ) VALUES (
          p_person_id, 'trapper', 'ffsc_trapper', 'active', 'volunteerhub', p_volunteerhub_id,
          CURRENT_DATE, 'VH group: ' || v_group.name
        )
        ON CONFLICT (person_id, role) DO UPDATE SET
          role_status = 'active',
          trapper_type = CASE
            WHEN person_roles.trapper_type IN ('head_trapper', 'coordinator')
            THEN person_roles.trapper_type
            ELSE 'ffsc_trapper'
          END,
          source_system = CASE
            WHEN person_roles.source_system = 'volunteerhub' OR person_roles.trapper_type NOT IN ('head_trapper', 'coordinator')
            THEN 'volunteerhub'
            ELSE person_roles.source_system
          END,
          updated_at = NOW();
      END IF;
      v_roles_assigned := array_append(v_roles_assigned, 'trapper/ffsc_trapper');
    ELSE
      INSERT INTO trapper.person_roles (
        person_id, role, role_status, source_system, source_record_id, started_at, notes
      ) VALUES (
        p_person_id, v_group.atlas_role, 'active', 'volunteerhub', p_volunteerhub_id,
        CURRENT_DATE, 'VH group: ' || v_group.name
      )
      ON CONFLICT (person_id, role) DO UPDATE SET
        role_status = 'active',
        source_system = CASE
          WHEN person_roles.source_system = 'volunteerhub' THEN 'volunteerhub'
          ELSE person_roles.source_system
        END,
        notes = CASE
          WHEN person_roles.notes IS NULL THEN 'VH group: ' || v_group.name
          WHEN person_roles.notes NOT LIKE '%VH group:%' THEN person_roles.notes || '; VH group: ' || v_group.name
          ELSE person_roles.notes
        END,
        updated_at = NOW();
      v_roles_assigned := array_append(v_roles_assigned, v_group.atlas_role);
    END IF;
  END LOOP;

  -- Upgrade volunteer role to active if in any approved group
  -- This replaces the old unconditional active assignment
  IF array_length(v_roles_assigned, 1) > 0 OR EXISTS (
    SELECT 1 FROM trapper.volunteerhub_group_memberships vgm
    JOIN trapper.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
    WHERE vgm.volunteerhub_id = p_volunteerhub_id
      AND vgm.left_at IS NULL
      AND (vug.is_approved_parent = TRUE
           OR vug.parent_user_group_uid IN (
             SELECT user_group_uid FROM trapper.volunteerhub_user_groups WHERE is_approved_parent = TRUE
           ))
  ) THEN
    -- Person is in an approved group — ensure active volunteer role
    INSERT INTO trapper.person_roles (
      person_id, role, role_status, source_system, source_record_id, started_at, notes
    ) VALUES (
      p_person_id, 'volunteer', 'active', 'volunteerhub', p_volunteerhub_id,
      CURRENT_DATE, 'FFSC Approved Volunteer via VolunteerHub'
    )
    ON CONFLICT (person_id, role) DO UPDATE SET
      role_status = 'active',
      updated_at = NOW();
  END IF;

  RETURN JSONB_BUILD_OBJECT(
    'person_id', p_person_id,
    'volunteerhub_id', p_volunteerhub_id,
    'roles_assigned', to_jsonb(v_roles_assigned),
    'existing_trapper_type', v_existing_trapper_type
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_volunteerhub_group_roles(UUID, TEXT) IS
  'MIG_816: Process VolunteerHub group memberships into Atlas roles. '
  'Upgrades volunteer role to active ONLY if the person is in an approved group. '
  'Replaces the old unconditional active assignment from MIG_810.';

-- ============================================================================
-- 3. Backfill: Set pending for VH volunteers not in any approved group
-- ============================================================================
\echo '--- 3. Backfilling: setting pending for unapproved VH volunteers ---'

WITH approved_volunteer_ids AS (
  SELECT DISTINCT vv.matched_person_id
  FROM trapper.volunteerhub_volunteers vv
  JOIN trapper.volunteerhub_group_memberships vgm ON vgm.volunteerhub_id = vv.volunteerhub_id
  JOIN trapper.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
  WHERE vv.matched_person_id IS NOT NULL
    AND vgm.left_at IS NULL
    AND (vug.atlas_role IS NOT NULL
         OR vug.is_approved_parent = TRUE
         OR vug.parent_user_group_uid IN (
           SELECT user_group_uid FROM trapper.volunteerhub_user_groups WHERE is_approved_parent = TRUE
         ))
),
updated AS (
  UPDATE trapper.person_roles pr
  SET role_status = 'pending', updated_at = NOW()
  WHERE pr.role = 'volunteer'
    AND pr.source_system = 'volunteerhub'
    AND pr.role_status = 'active'
    AND pr.person_id NOT IN (SELECT matched_person_id FROM approved_volunteer_ids)
  RETURNING pr.person_id
)
SELECT COUNT(*) AS volunteers_set_to_pending FROM updated;

-- ============================================================================
-- 4. Summary
-- ============================================================================
\echo ''
\echo '=== MIG_816 Complete ==='
\echo ''
\echo 'Summary:'
\echo '  - match_volunteerhub_volunteer() now assigns role_status=pending (was active)'
\echo '  - process_volunteerhub_group_roles() upgrades to active only if in approved group'
\echo '  - Backfilled: unapproved VH volunteers set from active to pending'
\echo '  - Active volunteers in approved groups are unaffected'
\echo ''
