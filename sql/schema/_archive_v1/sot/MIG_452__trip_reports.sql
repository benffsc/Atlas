\echo '=== MIG_452: Trapper Trip Reports ==='
\echo 'Required field reports from trappers before request completion'

-- Create trapper_trip_reports table
CREATE TABLE IF NOT EXISTS trapper.trapper_trip_reports (
  report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core references
  request_id UUID NOT NULL REFERENCES trapper.sot_requests(request_id),
  trapper_person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),

  -- Visit details
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  arrival_time TIME,
  departure_time TIME,

  -- Cat counts
  cats_trapped INT DEFAULT 0,
  cats_returned INT DEFAULT 0,
  traps_set INT,
  traps_retrieved INT,

  -- Observations (for colony estimates)
  cats_seen INT,
  eartipped_seen INT,

  -- Issues and notes
  issues_encountered TEXT[] DEFAULT '{}',
  issue_details TEXT,
  site_notes TEXT,

  -- Equipment tracking (optional)
  equipment_used JSONB, -- e.g., {"traps": 5, "carriers": 3, "nets": 1}

  -- Workflow flags
  is_final_visit BOOLEAN DEFAULT FALSE,

  -- Submission metadata
  submitted_from TEXT DEFAULT 'web_ui' CHECK (submitted_from IN ('web_ui', 'mobile', 'api')),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add request completion requirements
DO $$
BEGIN
  -- Add report_required_before_complete if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'sot_requests'
    AND column_name = 'report_required_before_complete'
  ) THEN
    ALTER TABLE trapper.sot_requests
    ADD COLUMN report_required_before_complete BOOLEAN DEFAULT TRUE;
  END IF;

  -- Add completion_report_id if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'sot_requests'
    AND column_name = 'completion_report_id'
  ) THEN
    ALTER TABLE trapper.sot_requests
    ADD COLUMN completion_report_id UUID REFERENCES trapper.trapper_trip_reports(report_id);
  END IF;
END $$;

-- Index for reports by request
CREATE INDEX IF NOT EXISTS idx_trip_reports_request
  ON trapper.trapper_trip_reports(request_id);

-- Index for trapper's report history
CREATE INDEX IF NOT EXISTS idx_trip_reports_trapper
  ON trapper.trapper_trip_reports(trapper_person_id);

-- Index for final visits (completion verification)
CREATE INDEX IF NOT EXISTS idx_trip_reports_final
  ON trapper.trapper_trip_reports(request_id, is_final_visit) WHERE is_final_visit = TRUE;

-- Index for recent reports
CREATE INDEX IF NOT EXISTS idx_trip_reports_date
  ON trapper.trapper_trip_reports(visit_date DESC);

-- Standard issue types for quick selection
COMMENT ON COLUMN trapper.trapper_trip_reports.issues_encountered IS
'Standard issue codes: no_access, cat_hiding, trap_shy, bad_weather, equipment_issue, owner_absent, aggressive_cat, other';

COMMENT ON TABLE trapper.trapper_trip_reports IS 'Field reports from trappers documenting each visit to a trapping site';
COMMENT ON COLUMN trapper.trapper_trip_reports.cats_seen IS 'Total cats observed at the site (for colony estimates)';
COMMENT ON COLUMN trapper.trapper_trip_reports.eartipped_seen IS 'Number of eartipped cats observed (already altered)';
COMMENT ON COLUMN trapper.trapper_trip_reports.is_final_visit IS 'Marks this as the completion report for the request';
COMMENT ON COLUMN trapper.sot_requests.report_required_before_complete IS 'If TRUE, request cannot be completed without a final trip report';
COMMENT ON COLUMN trapper.sot_requests.completion_report_id IS 'The trip report that closed this request';

-- Function to create colony estimate from trip report observations
CREATE OR REPLACE FUNCTION trapper.create_colony_estimate_from_report()
RETURNS TRIGGER AS $$
DECLARE
  v_place_id UUID;
BEGIN
  -- Only process if cats were observed
  IF NEW.cats_seen IS NULL OR NEW.cats_seen = 0 THEN
    RETURN NEW;
  END IF;

  -- Get place_id from request
  SELECT place_id INTO v_place_id
  FROM trapper.sot_requests
  WHERE request_id = NEW.request_id;

  IF v_place_id IS NOT NULL THEN
    -- Insert colony estimate from trapper observation
    INSERT INTO trapper.place_colony_estimates (
      place_id,
      total_cats,
      altered_cats,
      source_type,
      observation_date,
      notes,
      source_system,
      source_record_id
    ) VALUES (
      v_place_id,
      NEW.cats_seen,
      COALESCE(NEW.eartipped_seen, 0),
      'trapper_site_visit',
      NEW.visit_date,
      CASE
        WHEN NEW.is_final_visit THEN 'Final visit observation'
        ELSE 'Site visit observation'
      END,
      'web_app',
      NEW.report_id::TEXT
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for colony estimate creation
DROP TRIGGER IF EXISTS trg_trip_report_colony_estimate ON trapper.trapper_trip_reports;
CREATE TRIGGER trg_trip_report_colony_estimate
  AFTER INSERT ON trapper.trapper_trip_reports
  FOR EACH ROW
  EXECUTE FUNCTION trapper.create_colony_estimate_from_report();

\echo 'MIG_452 complete: trapper_trip_reports table created with colony estimate integration'
