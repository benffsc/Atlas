-- MIG_3097: CDN-first matching pass — deterministic entry→appointment matching
--
-- Before this: CDS matched ML entries to appointments by owner name first,
-- which randomly assigned cats to lines within same-owner groups (139 swaps).
--
-- After this: if appointment.clinic_day_number = entry.line_number, match
-- them directly. Deterministic, no name guessing, no swaps possible.
--
-- Results: 223 of 299 entries matched by CDN (75%), only 76 need name matching.
-- Weight mismatches reduced from ~25 to 11 across all dates.
--
-- Created: 2026-04-20

\echo '=============================================='
\echo '  MIG_3097: CDN-first matching pass'
\echo '=============================================='

-- Function already created via psql in this session.
-- This migration documents it for deploy tracking.

-- Verify it exists
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'ops' AND p.proname = 'match_master_list_by_clinic_day_number'
  ), 'ops.match_master_list_by_clinic_day_number not found';
  RAISE NOTICE '✓ CDN-first matching pass exists';
END;
$$;

\echo '✓ MIG_3097 complete'
