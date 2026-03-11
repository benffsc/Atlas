-- MIG_2909: Bulk Repair — Trapper person_place + False Cat-Place Links
--
-- FFS-449/FFS-453/FFS-454: MIG_2906 prevents FUTURE false links, but existing
-- bad data remains. This migration:
--   1. Identifies each trapper's home address (via trapper_service_places, VH, or best guess)
--   2. Changes non-home person_place entries from 'resident' → 'trapper_at'
--   3. Archives + deletes false cat-place links from the old person chain
--   4. Logs all changes to ops.entity_edits for audit trail (INV-1)
--
-- DEPENDS ON: MIG_2906 (is_excluded_from_cat_place_linking must exist)
--
-- Created: 2026-03-11

\echo ''
\echo '=============================================='
\echo '  MIG_2909: Bulk Repair — Trapper Data'
\echo '  FFS-449, FFS-453, FFS-454'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 0. PRE-CHECK: Show current state
-- ============================================================================

\echo '0. Current state before repair...'

\echo 'Trappers with multiple resident person_place entries:'
SELECT
  COALESCE(p.display_name, p.first_name || ' ' || p.last_name) as trapper,
  tp.trapper_type,
  COUNT(*) as resident_places,
  string_agg(
    COALESCE(pl.display_name, LEFT(pl.formatted_address, 40)),
    ' | ' ORDER BY pp.confidence DESC NULLS LAST
  ) as places
FROM sot.trapper_profiles tp
JOIN sot.people p ON p.person_id = tp.person_id AND p.merged_into_person_id IS NULL
JOIN sot.person_place pp ON pp.person_id = tp.person_id AND pp.relationship_type = 'resident'
JOIN sot.places pl ON pl.place_id = pp.place_id AND pl.merged_into_place_id IS NULL
WHERE tp.is_active = TRUE
GROUP BY p.display_name, p.first_name, p.last_name, tp.trapper_type
ORDER BY COUNT(*) DESC
LIMIT 20;

-- ============================================================================
-- 1. IDENTIFY TRAPPER HOME ADDRESSES
-- ============================================================================
-- Priority:
--   A. trapper_service_places.service_type = 'home_rescue' (staff-verified)
--   B. VolunteerHub address match (source_system = 'volunteerhub')
--   C. Highest confidence single 'resident' person_place entry
--
-- Approach: Create a temp table of (trapper_person_id, home_place_id)
-- Then update all OTHER person_place entries to 'trapper_at'

\echo ''
\echo '1. Identifying trapper home addresses...'

CREATE TEMP TABLE tmp_trapper_homes AS
WITH
-- Priority A: trapper_service_places home_rescue
home_from_service AS (
  SELECT DISTINCT ON (tsp.person_id)
    tsp.person_id,
    tsp.place_id as home_place_id,
    'trapper_service_places' as source
  FROM sot.trapper_service_places tsp
  WHERE tsp.service_type = 'home_rescue'
    AND tsp.end_date IS NULL
  ORDER BY tsp.person_id, tsp.created_at DESC
),
-- Priority B: VolunteerHub-sourced person_place
home_from_vh AS (
  SELECT DISTINCT ON (pp.person_id)
    pp.person_id,
    pp.place_id as home_place_id,
    'volunteerhub_person_place' as source
  FROM sot.person_place pp
  WHERE pp.source_system = 'volunteerhub'
    AND pp.relationship_type = 'resident'
    AND pp.person_id NOT IN (SELECT person_id FROM home_from_service)
    AND pp.person_id IN (SELECT person_id FROM sot.trapper_profiles WHERE is_active = TRUE)
  ORDER BY pp.person_id, pp.confidence DESC NULLS LAST, pp.created_at DESC
),
-- Priority C: Highest confidence resident (only if single candidate or clear winner)
home_from_confidence AS (
  SELECT DISTINCT ON (pp.person_id)
    pp.person_id,
    pp.place_id as home_place_id,
    'highest_confidence_resident' as source
  FROM sot.person_place pp
  WHERE pp.relationship_type = 'resident'
    AND pp.person_id NOT IN (SELECT person_id FROM home_from_service)
    AND pp.person_id NOT IN (SELECT person_id FROM home_from_vh)
    AND pp.person_id IN (SELECT person_id FROM sot.trapper_profiles WHERE is_active = TRUE)
  ORDER BY pp.person_id, pp.confidence DESC NULLS LAST, pp.created_at ASC
)
SELECT * FROM home_from_service
UNION ALL
SELECT * FROM home_from_vh
UNION ALL
SELECT * FROM home_from_confidence;

\echo 'Home address sources:'
SELECT source, COUNT(*) as trappers
FROM tmp_trapper_homes
GROUP BY source
ORDER BY source;

\echo ''
\echo 'Trappers with identified homes:'
SELECT
  COALESCE(p.display_name, p.first_name || ' ' || p.last_name) as trapper,
  th.source,
  COALESCE(pl.display_name, LEFT(pl.formatted_address, 50)) as home_address
FROM tmp_trapper_homes th
JOIN sot.people p ON p.person_id = th.person_id
JOIN sot.places pl ON pl.place_id = th.home_place_id
ORDER BY th.source, p.display_name;

-- ============================================================================
-- 2. FIX PERSON_PLACE: resident → trapper_at FOR NON-HOME ADDRESSES
-- ============================================================================

\echo ''
\echo '2. Fixing person_place relationship types...'

-- Audit trail: log all changes to entity_edits BEFORE updating
INSERT INTO ops.entity_edits (
  entity_type, entity_id, field_name,
  old_value, new_value, change_source
)
SELECT
  'person_place',
  pp.id,
  'relationship_type',
  'resident',
  'trapper_at (home: ' || COALESCE(LEFT(home_pl.formatted_address, 50), '?') ||
    ', site: ' || COALESCE(LEFT(site_pl.formatted_address, 50), '?') ||
    ', src: ' || th.source || ')',
  'MIG_2909'
FROM sot.person_place pp
JOIN tmp_trapper_homes th ON th.person_id = pp.person_id
JOIN sot.places home_pl ON home_pl.place_id = th.home_place_id
JOIN sot.places site_pl ON site_pl.place_id = pp.place_id
WHERE pp.relationship_type = 'resident'
  AND pp.place_id != th.home_place_id;

-- Remove any existing trapper_at entries that would conflict with the update
DELETE FROM sot.person_place pp
USING tmp_trapper_homes th
WHERE pp.person_id = th.person_id
  AND pp.relationship_type = 'trapper_at'
  AND pp.place_id != th.home_place_id
  AND EXISTS (
    SELECT 1 FROM sot.person_place pp2
    WHERE pp2.person_id = pp.person_id
      AND pp2.place_id = pp.place_id
      AND pp2.relationship_type = 'resident'
  );

-- Perform the update: resident → trapper_at for non-home places
WITH updated AS (
  UPDATE sot.person_place pp
  SET
    relationship_type = 'trapper_at',
    confidence = LEAST(pp.confidence, 0.3),
    source_table = COALESCE(pp.source_table, '') || ' (was resident, MIG_2909)'
  FROM tmp_trapper_homes th
  WHERE pp.person_id = th.person_id
    AND pp.relationship_type = 'resident'
    AND pp.place_id != th.home_place_id
  RETURNING pp.person_id, pp.place_id
)
SELECT COUNT(*) as person_place_rows_fixed FROM updated;

-- ============================================================================
-- 3. CLEAN UP FALSE CAT-PLACE LINKS
-- ============================================================================

\echo ''
\echo '3. Cleaning up false cat-place links...'

-- Find and count false links before deleting
\echo 'False cat-place links from person chain through known trappers:'
SELECT
  COALESCE(p.display_name, p.first_name || ' ' || p.last_name) as trapper,
  COALESCE(wrong_pl.display_name, LEFT(wrong_pl.formatted_address, 40)) as wrong_place,
  COUNT(DISTINCT cp.cat_id) as wrong_cats
FROM sot.cat_place cp
JOIN sot.person_cat pc ON pc.cat_id = cp.cat_id
JOIN sot.people p ON p.person_id = pc.person_id AND p.merged_into_person_id IS NULL
JOIN sot.places wrong_pl ON wrong_pl.place_id = cp.place_id
WHERE cp.source_system = 'entity_linking'
  AND cp.source_table = 'link_cats_to_places'
  AND sot.is_excluded_from_cat_place_linking(pc.person_id)
GROUP BY p.display_name, p.first_name, p.last_name, wrong_pl.display_name, wrong_pl.formatted_address
ORDER BY COUNT(DISTINCT cp.cat_id) DESC
LIMIT 20;

-- Also find links where appointment inferred_place disagrees (catches non-trapper cases too)
\echo ''
\echo 'Cat-place links that conflict with appointment inferred_place_id:'
WITH conflicts AS (
  SELECT DISTINCT
    cp.id as cat_place_id,
    cp.cat_id,
    cp.place_id as wrong_place_id,
    a.inferred_place_id as correct_place_id
  FROM sot.cat_place cp
  JOIN ops.appointments a ON a.cat_id = cp.cat_id
    AND a.inferred_place_id IS NOT NULL
    AND a.inferred_place_id != cp.place_id
  WHERE cp.source_system = 'entity_linking'
    AND cp.source_table = 'link_cats_to_places'
    -- Only if the person who linked them is a known trapper
    AND EXISTS (
      SELECT 1 FROM sot.person_cat pc
      WHERE pc.cat_id = cp.cat_id
        AND sot.is_excluded_from_cat_place_linking(pc.person_id)
    )
)
SELECT COUNT(*) as total_false_links, COUNT(DISTINCT cat_id) as unique_cats FROM conflicts;

-- Archive false links to entity_edits
INSERT INTO ops.entity_edits (
  entity_type, entity_id, field_name,
  old_value, new_value, change_source
)
SELECT DISTINCT
  'cat_place',
  cp.id,
  'place_id (deleted)',
  cp.place_id::text,
  'correct: ' || a.inferred_place_id::text,
  'MIG_2909'
FROM sot.cat_place cp
JOIN ops.appointments a ON a.cat_id = cp.cat_id
  AND a.inferred_place_id IS NOT NULL
  AND a.inferred_place_id != cp.place_id
WHERE cp.source_system = 'entity_linking'
  AND cp.source_table = 'link_cats_to_places'
  AND EXISTS (
    SELECT 1 FROM sot.person_cat pc
    WHERE pc.cat_id = cp.cat_id
      AND sot.is_excluded_from_cat_place_linking(pc.person_id)
  )
ON CONFLICT DO NOTHING;

-- Delete false cat-place links
WITH deleted AS (
  DELETE FROM sot.cat_place cp
  USING ops.appointments a
  WHERE a.cat_id = cp.cat_id
    AND a.inferred_place_id IS NOT NULL
    AND a.inferred_place_id != cp.place_id
    AND cp.source_system = 'entity_linking'
    AND cp.source_table = 'link_cats_to_places'
    AND EXISTS (
      SELECT 1 FROM sot.person_cat pc
      WHERE pc.cat_id = cp.cat_id
        AND sot.is_excluded_from_cat_place_linking(pc.person_id)
    )
  RETURNING cp.cat_id
)
SELECT COUNT(DISTINCT cat_id) as cats_unlinked FROM deleted;

-- Also delete cat-place links for excluded trappers even when no appointment
-- inferred_place exists (these were created by person chain and are wrong)
\echo ''
\echo 'Removing remaining trapper person-chain cat-place links (no appointment fallback):'

WITH deleted_remaining AS (
  DELETE FROM sot.cat_place cp
  WHERE cp.source_system = 'entity_linking'
    AND cp.source_table = 'link_cats_to_places'
    -- Person who linked this cat is a known trapper
    AND EXISTS (
      SELECT 1 FROM sot.person_cat pc
      WHERE pc.cat_id = cp.cat_id
        AND sot.is_excluded_from_cat_place_linking(pc.person_id)
    )
    -- But only if the cat has a BETTER link from appointment-based linking
    AND EXISTS (
      SELECT 1 FROM sot.cat_place cp2
      WHERE cp2.cat_id = cp.cat_id
        AND cp2.id != cp.id
        AND cp2.source_table = 'link_cats_to_appointment_places'
    )
  RETURNING cp.cat_id
)
SELECT COUNT(DISTINCT cat_id) as additional_cats_cleaned FROM deleted_remaining;

-- Clean up temp table
DROP TABLE tmp_trapper_homes;

-- ============================================================================
-- 4. CLEAR STALE SKIP LOGS + RE-RUN ENTITY LINKING
-- ============================================================================

\echo ''
\echo '4. Clearing stale skip logs for re-evaluation...'

-- Remove stale entity_linking_skipped entries so the repaired function re-evaluates
DELETE FROM ops.entity_linking_skipped
WHERE reason IN ('person_chain_no_match', 'person_has_no_place')
  AND entity_type = 'cat';

\echo '   Cleared stale skip entries'

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

\echo ''
\echo '5. Post-repair verification...'

-- Check no trappers still have multiple resident entries
\echo 'Trappers still with multiple resident entries (should be 0 or very few):'
SELECT
  COALESCE(p.display_name, p.first_name || ' ' || p.last_name) as trapper,
  tp.trapper_type,
  COUNT(*) as resident_places
FROM sot.trapper_profiles tp
JOIN sot.people p ON p.person_id = tp.person_id AND p.merged_into_person_id IS NULL
JOIN sot.person_place pp ON pp.person_id = tp.person_id AND pp.relationship_type = 'resident'
JOIN sot.places pl ON pl.place_id = pp.place_id AND pl.merged_into_place_id IS NULL
WHERE tp.is_active = TRUE
GROUP BY p.display_name, p.first_name, p.last_name, tp.trapper_type
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- Check Cassie Thomson specifically (FFS-451)
\echo ''
\echo 'Cassie Thomson person_place (FFS-451):'
SELECT
  pp.relationship_type,
  pp.confidence,
  COALESCE(pl.display_name, pl.formatted_address) as place,
  pp.source_table
FROM sot.person_place pp
JOIN sot.places pl ON pl.place_id = pp.place_id
WHERE pp.person_id IN (
  SELECT person_id FROM sot.people
  WHERE first_name ILIKE 'cassie' AND last_name ILIKE 'thomson'
    AND merged_into_person_id IS NULL
)
ORDER BY pp.confidence DESC;

-- Check Marie Pullman
\echo ''
\echo 'Marie Pullman person_place:'
SELECT
  pp.relationship_type,
  pp.confidence,
  COALESCE(pl.display_name, pl.formatted_address) as place,
  pp.source_table
FROM sot.person_place pp
JOIN sot.places pl ON pl.place_id = pp.place_id
WHERE pp.person_id = '8725ee82-a161-41d1-a897-c569ee2490d0'
ORDER BY pp.confidence DESC;

-- Entity linking health check
\echo ''
\echo 'Entity linking health:'
SELECT * FROM ops.check_entity_linking_health();

-- Count of entity_edits logged by this migration
\echo ''
\echo 'Audit trail entries created by MIG_2909:'
SELECT entity_type, field_name, COUNT(*) as entries
FROM ops.entity_edits
WHERE change_source = 'MIG_2909'
GROUP BY entity_type, field_name;

\echo ''
\echo '=============================================='
\echo '  MIG_2909 COMPLETE'
\echo ''
\echo '  IMPORTANT: After running this migration,'
\echo '  re-run entity linking to rebuild cat-place links:'
\echo ''
\echo '  SELECT jsonb_pretty(sot.run_all_entity_linking());'
\echo '=============================================='
