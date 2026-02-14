-- MIG_199: Intake Source Tagging and Geocoding Preparation
--
-- Adds source tracking for unified data collection pipeline:
--   - web: Public website form (new Atlas form)
--   - phone: Phone call intake by staff
--   - in_person: Walk-in or in-person intake
--   - paper: Paper form digitized later
--   - legacy_airtable: Imported from old Airtable system
--   - legacy_website: Old website form before Atlas
--
-- Also adds geocoding fields to normalize messy/incomplete addresses

\echo '=============================================='
\echo 'MIG_199: Intake Source and Geocoding'
\echo '=============================================='

-- ============================================
-- PART 1: Create intake source enum
-- ============================================

\echo 'Creating intake source enum...'

DO $$ BEGIN
  CREATE TYPE trapper.intake_source AS ENUM (
    'web',              -- New Atlas web form
    'phone',            -- Phone call intake
    'in_person',        -- Walk-in / in-person
    'paper',            -- Paper form digitized
    'legacy_airtable',  -- Old Airtable imports
    'legacy_website'    -- Old website form
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- PART 2: Add source field to web_intake_submissions
-- ============================================

\echo 'Adding intake_source field...'

ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS intake_source trapper.intake_source;

-- Set default based on is_legacy flag
UPDATE trapper.web_intake_submissions
SET intake_source = 'legacy_airtable'
WHERE is_legacy = TRUE AND intake_source IS NULL;

UPDATE trapper.web_intake_submissions
SET intake_source = 'web'
WHERE is_legacy = FALSE AND intake_source IS NULL;

-- ============================================
-- PART 3: Add geocoding fields
-- ============================================

\echo 'Adding geocoding fields...'

-- Geocoded location for cats_address
ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS geo_formatted_address TEXT;  -- Clean address from geocoder

ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS geo_latitude DOUBLE PRECISION;

ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS geo_longitude DOUBLE PRECISION;

ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS geo_place_id TEXT;  -- Google Place ID for deduplication

ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS geo_confidence TEXT CHECK (geo_confidence IN (
  'exact',        -- Exact address match
  'approximate',  -- Approximate (street level)
  'city',         -- Only city-level match
  'failed',       -- Geocoding failed
  'skip'          -- Address too messy/invalid to geocode
));

ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS geo_raw_response JSONB;  -- Store full geocoder response

-- Index for geo lookups
CREATE INDEX IF NOT EXISTS idx_web_intake_geo ON trapper.web_intake_submissions(geo_place_id) WHERE geo_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_web_intake_geo_coords ON trapper.web_intake_submissions(geo_latitude, geo_longitude) WHERE geo_latitude IS NOT NULL;

-- ============================================
-- PART 4: Update views to include new fields
-- ============================================

\echo 'Updating views...'

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
  w.matched_person_id,
  -- Source tracking
  w.intake_source,
  -- Geocoding
  w.geo_formatted_address,
  w.geo_latitude,
  w.geo_longitude,
  w.geo_confidence
FROM trapper.web_intake_submissions w
WHERE w.status NOT IN ('request_created', 'archived', 'client_handled')
ORDER BY
  w.is_emergency DESC,
  COALESCE(w.triage_score, 0) DESC,
  w.submitted_at ASC;

\echo ''
\echo 'MIG_199 complete!'
\echo ''
\echo 'Added:'
\echo '  - intake_source: web, phone, in_person, paper, legacy_airtable, legacy_website'
\echo '  - Geocoding fields: geo_formatted_address, geo_latitude, geo_longitude, geo_place_id, geo_confidence'
\echo ''
\echo 'Next steps:'
\echo '  1. Run geocoding script on existing addresses'
\echo '  2. Update intake form to set intake_source'
\echo '  3. Add source filter to queue UI'
