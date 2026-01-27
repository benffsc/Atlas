\echo '=== MIG_566: Fix create_person_from_intake function ==='
\echo 'Remove non-existent first_name/last_name columns from sot_people INSERT'

CREATE OR REPLACE FUNCTION trapper.create_person_from_intake(p_submission_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $$
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

    -- Build display name from first_name and last_name
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
    -- NOTE: sot_people uses display_name, not separate first_name/last_name
    IF v_person_id IS NULL THEN
      INSERT INTO trapper.sot_people (
        display_name,
        primary_email,
        primary_phone,
        data_source,
        created_at,
        updated_at
      ) VALUES (
        v_display_name,
        v_norm_email,
        v_norm_phone,
        'web_intake',
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
  -- Handle requester address linking
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
$$;

\echo 'Fixed: Removed first_name, last_name, source_system, source_record_id, source_created_at'
\echo 'Now uses: display_name, primary_email, primary_phone, data_source'
