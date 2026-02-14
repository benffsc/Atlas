-- MIG_239: Create People from Intake Submissions
--
-- Currently intake submissions only MATCH to existing people.
-- This adds a function to CREATE new people when no match is found.
--
-- Data flow after this migration:
--   1. Submission comes in via /api/intake
--   2. match_intake_to_person() tries to match existing person
--   3. NEW: create_person_from_intake() creates new person if no match
--   4. Person is linked via matched_person_id
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_239__intake_person_creation.sql

\echo ''
\echo 'MIG_239: Create People from Intake Submissions'
\echo '==============================================='
\echo ''

-- ============================================================
-- 1. Create function to create person from intake submission
-- ============================================================

\echo 'Creating create_person_from_intake function...'

CREATE OR REPLACE FUNCTION trapper.create_person_from_intake(p_submission_id UUID)
RETURNS UUID AS $$
DECLARE
  v_sub RECORD;
  v_person_id UUID;
  v_display_name TEXT;
  v_norm_email TEXT;
  v_norm_phone TEXT;
BEGIN
  -- Get the submission
  SELECT * INTO v_sub FROM trapper.web_intake_submissions WHERE submission_id = p_submission_id;

  IF v_sub IS NULL THEN
    RAISE NOTICE 'Submission not found: %', p_submission_id;
    RETURN NULL;
  END IF;

  -- If already matched to a person, return that
  IF v_sub.matched_person_id IS NOT NULL THEN
    RETURN v_sub.matched_person_id;
  END IF;

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

  -- Try one more time to find existing person by email
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
      RETURN v_person_id;
    END IF;
  END IF;

  -- Try to find by phone
  IF v_norm_phone IS NOT NULL THEN
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
      RETURN v_person_id;
    END IF;
  END IF;

  -- No match found - create new person
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
  RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_person_from_intake(UUID) IS
'Creates a new person from an intake submission if no match exists.
Uses email/phone identity resolution rules and respects blacklists.';

-- ============================================================
-- 2. Update match_intake_to_person to also create if no match
-- ============================================================

\echo 'Updating match_intake_to_person to create new people...'

CREATE OR REPLACE FUNCTION trapper.match_intake_to_person(p_submission_id UUID)
RETURNS UUID AS $$
DECLARE
  v_sub RECORD;
  v_person_id UUID;
  v_norm_email TEXT;
  v_norm_phone TEXT;
BEGIN
  SELECT * INTO v_sub FROM trapper.web_intake_submissions WHERE submission_id = p_submission_id;

  IF v_sub IS NULL THEN
    RETURN NULL;
  END IF;

  -- Already matched?
  IF v_sub.matched_person_id IS NOT NULL THEN
    RETURN v_sub.matched_person_id;
  END IF;

  -- Normalize identifiers
  v_norm_email := NULLIF(lower(trim(v_sub.email)), '');
  v_norm_phone := trapper.norm_phone_us(v_sub.phone);

  -- Try to match by email first (most reliable)
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
      RETURN v_person_id;
    END IF;
  END IF;

  -- Try to match by phone
  IF v_norm_phone IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM trapper.identity_phone_blacklist WHERE phone_norm = v_norm_phone
  ) THEN
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
      RETURN v_person_id;
    END IF;
  END IF;

  -- No match found - CREATE new person
  v_person_id := trapper.create_person_from_intake(p_submission_id);
  RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.match_intake_to_person(UUID) IS
'Matches intake submission to existing person by email/phone.
If no match found, creates a new person record.
Respects phone blacklist and merged person exclusions.';

-- ============================================================
-- 3. Backfill: Create people for existing unmatched submissions
-- ============================================================

\echo 'Backfilling people for unmatched submissions...'

DO $$
DECLARE
  v_count INT := 0;
  v_sub RECORD;
BEGIN
  FOR v_sub IN
    SELECT submission_id
    FROM trapper.web_intake_submissions
    WHERE matched_person_id IS NULL
      AND (email IS NOT NULL OR phone IS NOT NULL)
      AND first_name IS NOT NULL
    ORDER BY submitted_at
  LOOP
    PERFORM trapper.create_person_from_intake(v_sub.submission_id);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Created people for % unmatched submissions', v_count;
END;
$$;

-- ============================================================
-- 4. Add trigger to auto-create person on insert (optional)
-- ============================================================

\echo 'Creating trigger for automatic person creation...'

CREATE OR REPLACE FUNCTION trapper.trigger_intake_create_person()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process if we have contact info
  IF NEW.email IS NOT NULL OR NEW.phone IS NOT NULL THEN
    -- Run async to not block insert
    PERFORM trapper.match_intake_to_person(NEW.submission_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_intake_create_person ON trapper.web_intake_submissions;
CREATE TRIGGER trg_intake_create_person
  AFTER INSERT ON trapper.web_intake_submissions
  FOR EACH ROW
  EXECUTE FUNCTION trapper.trigger_intake_create_person();

COMMENT ON TRIGGER trg_intake_create_person ON trapper.web_intake_submissions IS
'Automatically matches or creates a person record when new intake submission is inserted.';

-- ============================================================
-- Summary
-- ============================================================

\echo ''
\echo 'MIG_239 Complete!'
\echo ''
\echo 'What changed:'
\echo '  - create_person_from_intake(): Creates new person if no match found'
\echo '  - match_intake_to_person(): Now creates person if no match (was match-only)'
\echo '  - Trigger: Auto-runs on new submissions'
\echo '  - Backfill: Created people for existing unmatched submissions'
\echo ''
\echo 'Identity resolution rules:'
\echo '  1. Match by email (exact, case-insensitive)'
\echo '  2. Match by phone (normalized US format)'
\echo '  3. Respect phone blacklist'
\echo '  4. Exclude merged persons'
\echo '  5. Create new person if no match found'
\echo ''
