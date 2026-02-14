-- MIG_468: VolunteerHub Processing - Unified Data Engine Integration
--
-- Creates processor for VolunteerHub user records that:
-- 1. Works with staged_records (unified flow)
-- 2. Creates people via find_or_create_person
-- 3. Assigns volunteer role
-- 4. Detects and assigns foster role from tags
--
-- MANUAL APPLY:
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_468__volunteerhub_processing.sql

\echo ''
\echo '╔══════════════════════════════════════════════════════════════════════╗'
\echo '║  MIG_468: VolunteerHub Processing - Unified Data Engine Integration  ║'
\echo '╚══════════════════════════════════════════════════════════════════════╝'
\echo ''

-- ============================================================================
-- PART 1: Fix MIG_350 column name bug (role_type → role)
-- ============================================================================

\echo 'Fixing MIG_350 match_volunteerhub_volunteer function column names...'

CREATE OR REPLACE FUNCTION trapper.match_volunteerhub_volunteer(
    p_volunteerhub_id TEXT
)
RETURNS UUID AS $$
DECLARE
    v_vol RECORD;
    v_result RECORD;
    v_person_id UUID;
    v_confidence NUMERIC;
    v_method TEXT;
BEGIN
    -- Get the volunteer record
    SELECT * INTO v_vol
    FROM trapper.volunteerhub_volunteers
    WHERE volunteerhub_id = p_volunteerhub_id;

    IF v_vol IS NULL THEN
        RETURN NULL;
    END IF;

    -- First try exact email match (highest confidence)
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
    ELSE
        -- Try phone match
        IF v_vol.phone_norm IS NOT NULL AND LENGTH(v_vol.phone_norm) = 10 THEN
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
    END IF;

    -- If still no match, use Data Engine for fuzzy matching
    IF v_person_id IS NULL THEN
        SELECT * INTO v_result FROM trapper.data_engine_resolve_identity(
            p_email := v_vol.email,
            p_phone := v_vol.phone,
            p_first_name := v_vol.first_name,
            p_last_name := v_vol.last_name,
            p_address := v_vol.full_address,
            p_source_system := 'volunteerhub',
            p_staged_record_id := NULL
        );

        v_person_id := v_result.person_id;
        v_confidence := v_result.confidence_score;
        v_method := 'data_engine';
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

        -- FIX: Use 'role' not 'role_type'
        -- Add volunteer role using the new assign_person_role function
        PERFORM trapper.assign_person_role(v_person_id, 'volunteer', 'volunteerhub');

        -- Check for foster tags and assign foster role
        IF EXISTS (
            SELECT 1 FROM trapper.volunteerhub_volunteers
            WHERE volunteerhub_id = p_volunteerhub_id
              AND (
                roles::text ILIKE '%foster%'
                OR tags::text ILIKE '%foster%'
                OR roles::text ILIKE '%kitten%'
              )
        ) THEN
            PERFORM trapper.assign_person_role(v_person_id, 'foster', 'volunteerhub');
        END IF;

        RAISE NOTICE 'Matched volunteer % to person % via % (confidence: %)',
            p_volunteerhub_id, v_person_id, v_method, v_confidence;
    ELSE
        UPDATE trapper.volunteerhub_volunteers
        SET sync_status = 'pending',
            synced_at = NOW()
        WHERE volunteerhub_id = p_volunteerhub_id;
    END IF;

    RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

\echo 'Fixed match_volunteerhub_volunteer function'

-- ============================================================================
-- PART 2: Create processor for staged_records (unified data engine flow)
-- ============================================================================

\echo 'Creating process_volunteerhub_user processor function...'

CREATE OR REPLACE FUNCTION trapper.process_volunteerhub_user(p_staged_record_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_record RECORD;
  v_person_id UUID;
  v_email TEXT;
  v_phone TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_roles JSONB;
  v_tags TEXT;
  v_is_foster BOOLEAN := false;
  v_address TEXT;
  v_result RECORD;
  v_roles_assigned TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Get the staged record
  SELECT * INTO v_record
  FROM trapper.staged_records
  WHERE id = p_staged_record_id;

  IF v_record IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Staged record not found',
      'staged_record_id', p_staged_record_id
    );
  END IF;

  -- Extract fields from payload (handle various field name formats)
  v_email := COALESCE(
    v_record.payload->>'Email',
    v_record.payload->>'email',
    v_record.payload->>'Primary Email',
    v_record.payload->>'Email Address'
  );

  v_phone := COALESCE(
    v_record.payload->>'Phone',
    v_record.payload->>'phone',
    v_record.payload->>'Primary Phone',
    v_record.payload->>'Cell Phone',
    v_record.payload->>'Mobile Phone'
  );

  v_first_name := COALESCE(
    v_record.payload->>'First Name',
    v_record.payload->>'first_name',
    v_record.payload->>'FirstName'
  );

  v_last_name := COALESCE(
    v_record.payload->>'Last Name',
    v_record.payload->>'last_name',
    v_record.payload->>'LastName'
  );

  v_address := COALESCE(
    v_record.payload->>'Address',
    v_record.payload->>'address',
    v_record.payload->>'Street Address',
    v_record.payload->>'Full Address'
  );

  -- Get roles and tags for foster detection
  v_roles := v_record.payload->'Roles';
  IF v_roles IS NULL THEN
    v_roles := v_record.payload->'roles';
  END IF;

  v_tags := COALESCE(
    v_record.payload->>'Tags',
    v_record.payload->>'tags',
    ''
  );

  -- Detect if this person is a foster
  v_is_foster := (
    v_roles::text ILIKE '%foster%'
    OR v_roles::text ILIKE '%kitten%'
    OR v_tags ILIKE '%foster%'
    OR v_tags ILIKE '%kitten foster%'
    OR v_record.payload->>'Role' ILIKE '%foster%'
    OR v_record.payload->>'Volunteer Type' ILIKE '%foster%'
  );

  -- Skip if no usable identity
  IF v_email IS NULL AND v_phone IS NULL THEN
    UPDATE trapper.staged_records
    SET is_processed = true,
        processed_at = NOW(),
        processor_name = 'process_volunteerhub_user',
        processing_error = 'No email or phone'
    WHERE id = p_staged_record_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'No email or phone to identify person',
      'staged_record_id', p_staged_record_id
    );
  END IF;

  -- Find or create person via Data Engine identity resolution
  SELECT * INTO v_result FROM trapper.data_engine_resolve_identity(
    p_email := v_email,
    p_phone := v_phone,
    p_first_name := v_first_name,
    p_last_name := v_last_name,
    p_address := v_address,
    p_source_system := 'volunteerhub',
    p_staged_record_id := p_staged_record_id
  );

  v_person_id := v_result.person_id;

  IF v_person_id IS NULL THEN
    UPDATE trapper.staged_records
    SET is_processed = true,
        processed_at = NOW(),
        processor_name = 'process_volunteerhub_user',
        processing_error = 'Failed to resolve identity'
    WHERE id = p_staged_record_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'Failed to resolve identity',
      'staged_record_id', p_staged_record_id
    );
  END IF;

  -- Assign volunteer role (always)
  PERFORM trapper.assign_person_role(v_person_id, 'volunteer', 'volunteerhub');
  v_roles_assigned := array_append(v_roles_assigned, 'volunteer');

  -- Assign foster role if detected
  IF v_is_foster THEN
    PERFORM trapper.assign_person_role(v_person_id, 'foster', 'volunteerhub');
    v_roles_assigned := array_append(v_roles_assigned, 'foster');
  END IF;

  -- Mark staged record as processed
  UPDATE trapper.staged_records
  SET is_processed = true,
      processed_at = NOW(),
      processor_name = 'process_volunteerhub_user',
      resulting_entity_type = 'person',
      resulting_entity_id = v_person_id
  WHERE id = p_staged_record_id;

  RETURN jsonb_build_object(
    'success', true,
    'person_id', v_person_id,
    'is_foster', v_is_foster,
    'roles_assigned', v_roles_assigned,
    'decision_type', v_result.decision_type,
    'confidence', v_result.confidence_score
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_volunteerhub_user IS 'Unified Data Engine processor for VolunteerHub user records.
Creates person via identity resolution, assigns volunteer role, detects and assigns foster role.';

-- ============================================================================
-- PART 3: Batch processor for VolunteerHub from staged_records
-- ============================================================================

\echo 'Creating process_all_volunteerhub_users batch function...'

CREATE OR REPLACE FUNCTION trapper.process_all_volunteerhub_users(
  p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
  v_processed INT := 0;
  v_success INT := 0;
  v_fosters INT := 0;
  v_errors INT := 0;
  v_rec RECORD;
  v_result JSONB;
BEGIN
  FOR v_rec IN
    SELECT id AS staged_record_id
    FROM trapper.staged_records
    WHERE source_system = 'volunteerhub'
      AND source_table = 'users'
      AND is_processed = false
      AND processing_error IS NULL
    ORDER BY created_at
    LIMIT p_batch_size
  LOOP
    v_result := trapper.process_volunteerhub_user(v_rec.staged_record_id);
    v_processed := v_processed + 1;

    IF (v_result->>'success')::boolean THEN
      v_success := v_success + 1;
      IF (v_result->>'is_foster')::boolean THEN
        v_fosters := v_fosters + 1;
      END IF;
    ELSE
      v_errors := v_errors + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'processed', v_processed,
    'success', v_success,
    'fosters_detected', v_fosters,
    'errors', v_errors
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_all_volunteerhub_users IS 'Batch process VolunteerHub user records from staged_records.
Run after volunteerhub_users_xlsx.mjs ingest.';

-- ============================================================================
-- PART 4: Re-process existing volunteerhub_volunteers table
-- ============================================================================

\echo 'Creating migration function to reprocess existing volunteerhub_volunteers...'

CREATE OR REPLACE FUNCTION trapper.migrate_volunteerhub_volunteers_to_roles()
RETURNS JSONB AS $$
DECLARE
  v_processed INT := 0;
  v_fosters INT := 0;
  v_errors INT := 0;
  v_rec RECORD;
BEGIN
  FOR v_rec IN
    SELECT volunteerhub_id, matched_person_id, roles, tags
    FROM trapper.volunteerhub_volunteers
    WHERE matched_person_id IS NOT NULL
  LOOP
    BEGIN
      -- Ensure volunteer role exists
      PERFORM trapper.assign_person_role(v_rec.matched_person_id, 'volunteer', 'volunteerhub');

      -- Check for foster and assign
      IF (
        v_rec.roles::text ILIKE '%foster%'
        OR v_rec.roles::text ILIKE '%kitten%'
        OR v_rec.tags::text ILIKE '%foster%'
      ) THEN
        PERFORM trapper.assign_person_role(v_rec.matched_person_id, 'foster', 'volunteerhub');
        v_fosters := v_fosters + 1;
      END IF;

      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'processed', v_processed,
    'fosters_detected', v_fosters,
    'errors', v_errors
  );
END;
$$ LANGUAGE plpgsql;

-- Run the migration
\echo 'Migrating existing volunteerhub_volunteers to person_roles...'
SELECT trapper.migrate_volunteerhub_volunteers_to_roles();

-- ============================================================================
-- PART 5: Summary
-- ============================================================================

\echo ''
\echo 'Current VolunteerHub stats:'
SELECT
  (SELECT COUNT(*) FROM trapper.volunteerhub_volunteers) AS total_in_staging_table,
  (SELECT COUNT(*) FROM trapper.volunteerhub_volunteers WHERE matched_person_id IS NOT NULL) AS matched_to_people,
  (SELECT COUNT(*) FROM trapper.person_roles WHERE role = 'volunteer' AND source_system = 'volunteerhub') AS volunteer_roles_created,
  (SELECT COUNT(*) FROM trapper.person_roles WHERE role = 'foster' AND source_system = 'volunteerhub') AS foster_roles_created;

\echo ''
\echo 'Pending staged_records for VolunteerHub:'
SELECT COUNT(*) AS pending_users
FROM trapper.staged_records
WHERE source_system = 'volunteerhub'
  AND source_table = 'users'
  AND is_processed = false;

\echo ''
\echo '╔══════════════════════════════════════════════════════════════════════╗'
\echo '║  MIG_468 COMPLETE - VolunteerHub Processing Integrated               ║'
\echo '╠══════════════════════════════════════════════════════════════════════╣'
\echo '║  Functions:                                                          ║'
\echo '║    - process_volunteerhub_user(): Processor for staged_records       ║'
\echo '║    - process_all_volunteerhub_users(): Batch processor               ║'
\echo '║    - match_volunteerhub_volunteer(): Fixed column names              ║'
\echo '║                                                                      ║'
\echo '║  Now capturing:                                                      ║'
\echo '║    - Volunteer role for all VolunteerHub users                       ║'
\echo '║    - Foster role detected from roles/tags                            ║'
\echo '║                                                                      ║'
\echo '║  Usage:                                                              ║'
\echo '║    SELECT trapper.process_all_volunteerhub_users(500);               ║'
\echo '║    -- or via API: POST /api/admin/data-engine/process               ║'
\echo '╚══════════════════════════════════════════════════════════════════════╝'
\echo ''
