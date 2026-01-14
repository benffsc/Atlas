-- MIG_201: Kitten Assessment Fields for Requests
-- Adds fields for foster coordinators to assess kittens on requests
--
-- Workflow:
--   1. Intake submission comes in with kitten details
--   2. Receptionist creates request from intake
--   3. Foster coordinator assesses kittens on the request detail page
--
-- This separates the intake-side kitten data (what the client reported)
-- from the assessment-side data (what the foster coordinator determined)

\echo '=============================================='
\echo 'MIG_201: Kitten Assessment Fields for Requests'
\echo '=============================================='

-- ============================================
-- PART 1: Add kitten assessment columns to requests
-- ============================================

\echo 'Adding kitten assessment columns to sot_requests...'

ALTER TABLE trapper.sot_requests
  -- Assessment status tracking
  ADD COLUMN IF NOT EXISTS kitten_assessment_status TEXT CHECK (kitten_assessment_status IS NULL OR kitten_assessment_status IN (
    'pending',      -- Not yet assessed
    'assessed',     -- Assessment complete
    'follow_up'     -- Needs follow-up/re-assessment
  )),
  -- Outcome decision
  ADD COLUMN IF NOT EXISTS kitten_assessment_outcome TEXT CHECK (kitten_assessment_outcome IS NULL OR kitten_assessment_outcome IN (
    'foster_intake',    -- Accepted for foster program
    'tnr_candidate',    -- Will be TNR'd (older/feral)
    'pending_space',    -- Waiting for foster space
    'return_to_colony', -- Return to colony with TNR
    'declined'          -- Not accepted for any program
  )),
  -- Foster readiness level
  ADD COLUMN IF NOT EXISTS kitten_foster_readiness TEXT CHECK (kitten_foster_readiness IS NULL OR kitten_foster_readiness IN (
    'high',    -- Friendly, ideal age, ready for foster
    'medium',  -- Needs some socialization work
    'low'      -- Not ready / likely TNR candidate
  )),
  -- Urgency factors (array of concerns)
  ADD COLUMN IF NOT EXISTS kitten_urgency_factors TEXT[],
  -- Free-form assessment notes
  ADD COLUMN IF NOT EXISTS kitten_assessment_notes TEXT,
  -- Who assessed and when
  ADD COLUMN IF NOT EXISTS kitten_assessed_by TEXT,
  ADD COLUMN IF NOT EXISTS kitten_assessed_at TIMESTAMPTZ;

-- ============================================
-- PART 2: Create trigger to track assessment timestamp
-- ============================================

\echo 'Creating assessment timestamp trigger...'

CREATE OR REPLACE FUNCTION trapper.set_kitten_assessed_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  -- If assessment status is being set to 'assessed' and wasn't before
  IF NEW.kitten_assessment_status = 'assessed'
     AND (OLD.kitten_assessment_status IS NULL OR OLD.kitten_assessment_status != 'assessed') THEN
    NEW.kitten_assessed_at := COALESCE(NEW.kitten_assessed_at, NOW());
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_kitten_assessed_timestamp ON trapper.sot_requests;
CREATE TRIGGER set_kitten_assessed_timestamp
  BEFORE UPDATE ON trapper.sot_requests
  FOR EACH ROW
  EXECUTE FUNCTION trapper.set_kitten_assessed_timestamp();

-- ============================================
-- PART 3: Create view for kitten cases needing assessment
-- ============================================

\echo 'Creating kitten assessment queue view...'

CREATE OR REPLACE VIEW trapper.v_kitten_assessment_queue AS
SELECT
  r.request_id,
  r.status,
  r.priority,
  r.summary,
  r.has_kittens,
  r.kitten_count,
  r.kitten_age_weeks,
  r.kitten_assessment_status,
  r.kitten_assessment_outcome,
  r.kitten_foster_readiness,
  r.kitten_urgency_factors,
  r.kitten_assessment_notes,
  r.kitten_assessed_by,
  r.kitten_assessed_at,
  r.created_at,
  r.updated_at,
  -- Place info
  p.display_name AS place_name,
  p.formatted_address AS place_address,
  -- Requester info
  per.display_name AS requester_name,
  -- Computed fields
  CASE
    WHEN r.kitten_assessment_status IS NULL OR r.kitten_assessment_status = 'pending'
    THEN 'Needs Assessment'
    WHEN r.kitten_assessment_status = 'follow_up'
    THEN 'Needs Follow-up'
    ELSE 'Assessed'
  END AS assessment_state,
  -- Days since request created
  EXTRACT(DAY FROM NOW() - r.created_at)::INTEGER AS days_pending
FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id
WHERE r.has_kittens = TRUE
  AND r.status NOT IN ('completed', 'cancelled')
ORDER BY
  -- Unassessed first
  CASE WHEN r.kitten_assessment_status IS NULL OR r.kitten_assessment_status = 'pending' THEN 0 ELSE 1 END,
  -- Then by urgency
  r.priority = 'urgent' DESC,
  r.priority = 'high' DESC,
  -- Then by age
  r.created_at ASC;

\echo ''
\echo 'MIG_201 complete!'
\echo ''
\echo 'Added columns to sot_requests:'
\echo '  - kitten_assessment_status: pending, assessed, follow_up'
\echo '  - kitten_assessment_outcome: foster_intake, tnr_candidate, pending_space, return_to_colony, declined'
\echo '  - kitten_foster_readiness: high, medium, low'
\echo '  - kitten_urgency_factors: TEXT[] (very_young, medical_concern, exposed_danger, etc.)'
\echo '  - kitten_assessment_notes: Free-form notes'
\echo '  - kitten_assessed_by: Who did the assessment'
\echo '  - kitten_assessed_at: When assessment was completed'
\echo ''
\echo 'Created view: v_kitten_assessment_queue'
\echo '  Shows all requests with kittens that need foster coordinator attention'
\echo ''
