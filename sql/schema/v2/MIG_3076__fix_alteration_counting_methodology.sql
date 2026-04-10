-- MIG_3075: Fix alteration counting — use service items, not status checkboxes
--
-- PROBLEM: The is_spay/is_neuter flags on ops.appointments come from ClinicHQ's
-- "Spay" and "Neuter" checkbox columns in the cat_info CSV. These indicate the
-- cat's ALTERED STATUS (i.e., "this cat is spayed"), NOT whether the surgery was
-- performed at THIS visit. A cat returning for a recheck, vaccine, or any other
-- service will still have Spay=Yes because it's already altered.
--
-- This inflated our DB counts:
--   2021: 2,844 by flag vs 2,650 first-time by service → 194 overcounted
--   Across all years: ~770 extra cats counted who were rechecks/returns
--
-- FIX: The service_type column contains the actual ClinicHQ service items
-- (e.g., "Cat Spay /; FVRCP vaccine..."). Only appointments where service_type
-- contains "Cat Spay" or "Cat Neuter" represent actual surgeries.
--
-- Additionally, we count first-time alterations only: if a cat had a spay/neuter
-- service in a prior year, it's a recapture and shouldn't count again.
--
-- METHODOLOGY (3 layers):
--   1. service_type ~* 'Cat Spay|Cat Neuter' — actual surgery service item
--   2. First occurrence per cat — exclude recaptures from prior years
--   3. GREATEST(reference, db) — never show less than Pip's verified count
--
-- INVESTIGATION DATA (2021 as example):
--   by_flag (old):     2,844
--   by_service:        2,719 (125 had no surgery service — exams, misc, rechecks)
--   first_time_only:   2,650 (69 were recaptures from prior years)
--   pip_reference:     2,083
--
-- The corrected count (2,650) still exceeds Pip's reference (2,083), which
-- means the GREATEST() logic still picks the DB count for 2021. But the
-- overcounting in the view is now fixed for audit/transparency purposes.
--
-- Related: FFS-1217 (2021 data gap), FFS-1193 (Beacon Polish)

-- Fix the view to use service items and first-time methodology
CREATE OR REPLACE VIEW ops.v_alteration_counts_by_year AS
WITH first_surgeries AS (
  -- Find each cat's FIRST spay/neuter service appointment
  SELECT
    cat_id,
    MIN(appointment_date) AS first_surgery_date
  FROM ops.appointments
  WHERE cat_id IS NOT NULL
    AND service_type IS NOT NULL
    AND service_type ~* 'Cat Spay|Cat Neuter'
  GROUP BY cat_id
),
db_by_year AS (
  -- Count first-time alterations per year
  SELECT
    EXTRACT(YEAR FROM first_surgery_date)::int AS year,
    COUNT(*)::int AS db_count
  FROM first_surgeries
  GROUP BY 1
)
SELECT
  r.year,
  r.count AS reference_count,
  COALESCE(db.db_count, 0) AS db_count,
  GREATEST(r.count, COALESCE(db.db_count, 0)) AS donor_facing_count,
  r.source,
  r.notes,
  CASE
    WHEN db.db_count IS NULL THEN 'pre_system'
    WHEN abs(r.count - db.db_count) <= r.count * 0.05 THEN 'aligned'
    WHEN db.db_count > r.count THEN 'db_over'
    ELSE 'db_under'
  END AS alignment_status
FROM ops.alteration_reference_counts r
LEFT JOIN db_by_year db ON db.year = r.year
ORDER BY r.year;

-- Verification: compare old vs new for key years
DO $$
DECLARE
  v_2021_count int;
  v_2021_old int;
BEGIN
  SELECT db_count INTO v_2021_count
  FROM ops.v_alteration_counts_by_year WHERE year = 2021;

  -- Old count was 2844 (by flag), new should be ~2650 (first-time by service)
  IF v_2021_count > 2700 THEN
    RAISE WARNING 'MIG_3075: 2021 count (%) still seems high — expected ~2650', v_2021_count;
  END IF;

  RAISE NOTICE 'MIG_3075: 2021 DB count is now % (was 2844 by flag method)', v_2021_count;

  -- Check total
  SELECT SUM(db_count) INTO v_2021_old FROM ops.v_alteration_counts_by_year;
  RAISE NOTICE 'MIG_3075: Total DB-provable alterations: %', v_2021_old;
END $$;
