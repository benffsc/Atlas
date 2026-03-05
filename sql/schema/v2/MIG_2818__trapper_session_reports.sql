-- MIG_2818: Trapper Session Reports (FFS-143)
-- Port V1 trapper.trapper_trip_reports → ops.trapper_trip_reports
-- Add colony estimate source type, request activity columns

BEGIN;

-- 1a. Create ops.trapper_trip_reports in V2
CREATE TABLE IF NOT EXISTS ops.trapper_trip_reports (
  report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES ops.requests(request_id),
  trapper_person_id UUID REFERENCES sot.people(person_id),  -- nullable: reports can come from non-trapper observers
  reported_by_name TEXT,  -- free-text name when no trapper_person_id (neighbor, caretaker, requester)
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  arrival_time TIME,
  departure_time TIME,
  cats_trapped INT DEFAULT 0,
  cats_returned INT DEFAULT 0,
  traps_set INT,
  traps_retrieved INT,
  cats_seen INT,
  eartipped_seen INT,
  issues_encountered TEXT[] DEFAULT '{}',
  issue_details TEXT,
  site_notes TEXT,
  equipment_used JSONB,
  is_final_visit BOOLEAN DEFAULT FALSE,
  submitted_from TEXT DEFAULT 'web_ui',
  -- FFS-143: Session report fields
  remaining_estimate INT,
  estimate_confidence TEXT CHECK (estimate_confidence IN ('counted', 'good_guess', 'rough_guess')),
  trapper_total_estimate INT,
  more_sessions_needed TEXT CHECK (more_sessions_needed IN ('yes', 'no', 'unknown')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_trip_reports_request
  ON ops.trapper_trip_reports(request_id);
CREATE INDEX IF NOT EXISTS idx_trip_reports_trapper
  ON ops.trapper_trip_reports(trapper_person_id);
CREATE INDEX IF NOT EXISTS idx_trip_reports_visit_date
  ON ops.trapper_trip_reports(visit_date DESC);

-- 1b. Extend colony_estimates source_type CHECK to include 'trapper_field_report'
ALTER TABLE sot.colony_estimates DROP CONSTRAINT IF EXISTS colony_estimates_source_type_check;
ALTER TABLE sot.colony_estimates ADD CONSTRAINT colony_estimates_source_type_check
  CHECK (source_type IN (
    'verified_cats', 'post_clinic_survey', 'trapper_site_visit',
    'manual_observation', 'trapping_request', 'appointment_request',
    'intake_form', 'trapper_field_report'
  ));

-- 1c. Add activity tracking + completion report columns to ops.requests
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS completion_report_id UUID;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS report_required_before_complete BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS last_activity_type TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS count_confidence TEXT;

COMMIT;
