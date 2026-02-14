\echo ''
\echo '=============================================='
\echo 'MIG_538: Intake Requester Address Handling'
\echo '=============================================='
\echo ''
\echo 'Ensures requester home addresses are properly captured and linked.'
\echo 'Adds columns for tracking requester place and creates person-place relationships.'
\echo ''

-- ============================================================================
-- STEP 1: Add requester_place_id column to web_intake_submissions
-- ============================================================================

\echo 'Step 1: Adding requester_place_id column...'

ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS requester_place_id UUID REFERENCES trapper.places(place_id);

COMMENT ON COLUMN trapper.web_intake_submissions.requester_place_id IS
'Place ID for requester home address (when different from cat location)';

-- ============================================================================
-- STEP 2: Add cats_at_requester_address flag
-- ============================================================================

\echo 'Step 2: Adding cats_at_requester_address column...'

ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS cats_at_requester_address BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN trapper.web_intake_submissions.cats_at_requester_address IS
'True if cats are at requester home address, false if at different location';

-- ============================================================================
-- STEP 3: Add selected_address_place_id for using known addresses
-- ============================================================================

\echo 'Step 3: Adding selected_address_place_id column...'

ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS selected_address_place_id UUID REFERENCES trapper.places(place_id);

COMMENT ON COLUMN trapper.web_intake_submissions.selected_address_place_id IS
'When user selects an existing address from person dropdown, this stores that place_id';

-- ============================================================================
-- STEP 4: Update create_person_from_intake to handle requester address
-- ============================================================================

\echo 'Step 4: Updating create_person_from_intake function...'

CREATE OR REPLACE FUNCTION trapper.create_person_from_intake(p_submission_id UUID)
RETURNS UUID AS $$
DECLARE
  v_sub RECORD;
  v_person_id UUID;
  v_display_name TEXT;
  v_norm_email TEXT;
  v_norm_phone TEXT;
  v_requester_address TEXT;
  v_requester_place_id UUID;
BEGIN
  -- Get the submission
  SELECT * INTO v_sub FROM trapper.web_intake_submissions WHERE submission_id = p_submission_id;

  IF v_sub IS NULL THEN
    RAISE NOTICE 'Submission not found: %', p_submission_id;
    RETURN NULL;
  END IF;

  -- If already matched to a person, use that
  IF v_sub.matched_person_id IS NOT NULL THEN
    v_person_id := v_sub.matched_person_id;
  ELSE
    -- Normalize email and phone
    v_norm_email := NULLIF(lower(trim(v_sub.email)), '');
    v_norm_phone := trapper.norm_phone_us(v_sub.phone);

    -- Check blacklists
    IF v_norm_phone IS NOT NULL AND EXISTS (
      SELECT 1 FROM trapper.identity_phone_blacklist WHERE phone_norm = v_norm_phone
    ) THEN
      RAISE NOTICE 'Phone is blacklisted: %', v_norm_phone;
      v_norm_phone := NULL;
    END IF;

    -- Build display name
    v_display_name := NULLIF(trim(
      COALESCE(v_sub.first_name, '') || ' ' || COALESCE(v_sub.last_name, '')
    ), '');

    -- Try to find existing person by email
    IF v_norm_email IS NOT NULL THEN
      SELECT pi.person_id INTO v_person_id
      FROM trapper.person_identifiers pi
      JOIN trapper.sot_people p ON p.person_id = pi.person_id
      WHERE pi.id_type = 'email'
        AND pi.id_value_norm = v_norm_email
        AND p.merged_into_person_id IS NULL
      LIMIT 1;

      IF v_person_id IS NOT NULL THEN
        UPDATE trapper.web_intake_submissions
        SET matched_person_id = v_person_id
        WHERE submission_id = p_submission_id;
      END IF;
    END IF;

    -- Try to find by phone if no email match
    IF v_person_id IS NULL AND v_norm_phone IS NOT NULL THEN
      SELECT pi.person_id INTO v_person_id
      FROM trapper.person_identifiers pi
      JOIN trapper.sot_people p ON p.person_id = pi.person_id
      WHERE pi.id_type = 'phone'
        AND pi.id_value_norm = v_norm_phone
        AND p.merged_into_person_id IS NULL
      LIMIT 1;

      IF v_person_id IS NOT NULL THEN
        UPDATE trapper.web_intake_submissions
        SET matched_person_id = v_person_id
        WHERE submission_id = p_submission_id;
      END IF;
    END IF;

    -- No match found - create new person
    IF v_person_id IS NULL THEN
      INSERT INTO trapper.sot_people (
        display_name,
        first_name,
        last_name,
        primary_email,
        primary_phone,
        source_system,
        source_record_id,
        source_created_at,
        created_at,
        updated_at
      ) VALUES (
        v_display_name,
        v_sub.first_name,
        v_sub.last_name,
        v_norm_email,
        v_norm_phone,
        COALESCE(v_sub.source_system, 'web_intake'),
        v_sub.submission_id::TEXT,
        v_sub.submitted_at,
        NOW(),
        NOW()
      )
      RETURNING person_id INTO v_person_id;

      -- Add email identifier
      IF v_norm_email IS NOT NULL THEN
        INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system)
        VALUES (v_person_id, 'email', v_sub.email, v_norm_email, 'web_intake')
        ON CONFLICT (id_type, id_value_norm) DO NOTHING;
      END IF;

      -- Add phone identifier
      IF v_norm_phone IS NOT NULL THEN
        INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system)
        VALUES (v_person_id, 'phone', v_sub.phone, v_norm_phone, 'web_intake')
        ON CONFLICT (id_type, id_value_norm) DO NOTHING;
      END IF;

      -- Update submission with new person
      UPDATE trapper.web_intake_submissions
      SET matched_person_id = v_person_id
      WHERE submission_id = p_submission_id;

      RAISE NOTICE 'Created new person % for submission %', v_person_id, p_submission_id;
    END IF;
  END IF;

  -- ============================================
  -- NEW: Handle requester address linking
  -- ============================================

  -- Build full requester address
  v_requester_address := NULLIF(TRIM(
    COALESCE(v_sub.requester_address, '') ||
    CASE WHEN v_sub.requester_city IS NOT NULL THEN ', ' || v_sub.requester_city ELSE '' END ||
    CASE WHEN v_sub.requester_zip IS NOT NULL THEN ' ' || v_sub.requester_zip ELSE '' END
  ), '');

  -- If requester address exists and is different from cat location
  IF v_requester_address IS NOT NULL
     AND v_requester_address != COALESCE(v_sub.cats_address, '')
     AND v_person_id IS NOT NULL THEN

    -- Create or find place for requester home
    v_requester_place_id := trapper.find_or_create_place_deduped(
      p_formatted_address := v_requester_address,
      p_display_name := NULL,
      p_latitude := NULL,
      p_longitude := NULL,
      p_source_system := 'web_intake'
    );

    IF v_requester_place_id IS NOT NULL THEN
      -- Link person to their home address with 'resident' role
      INSERT INTO trapper.person_place_relationships (
        person_id, place_id, role, confidence, source_system, source_table
      ) VALUES (
        v_person_id, v_requester_place_id, 'resident', 0.95, 'web_intake', 'web_intake_submissions'
      )
      ON CONFLICT (person_id, place_id, role) DO NOTHING;

      -- Update submission with requester place
      UPDATE trapper.web_intake_submissions
      SET requester_place_id = v_requester_place_id
      WHERE submission_id = p_submission_id;

      RAISE NOTICE 'Linked person % to home address % (place %)', v_person_id, v_requester_address, v_requester_place_id;
    END IF;
  END IF;

  -- If cats are at requester's address (same location), also link as resident
  IF v_sub.cats_at_requester_address = TRUE
     AND v_sub.place_id IS NOT NULL
     AND v_person_id IS NOT NULL THEN

    INSERT INTO trapper.person_place_relationships (
      person_id, place_id, role, confidence, source_system, source_table
    ) VALUES (
      v_person_id, v_sub.place_id, 'resident', 0.90, 'web_intake', 'web_intake_submissions'
    )
    ON CONFLICT (person_id, place_id, role) DO NOTHING;

    RAISE NOTICE 'Linked person % to cat location as resident (cats at home)', v_person_id;
  END IF;

  RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_person_from_intake(UUID) IS
'Creates or matches a person from intake submission.
Now also creates person_place_relationships for requester home address.
- If requester_address differs from cats_address, creates place and links as resident
- If cats_at_requester_address is true, links cat location place as resident';

-- ============================================================================
-- STEP 5: Create function to link existing person to intake place
-- ============================================================================

\echo 'Step 5: Creating link_intake_person_to_place function...'

CREATE OR REPLACE FUNCTION trapper.link_intake_person_to_place(p_submission_id UUID)
RETURNS VOID AS $$
DECLARE
  v_sub RECORD;
BEGIN
  SELECT * INTO v_sub FROM trapper.web_intake_submissions WHERE submission_id = p_submission_id;

  IF v_sub IS NULL OR v_sub.matched_person_id IS NULL THEN
    RETURN;
  END IF;

  -- If cats at requester address, link person as resident
  IF v_sub.cats_at_requester_address = TRUE AND v_sub.place_id IS NOT NULL THEN
    INSERT INTO trapper.person_place_relationships (
      person_id, place_id, role, confidence, source_system, source_table
    ) VALUES (
      v_sub.matched_person_id, v_sub.place_id, 'resident', 0.90, 'web_intake', 'web_intake_submissions'
    )
    ON CONFLICT (person_id, place_id, role) DO NOTHING;
  END IF;

  -- If requester place exists, link person as resident
  IF v_sub.requester_place_id IS NOT NULL THEN
    INSERT INTO trapper.person_place_relationships (
      person_id, place_id, role, confidence, source_system, source_table
    ) VALUES (
      v_sub.matched_person_id, v_sub.requester_place_id, 'resident', 0.95, 'web_intake', 'web_intake_submissions'
    )
    ON CONFLICT (person_id, place_id, role) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_intake_person_to_place(UUID) IS
'Links existing person to places from intake submission.
Called when using existing person_id selection in intake form.';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_538 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  - Added requester_place_id column to web_intake_submissions'
\echo '  - Added cats_at_requester_address column to web_intake_submissions'
\echo '  - Added selected_address_place_id column to web_intake_submissions'
\echo '  - Updated create_person_from_intake to create person_place_relationships'
\echo '  - Created link_intake_person_to_place function for existing person linking'
\echo ''
\echo 'New behavior:'
\echo '  1. When requester address differs from cat location:'
\echo '     - Creates place for requester home'
\echo '     - Links person to home with role=resident'
\echo '  2. When cats_at_requester_address = true:'
\echo '     - Links person to cat location with role=resident'
\echo ''
