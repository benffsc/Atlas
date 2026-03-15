-- MIG_2946: SAC (Shelter Animals Count) vocabulary reporting view (FFS-416)
--
-- Creates a reporting view that maps FFSC intake and outcome data to
-- ASPCA Shelter Animals Count (SAC) national standards for grant reporting.
-- No schema changes — this is a read-only view over existing data.

BEGIN;

-- ── SAC Intake Type Classification ──────────────────────────────────
-- Maps FFSC call_type + ownership_status to SAC intake categories

CREATE OR REPLACE FUNCTION ops.classify_sac_intake_type(
  p_call_type TEXT,
  p_ownership_status TEXT
) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    -- Owner's own pet = Owner Relinquished
    WHEN p_ownership_status = 'my_cat' THEN 'owner_relinquished'
    -- Colony TNR = Return-to-Field
    WHEN p_call_type = 'colony_tnr' THEN 'return_to_field'
    -- Stray, newcomer, unknown = Stray/At-Large
    WHEN p_ownership_status IN ('unknown_stray', 'newcomer') THEN 'stray'
    -- Community cats being fed = Stray/At-Large (SAC classification)
    WHEN p_ownership_status = 'community_colony' THEN 'stray'
    -- Kitten rescue = Stray/At-Large
    WHEN p_call_type = 'kitten_rescue' THEN 'stray'
    -- Medical/wellness for non-owned = Stray
    WHEN p_call_type IN ('medical_concern', 'wellness_check') THEN 'stray'
    -- Pet spay/neuter (not my_cat) = Other
    WHEN p_call_type = 'pet_spay_neuter' THEN 'other_intake'
    ELSE 'other_intake'
  END;
$$;

-- ── SAC Outcome Type Classification ─────────────────────────────────
-- Maps FFSC resolution_outcome to SAC outcome categories

CREATE OR REPLACE FUNCTION ops.classify_sac_outcome(
  p_resolution_outcome TEXT
) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    -- Successful TNR = Return-to-Field
    WHEN p_resolution_outcome = 'successful' THEN 'return_to_field'
    -- Partial success = still RTF (some cats were fixed)
    WHEN p_resolution_outcome = 'partial' THEN 'return_to_field'
    -- Referred out = Transfer Out
    WHEN p_resolution_outcome = 'referred_out' THEN 'transfer_out'
    -- Unable to complete / no longer needed = Other
    WHEN p_resolution_outcome IN ('unable_to_complete', 'no_longer_needed') THEN 'other_outcome'
    ELSE 'other_outcome'
  END;
$$;

-- ── SAC Reporting View ──────────────────────────────────────────────
-- Provides SAC-formatted data for grant reporting.
-- Query: SELECT * FROM ops.v_sac_report WHERE report_year = 2026;

CREATE OR REPLACE VIEW ops.v_sac_report AS
SELECT
  -- Identifiers
  i.submission_id,
  r.request_id,
  -- Dates
  i.submitted_at,
  EXTRACT(YEAR FROM i.submitted_at)::int AS report_year,
  EXTRACT(QUARTER FROM i.submitted_at)::int AS report_quarter,
  EXTRACT(MONTH FROM i.submitted_at)::int AS report_month,
  -- FFSC original values
  i.call_type,
  i.ownership_status,
  r.resolution_outcome,
  -- SAC mapped values
  ops.classify_sac_intake_type(i.call_type, i.ownership_status) AS sac_intake_type,
  CASE
    WHEN ops.classify_sac_intake_type(i.call_type, i.ownership_status) = 'stray' THEN 'Stray/At-Large'
    WHEN ops.classify_sac_intake_type(i.call_type, i.ownership_status) = 'owner_relinquished' THEN 'Owner/Guardian Relinquished'
    WHEN ops.classify_sac_intake_type(i.call_type, i.ownership_status) = 'return_to_field' THEN 'Return-to-Field (RTF)'
    WHEN ops.classify_sac_intake_type(i.call_type, i.ownership_status) = 'transfer_in' THEN 'Transferred In'
    ELSE 'Other Intake'
  END AS sac_intake_label,
  ops.classify_sac_outcome(r.resolution_outcome) AS sac_outcome_type,
  CASE
    WHEN ops.classify_sac_outcome(r.resolution_outcome) = 'return_to_field' THEN 'Return-to-Field (RTF)'
    WHEN ops.classify_sac_outcome(r.resolution_outcome) = 'transfer_out' THEN 'Transfer Out'
    ELSE 'Other Outcome'
  END AS sac_outcome_label,
  -- Counts
  COALESCE(r.estimated_cat_count, i.cat_count_estimate) AS cat_count,
  -- Context
  i.county,
  i.is_emergency,
  i.has_kittens,
  r.status AS request_status,
  i.submission_status
FROM ops.intake_submissions i
LEFT JOIN ops.requests r ON r.request_id = COALESCE(i.converted_to_request_id, i.request_id)
WHERE COALESCE(i.is_test, FALSE) = FALSE;

COMMENT ON VIEW ops.v_sac_report IS 'SAC (Shelter Animals Count) vocabulary mapping for grant reporting (FFS-416)';
COMMENT ON FUNCTION ops.classify_sac_intake_type IS 'Maps FFSC call_type + ownership_status to SAC intake type';
COMMENT ON FUNCTION ops.classify_sac_outcome IS 'Maps FFSC resolution_outcome to SAC outcome type';

COMMIT;
