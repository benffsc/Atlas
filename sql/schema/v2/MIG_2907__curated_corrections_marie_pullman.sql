-- MIG_2907: Curated Corrections — Marie Pullman + person_roles Backfill
--
-- FFS-449: Three fixes:
--   1. Backfill person_roles from trapper_profiles (7 missing entries)
--   2. Marie Pullman corrections (trapper profile, service places, person_place fix)
--   3. Clean up false cat-place links created by person chain through trapper addresses
--
-- Created: 2026-03-11

\echo ''
\echo '=============================================='
\echo '  MIG_2907: Curated Corrections'
\echo '  FFS-449'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. BACKFILL person_roles FROM trapper_profiles
-- ============================================================================

\echo '1. Backfilling person_roles from trapper_profiles...'

-- 7 trapper_profiles have no person_roles entry. Map trapper_type → role.
INSERT INTO sot.person_roles (person_id, role, role_status, trapper_type, source_system, notes)
SELECT
  tp.person_id,
  CASE tp.trapper_type
    WHEN 'ffsc_volunteer' THEN 'trapper'
    WHEN 'ffsc_staff' THEN 'staff'
    WHEN 'community_trapper' THEN 'trapper'
    WHEN 'rescue_operator' THEN 'trapper'
    WHEN 'colony_caretaker' THEN 'caretaker'
    ELSE 'trapper'
  END,
  'active',
  CASE tp.trapper_type
    WHEN 'ffsc_volunteer' THEN 'ffsc_trapper'
    WHEN 'community_trapper' THEN 'community_trapper'
    ELSE NULL
  END,
  'atlas_inference',
  'MIG_2907/FFS-449: Backfilled from trapper_profiles'
FROM sot.trapper_profiles tp
WHERE tp.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM sot.person_roles pr
    WHERE pr.person_id = tp.person_id
  )
ON CONFLICT (person_id, role) DO NOTHING;

\echo '   Backfilled missing person_roles entries'

-- Show what was added
SELECT
  COALESCE(p.display_name, p.first_name || ' ' || p.last_name) as person,
  tp.trapper_type,
  pr.role,
  pr.notes
FROM sot.trapper_profiles tp
JOIN sot.people p ON p.person_id = tp.person_id
JOIN sot.person_roles pr ON pr.person_id = tp.person_id
  AND pr.notes LIKE '%MIG_2907%'
ORDER BY p.display_name;

-- ============================================================================
-- 2. MARIE PULLMAN — ADD TRAPPER PROFILE
-- ============================================================================

\echo ''
\echo '2. Adding Marie Pullman trapper profile...'

-- Marie Pullman: person_id = 8725ee82-a161-41d1-a897-c569ee2490d0
-- Lives at 181 Schlee Way, traps at Ciavi Offices (1405 Thunderbolt Way) and 1402 Mariner Way
-- Son PJ lives at 2955 Sunnywood Cir

DO $$
DECLARE
  v_marie_id UUID := '8725ee82-a161-41d1-a897-c569ee2490d0';
  v_schlee_id UUID;
  v_thunderbolt_id UUID;
  v_mariner_id UUID;
  v_sunnywood_id UUID;
  v_pj_id UUID;
  v_deleted_links INT;
  v_archived_links INT;
BEGIN
  -- Verify Marie exists
  IF NOT EXISTS (SELECT 1 FROM sot.people WHERE person_id = v_marie_id AND merged_into_person_id IS NULL) THEN
    RAISE NOTICE 'Marie Pullman (%) not found or merged — skipping corrections', v_marie_id;
    RETURN;
  END IF;

  RAISE NOTICE 'Marie Pullman found: %', v_marie_id;

  -- Find place IDs by address
  SELECT place_id INTO v_schlee_id
  FROM sot.places
  WHERE normalized_address ILIKE '%schlee%way%'
    AND merged_into_place_id IS NULL
  LIMIT 1;

  SELECT place_id INTO v_thunderbolt_id
  FROM sot.places
  WHERE normalized_address ILIKE '%thunderbolt%'
    AND merged_into_place_id IS NULL
  LIMIT 1;

  SELECT place_id INTO v_mariner_id
  FROM sot.places
  WHERE normalized_address ILIKE '%1402%mariner%'
    AND merged_into_place_id IS NULL
  LIMIT 1;

  SELECT place_id INTO v_sunnywood_id
  FROM sot.places
  WHERE normalized_address ILIKE '%sunnywood%'
    AND merged_into_place_id IS NULL
  LIMIT 1;

  RAISE NOTICE 'Places: Schlee=%, Thunderbolt=%, Mariner=%, Sunnywood=%',
    v_schlee_id, v_thunderbolt_id, v_mariner_id, v_sunnywood_id;

  -- 2a. Add trapper_profiles entry
  INSERT INTO sot.trapper_profiles (person_id, trapper_type, is_active, source_system, notes)
  VALUES (
    v_marie_id,
    'community_trapper',
    TRUE,
    'atlas_ui',
    'MIG_2907/FFS-449: Unofficial trapper. Traps at Ciavi Offices (Thunderbolt) and Mariner Way. Lives at Schlee Way.'
  )
  ON CONFLICT (person_id) DO UPDATE SET
    trapper_type = EXCLUDED.trapper_type,
    is_active = EXCLUDED.is_active,
    notes = EXCLUDED.notes,
    updated_at = NOW();

  RAISE NOTICE 'Added trapper_profiles entry for Marie';

  -- 2b. Add person_roles entry
  INSERT INTO sot.person_roles (person_id, role, role_status, trapper_type, source_system, notes)
  VALUES (
    v_marie_id,
    'trapper',
    'active',
    'community_trapper',
    'atlas_ui',
    'MIG_2907/FFS-449: Unofficial community trapper (Tier 3). Identified from data patterns.'
  )
  ON CONFLICT (person_id, role) DO NOTHING;

  RAISE NOTICE 'Added person_roles entry for Marie';

  -- 2c. Add trapper_service_places
  IF v_thunderbolt_id IS NOT NULL THEN
    INSERT INTO sot.trapper_service_places (person_id, place_id, service_type, role, source_system, evidence_type, notes)
    VALUES (v_marie_id, v_thunderbolt_id, 'primary_territory', 'property_liaison', 'atlas_ui', 'staff_verified',
            'MIG_2907/FFS-449: Ciavi Offices — Marie''s primary trapping site')
    ON CONFLICT (person_id, place_id) DO UPDATE SET
      service_type = EXCLUDED.service_type,
      role = EXCLUDED.role,
      notes = EXCLUDED.notes;
    RAISE NOTICE 'Added Thunderbolt as primary_territory';
  END IF;

  IF v_mariner_id IS NOT NULL THEN
    INSERT INTO sot.trapper_service_places (person_id, place_id, service_type, role, source_system, evidence_type, notes)
    VALUES (v_marie_id, v_mariner_id, 'regular', 'property_liaison', 'atlas_ui', 'staff_verified',
            'MIG_2907/FFS-449: Regular trapping site')
    ON CONFLICT (person_id, place_id) DO UPDATE SET
      service_type = EXCLUDED.service_type,
      role = EXCLUDED.role,
      notes = EXCLUDED.notes;
    RAISE NOTICE 'Added Mariner as regular service place';
  END IF;

  -- 2d. Fix person_place relationships
  -- Unique constraint is (person_id, place_id, relationship_type), so we UPDATE existing rows
  -- and INSERT only if no row exists for this person+place combo.

  -- Schlee Way = resident (Marie's home) — update confidence
  IF v_schlee_id IS NOT NULL THEN
    UPDATE sot.person_place SET confidence = 0.9, source_system = 'atlas_ui', source_table = 'MIG_2907'
    WHERE person_id = v_marie_id AND place_id = v_schlee_id AND relationship_type = 'resident';
    IF NOT FOUND THEN
      -- Delete any non-resident entry first, then insert as resident
      DELETE FROM sot.person_place WHERE person_id = v_marie_id AND place_id = v_schlee_id;
      INSERT INTO sot.person_place (person_id, place_id, relationship_type, confidence, source_system, source_table)
      VALUES (v_marie_id, v_schlee_id, 'resident', 0.9, 'atlas_ui', 'MIG_2907');
    END IF;
    RAISE NOTICE 'Set Schlee Way as resident (0.9)';
  END IF;

  -- Thunderbolt = trapper_at (NOT resident)
  IF v_thunderbolt_id IS NOT NULL THEN
    -- Remove existing resident entry, replace with trapper_at
    DELETE FROM sot.person_place WHERE person_id = v_marie_id AND place_id = v_thunderbolt_id;
    INSERT INTO sot.person_place (person_id, place_id, relationship_type, confidence, source_system, source_table)
    VALUES (v_marie_id, v_thunderbolt_id, 'trapper_at', 0.3, 'atlas_ui', 'MIG_2907');
    RAISE NOTICE 'Set Thunderbolt as trapper_at (0.3)';
  END IF;

  -- Mariner = trapper_at (NOT resident)
  IF v_mariner_id IS NOT NULL THEN
    DELETE FROM sot.person_place WHERE person_id = v_marie_id AND place_id = v_mariner_id;
    INSERT INTO sot.person_place (person_id, place_id, relationship_type, confidence, source_system, source_table)
    VALUES (v_marie_id, v_mariner_id, 'trapper_at', 0.3, 'atlas_ui', 'MIG_2907');
    RAISE NOTICE 'Set Mariner as trapper_at (0.3)';
  END IF;

  -- Sunnywood = remove (PJ's address, not Marie's)
  IF v_sunnywood_id IS NOT NULL THEN
    DELETE FROM sot.person_place
    WHERE person_id = v_marie_id AND place_id = v_sunnywood_id;
    RAISE NOTICE 'Removed Marie from Sunnywood (PJ''s address)';
  END IF;

  -- 2e. If PJ Pullman exists, ensure resident at Sunnywood
  SELECT p.person_id INTO v_pj_id
  FROM sot.people p
  WHERE (p.first_name ILIKE 'pj' OR p.first_name ILIKE 'p.j.' OR p.first_name ILIKE 'phillip')
    AND p.last_name ILIKE 'pullman'
    AND p.merged_into_person_id IS NULL
  LIMIT 1;

  IF v_pj_id IS NOT NULL AND v_sunnywood_id IS NOT NULL THEN
    INSERT INTO sot.person_place (person_id, place_id, relationship_type, confidence, source_system, source_table)
    VALUES (v_pj_id, v_sunnywood_id, 'resident', 0.8, 'atlas_ui', 'MIG_2907')
    ON CONFLICT (person_id, place_id, relationship_type) DO NOTHING;
    RAISE NOTICE 'Linked PJ Pullman (%) to Sunnywood as resident', v_pj_id;
  END IF;

  -- ========================================================================
  -- 3. CLEAN UP FALSE CAT-PLACE LINKS
  -- ========================================================================
  -- Delete cat_place rows where:
  --   - Cat is linked to Thunderbolt/Mariner/Sunnywood via entity_linking
  --   - Cat's appointment inferred_place_id points elsewhere (e.g., Schlee Way)
  -- Log all deletions to ops.entity_edits for audit trail (INV-1)

  -- Archive false links to entity_edits before deletion
  INSERT INTO ops.entity_edits (
    entity_type, entity_id, field_name,
    old_value, new_value, change_source
  )
  SELECT
    'cat_place',
    cp.id,
    'place_id (deleted)',
    cp.place_id::text,
    'MIG_2907/FFS-449: False cat-place link via trapper person chain',
    'MIG_2907'
  FROM sot.cat_place cp
  WHERE cp.source_system = 'entity_linking'
    AND cp.source_table = 'link_cats_to_places'
    AND cp.place_id IN (v_thunderbolt_id, v_mariner_id, v_sunnywood_id)
    -- Only delete if there's a better link via appointment
    AND EXISTS (
      SELECT 1 FROM ops.appointments a
      WHERE a.cat_id = cp.cat_id
        AND a.inferred_place_id IS NOT NULL
        AND a.inferred_place_id != cp.place_id
    );

  GET DIAGNOSTICS v_archived_links = ROW_COUNT;
  RAISE NOTICE 'Archived % false cat-place links to entity_edits', v_archived_links;

  -- Delete the false links
  DELETE FROM sot.cat_place cp
  WHERE cp.source_system = 'entity_linking'
    AND cp.source_table = 'link_cats_to_places'
    AND cp.place_id IN (v_thunderbolt_id, v_mariner_id, v_sunnywood_id)
    AND EXISTS (
      SELECT 1 FROM ops.appointments a
      WHERE a.cat_id = cp.cat_id
        AND a.inferred_place_id IS NOT NULL
        AND a.inferred_place_id != cp.place_id
    );

  GET DIAGNOSTICS v_deleted_links = ROW_COUNT;
  RAISE NOTICE 'Deleted % false cat-place links at Thunderbolt/Mariner/Sunnywood', v_deleted_links;

END $$;

-- ============================================================================
-- 4. VERIFICATION
-- ============================================================================

\echo ''
\echo '4. Verification...'

-- Verify Marie is now excluded from cat-place linking
\echo 'Marie exclusion check:'
SELECT sot.is_excluded_from_cat_place_linking('8725ee82-a161-41d1-a897-c569ee2490d0') as marie_excluded;

-- Verify Marie's person_place relationships
\echo ''
\echo 'Marie person_place relationships:'
SELECT
  pp.relationship_type,
  pp.confidence,
  COALESCE(pl.display_name, pl.formatted_address, pl.normalized_address) as place,
  pp.source_table
FROM sot.person_place pp
JOIN sot.places pl ON pl.place_id = pp.place_id
WHERE pp.person_id = '8725ee82-a161-41d1-a897-c569ee2490d0'
ORDER BY pp.confidence DESC;

-- Verify person_roles backfill count
\echo ''
\echo 'person_roles backfill summary:'
SELECT
  COUNT(*) as total_trapper_profiles,
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM sot.person_roles pr WHERE pr.person_id = tp.person_id
  )) as with_roles,
  COUNT(*) FILTER (WHERE NOT EXISTS (
    SELECT 1 FROM sot.person_roles pr WHERE pr.person_id = tp.person_id
  )) as still_missing_roles
FROM sot.trapper_profiles tp
WHERE tp.is_active = TRUE;

\echo ''
\echo '=============================================='
\echo '  MIG_2907 COMPLETE'
\echo '=============================================='
