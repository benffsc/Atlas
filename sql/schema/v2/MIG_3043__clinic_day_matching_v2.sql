-- MIG_3043: Enhanced clinic day matching signals
-- Adds weight, surgery end time, waiver link, and composite match scoring
-- to clinic_day_entries for robust multi-signal matching.
--
-- Context: Master list CSV now includes Weight and Sx End Time columns.
-- Waiver chip4 data can disambiguate within-client-group matches.
-- match_score/match_signals support the new TypeScript composite matching engine.

BEGIN;

-- Weight in pounds (range 0.5-30.0 for cats)
ALTER TABLE ops.clinic_day_entries
  ADD COLUMN IF NOT EXISTS weight_lbs NUMERIC(5,2);

-- Surgery end time from master list
ALTER TABLE ops.clinic_day_entries
  ADD COLUMN IF NOT EXISTS sx_end_time TIME;

-- Link to waiver scan that confirmed this entry's match
ALTER TABLE ops.clinic_day_entries
  ADD COLUMN IF NOT EXISTS waiver_scan_id UUID REFERENCES ops.waiver_scans(waiver_id);

-- Composite match score from TypeScript matching engine (0.000-1.000)
ALTER TABLE ops.clinic_day_entries
  ADD COLUMN IF NOT EXISTS match_score NUMERIC(5,3);

-- JSONB breakdown of which signals contributed to the match score
-- e.g. {"client_name": 0.40, "cat_name": 0.25, "sex": 0.10, "weight": 0.10, "chip4": 0.10}
ALTER TABLE ops.clinic_day_entries
  ADD COLUMN IF NOT EXISTS match_signals JSONB;

-- Index for waiver lookups
CREATE INDEX IF NOT EXISTS idx_clinic_day_entries_waiver
  ON ops.clinic_day_entries(waiver_scan_id)
  WHERE waiver_scan_id IS NOT NULL;

-- Index for score-based queries (find low-confidence matches to review)
CREATE INDEX IF NOT EXISTS idx_clinic_day_entries_match_score
  ON ops.clinic_day_entries(match_score)
  WHERE match_score IS NOT NULL;

COMMIT;
