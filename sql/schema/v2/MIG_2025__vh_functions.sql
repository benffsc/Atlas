-- MIG_2025: VolunteerHub Functions for V2
-- Ports V1 VolunteerHub matching and processing functions to V2 schema

-- ============================================================================
-- 1. Enhance person_roles table to match V1 structure
-- ============================================================================
DO $$
BEGIN
  -- Add trapper_type if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sot' AND table_name = 'person_roles' AND column_name = 'trapper_type'
  ) THEN
    ALTER TABLE sot.person_roles ADD COLUMN trapper_type TEXT;
    ALTER TABLE sot.person_roles ADD CONSTRAINT person_roles_trapper_type_check
      CHECK (trapper_type IS NULL OR trapper_type IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper'));
  END IF;

  -- Add source_record_id if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sot' AND table_name = 'person_roles' AND column_name = 'source_record_id'
  ) THEN
    ALTER TABLE sot.person_roles ADD COLUMN source_record_id TEXT;
  END IF;

  -- Add started_at if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sot' AND table_name = 'person_roles' AND column_name = 'started_at'
  ) THEN
    ALTER TABLE sot.person_roles ADD COLUMN started_at DATE;
  END IF;

  -- Add ended_at if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sot' AND table_name = 'person_roles' AND column_name = 'ended_at'
  ) THEN
    ALTER TABLE sot.person_roles ADD COLUMN ended_at DATE;
  END IF;

  -- Add notes if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sot' AND table_name = 'person_roles' AND column_name = 'notes'
  ) THEN
    ALTER TABLE sot.person_roles ADD COLUMN notes TEXT;
  END IF;

  -- Add updated_at if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sot' AND table_name = 'person_roles' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE sot.person_roles ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Add role_status check constraint if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'person_roles_role_status_check'
  ) THEN
    ALTER TABLE sot.person_roles ADD CONSTRAINT person_roles_role_status_check
      CHECK (role_status IN ('active', 'inactive', 'pending', 'on_leave'));
  END IF;
END $$;

-- Add role check constraint if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'person_roles_role_check' AND constraint_schema = 'sot'
  ) THEN
    ALTER TABLE sot.person_roles ADD CONSTRAINT person_roles_role_check
      CHECK (role IN ('trapper', 'foster', 'volunteer', 'staff', 'caretaker', 'board_member', 'donor'));
  END IF;
END $$;

-- Add unique constraint for person_id + role
DROP INDEX IF EXISTS sot.idx_person_roles_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_person_roles_person_role
  ON sot.person_roles(person_id, role);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_person_roles_person ON sot.person_roles(person_id);
CREATE INDEX IF NOT EXISTS idx_person_roles_role ON sot.person_roles(role);
CREATE INDEX IF NOT EXISTS idx_person_roles_trapper_type ON sot.person_roles(trapper_type) WHERE role = 'trapper';

-- ============================================================================
-- 2. Create role_reconciliation_log table
-- ============================================================================
CREATE TABLE IF NOT EXISTS sot.role_reconciliation_log (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES sot.people(person_id),
  role TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  reason TEXT,
  source_system TEXT,
  evidence JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_role_reconciliation_person
  ON sot.role_reconciliation_log(person_id);

-- ============================================================================
-- 3. Create trusted_person_sources table
-- ============================================================================
CREATE TABLE IF NOT EXISTS sot.trusted_person_sources (
  source_system TEXT PRIMARY KEY,
  allow_skeleton_creation BOOLEAN NOT NULL DEFAULT FALSE,
  allow_auto_merge BOOLEAN NOT NULL DEFAULT FALSE,
  confidence_floor NUMERIC(3,2) NOT NULL DEFAULT 0.70,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed trusted sources
INSERT INTO sot.trusted_person_sources (source_system, allow_skeleton_creation, allow_auto_merge, confidence_floor)
VALUES
  ('volunteerhub', TRUE, FALSE, 0.70),
  ('shelterluv', TRUE, FALSE, 0.70),
  ('clinichq', TRUE, TRUE, 0.85),
  ('airtable', FALSE, FALSE, 0.80),
  ('atlas_ui', TRUE, TRUE, 0.90)
ON CONFLICT (source_system) DO NOTHING;

-- ============================================================================
-- 4. Create is_internal_account function
-- ============================================================================
CREATE OR REPLACE FUNCTION sot.is_internal_account(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_name IS NULL OR TRIM(LOWER(p_name)) IN (
    'test', 'test account', 'testing', 'admin', 'system',
    'unknown', 'anonymous', 'guest', 'n/a', 'na', 'none',
    'no name', 'no owner', 'stray', 'feral', 'community cat',
    'tnr', 'ffsc', 'forgotten felines', 'clinic'
  )
$$;

-- ============================================================================
-- 5. Create create_skeleton_person function
-- ============================================================================
CREATE OR REPLACE FUNCTION sot.create_skeleton_person(
  p_first_name TEXT,
  p_last_name TEXT,
  p_address TEXT DEFAULT NULL,
  p_source_system TEXT DEFAULT 'volunteerhub',
  p_source_record_id TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_person_id UUID;
  v_display_name TEXT;
  v_place_id UUID;
  v_is_trusted BOOLEAN;
BEGIN
  SELECT allow_skeleton_creation INTO v_is_trusted
  FROM sot.trusted_person_sources
  WHERE source_system = p_source_system;

  IF NOT COALESCE(v_is_trusted, FALSE) THEN
    RAISE EXCEPTION 'Source system % is not trusted for skeleton creation', p_source_system;
  END IF;

  v_display_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));
  IF v_display_name = '' THEN
    RAISE EXCEPTION 'Cannot create skeleton person without a name';
  END IF;

  IF sot.is_internal_account(v_display_name) THEN
    RETURN NULL;
  END IF;
  IF sot.is_organization_name(v_display_name) THEN
    RETURN NULL;
  END IF;

  INSERT INTO sot.people (
    display_name,
    data_source,
    data_quality,
    entity_type,
    is_canonical
  ) VALUES (
    v_display_name,
    p_source_system,
    'skeleton',
    'individual',
    FALSE
  )
  RETURNING person_id INTO v_person_id;

  IF p_address IS NOT NULL AND TRIM(p_address) != '' AND TRIM(p_address) != ', , ,' THEN
    v_place_id := sot.find_or_create_place_deduped(
      p_address, NULL, NULL, NULL, p_source_system
    );

    IF v_place_id IS NOT NULL THEN
      INSERT INTO sot.person_place (
        person_id, place_id, role, source_system, confidence, note
      ) VALUES (
        v_person_id, v_place_id, 'resident', p_source_system, 0.70,
        'Skeleton person from ' || p_source_system || ' — no contact info'
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  INSERT INTO sot.entity_edits (
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
$$;

-- ============================================================================
-- 6. Create match_volunteerhub_volunteer function
-- ============================================================================
CREATE OR REPLACE FUNCTION sot.match_volunteerhub_volunteer(p_volunteerhub_id TEXT)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_vol RECORD;
    v_result RECORD;
    v_person_id UUID;
    v_confidence NUMERIC;
    v_method TEXT;
    v_address TEXT;
    v_is_blacklisted BOOLEAN;
BEGIN
    -- Get the volunteer record
    SELECT * INTO v_vol
    FROM source.volunteerhub_volunteers
    WHERE volunteerhub_id = p_volunteerhub_id;

    IF v_vol IS NULL THEN
        RETURN NULL;
    END IF;

    -- GUARD: Respect match_locked
    IF v_vol.match_locked = TRUE AND v_vol.matched_person_id IS NOT NULL THEN
        RAISE NOTICE 'Volunteer % match is locked — skipping', p_volunteerhub_id;
        RETURN v_vol.matched_person_id;
    END IF;

    -- Strategy 1: Exact email match
    IF v_vol.email_norm IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM sot.soft_blacklist sbl
            WHERE sbl.identifier_type = 'email'
              AND sbl.identifier_norm = v_vol.email_norm
        ) INTO v_is_blacklisted;

        IF NOT v_is_blacklisted THEN
            SELECT sp.person_id INTO v_person_id
            FROM sot.person_identifiers pi
            JOIN sot.people sp ON sp.person_id = pi.person_id
            WHERE pi.id_type = 'email'
              AND pi.id_value_norm = v_vol.email_norm
              AND sp.merged_into_person_id IS NULL
              AND NOT sot.is_organization_name(sp.display_name)
            LIMIT 1;

            IF v_person_id IS NOT NULL THEN
                v_confidence := 1.0;
                v_method := 'email';
            END IF;
        ELSE
            RAISE NOTICE 'Email % is soft-blacklisted for volunteer %', v_vol.email_norm, p_volunteerhub_id;
        END IF;
    END IF;

    -- Strategy 2: Phone match
    IF v_person_id IS NULL AND v_vol.phone_norm IS NOT NULL AND LENGTH(v_vol.phone_norm) = 10 THEN
        SELECT EXISTS (
            SELECT 1 FROM sot.soft_blacklist sbl
            WHERE sbl.identifier_type = 'phone'
              AND sbl.identifier_norm = v_vol.phone_norm
        ) INTO v_is_blacklisted;

        IF NOT v_is_blacklisted THEN
            SELECT sp.person_id INTO v_person_id
            FROM sot.person_identifiers pi
            JOIN sot.people sp ON sp.person_id = pi.person_id
            WHERE pi.id_type = 'phone'
              AND pi.id_value_norm = v_vol.phone_norm
              AND sp.merged_into_person_id IS NULL
              AND NOT sot.is_organization_name(sp.display_name)
            LIMIT 1;

            IF v_person_id IS NOT NULL THEN
                v_confidence := 0.9;
                v_method := 'phone';
            END IF;
        ELSE
            RAISE NOTICE 'Phone % is soft-blacklisted for volunteer %', v_vol.phone_norm, p_volunteerhub_id;
        END IF;
    END IF;

    -- Strategy 3: Data Engine
    IF v_person_id IS NULL AND (v_vol.email_norm IS NOT NULL OR (v_vol.phone_norm IS NOT NULL AND LENGTH(v_vol.phone_norm) = 10)) THEN
        SELECT * INTO v_result FROM sot.data_engine_resolve_identity(
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
            IF NOT sot.is_organization_name(
                (SELECT display_name FROM sot.people WHERE person_id = v_result.person_id)
            ) THEN
                v_person_id := v_result.person_id;
                v_confidence := v_result.confidence_score;
                v_method := 'data_engine/' || COALESCE(v_result.decision_type, 'unknown');
            ELSE
                RAISE NOTICE 'Data Engine matched to org-named person for volunteer % — skipping', p_volunteerhub_id;
            END IF;
        END IF;
    END IF;

    -- Strategy 4: Staff name match
    IF v_person_id IS NULL AND v_vol.first_name IS NOT NULL AND v_vol.last_name IS NOT NULL THEN
        SELECT sp.person_id INTO v_person_id
        FROM sot.people sp
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

        v_person_id := sot.create_skeleton_person(
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

    -- Update the volunteer record
    IF v_person_id IS NOT NULL THEN
        UPDATE source.volunteerhub_volunteers
        SET matched_person_id = v_person_id,
            matched_at = NOW(),
            match_confidence = v_confidence,
            match_method = v_method,
            sync_status = 'matched',
            synced_at = NOW()
        WHERE volunteerhub_id = p_volunteerhub_id;

        -- Add volunteer role as PENDING
        INSERT INTO sot.person_roles (person_id, role, role_status, source_system, source_record_id, started_at)
        VALUES (v_person_id, 'volunteer', 'pending', 'volunteerhub', p_volunteerhub_id, CURRENT_DATE)
        ON CONFLICT (person_id, role) DO UPDATE SET
            role_status = CASE
                WHEN sot.person_roles.role_status = 'active' THEN 'active'
                ELSE 'pending'
            END,
            updated_at = NOW();

        RAISE NOTICE 'Matched volunteer % to person % via % (confidence: %)',
            p_volunteerhub_id, v_person_id, v_method, v_confidence;
    ELSE
        UPDATE source.volunteerhub_volunteers
        SET sync_status = 'unmatched',
            synced_at = NOW()
        WHERE volunteerhub_id = p_volunteerhub_id;
    END IF;

    RETURN v_person_id;
END;
$$;

-- ============================================================================
-- 7. Create match_all_volunteerhub_volunteers function
-- ============================================================================
CREATE OR REPLACE FUNCTION sot.match_all_volunteerhub_volunteers(p_batch_size INTEGER DEFAULT 100)
RETURNS TABLE(total_processed INTEGER, total_matched INTEGER, total_pending INTEGER, total_errors INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
    v_processed INT := 0;
    v_matched INT := 0;
    v_pending INT := 0;
    v_errors INT := 0;
    v_volunteer RECORD;
    v_person_id UUID;
BEGIN
    FOR v_volunteer IN
        SELECT volunteerhub_id
        FROM source.volunteerhub_volunteers
        WHERE sync_status = 'pending'
          AND matched_person_id IS NULL
        ORDER BY imported_at
        LIMIT p_batch_size
    LOOP
        BEGIN
            v_person_id := sot.match_volunteerhub_volunteer(v_volunteer.volunteerhub_id);
            v_processed := v_processed + 1;

            IF v_person_id IS NOT NULL THEN
                v_matched := v_matched + 1;
            ELSE
                v_pending := v_pending + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            UPDATE source.volunteerhub_volunteers
            SET sync_status = 'error',
                sync_error = SQLERRM
            WHERE volunteerhub_id = v_volunteer.volunteerhub_id;
        END;
    END LOOP;

    RETURN QUERY SELECT v_processed, v_matched, v_pending, v_errors;
END;
$$;

-- ============================================================================
-- 8. Create sync_volunteer_group_memberships function
-- ============================================================================
CREATE OR REPLACE FUNCTION sot.sync_volunteer_group_memberships(p_volunteerhub_id TEXT, p_current_group_uids TEXT[])
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_joined TEXT[] := '{}';
  v_left TEXT[] := '{}';
  v_uid TEXT;
  v_group_name TEXT;
  v_person_id UUID;
BEGIN
  SELECT matched_person_id INTO v_person_id
  FROM source.volunteerhub_volunteers
  WHERE volunteerhub_id = p_volunteerhub_id;

  -- Find groups the volunteer LEFT
  FOR v_uid, v_group_name IN
    SELECT vgm.user_group_uid, vug.name
    FROM source.volunteerhub_group_memberships vgm
    JOIN source.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
    WHERE vgm.volunteerhub_id = p_volunteerhub_id
      AND vgm.left_at IS NULL
      AND vgm.user_group_uid != ALL(COALESCE(p_current_group_uids, '{}'))
  LOOP
    UPDATE source.volunteerhub_group_memberships
    SET left_at = NOW(), updated_at = NOW()
    WHERE volunteerhub_id = p_volunteerhub_id
      AND user_group_uid = v_uid
      AND left_at IS NULL;

    v_left := array_append(v_left, v_group_name);

    IF v_person_id IS NOT NULL THEN
      INSERT INTO sot.entity_edits (
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

  -- Find groups the volunteer JOINED
  FOREACH v_uid IN ARRAY COALESCE(p_current_group_uids, '{}')
  LOOP
    SELECT name INTO v_group_name
    FROM source.volunteerhub_user_groups
    WHERE user_group_uid = v_uid;

    IF NOT FOUND THEN CONTINUE; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM source.volunteerhub_group_memberships
      WHERE volunteerhub_id = p_volunteerhub_id
        AND user_group_uid = v_uid
        AND left_at IS NULL
    ) THEN
      INSERT INTO source.volunteerhub_group_memberships (
        volunteerhub_id, user_group_uid, joined_at, source
      ) VALUES (
        p_volunteerhub_id, v_uid, NOW(), 'api_sync'
      );

      v_joined := array_append(v_joined, v_group_name);

      IF v_person_id IS NOT NULL THEN
        INSERT INTO sot.entity_edits (
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

  UPDATE source.volunteerhub_volunteers
  SET user_group_uids = p_current_group_uids,
      last_api_sync_at = NOW()
  WHERE volunteerhub_id = p_volunteerhub_id;

  RETURN JSONB_BUILD_OBJECT(
    'joined', to_jsonb(v_joined),
    'left', to_jsonb(v_left)
  );
END;
$$;

-- ============================================================================
-- 9. Create process_volunteerhub_group_roles function
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.process_volunteerhub_group_roles(p_person_id UUID, p_volunteerhub_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
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
  FROM sot.person_roles
  WHERE person_id = p_person_id
    AND role = 'trapper'
    AND role_status = 'active';

  FOR v_group IN
    SELECT vug.user_group_uid, vug.name, vug.atlas_role, vug.atlas_trapper_type
    FROM source.volunteerhub_group_memberships vgm
    JOIN source.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
    WHERE vgm.volunteerhub_id = p_volunteerhub_id
      AND vgm.left_at IS NULL
      AND vug.atlas_role IS NOT NULL
  LOOP
    IF v_group.atlas_role = 'trapper' THEN
      IF v_existing_trapper_type IN ('head_trapper', 'coordinator') THEN
        UPDATE sot.person_roles
        SET role_status = 'active', updated_at = NOW()
        WHERE person_id = p_person_id AND role = 'trapper' AND role_status != 'active';
      ELSE
        INSERT INTO sot.person_roles (
          person_id, role, trapper_type, role_status, source_system, source_record_id, started_at, notes
        ) VALUES (
          p_person_id, 'trapper', 'ffsc_trapper', 'active', 'volunteerhub', p_volunteerhub_id,
          CURRENT_DATE, 'VH group: ' || v_group.name
        )
        ON CONFLICT (person_id, role) DO UPDATE SET
          role_status = 'active',
          trapper_type = CASE
            WHEN sot.person_roles.trapper_type IN ('head_trapper', 'coordinator')
            THEN sot.person_roles.trapper_type
            ELSE 'ffsc_trapper'
          END,
          source_system = CASE
            WHEN sot.person_roles.source_system = 'volunteerhub' OR sot.person_roles.trapper_type NOT IN ('head_trapper', 'coordinator')
            THEN 'volunteerhub'
            ELSE sot.person_roles.source_system
          END,
          updated_at = NOW();
      END IF;
      v_roles_assigned := array_append(v_roles_assigned, 'trapper/ffsc_trapper');
    ELSE
      INSERT INTO sot.person_roles (
        person_id, role, role_status, source_system, source_record_id, started_at, notes
      ) VALUES (
        p_person_id, v_group.atlas_role, 'active', 'volunteerhub', p_volunteerhub_id,
        CURRENT_DATE, 'VH group: ' || v_group.name
      )
      ON CONFLICT (person_id, role) DO UPDATE SET
        role_status = 'active',
        source_system = CASE
          WHEN sot.person_roles.source_system = 'volunteerhub' THEN 'volunteerhub'
          ELSE sot.person_roles.source_system
        END,
        notes = CASE
          WHEN sot.person_roles.notes IS NULL THEN 'VH group: ' || v_group.name
          WHEN sot.person_roles.notes NOT LIKE '%VH group:%' THEN sot.person_roles.notes || '; VH group: ' || v_group.name
          ELSE sot.person_roles.notes
        END,
        updated_at = NOW();
      v_roles_assigned := array_append(v_roles_assigned, v_group.atlas_role);
    END IF;
  END LOOP;

  -- Upgrade volunteer role to active if in any approved group
  IF array_length(v_roles_assigned, 1) > 0 OR EXISTS (
    SELECT 1 FROM source.volunteerhub_group_memberships vgm
    JOIN source.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
    WHERE vgm.volunteerhub_id = p_volunteerhub_id
      AND vgm.left_at IS NULL
      AND (vug.is_approved_parent = TRUE
           OR vug.parent_user_group_uid IN (
             SELECT user_group_uid FROM source.volunteerhub_user_groups WHERE is_approved_parent = TRUE
           ))
  ) THEN
    INSERT INTO sot.person_roles (
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
$$;

-- ============================================================================
-- 10. Create enforce_vh_role_authority function
-- ============================================================================
CREATE OR REPLACE FUNCTION sot.enforce_vh_role_authority(p_dry_run BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_rec RECORD;
  v_deactivated INT := 0;
  v_skipped INT := 0;
  v_details JSONB := '[]'::JSONB;
  v_has_backing BOOLEAN;
BEGIN
  FOR v_rec IN
    SELECT
      pr.role_id,
      pr.person_id,
      pr.role,
      pr.trapper_type,
      pr.source_system,
      sp.display_name
    FROM sot.person_roles pr
    JOIN sot.people sp ON sp.person_id = pr.person_id
    WHERE pr.role_status = 'active'
      AND sp.merged_into_person_id IS NULL
      AND pr.role IN ('volunteer', 'foster', 'trapper', 'caretaker', 'staff')
      AND NOT (pr.role = 'trapper' AND pr.trapper_type = 'community_trapper')
      AND COALESCE(pr.source_system, '') != 'airtable_staff'
    ORDER BY sp.display_name, pr.role
  LOOP
    IF v_rec.role = 'volunteer' THEN
      SELECT EXISTS (
        SELECT 1
        FROM source.volunteerhub_volunteers vv
        JOIN source.volunteerhub_group_memberships vgm
          ON vgm.volunteerhub_id = vv.volunteerhub_id
        WHERE vv.matched_person_id = v_rec.person_id
          AND vgm.left_at IS NULL
      ) INTO v_has_backing;
    ELSE
      SELECT EXISTS (
        SELECT 1
        FROM source.volunteerhub_volunteers vv
        JOIN source.volunteerhub_group_memberships vgm
          ON vgm.volunteerhub_id = vv.volunteerhub_id
        JOIN source.volunteerhub_user_groups vug
          ON vug.user_group_uid = vgm.user_group_uid
        WHERE vv.matched_person_id = v_rec.person_id
          AND vgm.left_at IS NULL
          AND vug.atlas_role = v_rec.role
      ) INTO v_has_backing;
    END IF;

    IF v_has_backing THEN
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      v_skipped := v_skipped + 1;
      v_details := v_details || jsonb_build_object(
        'person', v_rec.display_name,
        'role', v_rec.role,
        'trapper_type', v_rec.trapper_type,
        'source', v_rec.source_system,
        'action', 'would_deactivate'
      );
      CONTINUE;
    END IF;

    UPDATE sot.person_roles
    SET role_status = 'inactive',
        ended_at = CURRENT_DATE,
        notes = COALESCE(notes || '; ', '') ||
          'MIG_2025: Deactivated — not backed by current VH group membership',
        updated_at = NOW()
    WHERE role_id = v_rec.role_id;

    INSERT INTO sot.role_reconciliation_log (
      person_id, role, previous_status, new_status,
      reason, source_system, evidence
    ) VALUES (
      v_rec.person_id,
      v_rec.role,
      'active',
      'inactive',
      'enforce_vh_role_authority: No current VH group backs this role',
      v_rec.source_system,
      jsonb_build_object(
        'trapper_type', v_rec.trapper_type,
        'original_source', v_rec.source_system,
        'display_name', v_rec.display_name
      )
    );

    INSERT INTO sot.entity_edits (
      entity_type, entity_id, edit_type, field_name,
      old_value, new_value, reason,
      edit_source, edited_by
    ) VALUES (
      'person', v_rec.person_id, 'status_change', 'role_status',
      to_jsonb('active'::text), to_jsonb('inactive'::text),
      'VH authority: ' || v_rec.role || ' role deactivated — no current VH group with atlas_role=''' || v_rec.role || '''',
      'system', 'enforce_vh_role_authority'
    );

    v_deactivated := v_deactivated + 1;
    v_details := v_details || jsonb_build_object(
      'person', v_rec.display_name,
      'role', v_rec.role,
      'trapper_type', v_rec.trapper_type,
      'source', v_rec.source_system,
      'action', 'deactivated'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'deactivated', v_deactivated,
    'skipped', v_skipped,
    'dry_run', p_dry_run,
    'details', v_details
  );
END;
$$;

-- ============================================================================
-- Grant permissions
-- ============================================================================
GRANT ALL ON sot.role_reconciliation_log TO postgres;
GRANT ALL ON sot.trusted_person_sources TO postgres;
GRANT EXECUTE ON FUNCTION sot.is_internal_account(TEXT) TO postgres;
GRANT EXECUTE ON FUNCTION sot.create_skeleton_person(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO postgres;
GRANT EXECUTE ON FUNCTION sot.match_volunteerhub_volunteer(TEXT) TO postgres;
GRANT EXECUTE ON FUNCTION sot.match_all_volunteerhub_volunteers(INTEGER) TO postgres;
GRANT EXECUTE ON FUNCTION sot.sync_volunteer_group_memberships(TEXT, TEXT[]) TO postgres;
GRANT EXECUTE ON FUNCTION ops.process_volunteerhub_group_roles(UUID, TEXT) TO postgres;
GRANT EXECUTE ON FUNCTION sot.enforce_vh_role_authority(BOOLEAN) TO postgres;

-- ============================================================================
-- Summary
-- ============================================================================
-- Enhanced tables:
-- - sot.person_roles (added trapper_type, source_record_id, started_at, ended_at, notes, updated_at)
--
-- Created tables:
-- - sot.role_reconciliation_log
-- - sot.trusted_person_sources
--
-- Created functions:
-- - sot.is_internal_account()
-- - sot.create_skeleton_person()
-- - sot.match_volunteerhub_volunteer()
-- - sot.match_all_volunteerhub_volunteers()
-- - sot.sync_volunteer_group_memberships()
-- - ops.process_volunteerhub_group_roles()
-- - sot.enforce_vh_role_authority()
