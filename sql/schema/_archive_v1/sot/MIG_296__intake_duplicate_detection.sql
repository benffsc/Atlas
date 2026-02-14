-- MIG_296: Intake Duplicate Detection
--
-- Adds duplicate detection for intake submissions to prevent the same
-- person from submitting multiple times for the same address.
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_296__intake_duplicate_detection.sql

\echo ''
\echo 'MIG_296: Intake Duplicate Detection'
\echo '===================================='
\echo ''

-- 1. Add columns for duplicate tracking
\echo 'Adding duplicate tracking columns...'

ALTER TABLE trapper.web_intake_submissions
  ADD COLUMN IF NOT EXISTS potential_duplicate_of UUID REFERENCES trapper.web_intake_submissions(submission_id),
  ADD COLUMN IF NOT EXISTS duplicate_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN trapper.web_intake_submissions.potential_duplicate_of IS
'If set, this submission may be a duplicate of another submission';

COMMENT ON COLUMN trapper.web_intake_submissions.duplicate_checked_at IS
'When duplicate check was last performed';

-- 2. Create function to find potential duplicates
\echo 'Creating duplicate detection function...'

CREATE OR REPLACE FUNCTION trapper.find_intake_duplicates(
  p_email TEXT,
  p_phone TEXT,
  p_address TEXT,
  p_days_window INT DEFAULT 30
)
RETURNS TABLE (
  submission_id UUID,
  submitted_at TIMESTAMPTZ,
  submitter_name TEXT,
  email TEXT,
  cats_address TEXT,
  submission_status trapper.intake_submission_status,
  match_type TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    w.submission_id,
    w.submitted_at,
    (w.first_name || ' ' || w.last_name)::TEXT AS submitter_name,
    w.email,
    w.cats_address,
    w.submission_status,
    CASE
      WHEN w.email = p_email AND w.cats_address ILIKE '%' || p_address || '%' THEN 'email+address'
      WHEN trapper.norm_phone_us(w.phone) = trapper.norm_phone_us(p_phone) AND w.cats_address ILIKE '%' || p_address || '%' THEN 'phone+address'
      WHEN w.email = p_email THEN 'email_only'
      WHEN trapper.norm_phone_us(w.phone) = trapper.norm_phone_us(p_phone) THEN 'phone_only'
      ELSE 'address_only'
    END AS match_type
  FROM trapper.web_intake_submissions w
  WHERE w.submitted_at > NOW() - (p_days_window || ' days')::INTERVAL
    AND w.submission_status NOT IN ('archived', 'complete')
    AND (
      w.email = p_email
      OR trapper.norm_phone_us(w.phone) = trapper.norm_phone_us(p_phone)
      OR w.cats_address ILIKE '%' || p_address || '%'
    )
  ORDER BY
    CASE
      WHEN w.email = p_email AND w.cats_address ILIKE '%' || p_address || '%' THEN 1
      WHEN trapper.norm_phone_us(w.phone) = trapper.norm_phone_us(p_phone) AND w.cats_address ILIKE '%' || p_address || '%' THEN 2
      WHEN w.email = p_email THEN 3
      WHEN trapper.norm_phone_us(w.phone) = trapper.norm_phone_us(p_phone) THEN 4
      ELSE 5
    END,
    w.submitted_at DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_intake_duplicates IS
'Finds potential duplicate intake submissions by email, phone, or address within N days.';

-- 3. Create function to check for duplicates on new submission
\echo 'Creating duplicate check trigger function...'

CREATE OR REPLACE FUNCTION trapper.check_intake_duplicate()
RETURNS TRIGGER AS $$
DECLARE
  v_duplicate_id UUID;
BEGIN
  -- Look for existing submission with same email+address in last 30 days
  SELECT submission_id INTO v_duplicate_id
  FROM trapper.web_intake_submissions
  WHERE submission_id != NEW.submission_id
    AND submitted_at > NOW() - INTERVAL '30 days'
    AND submission_status NOT IN ('archived', 'complete')
    AND (
      (email = NEW.email AND cats_address ILIKE '%' || NEW.cats_address || '%')
      OR (trapper.norm_phone_us(phone) = trapper.norm_phone_us(NEW.phone) AND cats_address ILIKE '%' || NEW.cats_address || '%')
    )
  ORDER BY submitted_at DESC
  LIMIT 1;

  IF v_duplicate_id IS NOT NULL THEN
    NEW.potential_duplicate_of := v_duplicate_id;
  END IF;

  NEW.duplicate_checked_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Create trigger for new submissions
DROP TRIGGER IF EXISTS trg_check_intake_duplicate ON trapper.web_intake_submissions;

CREATE TRIGGER trg_check_intake_duplicate
  BEFORE INSERT ON trapper.web_intake_submissions
  FOR EACH ROW
  EXECUTE FUNCTION trapper.check_intake_duplicate();

\echo 'Duplicate detection trigger created'

-- 5. Create view for potential duplicates
\echo 'Creating potential duplicates view...'

CREATE OR REPLACE VIEW trapper.v_intake_potential_duplicates AS
SELECT
  w1.submission_id,
  w1.submitted_at,
  w1.first_name || ' ' || w1.last_name AS submitter_name,
  w1.email,
  w1.phone,
  w1.cats_address,
  w1.submission_status,
  w1.potential_duplicate_of,
  w2.submitted_at AS original_submitted_at,
  w2.first_name || ' ' || w2.last_name AS original_submitter_name,
  w2.submission_status AS original_status
FROM trapper.web_intake_submissions w1
JOIN trapper.web_intake_submissions w2 ON w2.submission_id = w1.potential_duplicate_of
WHERE w1.potential_duplicate_of IS NOT NULL
  AND w1.submission_status NOT IN ('archived', 'complete')
ORDER BY w1.submitted_at DESC;

COMMENT ON VIEW trapper.v_intake_potential_duplicates IS
'Shows intake submissions that may be duplicates of earlier submissions';

-- 6. Run duplicate check on existing submissions
\echo 'Checking existing submissions for duplicates...'

UPDATE trapper.web_intake_submissions w1
SET
  potential_duplicate_of = (
    SELECT w2.submission_id
    FROM trapper.web_intake_submissions w2
    WHERE w2.submission_id != w1.submission_id
      AND w2.submitted_at < w1.submitted_at
      AND w2.submitted_at > w1.submitted_at - INTERVAL '30 days'
      AND w2.submission_status NOT IN ('archived', 'complete')
      AND (
        (w2.email = w1.email AND w2.cats_address ILIKE '%' || w1.cats_address || '%')
        OR (trapper.norm_phone_us(w2.phone) = trapper.norm_phone_us(w1.phone) AND w2.cats_address ILIKE '%' || w1.cats_address || '%')
      )
    ORDER BY w2.submitted_at DESC
    LIMIT 1
  ),
  duplicate_checked_at = NOW()
WHERE w1.duplicate_checked_at IS NULL
  AND w1.submission_status NOT IN ('archived', 'complete');

\echo ''
\echo 'MIG_296 complete!'
\echo ''
\echo 'Potential duplicates found:'
SELECT COUNT(*) AS count FROM trapper.v_intake_potential_duplicates;

\echo ''
\echo 'New features:'
\echo '  - potential_duplicate_of column on web_intake_submissions'
\echo '  - find_intake_duplicates() function for manual lookup'
\echo '  - trg_check_intake_duplicate trigger for new submissions'
\echo '  - v_intake_potential_duplicates view'
\echo ''
