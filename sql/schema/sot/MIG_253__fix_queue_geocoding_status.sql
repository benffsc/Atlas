-- MIG_253: Fix geocoding status display in intake queue
--
-- Problem: The queue shows "needs geocoding" based on submission's geo_confidence,
-- but geocoding actually happens on the linked places table.
--
-- Fix: Update view to check the linked place's location status
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_253__fix_queue_geocoding_status.sql

\echo ''
\echo 'MIG_253: Fix geocoding status in intake queue view'
\echo '==================================================='
\echo ''

-- Drop and recreate to change column order/types
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
  -- Geocoding - prefer place data, fallback to submission geo fields
  COALESCE(p.formatted_address, w.geo_formatted_address) AS geo_formatted_address,
  COALESCE(ST_Y(p.location::geometry), w.geo_latitude) AS geo_latitude,
  COALESCE(ST_X(p.location::geometry), w.geo_longitude) AS geo_longitude,
  -- Confidence: if place has location, it's geocoded; otherwise use submission's confidence
  CASE
    WHEN p.location IS NOT NULL THEN 'geocoded'
    WHEN w.geo_confidence IS NOT NULL THEN w.geo_confidence
    ELSE NULL
  END AS geo_confidence,
  w.matched_person_id,
  w.review_notes,
  w.intake_source,
  -- Contact tracking fields
  w.last_contacted_at,
  w.last_contact_method,
  w.contact_attempt_count,
  -- Test flag
  w.is_test
FROM trapper.web_intake_submissions w
LEFT JOIN trapper.places p ON p.place_id = w.place_id AND p.merged_into_place_id IS NULL
WHERE w.status NOT IN ('request_created', 'archived')
ORDER BY
  w.is_emergency DESC,
  w.triage_score DESC,
  w.submitted_at ASC;

\echo ''
\echo 'MIG_253 complete!'
\echo '  - geo_formatted_address now prefers linked place data'
\echo '  - geo_confidence shows "geocoded" when place has location'
\echo ''
