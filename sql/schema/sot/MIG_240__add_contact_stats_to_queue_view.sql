\echo '=== MIG_240: Add Contact Stats to Queue View ==='
\echo 'Expose communication tracking fields in the intake queue view'

-- Update the triage view to include contact tracking fields
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
  -- Geocoding
  w.geo_confidence,
  w.geo_formatted_address,
  w.geo_latitude,
  w.geo_longitude,
  w.matched_person_id,
  w.review_notes,
  w.intake_source,
  -- Contact tracking fields (from MIG_239)
  w.last_contacted_at,
  w.last_contact_method,
  w.contact_attempt_count
FROM trapper.web_intake_submissions w
WHERE w.status NOT IN ('request_created', 'archived')
ORDER BY
  -- Emergencies first
  w.is_emergency DESC,
  -- Then by triage score
  w.triage_score DESC,
  -- Then by submission time
  w.submitted_at ASC;

\echo ''
\echo 'MIG_240 complete!'
\echo 'Added to v_intake_triage_queue: last_contacted_at, last_contact_method, contact_attempt_count'
\echo ''
