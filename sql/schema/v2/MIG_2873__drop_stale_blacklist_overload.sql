-- MIG_2873: Drop stale is_identifier_blacklisted overload (FFS-299)
--
-- The 3-arg overload (p_type, p_value, p_check_v1) references
-- trapper.data_engine_soft_blacklist which was dropped in MIG_2299.
-- The 2-arg version (p_type, p_value) is the correct V2-only version.
--
-- Already applied manually; this records the migration.

DROP FUNCTION IF EXISTS sot.is_identifier_blacklisted(text, text, boolean);

-- Verify only the 2-arg version remains
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM pg_proc p 
      JOIN pg_namespace n ON p.pronamespace = n.oid 
      WHERE n.nspname = 'sot' AND p.proname = 'is_identifier_blacklisted') <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 overload of sot.is_identifier_blacklisted';
  END IF;
END $$;

\echo 'MIG_2873: Dropped stale 3-arg overload of sot.is_identifier_blacklisted'
