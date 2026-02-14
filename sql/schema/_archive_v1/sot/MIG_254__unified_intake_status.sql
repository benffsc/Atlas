-- MIG_254: Unified Intake Status System
--
-- Simplifies the intake workflow by consolidating multiple status fields
-- into a single submission_status field, and migrates all existing data.
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_254__unified_intake_status.sql

\echo ''
\echo 'MIG_254: Unified Intake Status System'
\echo '======================================'
\echo ''

-- 1. Create the unified status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'intake_submission_status') THEN
    CREATE TYPE trapper.intake_submission_status AS ENUM (
      'new',           -- Just submitted, needs attention
      'in_progress',   -- Being worked (contacted, awaiting response)
      'scheduled',     -- Appointment booked
      'complete',      -- Done (serviced, converted to request, or declined)
      'archived'       -- Hidden from queue
    );
    RAISE NOTICE 'Created intake_submission_status enum';
  ELSE
    RAISE NOTICE 'intake_submission_status enum already exists';
  END IF;
END $$;

-- 2. Add new columns to web_intake_submissions
ALTER TABLE trapper.web_intake_submissions
  ADD COLUMN IF NOT EXISTS submission_status trapper.intake_submission_status,
  ADD COLUMN IF NOT EXISTS appointment_date DATE;

\echo 'Added submission_status and appointment_date columns'

-- 3. Migrate existing data from legacy fields
\echo 'Migrating existing data...'

UPDATE trapper.web_intake_submissions
SET submission_status = CASE
  -- Archived status takes precedence
  WHEN status = 'archived' THEN 'archived'::trapper.intake_submission_status
  -- Request created = complete
  WHEN status = 'request_created' OR created_request_id IS NOT NULL THEN 'complete'::trapper.intake_submission_status
  -- Booked = scheduled
  WHEN legacy_submission_status = 'Booked' THEN 'scheduled'::trapper.intake_submission_status
  -- Complete or Declined = complete
  WHEN legacy_submission_status IN ('Complete', 'Declined') THEN 'complete'::trapper.intake_submission_status
  -- Any contact attempt = in_progress
  WHEN legacy_status IS NOT NULL AND legacy_status != '' THEN 'in_progress'::trapper.intake_submission_status
  -- Pending Review with contact = in_progress
  WHEN legacy_submission_status = 'Pending Review' THEN 'in_progress'::trapper.intake_submission_status
  -- Default = new
  ELSE 'new'::trapper.intake_submission_status
END,
appointment_date = COALESCE(appointment_date, legacy_appointment_date)
WHERE submission_status IS NULL;

\echo 'Data migration complete'

-- 4. Set default for new submissions
ALTER TABLE trapper.web_intake_submissions
  ALTER COLUMN submission_status SET DEFAULT 'new'::trapper.intake_submission_status;

-- 5. Convert legacy_status contact notes to journal entries
\echo 'Converting legacy contact status to journal entries...'

INSERT INTO trapper.journal_entries (
  entry_kind,
  body,
  primary_submission_id,
  primary_person_id,
  occurred_at,
  created_by,
  meta
)
SELECT
  'contact_attempt'::trapper.journal_entry_kind,
  'Contact Status: ' || w.legacy_status ||
    CASE WHEN w.legacy_notes IS NOT NULL AND w.legacy_notes != ''
      THEN E'\n\nNotes: ' || w.legacy_notes
      ELSE ''
    END,
  w.submission_id,
  w.matched_person_id,
  COALESCE(w.updated_at, w.submitted_at),
  'System Migration (MIG_254)',
  jsonb_build_object(
    'migrated_from', 'legacy_status',
    'original_legacy_status', w.legacy_status,
    'original_legacy_notes', w.legacy_notes
  )
FROM trapper.web_intake_submissions w
WHERE w.legacy_status IS NOT NULL
  AND w.legacy_status != ''
  AND NOT EXISTS (
    -- Don't duplicate if already migrated
    SELECT 1 FROM trapper.journal_entries j
    WHERE j.primary_submission_id = w.submission_id
    AND j.meta->>'migrated_from' = 'legacy_status'
  );

\echo 'Legacy contact status migrated to journal entries'

-- 6. Update the v_intake_triage_queue view to use new status
DROP VIEW IF EXISTS trapper.v_intake_triage_queue;

CREATE VIEW trapper.v_intake_triage_queue AS
SELECT
  w.submission_id,
  w.submitted_at,
  w.first_name || ' ' || w.last_name AS submitter_name,
  w.email,
  w.phone,
  w.cats_address,
  w.cats_city,
  w.ownership_status,
  w.cat_count_estimate,
  w.fixed_status,
  w.has_kittens,
  w.has_medical_concerns,
  w.is_emergency,
  w.situation_description,
  w.triage_category,
  w.triage_score,
  w.triage_reasons,
  -- New unified status field
  w.submission_status,
  w.appointment_date,
  w.priority_override,
  -- Keep old status for reference/transition
  w.status AS native_status,
  w.final_category,
  w.created_request_id,
  -- Age of submission
  NOW() - w.submitted_at AS age,
  -- Flag if older than 48 hours and not progressed
  CASE WHEN w.submission_status = 'new' AND NOW() - w.submitted_at > INTERVAL '48 hours'
       THEN TRUE ELSE FALSE END AS overdue,
  -- Legacy fields (kept for backward compatibility during transition)
  w.is_legacy,
  w.legacy_status,
  w.legacy_submission_status,
  w.legacy_appointment_date,
  w.legacy_notes,
  w.legacy_source_id,
  -- Geocoding - prefer place data
  COALESCE(p.formatted_address, w.geo_formatted_address) AS geo_formatted_address,
  COALESCE(ST_Y(p.location::geometry), w.geo_latitude) AS geo_latitude,
  COALESCE(ST_X(p.location::geometry), w.geo_longitude) AS geo_longitude,
  CASE
    WHEN p.location IS NOT NULL THEN 'geocoded'
    WHEN w.geo_confidence IS NOT NULL THEN w.geo_confidence
    ELSE NULL
  END AS geo_confidence,
  w.matched_person_id,
  w.review_notes,
  w.intake_source,
  -- Contact tracking
  w.last_contacted_at,
  w.last_contact_method,
  w.contact_attempt_count,
  -- Test flag
  w.is_test
FROM trapper.web_intake_submissions w
LEFT JOIN trapper.places p ON p.place_id = w.place_id AND p.merged_into_place_id IS NULL
WHERE w.submission_status != 'archived'
ORDER BY
  w.is_emergency DESC,
  w.triage_score DESC,
  w.submitted_at ASC;

COMMENT ON VIEW trapper.v_intake_triage_queue IS
'Intake submissions queue with unified status. Uses submission_status for filtering.';

-- 7. Create helper function for status transitions
CREATE OR REPLACE FUNCTION trapper.update_submission_status(
  p_submission_id UUID,
  p_new_status trapper.intake_submission_status,
  p_appointment_date DATE DEFAULT NULL,
  p_staff_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_old_status trapper.intake_submission_status;
BEGIN
  -- Get current status
  SELECT submission_status INTO v_old_status
  FROM trapper.web_intake_submissions
  WHERE submission_id = p_submission_id;

  -- Update the submission
  UPDATE trapper.web_intake_submissions
  SET
    submission_status = p_new_status,
    appointment_date = COALESCE(p_appointment_date, appointment_date),
    updated_at = NOW()
  WHERE submission_id = p_submission_id;

  -- Log status change as journal entry
  IF v_old_status IS DISTINCT FROM p_new_status THEN
    INSERT INTO trapper.journal_entries (
      entry_kind,
      body,
      primary_submission_id,
      created_by_staff_id,
      meta
    ) VALUES (
      'status_change',
      'Status changed from ' || COALESCE(v_old_status::text, 'unknown') || ' to ' || p_new_status::text,
      p_submission_id,
      p_staff_id,
      jsonb_build_object('old_status', v_old_status, 'new_status', p_new_status)
    );
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.update_submission_status IS
'Updates submission status and logs the change to journal. Use this instead of direct UPDATE.';

\echo ''
\echo 'MIG_254 complete!'
\echo ''
\echo 'New features:'
\echo '  - submission_status: Single unified status field (new, in_progress, scheduled, complete, archived)'
\echo '  - appointment_date: Native appointment date field'
\echo '  - All existing data migrated from legacy fields'
\echo '  - Legacy contact status converted to journal entries'
\echo '  - v_intake_triage_queue view updated'
\echo '  - update_submission_status() helper function'
\echo ''
\echo 'Status mapping:'
\echo '  - NULL/Pending Review → new or in_progress (based on contact history)'
\echo '  - Booked → scheduled'
\echo '  - Complete/Declined → complete'
\echo '  - archived → archived'
\echo ''
