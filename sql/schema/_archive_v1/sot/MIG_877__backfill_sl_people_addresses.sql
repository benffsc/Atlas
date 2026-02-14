\echo '=== MIG_877: Backfill ShelterLuv People Addresses ==='
\echo 'Problem: process_shelterluv_person() had wrong field name (Street Address vs Street Address 1).'
\echo 'MIG_874b fixed the function but 9,123 already-processed people were never re-run.'
\echo '4,960 have addresses in their payload but no person_place_relationships.'
\echo ''

-- ============================================================================
-- 1. PRE-DIAGNOSTIC
-- ============================================================================

\echo '--- Step 1: Pre-backfill diagnostic ---'

SELECT 'sl_people_with_addresses' AS metric,
  COUNT(*) AS count
FROM trapper.staged_records sr
WHERE sr.source_system = 'shelterluv' AND sr.source_table = 'people'
  AND sr.is_processed = TRUE
  AND sr.resulting_entity_id IS NOT NULL
  AND sr.payload->>'Street Address 1' IS NOT NULL
  AND TRIM(sr.payload->>'Street Address 1') != ''
UNION ALL
SELECT 'sl_people_with_place_links',
  (SELECT COUNT(DISTINCT ppr.person_id)
   FROM trapper.person_place_relationships ppr
   WHERE ppr.source_system = 'shelterluv' AND ppr.source_table = 'people')
UNION ALL
SELECT 'sl_people_needing_backfill',
  (SELECT COUNT(*)
   FROM trapper.staged_records sr
   WHERE sr.source_system = 'shelterluv' AND sr.source_table = 'people'
     AND sr.is_processed = TRUE
     AND sr.resulting_entity_id IS NOT NULL
     AND sr.payload->>'Street Address 1' IS NOT NULL
     AND TRIM(sr.payload->>'Street Address 1') != ''
     AND NOT EXISTS (
       SELECT 1 FROM trapper.person_place_relationships ppr
       WHERE ppr.person_id = sr.resulting_entity_id
         AND ppr.source_system = 'shelterluv'
     ));

-- ============================================================================
-- 2. BACKFILL ADDRESSES
-- ============================================================================

\echo ''
\echo '--- Step 2: Backfilling addresses ---'

DO $$
DECLARE
  v_rec RECORD;
  v_addr TEXT;
  v_city TEXT;
  v_state TEXT;
  v_zip TEXT;
  v_full_addr TEXT;
  v_place_id UUID;
  v_places_created INT := 0;
  v_links_created INT := 0;
  v_skipped INT := 0;
  v_errors INT := 0;
BEGIN
  FOR v_rec IN
    SELECT sr.id, sr.resulting_entity_id AS person_id, sr.payload
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'shelterluv' AND sr.source_table = 'people'
      AND sr.is_processed = TRUE
      AND sr.resulting_entity_id IS NOT NULL
      AND sr.payload->>'Street Address 1' IS NOT NULL
      AND TRIM(sr.payload->>'Street Address 1') != ''
      -- Skip if already has a SL person_place_relationship
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_place_relationships ppr
        WHERE ppr.person_id = sr.resulting_entity_id
          AND ppr.source_system = 'shelterluv'
      )
    ORDER BY sr.id
  LOOP
    BEGIN
      v_addr := TRIM(v_rec.payload->>'Street Address 1');
      v_city := TRIM(COALESCE(v_rec.payload->>'City', ''));
      v_state := TRIM(COALESCE(v_rec.payload->>'State', ''));
      v_zip := TRIM(COALESCE(v_rec.payload->>'Zip', ''));

      -- Skip obviously bad addresses
      IF v_addr = '' OR v_addr IS NULL THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Build full address
      v_full_addr := v_addr;
      IF v_city != '' THEN v_full_addr := v_full_addr || ', ' || v_city; END IF;
      IF v_state != '' THEN v_full_addr := v_full_addr || ', ' || v_state; END IF;
      IF v_zip != '' THEN v_full_addr := v_full_addr || ' ' || v_zip; END IF;

      -- Create or find place (returns UUID directly)
      SELECT trapper.find_or_create_place_deduped(
        v_full_addr, NULL, NULL, NULL, 'shelterluv'
      ) INTO v_place_id;

      IF v_place_id IS NOT NULL THEN
        -- Link person to place
        INSERT INTO trapper.person_place_relationships (
          person_id, place_id, role, source_system, source_table,
          staged_record_id, confidence, created_by
        ) VALUES (
          v_rec.person_id, v_place_id,
          'resident'::trapper.person_place_role,
          'shelterluv', 'people',
          v_rec.id, 0.75,
          'MIG_877_backfill'
        )
        ON CONFLICT (person_id, place_id, role) DO NOTHING;

        IF FOUND THEN
          v_links_created := v_links_created + 1;
        ELSE
          v_skipped := v_skipped + 1;
        END IF;
        v_places_created := v_places_created + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      IF v_errors <= 5 THEN
        RAISE NOTICE 'Error for staged_record %: %', v_rec.id, SQLERRM;
      END IF;
    END;

    -- Progress logging every 500
    IF (v_places_created + v_skipped + v_errors) % 500 = 0 THEN
      RAISE NOTICE 'Progress: % places, % links, % skipped, % errors',
        v_places_created, v_links_created, v_skipped, v_errors;
    END IF;
  END LOOP;

  RAISE NOTICE 'Backfill complete: % places processed, % links created, % skipped, % errors',
    v_places_created, v_links_created, v_skipped, v_errors;
END $$;

-- ============================================================================
-- 3. VERIFICATION
-- ============================================================================

\echo ''
\echo '--- Step 3: Post-backfill verification ---'

SELECT 'sl_people_with_place_links' AS metric,
  COUNT(DISTINCT ppr.person_id) AS count
FROM trapper.person_place_relationships ppr
WHERE ppr.source_system = 'shelterluv' AND ppr.source_table = 'people'
UNION ALL
SELECT 'sl_people_still_needing_addresses',
  (SELECT COUNT(*)
   FROM trapper.staged_records sr
   WHERE sr.source_system = 'shelterluv' AND sr.source_table = 'people'
     AND sr.is_processed = TRUE
     AND sr.resulting_entity_id IS NOT NULL
     AND sr.payload->>'Street Address 1' IS NOT NULL
     AND TRIM(sr.payload->>'Street Address 1') != ''
     AND NOT EXISTS (
       SELECT 1 FROM trapper.person_place_relationships ppr
       WHERE ppr.person_id = sr.resulting_entity_id
         AND ppr.source_system = 'shelterluv'
     ));

\echo ''
\echo '=== MIG_877 Complete ==='
\echo 'Backfilled ShelterLuv people addresses into person_place_relationships.'
\echo 'These place links enable MIG_878 to tag places with context types.'
