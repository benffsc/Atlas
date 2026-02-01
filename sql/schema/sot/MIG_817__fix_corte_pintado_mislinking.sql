-- =====================================================
-- MIG_817: Fix 410 Corte Pintado Mislinking
-- =====================================================
-- Problem: Google Maps entry about "410 Corte Pintado" (mom cat + kittens,
-- contact Vickie Sneed) is unlinked (no linked_place_id). Five duplicate
-- place records "410 Corde Pintado" (misspelled with 'e' instead of 'te')
-- were merged into 107 Verde Ct (wrong target). A malformed person record
-- "410 Corde Pintado Dr." exists with an address as the person name.
-- Britteny Robinette's place at 407 Corte Pintado is separate and should
-- not absorb 410's data.
--
-- Solution: Create the correct place for 410 Corte Pintado, re-link
-- Google Maps entries, fix merged place targets, and flag the malformed
-- person record.
--
-- MANUAL APPLY:
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_817__fix_corte_pintado_mislinking.sql
-- =====================================================

\echo '=== MIG_817: Fix 410 Corte Pintado Mislinking ==='
\echo ''

DO $$
DECLARE
  v_place_id UUID;
  v_gme_updated INT;
  v_places_fixed INT;
  v_person_fixed INT;
BEGIN

  -- ============================================================
  -- Step 1: Create correct place for 410 Corte Pintado
  -- ============================================================
  RAISE NOTICE 'Step 1: Creating/finding correct place for 410 Corte Pintado...';

  v_place_id := trapper.find_or_create_place_deduped(
    '410 Corte Pintado, Rohnert Park, CA',
    NULL,  -- display_name
    NULL,  -- lat
    NULL,  -- lng
    'atlas_ui'  -- source
  );

  RAISE NOTICE 'Created/found place: %', v_place_id;

  -- ============================================================
  -- Step 2: Link Google Maps entries
  -- ============================================================
  RAISE NOTICE 'Step 2: Linking Google Maps entries...';

  UPDATE trapper.google_map_entries
  SET linked_place_id = v_place_id,
      match_status = 'manually_linked',
      matched_at = NOW()
  WHERE (kml_name ILIKE '%410%Corte Pintado%' OR kml_name ILIKE '%410%Corde Pintado%')
    AND linked_place_id IS NULL;
  GET DIAGNOSTICS v_gme_updated = ROW_COUNT;
  RAISE NOTICE 'Linked % Google Maps entries', v_gme_updated;

  -- ============================================================
  -- Step 3: Fix merged place records pointing to wrong target (107 Verde Ct)
  -- ============================================================
  RAISE NOTICE 'Step 3: Fixing merged place records...';

  UPDATE trapper.places
  SET merged_into_place_id = v_place_id
  WHERE (formatted_address ILIKE '%410%Corde Pintado%' OR normalized_address ILIKE '%410%corde pintado%')
    AND merged_into_place_id IS NOT NULL
    AND place_id != v_place_id;
  GET DIAGNOSTICS v_places_fixed = ROW_COUNT;
  RAISE NOTICE 'Fixed % merged place records', v_places_fixed;

  -- ============================================================
  -- Step 4: Flag malformed person "410 Corde Pintado Dr." as system account
  -- ============================================================
  RAISE NOTICE 'Step 4: Flagging malformed person record...';

  UPDATE trapper.sot_people
  SET is_system_account = TRUE
  WHERE display_name ILIKE '410 Corde Pintado%'
    AND is_system_account IS NOT TRUE;
  GET DIAGNOSTICS v_person_fixed = ROW_COUNT;
  RAISE NOTICE 'Flagged % malformed person records', v_person_fixed;

  -- ============================================================
  -- Summary
  -- ============================================================
  RAISE NOTICE '';
  RAISE NOTICE '=== MIG_817 Summary: place=%, gme=%, places_fixed=%, person_fixed=%',
    v_place_id, v_gme_updated, v_places_fixed, v_person_fixed;

END $$;

\echo ''
\echo '=== MIG_817 Complete ==='
