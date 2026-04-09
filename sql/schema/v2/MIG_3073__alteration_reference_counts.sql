-- MIG_3073: Import Pip's alteration reference counts (1990-2026)
--
-- SOURCE: /Users/benmisdiaz/Downloads/Cats Altered to date by year.xlsx
-- Archived: data/reference/pip_cats_altered_by_year.xlsx
--
-- CONTEXT: The impact summary card on the dashboard shows "cats altered since
-- inception" but our DB only has ClinicHQ data starting ~2014. Pip (FFSC ED)
-- has maintained an Excel with yearly alteration counts since 1990 for donor
-- presentations. This migration imports those counts as a reference table so
-- the impact card can show the full organizational history.
--
-- IMPORTANT DATA GAPS IDENTIFIED (see Linear issues):
--   - 1990-2012: 22,142 cats NOT in our DB (pre-ClinicHQ era)
--   - 2013: only 2 in DB vs 2,035 in Excel (import started late/incomplete)
--   - 2014: 1,447 DB vs 1,985 Excel (538 gap, 27% under)
--   - 2021: 2,844 DB vs 2,083 Excel (761 OVER — needs investigation)
--   - 2019-2024: systematic 5-10% undercount in DB vs Excel
--
-- The reference counts are AUTHORITATIVE for donor-facing numbers. The DB
-- counts are what our system can prove with individual records. For the
-- impact card, we use MAX(reference, db) per year so we never show less
-- than what Pip has committed to donors.
--
-- Related: FFS-1194 (impact summary), FFS-1193 (rebrand epic)

-- Reference table for externally-verified alteration counts
CREATE TABLE IF NOT EXISTS ops.alteration_reference_counts (
  year integer PRIMARY KEY,
  count integer NOT NULL,
  source text NOT NULL DEFAULT 'pip_excel',
  notes text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ops.alteration_reference_counts IS
  'Externally-verified yearly alteration counts from the ED (Pip). Used by the '
  'impact summary card to show the full organizational history including years '
  'before ClinicHQ existed. Source: data/reference/pip_cats_altered_by_year.xlsx';

-- Seed the data from Pip's Excel
INSERT INTO ops.alteration_reference_counts (year, count, source, notes)
VALUES
  (1990,  180, 'pip_excel', 'Pre-ClinicHQ era — manual records only'),
  (1991,  237, 'pip_excel', 'Pre-ClinicHQ era'),
  (1992,  325, 'pip_excel', 'Pre-ClinicHQ era'),
  (1993,  338, 'pip_excel', 'Pre-ClinicHQ era'),
  (1994,  360, 'pip_excel', 'Pre-ClinicHQ era'),
  (1995,  370, 'pip_excel', 'Pre-ClinicHQ era'),
  (1996,  420, 'pip_excel', 'Pre-ClinicHQ era'),
  (1997,  465, 'pip_excel', 'Pre-ClinicHQ era'),
  (1998,  525, 'pip_excel', 'Pre-ClinicHQ era'),
  (1999,  528, 'pip_excel', 'Pre-ClinicHQ era'),
  (2000,  539, 'pip_excel', 'Pre-ClinicHQ era'),
  (2001,  501, 'pip_excel', 'Pre-ClinicHQ era'),
  (2002,  524, 'pip_excel', 'Pre-ClinicHQ era'),
  (2003,  669, 'pip_excel', 'Pre-ClinicHQ era'),
  (2004,  973, 'pip_excel', 'Pre-ClinicHQ era'),
  (2005, 1262, 'pip_excel', 'Pre-ClinicHQ era'),
  (2006, 1488, 'pip_excel', 'Pre-ClinicHQ era'),
  (2007, 1506, 'pip_excel', 'Pre-ClinicHQ era'),
  (2008, 1580, 'pip_excel', 'Pre-ClinicHQ era'),
  (2009, 1977, 'pip_excel', 'Pre-ClinicHQ era'),
  (2010, 2725, 'pip_excel', 'Pre-ClinicHQ era'),
  (2011, 2386, 'pip_excel', 'Pre-ClinicHQ era'),
  (2012, 2264, 'pip_excel', 'Pre-ClinicHQ era'),
  (2013, 2035, 'pip_excel', 'DB shows only 2 (ClinicHQ import gap — DATA_GAP)'),
  (2014, 1985, 'pip_excel', 'DB shows 1447 (538 gap, 27% — DATA_GAP)'),
  (2015, 2092, 'pip_excel', 'DB aligns (2121, 1.4% diff)'),
  (2016, 1986, 'pip_excel', 'DB aligns (1982, 0.2% diff)'),
  (2017, 1981, 'pip_excel', 'DB aligns (1983, 0.1% diff)'),
  (2018, 2149, 'pip_excel', 'DB aligns (2122, 1.3% diff)'),
  (2019, 2532, 'pip_excel', 'DB under (2384, 6% gap)'),
  (2020, 1837, 'pip_excel', 'DB under (1606, 13% gap — COVID year)'),
  (2021, 2083, 'pip_excel', 'DB OVER (2844, 37% over — needs investigation)'),
  (2022, 3600, 'pip_excel', 'DB under (3440, 4% gap)'),
  (2023, 4043, 'pip_excel', 'DB under (3680, 9% gap)'),
  (2024, 4327, 'pip_excel', 'DB under (4001, 8% gap)'),
  (2025, 4285, 'pip_excel', 'DB aligns (4401, 3% over — year still in progress)'),
  (2026, 1205, 'pip_excel', 'Year in progress — snapshot as of 2026-04-09')
ON CONFLICT (year) DO UPDATE
  SET count = EXCLUDED.count,
      source = EXCLUDED.source,
      notes = EXCLUDED.notes,
      updated_at = NOW();

-- Handy view: combines reference counts with DB counts per year,
-- using MAX(reference, db) for donor-facing numbers
CREATE OR REPLACE VIEW ops.v_alteration_counts_by_year AS
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
LEFT JOIN LATERAL (
  SELECT COUNT(DISTINCT a.cat_id)::int AS db_count
  FROM ops.appointments a
  WHERE a.cat_id IS NOT NULL
    AND (a.is_spay = TRUE OR a.is_neuter = TRUE)
    AND EXTRACT(YEAR FROM a.appointment_date) = r.year
) db ON TRUE
ORDER BY r.year;

-- Verification
DO $$
DECLARE
  v_total integer;
  v_count integer;
BEGIN
  SELECT COUNT(*), SUM(count) INTO v_count, v_total FROM ops.alteration_reference_counts;
  IF v_count < 35 THEN
    RAISE EXCEPTION 'MIG_3073 verification failed: expected 37 years of data, found %', v_count;
  END IF;
  RAISE NOTICE 'MIG_3073: % years of reference data imported, total alterations: %', v_count, v_total;
END $$;
