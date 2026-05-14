-- MIG_3140: CDS v3.1 Sprint 4 — Cross-System Bridges
--
-- FFS-1474: Unchipped clinic → ShelterLuv bridge
--   Scores unchipped clinic cats against ShelterLuv cats by date+sex+weight+color.
--   Auto-merge ≥ 0.60, staff review 0.40-0.60.
--
-- FFS-1475: Chip-in-name duplicate detection (depends on FFS-1471)
--   After chip extraction from Animal Name, check if chip exists on another cat.
--   Auto-merge via sot.merge_cat_into() with safety gates.
--
-- Created: 2026-05-14

\echo ''
\echo '=============================================='
\echo '  MIG_3140: Cross-System Bridges'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. ops.bridge_unchipped_cats_to_shelterluv() — FFS-1474
-- ============================================================================

\echo '1. Creating ops.bridge_unchipped_cats_to_shelterluv()...'

CREATE OR REPLACE FUNCTION ops.bridge_unchipped_cats_to_shelterluv()
RETURNS JSONB AS $$
DECLARE
  v_results JSONB := '{}'::JSONB;
  v_auto_merged INT := 0;
  v_review_queued INT := 0;
  v_skipped INT := 0;
  r RECORD;
  v_score NUMERIC;
  v_safe TEXT;
BEGIN
  -- Find unchipped clinic cats that might match ShelterLuv cats
  -- Criteria: same appointment date (within 7 days), same sex, similar weight/color
  FOR r IN
    SELECT
      c_clinic.cat_id AS clinic_cat_id,
      c_clinic.name AS clinic_name,
      c_clinic.sex AS clinic_sex,
      c_clinic.primary_color AS clinic_color,
      a.appointment_date AS clinic_date,
      a.cat_weight_lbs AS clinic_weight,
      c_sl.cat_id AS sl_cat_id,
      c_sl.name AS sl_name,
      c_sl.sex AS sl_sex,
      c_sl.primary_color AS sl_color,
      c_sl.weight_lbs AS sl_weight,
      -- Score components
      CASE WHEN LOWER(COALESCE(c_clinic.sex, '')) = LOWER(COALESCE(c_sl.sex, ''))
           AND c_clinic.sex IS NOT NULL AND c_sl.sex IS NOT NULL
           THEN 0.25 ELSE 0 END AS sex_score,
      CASE WHEN c_clinic.primary_color IS NOT NULL AND c_sl.primary_color IS NOT NULL
           AND LOWER(c_clinic.primary_color) = LOWER(c_sl.primary_color)
           THEN 0.15 ELSE 0 END AS color_score,
      CASE WHEN a.cat_weight_lbs IS NOT NULL AND c_sl.weight_lbs IS NOT NULL
           AND ABS(a.cat_weight_lbs - c_sl.weight_lbs) < 1.0
           THEN 0.20
           WHEN a.cat_weight_lbs IS NOT NULL AND c_sl.weight_lbs IS NOT NULL
           AND ABS(a.cat_weight_lbs - c_sl.weight_lbs) < 2.0
           THEN 0.10
           ELSE 0 END AS weight_score,
      -- Date proximity score using ShelterLuv event timestamps
      CASE WHEN sl_event.event_date = a.appointment_date THEN 0.25
           WHEN sl_event.event_date IS NOT NULL
                AND ABS(sl_event.event_date - a.appointment_date) <= 3 THEN 0.15
           WHEN sl_event.event_date IS NOT NULL
                AND ABS(sl_event.event_date - a.appointment_date) <= 7 THEN 0.05
           ELSE 0 END AS date_score
    FROM sot.cats c_clinic
    JOIN ops.appointments a ON a.cat_id = c_clinic.cat_id
      AND a.merged_into_appointment_id IS NULL
    -- ShelterLuv cats: unchipped, same sex
    CROSS JOIN LATERAL (
      SELECT c2.cat_id, c2.name, c2.sex, c2.primary_color, c2.weight_lbs,
             c2.source_record_id AS sl_animal_id
      FROM sot.cats c2
      WHERE c2.source_system = 'shelterluv'
        AND c2.merged_into_cat_id IS NULL
        AND c2.microchip IS NULL
        AND (c_clinic.sex IS NULL OR c2.sex IS NULL
             OR LOWER(c_clinic.sex) = LOWER(c2.sex))
        AND c2.cat_id != c_clinic.cat_id
    ) c_sl
    -- Find ShelterLuv events near the clinic date
    LEFT JOIN LATERAL (
      SELECT (TO_TIMESTAMP((sr.payload->>'Time')::bigint))::date AS event_date
      FROM source.shelterluv_raw sr
      WHERE sr.record_type = 'event'
        AND sr.payload->'AssociatedRecords' @> jsonb_build_array(jsonb_build_object('Type', 'Animal', 'Id', c_sl.sl_animal_id))
      ORDER BY ABS((TO_TIMESTAMP((sr.payload->>'Time')::bigint))::date - a.appointment_date)
      LIMIT 1
    ) sl_event ON true
    WHERE c_clinic.microchip IS NULL
      AND c_clinic.merged_into_cat_id IS NULL
      AND c_clinic.source_system = 'clinichq'
      -- Don't re-bridge cats that already have shelterluv identifiers
      AND NOT EXISTS (
        SELECT 1 FROM sot.cat_identifiers ci
        WHERE ci.cat_id = c_clinic.cat_id
          AND ci.id_type = 'shelterluv_animal_id'
      )
    LIMIT 200  -- Process in batches
  LOOP
    v_score := r.sex_score + r.color_score + r.weight_score + r.date_score;

    IF v_score >= 0.60 THEN
      -- Auto-merge: high confidence
      v_safe := sot.cat_safe_to_merge(r.sl_cat_id, r.clinic_cat_id);
      IF v_safe = 'safe' THEN
        PERFORM sot.merge_cat_into(
          r.sl_cat_id, r.clinic_cat_id,
          'unchipped_shelterluv_bridge (score=' || v_score::text || ')',
          NULL  -- system merge
        );
        v_auto_merged := v_auto_merged + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    ELSIF v_score >= 0.40 THEN
      -- Staff review: medium confidence — log for review
      INSERT INTO ops.ingest_skipped (
        source_system, source_table, source_record_id, source_date,
        skip_reason, notes, payload
      ) VALUES (
        'shelterluv', 'bridge_candidate', r.sl_cat_id::text, NOW()::date,
        'bridge_review',
        'Unchipped clinic cat ' || r.clinic_cat_id || ' may match ShelterLuv cat '
          || r.sl_cat_id || ' (score=' || v_score::text || ')',
        jsonb_build_object(
          'clinic_cat_id', r.clinic_cat_id,
          'sl_cat_id', r.sl_cat_id,
          'score', v_score,
          'clinic_name', r.clinic_name,
          'sl_name', r.sl_name
        )
      ) ON CONFLICT DO NOTHING;
      v_review_queued := v_review_queued + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  v_results := jsonb_build_object(
    'auto_merged', v_auto_merged,
    'review_queued', v_review_queued,
    'skipped', v_skipped
  );

  RETURN v_results;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.bridge_unchipped_cats_to_shelterluv IS
'FFS-1474: Bridges unchipped clinic cats to ShelterLuv records.
Scores by date proximity + sex + weight + color.
Auto-merges >= 0.60, queues 0.40-0.60 for staff review.
Run after ShelterLuv sync cron.';

-- ============================================================================
-- 2. ops.detect_chip_in_name_duplicates() — FFS-1475
-- ============================================================================

\echo '2. Creating ops.detect_chip_in_name_duplicates()...'

CREATE OR REPLACE FUNCTION ops.detect_chip_in_name_duplicates()
RETURNS JSONB AS $$
DECLARE
  v_results JSONB := '{}'::JSONB;
  v_merged INT := 0;
  v_skipped INT := 0;
  r RECORD;
  v_safe TEXT;
  v_existing_cat_id UUID;
BEGIN
  -- Find cats whose name still contains a 15-digit chip that belongs to another cat
  -- This catches cases where find_or_create_cat_by_clinichq_id created a cat
  -- BEFORE MIG_3138 added chip extraction routing
  FOR r IN
    SELECT
      c.cat_id,
      c.name,
      (regexp_match(c.name, '([0-9]{15})'))[1] AS embedded_chip
    FROM sot.cats c
    WHERE c.merged_into_cat_id IS NULL
      AND c.microchip IS NULL
      AND c.name ~ '[0-9]{15}'
    LIMIT 100
  LOOP
    -- Check if this chip exists on another cat
    SELECT ci.cat_id INTO v_existing_cat_id
    FROM sot.cat_identifiers ci
    JOIN sot.cats c2 ON c2.cat_id = ci.cat_id AND c2.merged_into_cat_id IS NULL
    WHERE ci.id_type = 'microchip'
      AND ci.id_value = r.embedded_chip
      AND ci.cat_id != r.cat_id
    LIMIT 1;

    IF v_existing_cat_id IS NOT NULL THEN
      -- Found duplicate — merge the unchipped cat into the chipped one
      v_safe := sot.cat_safe_to_merge(r.cat_id, v_existing_cat_id);
      IF v_safe = 'safe' THEN
        PERFORM sot.merge_cat_into(
          r.cat_id, v_existing_cat_id,
          'chip_in_name_duplicate (chip=' || r.embedded_chip || ')',
          NULL
        );
        v_merged := v_merged + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    ELSE
      -- Chip not on another cat — set it on this cat instead
      BEGIN
        -- Validate the chip first
        IF (SELECT is_valid FROM sot.validate_microchip(r.embedded_chip)) THEN
          UPDATE sot.cats
          SET microchip = r.embedded_chip,
              name = COALESCE(sot.clean_cat_name(r.name), 'Unknown'),
              updated_at = NOW()
          WHERE cat_id = r.cat_id;

          INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at)
          VALUES (r.cat_id, 'microchip', r.embedded_chip, 'clinichq', NOW())
          ON CONFLICT (id_type, id_value) DO NOTHING;

          v_merged := v_merged + 1;  -- Count as fixed (not really a merge)
        ELSE
          v_skipped := v_skipped + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped + 1;
      END;
    END IF;
  END LOOP;

  v_results := jsonb_build_object(
    'chip_duplicates_merged', v_merged,
    'chip_duplicates_skipped', v_skipped
  );

  RETURN v_results;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.detect_chip_in_name_duplicates IS
'FFS-1475: Detects cats with embedded microchips in their name.
If chip already exists on another cat → merge (with safety gate).
If chip is new → set on cat and clean name.
Run after chip extraction (MIG_3138) or as maintenance.';

-- ============================================================================
-- 3. GRANT PERMISSIONS
-- ============================================================================

\echo '3. Granting permissions...'

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION ops.bridge_unchipped_cats_to_shelterluv() TO service_role;
    GRANT EXECUTE ON FUNCTION ops.detect_chip_in_name_duplicates() TO service_role;
  END IF;
END $$;

-- ============================================================================
-- 4. Run chip-in-name duplicate detection — FFS-1475
-- ============================================================================

\echo '4. Running chip-in-name duplicate detection...'

DO $$
DECLARE
  v_result JSONB;
BEGIN
  v_result := ops.detect_chip_in_name_duplicates();
  RAISE NOTICE 'Chip-in-name duplicates: %', v_result;
END $$;

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

\echo ''
\echo '5. Verification...'

DO $$
BEGIN
  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'ops' AND p.proname = 'bridge_unchipped_cats_to_shelterluv'
  )), 'Function ops.bridge_unchipped_cats_to_shelterluv() not found';

  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'ops' AND p.proname = 'detect_chip_in_name_duplicates'
  )), 'Function ops.detect_chip_in_name_duplicates() not found';

  RAISE NOTICE 'All functions verified';
END $$;

-- Show current state
SELECT 'Unchipped clinic cats' AS metric,
  COUNT(*) AS total
FROM sot.cats
WHERE microchip IS NULL
  AND merged_into_cat_id IS NULL
  AND source_system = 'clinichq';

SELECT 'Cats with chips in name' AS metric,
  COUNT(*) AS total
FROM sot.cats
WHERE merged_into_cat_id IS NULL
  AND microchip IS NULL
  AND name ~ '[0-9]{15}';

\echo ''
\echo '=============================================='
\echo '  MIG_3140 COMPLETE'
\echo '=============================================='
\echo ''
