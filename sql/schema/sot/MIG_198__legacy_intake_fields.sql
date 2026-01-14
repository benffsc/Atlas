-- MIG_198: Legacy Intake Fields
-- Adds support for importing legacy Airtable appointment requests into web_intake_submissions
--
-- Context: Jami has been using Airtable to manage intake requests with:
--   - Status: Free-text tracking ("An appointment has been booked", "Contacted", etc.)
--   - Submission Status: Workflow state ("Booked", "Pending Review", "Declined", "Complete")
--   - Appointment Date: Manual date reminder for when appointment was booked
--   - Notes: Free-text working notes
--
-- These fields need to remain editable for compatibility during transition to Atlas.
-- Legacy records skip auto-triage since they're already processed.

\echo '=============================================='
\echo 'MIG_198: Legacy Intake Fields'
\echo '=============================================='

-- ============================================
-- PART 1: Add legacy fields to web_intake_submissions
-- ============================================

\echo 'Adding legacy fields to web_intake_submissions...'

-- Flag to identify legacy imports (skip auto-triage)
ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT FALSE;

-- Legacy Status field (Jami's free-text status notes)
-- Values: "An appointment has been booked", "Contacted", "Out of County - no appts avail", etc.
ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS legacy_status TEXT;

-- Legacy Submission Status (workflow state)
-- Values: "Booked", "Pending Review", "Declined", "Complete", or empty
ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS legacy_submission_status TEXT;

-- Legacy Appointment Date (Jami's manual reminder date)
ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS legacy_appointment_date DATE;

-- Legacy Notes (Jami's working notes - separate from review_notes)
ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS legacy_notes TEXT;

-- Source tracking for legacy imports
ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS legacy_source_id TEXT;  -- Airtable record ID

ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS legacy_source_file TEXT;  -- Source CSV file

-- Index for legacy records
CREATE INDEX IF NOT EXISTS idx_web_intake_legacy ON trapper.web_intake_submissions(is_legacy) WHERE is_legacy = TRUE;
CREATE INDEX IF NOT EXISTS idx_web_intake_legacy_source ON trapper.web_intake_submissions(legacy_source_id) WHERE legacy_source_id IS NOT NULL;

-- ============================================
-- PART 2: Update auto-triage trigger to skip legacy
-- ============================================

\echo 'Updating auto-triage trigger to skip legacy records...'

CREATE OR REPLACE FUNCTION trapper.trigger_auto_triage()
RETURNS TRIGGER AS $$
DECLARE
  v_triage RECORD;
BEGIN
  -- Skip auto-triage for legacy imports
  IF NEW.is_legacy = TRUE THEN
    -- For legacy records, set status to 'triaged' but don't compute triage
    IF NEW.status IS NULL OR NEW.status = 'new' THEN
      NEW.status := 'triaged';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_triage FROM trapper.compute_intake_triage(NEW.submission_id);

  NEW.triage_category := v_triage.category;
  NEW.triage_score := v_triage.score;
  NEW.triage_reasons := v_triage.reasons;
  NEW.triage_computed_at := NOW();
  NEW.status := 'triaged';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 3: Extend triage queue view for legacy
-- ============================================

\echo 'Extending triage queue view for legacy submissions...'

CREATE OR REPLACE VIEW trapper.v_intake_triage_queue AS
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
  w.status,
  w.final_category,
  w.created_request_id,
  -- Age of submission
  NOW() - w.submitted_at AS age,
  -- Flag if older than 48 hours and not reviewed
  CASE WHEN w.status IN ('new', 'triaged') AND NOW() - w.submitted_at > INTERVAL '48 hours'
       THEN TRUE ELSE FALSE END AS overdue,
  -- Legacy fields
  w.is_legacy,
  w.legacy_status,
  w.legacy_submission_status,
  w.legacy_appointment_date,
  w.legacy_notes,
  w.legacy_source_id,
  -- Review fields
  w.review_notes,
  w.reviewed_by,
  w.reviewed_at,
  -- Person matching
  w.matched_person_id
FROM trapper.web_intake_submissions w
WHERE w.status NOT IN ('request_created', 'archived')
ORDER BY
  -- Emergencies first
  w.is_emergency DESC,
  -- Then by triage score (NULL scores sort last)
  COALESCE(w.triage_score, 0) DESC,
  -- Then by submission time
  w.submitted_at ASC;

-- ============================================
-- PART 4: View for all submissions (including archived)
-- ============================================

\echo 'Creating full submissions view...'

CREATE OR REPLACE VIEW trapper.v_intake_all_submissions AS
SELECT
  w.submission_id,
  w.submitted_at,
  w.first_name,
  w.last_name,
  w.first_name || ' ' || w.last_name AS submitter_name,
  w.email,
  w.phone,
  w.requester_address,
  w.requester_city,
  w.requester_zip,
  w.cats_address,
  w.cats_city,
  w.cats_zip,
  w.county,
  w.ownership_status,
  w.cat_count_estimate,
  w.cat_count_text,
  w.fixed_status,
  w.has_kittens,
  w.kitten_count,
  w.kitten_age_estimate,
  w.awareness_duration,
  w.has_medical_concerns,
  w.medical_description,
  w.is_emergency,
  w.cats_being_fed,
  w.feeder_info,
  w.has_property_access,
  w.access_notes,
  w.is_property_owner,
  w.situation_description,
  w.referral_source,
  w.media_urls,
  w.triage_category,
  w.triage_score,
  w.triage_reasons,
  w.status,
  w.final_category,
  w.created_request_id,
  w.matched_person_id,
  w.matched_place_id,
  w.reviewed_by,
  w.reviewed_at,
  w.review_notes,
  -- Legacy fields
  w.is_legacy,
  w.legacy_status,
  w.legacy_submission_status,
  w.legacy_appointment_date,
  w.legacy_notes,
  w.legacy_source_id,
  w.legacy_source_file,
  -- Timestamps
  w.created_at,
  w.updated_at
FROM trapper.web_intake_submissions w
ORDER BY w.submitted_at DESC;

\echo ''
\echo 'MIG_198 complete!'
\echo ''
\echo 'Added legacy fields:'
\echo '  - is_legacy: Marks imports from old Airtable form'
\echo '  - legacy_status: Free-text status notes'
\echo '  - legacy_submission_status: Workflow state (Booked, Pending Review, etc.)'
\echo '  - legacy_appointment_date: Manual appointment date reminder'
\echo '  - legacy_notes: Working notes'
\echo '  - legacy_source_id: Airtable record ID'
\echo '  - legacy_source_file: Source CSV file'
\echo ''
\echo 'Updated:'
\echo '  - Auto-triage trigger now skips legacy records'
\echo '  - v_intake_triage_queue includes legacy fields'
\echo '  - v_intake_all_submissions new view for full data access'
