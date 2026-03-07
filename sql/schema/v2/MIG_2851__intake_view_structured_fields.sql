-- MIG_2851: Add structured fields to v_intake_triage_queue view
-- Adds call_type, cat_name, cat_description, feeding_situation so the detail panel
-- can display them separately from the situation_description text blob.
-- Must DROP + recreate because adding new columns changes column positions.
-- No dependent views (verified).

DROP VIEW IF EXISTS ops.v_intake_triage_queue;

CREATE VIEW ops.v_intake_triage_queue AS
SELECT
  submission_id,
  submitted_at,
  COALESCE(NULLIF(TRIM(concat(first_name, ' ', last_name)), ''), email) AS submitter_name,
  first_name,
  last_name,
  email,
  phone,
  cats_address,
  cats_city,
  cats_zip,
  ownership_status,
  cat_count_estimate,
  fixed_status,
  has_kittens,
  kitten_count,
  has_medical_concerns,
  is_emergency,
  situation_description,
  call_type,
  cat_name,
  cat_description,
  feeding_situation,
  triage_category,
  triage_score,
  triage_reasons,
  -- Use submission_status column directly, fall back to mapping from status
  COALESCE(
    submission_status,
    CASE status
      WHEN 'new' THEN 'new'
      WHEN 'triaged' THEN 'in_progress'
      WHEN 'reviewed' THEN 'in_progress'
      WHEN 'request_created' THEN 'complete'
      WHEN 'redirected' THEN 'complete'
      WHEN 'closed' THEN 'complete'
      ELSE 'new'
    END
  ) AS submission_status,
  NULL::timestamptz AS appointment_date,
  priority_override,
  status AS native_status,
  final_category,
  request_id AS created_request_id,
  CASE
    WHEN submitted_at >= now() - interval '24 hours' THEN '< 1 day'
    WHEN submitted_at >= now() - interval '7 days' THEN '1-7 days'
    WHEN submitted_at >= now() - interval '30 days' THEN '1-4 weeks'
    WHEN submitted_at >= now() - interval '90 days' THEN '1-3 months'
    ELSE '> 3 months'
  END AS age,
  submitted_at < now() - interval '7 days' AND status IN ('new', 'triaged') AS overdue,
  migrated_at IS NOT NULL AND source_raw_id IS NOT NULL AS is_legacy,
  NULL::text AS legacy_status,
  NULL::text AS legacy_submission_status,
  NULL::timestamptz AS legacy_appointment_date,
  NULL::text AS legacy_notes,
  source_raw_id::text AS legacy_source_id,
  review_notes,
  person_id AS matched_person_id,
  COALESCE(intake_source, CASE WHEN migrated_at IS NOT NULL THEN 'airtable' ELSE 'web_intake' END) AS intake_source,
  geo_formatted_address,
  geo_latitude,
  geo_longitude,
  geo_confidence,
  last_contacted_at,
  last_contact_method,
  COALESCE(contact_attempt_count, 0) AS contact_attempt_count,
  COALESCE(is_test, false) AS is_test,
  created_at,
  place_id,
  person_id,
  request_id,
  is_third_party_report,
  third_party_relationship,
  property_owner_name,
  property_owner_phone,
  property_owner_email,
  -- MIG_2531/2532 fields for request conversion
  county,
  peak_count,
  awareness_duration,
  medical_description,
  feeding_location,
  feeding_time,
  dogs_on_site,
  trap_savvy,
  previous_tnr,
  kitten_age_estimate,
  kitten_behavior,
  has_property_access,
  access_notes,
  handleability
FROM ops.intake_submissions w
WHERE COALESCE(submission_status, 'new') NOT IN ('archived', 'closed');
