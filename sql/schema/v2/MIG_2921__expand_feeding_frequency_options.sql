-- MIG_2921: Expand feeding_frequency CHECK constraint
-- FFS-486: Add 'free_fed' and 'not_fed' to feeding_frequency options
--
-- Research-driven additions:
--   free_fed  — Food is always available (affects trap strategy: must coordinate food withholding)
--   not_fed   — No one feeds these cats (distinct from 'rarely', affects triage priority)

BEGIN;

-- Drop any existing feeding_frequency constraints (auto-generated or named)
-- PostgreSQL auto-names inline CHECK as {table}_{column}_check
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Drop all CHECK constraints on ops.requests.feeding_frequency
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'ops'
      AND rel.relname = 'requests'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%feeding_frequency%'
  LOOP
    EXECUTE format('ALTER TABLE ops.requests DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'Dropped constraint % from ops.requests', r.conname;
  END LOOP;

  -- Drop all CHECK constraints on ops.intake_submissions.feeding_frequency
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'ops'
      AND rel.relname = 'intake_submissions'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%feeding_frequency%'
  LOOP
    EXECUTE format('ALTER TABLE ops.intake_submissions DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'Dropped constraint % from ops.intake_submissions', r.conname;
  END LOOP;
END $$;

-- Add expanded constraints with explicit names
ALTER TABLE ops.requests
ADD CONSTRAINT requests_feeding_frequency_check CHECK (
  feeding_frequency IS NULL OR feeding_frequency IN (
    'daily', 'free_fed', 'few_times_week', 'occasionally', 'rarely', 'not_fed'
  )
);

ALTER TABLE ops.intake_submissions
ADD CONSTRAINT intake_submissions_feeding_frequency_check CHECK (
  feeding_frequency IS NULL OR feeding_frequency IN (
    'daily', 'free_fed', 'few_times_week', 'occasionally', 'rarely', 'not_fed'
  )
);

-- Verify
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'ops' AND rel.relname = 'requests'
      AND con.conname = 'requests_feeding_frequency_check'
  ) THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: requests_feeding_frequency_check not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'ops' AND rel.relname = 'intake_submissions'
      AND con.conname = 'intake_submissions_feeding_frequency_check'
  ) THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: intake_submissions_feeding_frequency_check not found';
  END IF;
END $$;

\echo 'MIG_2921: feeding_frequency CHECK expanded to include free_fed, not_fed'

COMMIT;
