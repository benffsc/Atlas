-- MIG_2912: Merge Duplicate Trapper Records
--
-- FFS-468: Kate Vasey and Lesley Cowley each have two person records
-- from different sources (ClinicHQ vs VolunteerHub/Airtable) with
-- different identifiers that the Data Engine couldn't auto-match.
--
-- Kate Vasey:
--   Winner: 0cc8ca05 (VH, trapper_profile, 10 cats, 13 appts)
--   Loser:  f19fa743 (ClinicHQ, riverkat@sonic.net, 4 cats, 5 appts)
--
-- Lesley Cowley:
--   Winner: 7117c83b (VH-matched, lesley@cowleyusa.com, 9 cats, 9 appts)
--   Loser:  cd860227 (ClinicHQ, lesley.no@cowleyusa.com, 7 cats, 10 appts)
--
-- merge_person_into() doesn't handle trapper_profiles or
-- trapper_service_places, so we migrate those first.
--
-- Created: 2026-03-12

\echo ''
\echo '=============================================='
\echo '  MIG_2912: Merge Duplicate Trappers'
\echo '  FFS-468'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 0. PRE-CHECK
-- ============================================================================

\echo '0. Pre-merge state:'

\echo 'Kate Vasey records:'
SELECT p.person_id, p.display_name, p.source_system,
  (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.person_id = p.person_id) as cats,
  (SELECT COUNT(*) FROM ops.appointments a WHERE a.person_id = p.person_id) as appts
FROM sot.people p
WHERE p.person_id IN ('f19fa743-a84d-4ab1-94db-0338f2edad9c', '0cc8ca05-0be5-46df-9a63-29379e0f27e9');

\echo ''
\echo 'Lesley Cowley records:'
SELECT p.person_id, p.display_name, p.source_system,
  (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.person_id = p.person_id) as cats,
  (SELECT COUNT(*) FROM ops.appointments a WHERE a.person_id = p.person_id) as appts
FROM sot.people p
WHERE p.person_id IN ('cd860227-1cab-416a-9e01-750f5d830de3', '7117c83b-39ae-4419-98ca-66fc34635976');

-- ============================================================================
-- 1. KATE VASEY: Migrate trapper data then merge
-- ============================================================================

\echo ''
\echo '1. Merging Kate Vasey...'

DO $$
DECLARE
  v_winner UUID := '0cc8ca05-0be5-46df-9a63-29379e0f27e9'; -- VH record
  v_loser  UUID := 'f19fa743-a84d-4ab1-94db-0338f2edad9c'; -- ClinicHQ record
BEGIN
  -- 1a. Migrate trapper_service_places from loser → winner (loser has 'regular' at Steele Ln)
  UPDATE sot.trapper_service_places
  SET person_id = v_winner
  WHERE person_id = v_loser
    AND NOT EXISTS (
      SELECT 1 FROM sot.trapper_service_places tsp2
      WHERE tsp2.person_id = v_winner AND tsp2.place_id = trapper_service_places.place_id
    );
  -- Delete any remaining (conflicts)
  DELETE FROM sot.trapper_service_places WHERE person_id = v_loser;
  RAISE NOTICE 'Kate Vasey: Migrated trapper_service_places';

  -- 1b. Loser has no trapper_profiles entry — nothing to migrate

  -- 1c. Call merge_person_into
  PERFORM sot.merge_person_into(v_loser, v_winner, 'MIG_2912/FFS-468: Duplicate Kate Vasey (ClinicHQ + VH)', 'MIG_2912');
  RAISE NOTICE 'Kate Vasey: Merged % into %', v_loser, v_winner;
END $$;

-- ============================================================================
-- 2. LESLEY COWLEY: Migrate trapper data then merge
-- ============================================================================

\echo ''
\echo '2. Merging Lesley Cowley...'

DO $$
DECLARE
  v_winner UUID := '7117c83b-39ae-4419-98ca-66fc34635976'; -- VH-matched record
  v_loser  UUID := 'cd860227-1cab-416a-9e01-750f5d830de3'; -- ClinicHQ/Airtable record
BEGIN
  -- 2a. Migrate trapper_service_places from loser → winner (loser has 'regular' at Lakeville)
  UPDATE sot.trapper_service_places
  SET person_id = v_winner
  WHERE person_id = v_loser
    AND NOT EXISTS (
      SELECT 1 FROM sot.trapper_service_places tsp2
      WHERE tsp2.person_id = v_winner AND tsp2.place_id = trapper_service_places.place_id
    );
  DELETE FROM sot.trapper_service_places WHERE person_id = v_loser;
  RAISE NOTICE 'Lesley Cowley: Migrated trapper_service_places';

  -- 2b. Delete loser's trapper_profiles (winner already has one from VH)
  DELETE FROM sot.trapper_profiles WHERE person_id = v_loser;
  RAISE NOTICE 'Lesley Cowley: Removed loser trapper_profiles';

  -- 2c. Call merge_person_into
  PERFORM sot.merge_person_into(v_loser, v_winner, 'MIG_2912/FFS-468: Duplicate Lesley Cowley (two ClinicHQ emails)', 'MIG_2912');
  RAISE NOTICE 'Lesley Cowley: Merged % into %', v_loser, v_winner;
END $$;

-- ============================================================================
-- 3. VERIFICATION
-- ============================================================================

\echo ''
\echo '3. Verification...'

\echo 'Kate Vasey (should be 1 active record):'
SELECT p.person_id, p.display_name, p.source_system, p.merged_into_person_id,
  (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.person_id = p.person_id) as cats,
  (SELECT COUNT(*) FROM ops.appointments a WHERE a.person_id = p.person_id) as appts,
  (SELECT COUNT(*) FROM sot.trapper_service_places tsp WHERE tsp.person_id = p.person_id) as service_places
FROM sot.people p
WHERE p.first_name ILIKE 'kate' AND p.last_name ILIKE 'vasey'
ORDER BY p.merged_into_person_id NULLS FIRST;

\echo ''
\echo 'Lesley Cowley (should be 1 active record):'
SELECT p.person_id, p.display_name, p.source_system, p.merged_into_person_id,
  (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.person_id = p.person_id) as cats,
  (SELECT COUNT(*) FROM ops.appointments a WHERE a.person_id = p.person_id) as appts,
  (SELECT COUNT(*) FROM sot.trapper_service_places tsp WHERE tsp.person_id = p.person_id) as service_places
FROM sot.people p
WHERE p.first_name ILIKE 'lesley' AND p.last_name ILIKE 'cowley'
ORDER BY p.merged_into_person_id NULLS FIRST;

\echo ''
\echo 'Trapper list count (should have no duplicates):'
SELECT COUNT(*) as total_active_trappers
FROM sot.person_roles pr
JOIN sot.people p ON p.person_id = pr.person_id AND p.merged_into_person_id IS NULL
WHERE pr.role = 'trapper' AND pr.role_status = 'active';

\echo ''
\echo '=============================================='
\echo '  MIG_2912 COMPLETE'
\echo '=============================================='
