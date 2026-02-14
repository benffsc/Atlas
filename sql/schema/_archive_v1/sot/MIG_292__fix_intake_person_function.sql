-- MIG_292: Fix Intake Person Creation to Use Centralized Function
--
-- Problem:
--   MIG_273's create_person_from_intake() function directly INSERTs into
--   sot_people and person_identifiers, duplicating the logic of
--   find_or_create_person(). This violates the mission contract rule:
--   "NEVER create inline INSERT statements for core entities."
--
-- Solution:
--   Replace the function to call find_or_create_person() instead.
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_292__fix_intake_person_function.sql

\echo ''
\echo 'MIG_292: Fix Intake Person Function to Use Centralized Function'
\echo '================================================================'
\echo ''

-- ============================================================
-- 1. Replace create_person_from_intake to use centralized function
-- ============================================================

\echo 'Replacing create_person_from_intake function...'

CREATE OR REPLACE FUNCTION trapper.create_person_from_intake(p_submission_id UUID)
RETURNS UUID AS $$
DECLARE
  v_sub RECORD;
  v_person_id UUID;
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

  -- Use the centralized find_or_create_person function
  -- This handles:
  --   - Email/phone normalization
  --   - Blacklist checking
  --   - Identity matching via person_identifiers
  --   - Canonical person resolution (merged person handling)
  --   - Creating person and identifiers if not found
  --   - Proper audit trail
  v_person_id := trapper.find_or_create_person(
    p_email := v_sub.email,
    p_phone := v_sub.phone,
    p_first_name := v_sub.first_name,
    p_last_name := v_sub.last_name,
    p_address := NULL,  -- No address in intake submissions at person level
    p_source_system := 'web_intake'  -- web_intake_submissions don't have source_system column
  );

  -- Update submission with the person (whether matched or created)
  IF v_person_id IS NOT NULL THEN
    UPDATE trapper.web_intake_submissions
    SET matched_person_id = v_person_id
    WHERE submission_id = p_submission_id;

    RAISE NOTICE 'Linked person % to submission %', v_person_id, p_submission_id;
  END IF;

  RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_person_from_intake IS
'Creates or finds a person from intake submission data.
Uses the centralized find_or_create_person() function to ensure:
- Consistent identity resolution
- Proper deduplication
- Audit trail compliance
- Merged entity handling';

-- ============================================================
-- 2. Verify the fix
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'
\echo ''

\echo 'Function updated:'
SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'trapper'
AND routine_name = 'create_person_from_intake';

\echo ''
SELECT 'MIG_292 Complete - Intake person creation now uses centralized function' AS status;
