-- MIG_3080: Centralize ClinicHQ ownership_type mapping
-- FFS-1233: The CASE mapping from ClinicHQ's raw Ownership values to our
-- normalized ownership_type was duplicated 10+ times across migrations.
-- Single function = one place to add new types, zero drift.
--
-- Called by: ops.run_clinichq_post_processing() (MIG_2975),
--            any future code that needs to interpret ClinicHQ ownership.
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION ops.map_clinichq_ownership_type(raw_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE TRIM(raw_value)
    WHEN 'Community Cat (Feral)'    THEN 'feral'
    WHEN 'Community Cat (Friendly)' THEN 'community'
    WHEN 'Owned'                    THEN 'owned'
    WHEN 'Foster'                   THEN 'foster'
    WHEN 'Shelter'                  THEN 'shelter'
    WHEN 'Misc 1'                   THEN 'unknown'
    WHEN 'Misc 2'                   THEN 'unknown'
    WHEN 'Misc 3'                   THEN 'unknown'
    ELSE NULL
  END
$$;

COMMENT ON FUNCTION ops.map_clinichq_ownership_type(TEXT) IS
  'Maps raw ClinicHQ Ownership field values to normalized ownership_type. '
  'Single source of truth — never inline this CASE mapping.';
