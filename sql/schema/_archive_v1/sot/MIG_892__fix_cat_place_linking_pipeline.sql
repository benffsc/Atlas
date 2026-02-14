-- ============================================================================
-- MIG_892: Fix Cat-Place Linking Pipeline
-- ============================================================================
-- Root Cause: run_all_entity_linking() has TWO broken cat-place linking steps:
--   Step 4: run_cat_place_linking() - joins ALL person_place_relationships
--   Step 6: Direct INSERT - also joins ALL person_place_relationships
--
-- Neither uses the fixed functions from MIG_889:
--   - link_cats_to_appointment_places() - uses inferred_place_id
--   - link_cats_to_places() - has LIMIT 1 + staff exclusion
--
-- This creates massive pollution at staff/trapper addresses (1000+ cats per place).
--
-- Fixes:
--   1. Update run_cat_place_linking() to call the proper MIG_889 functions
--   2. Remove Step 6 from run_all_entity_linking() (redundant + broken)
--   3. Clean up existing polluted cat_place_relationships
-- ============================================================================

\echo '=== MIG_892: Fix Cat-Place Linking Pipeline ==='

-- ============================================================================
-- Phase 1: Update run_cat_place_linking() to use MIG_889 functions
-- ============================================================================

\echo ''
\echo 'Phase 1: Updating run_cat_place_linking() to use proper functions...'

CREATE OR REPLACE FUNCTION trapper.run_cat_place_linking()
RETURNS TABLE(cats_linked integer, places_involved integer)
LANGUAGE plpgsql
AS $$
DECLARE
  v_appointment_cats INT := 0;
  v_person_cats INT := 0;
  v_rec RECORD;
BEGIN
  -- MIG_892: Use the proper functions from MIG_889

  -- 1. Link cats via appointment inferred_place_id (highest priority, most accurate)
  -- This uses the pre-computed best-place from the most recent appointment
  FOR v_rec IN SELECT * FROM trapper.link_cats_to_appointment_places() LOOP
    v_appointment_cats := v_rec.cats_linked;
  END LOOP;

  -- 2. Link cats via person_cat → person_place chain (with LIMIT 1 + staff exclusion)
  FOR v_rec IN SELECT * FROM trapper.link_cats_to_places() LOOP
    v_person_cats := v_rec.cats_linked_home;
  END LOOP;

  cats_linked := v_appointment_cats + v_person_cats;
  places_involved := 0; -- Not tracked in new functions
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION trapper.run_cat_place_linking IS
'MIG_892: Updated to use proper MIG_889 functions.
1. link_cats_to_appointment_places() - uses inferred_place_id (92.3% coverage, most accurate)
2. link_cats_to_places() - LIMIT 1 per person, excludes staff/trappers (INV-12)
Replaces broken logic that linked cats to ALL person addresses.';

-- ============================================================================
-- Phase 2: Update run_all_entity_linking() to remove broken Step 6
-- ============================================================================

\echo ''
\echo 'Phase 2: Removing broken Step 6 from run_all_entity_linking()...'

CREATE OR REPLACE FUNCTION trapper.run_all_entity_linking()
RETURNS TABLE(operation text, count integer) AS $$
DECLARE
  v_count INT;
  v_cats INT;
  v_places INT;
  v_updated INT;
  v_created INT;
  v_linked INT;
  v_skipped INT;
  v_rec RECORD;
BEGIN
  -- 1. Link appointments to owners first (critical for cat-place linking)
  SELECT appointments_updated, persons_created, persons_linked
  INTO v_updated, v_created, v_linked
  FROM trapper.link_appointments_to_owners();
  RETURN QUERY SELECT 'appointments_linked_to_owners'::TEXT, v_updated;
  RETURN QUERY SELECT 'persons_created_for_appointments'::TEXT, v_created;

  -- 2. Create places from intake
  SELECT trapper.create_places_from_intake() INTO v_count;
  RETURN QUERY SELECT 'places_created_from_intake'::TEXT, v_count;

  -- 3. Link intake requesters to places
  SELECT trapper.link_intake_requesters_to_places() INTO v_count;
  RETURN QUERY SELECT 'intake_requester_place_links'::TEXT, v_count;

  -- 4. Link cats to places (MIG_892: now uses proper MIG_889 functions)
  SELECT cats_linked, places_involved INTO v_cats, v_places
  FROM trapper.run_cat_place_linking();
  RETURN QUERY SELECT 'cats_linked_to_places'::TEXT, v_cats;

  -- 5. Link appointments to trappers
  SELECT trapper.run_appointment_trapper_linking() INTO v_count;
  RETURN QUERY SELECT 'appointments_linked_to_trappers'::TEXT, v_count;

  -- MIG_892: Step 6 REMOVED - was redundant + broken
  -- Old Step 6 linked cats to ALL person_place_relationships without staff exclusion.
  -- The proper logic is now in run_cat_place_linking() via MIG_889 functions.

  -- 6. Link cats to requests (was Step 7)
  SELECT linked, skipped INTO v_linked, v_skipped
  FROM trapper.link_cats_to_requests_safe();
  RETURN QUERY SELECT 'cats_linked_to_requests'::TEXT, v_linked;

  -- 7. Link appointments to partner organizations (was Step 8)
  FOR v_rec IN SELECT * FROM trapper.link_appointments_to_partner_orgs() LOOP
    RETURN QUERY SELECT ('partner_org_' || lower(replace(v_rec.source, ' ', '_')))::TEXT, v_rec.appointments_linked;
  END LOOP;

  -- 8. Infer place_id for appointments (was Step 9)
  FOR v_rec IN SELECT * FROM trapper.infer_appointment_places() LOOP
    RETURN QUERY SELECT ('inferred_place_' || lower(replace(v_rec.source, ' ', '_')))::TEXT, v_rec.appointments_linked;
  END LOOP;

  -- 9. Link Google Maps entries to places (was Step 10)
  SELECT trapper.link_google_entries_incremental(500) INTO v_count;
  RETURN QUERY SELECT 'google_entries_linked'::TEXT, v_count;

  -- 10. Flag multi-unit candidates for manual review (was Step 11)
  SELECT trapper.flag_multi_unit_candidates() INTO v_count;
  RETURN QUERY SELECT 'google_entries_flagged_multiunit'::TEXT, v_count;

END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_all_entity_linking IS
'MIG_892: Removed broken Step 6 (appointment_person_link pollution).
Entity linking chain:
1. Link appointments to owners
2. Create places from intake
3. Link intake requesters to places
4. Link cats to places (via MIG_889 proper functions)
5. Link appointments to trappers
6. Link cats to requests
7. Link appointments to partner orgs
8. Infer places for appointments
9. Link Google Maps entries (incremental)
10. Flag multi-unit candidates

Run via cron every 15 minutes or after data ingest.';

-- ============================================================================
-- Phase 3: Clean up polluted cat_place_relationships at staff/trapper addresses
-- ============================================================================

\echo ''
\echo 'Phase 3: Cleaning up polluted cat_place_relationships...'

-- Delete cat-place relationships where:
-- 1. The place is linked to a staff/trapper person
-- 2. The relationship was created by the broken pipeline steps
-- 3. Keep legitimate relationships (adopter_residence, foster, etc.)

WITH staff_places AS (
    -- Get all places linked to staff/trappers
    SELECT DISTINCT ppr.place_id
    FROM trapper.person_place_relationships ppr
    JOIN trapper.person_roles pr ON pr.person_id = ppr.person_id
    WHERE pr.role_status = 'active'
      AND pr.role IN ('staff', 'coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper')
),
deleted AS (
    DELETE FROM trapper.cat_place_relationships cpr
    WHERE cpr.place_id IN (SELECT place_id FROM staff_places)
      AND cpr.source_table IN (
          'appointment_person_link',
          'appointment_owner_link',
          'mig224_person_place_link',
          'mig_235_backfill',
          'link_cats_to_places'  -- Old broken version
      )
      -- Keep legitimate relationships
      AND cpr.relationship_type NOT IN ('adopter_residence', 'foster_home')
    RETURNING cpr.cat_id, cpr.place_id
)
SELECT COUNT(*) AS deleted_count FROM deleted;

\echo ''
\echo 'Phase 3b: Clean up person_cat_relationships for staff...'

-- Staff members should not have person_cat_relationships for clinic-processed cats
-- (Exception: if they're the actual owner/caretaker at their home)
WITH staff_cat_cleanup AS (
    DELETE FROM trapper.person_cat_relationships pcr
    WHERE pcr.person_id IN (
        SELECT pr.person_id
        FROM trapper.person_roles pr
        WHERE pr.role_status = 'active'
          AND pr.role IN ('staff', 'coordinator')
    )
    -- Only delete 'caretaker' relationships from clinic processing
    AND pcr.relationship_type = 'caretaker'
    AND pcr.source_system = 'clinichq'
    RETURNING pcr.person_id, pcr.cat_id
)
SELECT COUNT(*) AS deleted_staff_cat_links FROM staff_cat_cleanup;

-- ============================================================================
-- Phase 4: Verify cleanup
-- ============================================================================

\echo ''
\echo 'Phase 4: Verifying cleanup results...'

\echo ''
\echo 'Top places by cat count (should all be < 100 now for non-colony sites):'
SELECT p.formatted_address, COUNT(*) as cat_count,
       CASE WHEN EXISTS (
           SELECT 1 FROM trapper.person_place_relationships ppr
           JOIN trapper.person_roles pr ON pr.person_id = ppr.person_id
           WHERE ppr.place_id = p.place_id
             AND pr.role_status = 'active'
             AND pr.role IN ('staff', 'coordinator', 'head_trapper', 'ffsc_trapper')
       ) THEN 'STAFF' ELSE '' END as is_staff
FROM trapper.cat_place_relationships cpr
JOIN trapper.places p ON p.place_id = cpr.place_id AND p.merged_into_place_id IS NULL
GROUP BY p.place_id, p.formatted_address
ORDER BY cat_count DESC
LIMIT 15;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_892 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. run_cat_place_linking() now calls MIG_889 proper functions'
\echo '  2. Removed broken Step 6 from run_all_entity_linking()'
\echo '  3. Cleaned up polluted cat_place_relationships at staff addresses'
\echo '  4. Cleaned up staff person_cat_relationships from clinic processing'
\echo ''
\echo 'The cat-place linking pipeline now:'
\echo '  - Uses inferred_place_id from appointments (92.3% coverage)'
\echo '  - Limits to 1 place per person (highest confidence)'
\echo '  - Excludes staff/trappers from person_cat → place chain (INV-12)'
\echo ''
