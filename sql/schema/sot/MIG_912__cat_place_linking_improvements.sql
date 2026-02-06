-- ============================================================================
-- MIG_912: Cat-Place Linking Pipeline Improvements (DATA_GAP_007)
-- ============================================================================
-- Problems identified from Macy investigation:
--   1. link_cats_to_places() uses ORDER BY created_at DESC, picking NEWEST
--      address (where person moved TO) instead of where cat actually lives
--   2. Phone-only appointments not linked (MIG_902 not deployed)
--   3. No colony detection - 31 cats linked to one caretaker's address
--
-- Solution:
--   1. Add temporal awareness to link_cats_to_places()
--   2. Integrate phone linking into entity linking pipeline
--   3. Add colony caretaker detection and auto-tagging
--   4. Add 'caretaker' role to person_place_relationships
-- ============================================================================

\echo '=== MIG_912: Cat-Place Linking Pipeline Improvements ==='
\echo ''

-- ============================================================================
-- Phase 1: Add 'caretaker' role to person_place_role enum
-- ============================================================================

\echo 'Phase 1: Adding caretaker role to person_place_role enum...'

DO $$
BEGIN
  -- Check if 'caretaker' already exists in the enum
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'trapper.person_place_role'::regtype
      AND enumlabel = 'caretaker'
  ) THEN
    ALTER TYPE trapper.person_place_role ADD VALUE 'caretaker';
    RAISE NOTICE 'Added caretaker to person_place_role enum';
  ELSE
    RAISE NOTICE 'caretaker already exists in person_place_role enum';
  END IF;
END $$;

-- ============================================================================
-- Phase 2: Update link_cats_to_places() with temporal awareness
-- ============================================================================

\echo ''
\echo 'Phase 2: Updating link_cats_to_places() with temporal awareness...'

CREATE OR REPLACE FUNCTION trapper.link_cats_to_places()
RETURNS TABLE (
  cats_linked_home INT
) AS $$
DECLARE
  v_count INT := 0;
BEGIN
  -- MIG_912: Temporal awareness fix
  -- Previously: ORDER BY created_at DESC picked NEWEST address (where person moved TO)
  -- Now: Prefer addresses valid at time of cat's first appointment
  --      Use created_at ASC to prefer OLDER addresses (where cat was first seen)

  WITH cats_needing_places AS (
    SELECT DISTINCT
      pcr.cat_id,
      pcr.person_id,
      (SELECT MIN(a.appointment_date)
       FROM trapper.sot_appointments a
       WHERE a.cat_id = pcr.cat_id) as first_appointment_date
    FROM trapper.person_cat_relationships pcr
    JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
      AND c.merged_into_cat_id IS NULL
    WHERE pcr.relationship_type IN ('owner', 'foster', 'adopter')
      -- Exclude cats already linked to places
      AND NOT EXISTS (
        SELECT 1 FROM trapper.cat_place_relationships cpr
        WHERE cpr.cat_id = pcr.cat_id
      )
      -- INV-12: Exclude staff/trappers to prevent address pollution
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_roles pr
        WHERE pr.person_id = pcr.person_id
          AND pr.role_status = 'active'
          AND pr.role IN ('staff', 'coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper')
      )
  ),
  best_places AS (
    SELECT DISTINCT ON (cnp.cat_id)
      cnp.cat_id,
      cnp.person_id,
      ppr.place_id,
      ppr.role as person_place_role
    FROM cats_needing_places cnp
    JOIN trapper.person_place_relationships ppr ON ppr.person_id = cnp.person_id
    JOIN trapper.places pl ON pl.place_id = ppr.place_id
      AND pl.merged_into_place_id IS NULL
    WHERE ppr.role IN ('resident', 'owner', 'requester')
      -- MIG_912: Exclude caretaker role (like staff filter)
      AND ppr.role NOT IN ('caretaker', 'contact')
      -- MIG_912: Temporal check - only use if person lived there when cat was seen
      AND (ppr.valid_to IS NULL OR ppr.valid_to >= COALESCE(cnp.first_appointment_date, ppr.created_at))
    ORDER BY
      cnp.cat_id,
      -- MIG_912: Prefer addresses still valid (no end date)
      CASE WHEN ppr.valid_to IS NULL THEN 0 ELSE 1 END,
      ppr.confidence DESC,
      -- MIG_912: Prefer OLDER addresses (created_at ASC, not DESC)
      -- This is where cat was first seen, not where person moved to
      ppr.created_at ASC
  ),
  linked AS (
    INSERT INTO trapper.cat_place_relationships (
      cat_id, place_id, relationship_type, confidence, source_system, source_table
    )
    SELECT
      bp.cat_id,
      bp.place_id,
      'home',
      'high',
      'atlas',
      'link_cats_to_places'
    FROM best_places bp
    ON CONFLICT DO NOTHING
    RETURNING cat_id
  )
  SELECT COUNT(*) INTO v_count FROM linked;

  cats_linked_home := v_count;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_cats_to_places IS
'MIG_912: Temporal awareness fix.
Links cats to places via person_cat → person_place chain.
Changes from previous version:
1. Uses created_at ASC (prefer OLDER addresses where cat was first seen)
2. Checks valid_to against cat''s first appointment date
3. Excludes caretaker and contact roles (like staff filter)
INV-12: Excludes staff/trappers to prevent address pollution.';

-- ============================================================================
-- Phase 3: Create colony caretaker detection function
-- ============================================================================

\echo ''
\echo 'Phase 3: Creating colony caretaker detection function...'

CREATE OR REPLACE FUNCTION trapper.detect_colony_caretakers()
RETURNS TABLE (
  person_id UUID,
  person_name TEXT,
  place_id UUID,
  place_address TEXT,
  cat_count INT,
  tagged_as_colony BOOLEAN
) AS $$
BEGIN
  -- Find person-place combinations with 15+ cats
  -- This suggests colony caretaking, not individual cat ownership

  WITH heavy_linkers AS (
    SELECT
      pcr.person_id,
      cpr.place_id,
      COUNT(DISTINCT pcr.cat_id) as cat_count
    FROM trapper.person_cat_relationships pcr
    JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = pcr.cat_id
    WHERE pcr.relationship_type IN ('owner', 'caretaker', 'feeder')
    GROUP BY pcr.person_id, cpr.place_id
    HAVING COUNT(DISTINCT pcr.cat_id) >= 15
  ),
  -- Auto-tag these places as colony_site
  tagged AS (
    INSERT INTO trapper.place_contexts (place_id, context_type, source_system, source_table)
    SELECT DISTINCT
      hl.place_id,
      'colony_site'::trapper.place_context_type,
      'atlas',
      'detect_colony_caretakers'
    FROM heavy_linkers hl
    WHERE NOT EXISTS (
      SELECT 1 FROM trapper.place_contexts pc
      WHERE pc.place_id = hl.place_id
        AND pc.context_type = 'colony_site'
        AND pc.ended_at IS NULL
    )
    ON CONFLICT DO NOTHING
    RETURNING place_id
  )
  RETURN QUERY
  SELECT
    hl.person_id,
    p.display_name as person_name,
    hl.place_id,
    pl.formatted_address as place_address,
    hl.cat_count::INT,
    EXISTS (SELECT 1 FROM tagged t WHERE t.place_id = hl.place_id) as tagged_as_colony
  FROM heavy_linkers hl
  JOIN trapper.sot_people p ON p.person_id = hl.person_id
  JOIN trapper.places pl ON pl.place_id = hl.place_id
  ORDER BY hl.cat_count DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.detect_colony_caretakers IS
'MIG_912: Detects person-place combinations with 15+ cats.
Auto-tags these places as colony_site.
Use to identify and flag colony caretakers for review.';

-- ============================================================================
-- Phase 4: Update run_all_entity_linking() to include phone linking
-- ============================================================================

\echo ''
\echo 'Phase 4: Updating run_all_entity_linking() with phone linking and colony detection...'

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
  v_json JSONB;
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

  -- 4. Link cats to places (MIG_912: now with temporal awareness)
  SELECT cats_linked INTO v_cats
  FROM trapper.run_cat_place_linking();
  RETURN QUERY SELECT 'cats_linked_to_places'::TEXT, v_cats;

  -- 5. Link appointments to trappers
  SELECT trapper.run_appointment_trapper_linking() INTO v_count;
  RETURN QUERY SELECT 'appointments_linked_to_trappers'::TEXT, v_count;

  -- 6. Link cats to requests
  SELECT linked, skipped INTO v_linked, v_skipped
  FROM trapper.link_cats_to_requests_safe();
  RETURN QUERY SELECT 'cats_linked_to_requests'::TEXT, v_linked;

  -- 7. Link appointments to partner organizations
  FOR v_rec IN SELECT * FROM trapper.link_appointments_to_partner_orgs() LOOP
    RETURN QUERY SELECT ('partner_org_' || lower(replace(v_rec.source, ' ', '_')))::TEXT, v_rec.appointments_linked;
  END LOOP;

  -- 8. Infer place_id for appointments
  FOR v_rec IN SELECT * FROM trapper.infer_appointment_places() LOOP
    RETURN QUERY SELECT ('inferred_place_' || lower(replace(v_rec.source, ' ', '_')))::TEXT, v_rec.appointments_linked;
  END LOOP;

  -- 9. MIG_909: Fix address account place overrides
  FOR v_rec IN SELECT * FROM trapper.fix_address_account_place_overrides() LOOP
    RETURN QUERY SELECT ('address_account_' || lower(replace(v_rec.source, ' ', '_')))::TEXT, v_rec.appointments_updated;
  END LOOP;

  -- 10. MIG_912: Link appointments via phone (phone-only cases)
  v_json := trapper.link_appointments_via_phone();
  RETURN QUERY SELECT 'phone_appointments_linked'::TEXT, (v_json->>'appointments_linked')::INT;
  RETURN QUERY SELECT 'phone_relationships_created'::TEXT, (v_json->>'relationships_created')::INT;

  -- 11. MIG_912: Detect and tag colony caretakers
  SELECT COUNT(*) INTO v_count FROM trapper.detect_colony_caretakers() WHERE tagged_as_colony = true;
  RETURN QUERY SELECT 'colony_sites_detected'::TEXT, v_count;

  -- 12. Link Google Maps entries to places
  SELECT trapper.link_google_entries_incremental(500) INTO v_count;
  RETURN QUERY SELECT 'google_entries_linked'::TEXT, v_count;

  -- 13. Flag multi-unit candidates for manual review
  SELECT trapper.flag_multi_unit_candidates() INTO v_count;
  RETURN QUERY SELECT 'google_entries_flagged_multiunit'::TEXT, v_count;

END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_all_entity_linking IS
'MIG_912: Added phone linking (Step 10) and colony detection (Step 11).
Entity linking chain:
1. Link appointments to owners (email-based)
2. Create places from intake
3. Link intake requesters to places
4. Link cats to places (MIG_912: temporal awareness)
5. Link appointments to trappers
6. Link cats to requests
7. Link appointments to partner orgs
8. Infer places for appointments
9. Fix address account place overrides (MIG_909)
10. Link appointments via phone (MIG_912)
11. Detect and tag colony caretakers (MIG_912)
12. Link Google Maps entries (incremental)
13. Flag multi-unit candidates

Run via cron every 15 minutes or after data ingest.';

-- ============================================================================
-- Phase 5: Run initial backfill
-- ============================================================================

\echo ''
\echo 'Phase 5: Running phone linking backfill...'

SELECT * FROM trapper.link_appointments_via_phone();

\echo ''
\echo 'Phase 5b: Running colony detection...'

SELECT * FROM trapper.detect_colony_caretakers();

-- ============================================================================
-- Phase 6: Audit results
-- ============================================================================

\echo ''
\echo 'Phase 6: Auditing results...'

-- Check phone-only linking stats
SELECT
  'Phone-only appointments' as metric,
  COUNT(*) FILTER (WHERE person_id IS NOT NULL) as linked,
  COUNT(*) FILTER (WHERE person_id IS NULL) as unlinked,
  COUNT(*) as total
FROM trapper.sot_appointments
WHERE (owner_email IS NULL OR TRIM(owner_email) = '')
  AND owner_phone IS NOT NULL
  AND TRIM(owner_phone) != '';

-- Check colony sites detected
SELECT
  'Colony sites detected' as metric,
  COUNT(*) as count
FROM trapper.place_contexts
WHERE context_type = 'colony_site'
  AND source_table = 'detect_colony_caretakers';

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_912 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Added caretaker role to person_place_role enum'
\echo '  2. Updated link_cats_to_places() with temporal awareness'
\echo '     - Uses created_at ASC (prefer OLDER addresses)'
\echo '     - Checks valid_to against cat first appointment'
\echo '     - Excludes caretaker and contact roles'
\echo '  3. Created detect_colony_caretakers() function'
\echo '  4. Updated run_all_entity_linking() pipeline:'
\echo '     - Step 10: Phone linking (MIG_902)'
\echo '     - Step 11: Colony detection (MIG_912)'
\echo ''
\echo 'DATA_GAP_007: Cat-Place Linking Pipeline - RESOLVED'
\echo ''
