-- MIG_3089: Auto Hero Photo Selection
--
-- Part of FFS-1239 (Best Photo Selection: Auto-set is_hero after CDS-AI photo assignment)
--
-- Problem: Only 19 of ~500 cats with clinic photos have is_hero = true.
-- Hero photos are displayed as the cat's primary image in UI. Currently
-- set manually one at a time.
--
-- Solution: SQL function that auto-selects the best photo as hero for each
-- cat that has assigned photos but no current hero. Heuristic scoring based
-- on evidence segment role, file size, and confidence.
--
-- Depends on: MIG_805 (is_hero column), MIG_3070 (evidence_stream_segments)
--
-- Created: 2026-04-18

\echo ''
\echo '=============================================='
\echo '  MIG_3089: Auto Hero Photo Selection'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Auto-select hero photo function
-- ============================================================================

\echo '1. Creating ops.auto_set_hero_photos...'

CREATE OR REPLACE FUNCTION ops.auto_set_hero_photos(
  p_cat_id UUID DEFAULT NULL  -- NULL = all cats without heroes
) RETURNS TABLE(cat_id UUID, media_id UUID, score NUMERIC) AS $$
BEGIN
  RETURN QUERY
  WITH cats_needing_hero AS (
    -- Cats that have photos assigned but no hero set
    SELECT DISTINCT rm.cat_id
    FROM ops.request_media rm
    WHERE rm.cat_id IS NOT NULL
      AND NOT rm.is_archived
      AND (p_cat_id IS NULL OR rm.cat_id = p_cat_id)
      AND NOT EXISTS (
        SELECT 1 FROM ops.request_media h
        WHERE h.cat_id = rm.cat_id
          AND h.is_hero = TRUE
          AND NOT h.is_archived
      )
  ),
  scored_photos AS (
    -- Score each photo by heuristic criteria
    SELECT
      rm.cat_id,
      rm.media_id,
      (
        -- Prefer cat_photo role from evidence segments (0.40)
        CASE WHEN EXISTS (
          SELECT 1 FROM ops.evidence_stream_segments ess
          WHERE ess.source_ref_id = rm.media_id
            AND ess.segment_role = 'cat_photo'
        ) THEN 0.40 ELSE 0.10 END
        +
        -- Penalize waiver/barcode/discard photos heavily
        CASE WHEN EXISTS (
          SELECT 1 FROM ops.evidence_stream_segments ess
          WHERE ess.source_ref_id = rm.media_id
            AND ess.segment_role IN ('waiver_photo', 'microchip_barcode', 'discard')
        ) THEN -0.50 ELSE 0.00 END
        +
        -- Prefer confirmed/high confidence (0.25)
        CASE rm.cat_identification_confidence
          WHEN 'confirmed' THEN 0.25
          WHEN 'high'      THEN 0.20
          WHEN 'likely'    THEN 0.15
          WHEN 'uncertain' THEN 0.05
          ELSE 0.00
        END
        +
        -- Prefer larger files (better quality, up to 0.20)
        LEAST(COALESCE(rm.file_size_bytes, 0)::NUMERIC / 5000000.0, 0.20)
        +
        -- Prefer media_type = cat_photo (0.15)
        CASE WHEN rm.media_type::text = 'cat_photo' THEN 0.15 ELSE 0.00 END
      )::NUMERIC(5,3) AS score
    FROM ops.request_media rm
    JOIN cats_needing_hero cnh ON cnh.cat_id = rm.cat_id
    WHERE NOT rm.is_archived
  ),
  best_per_cat AS (
    SELECT DISTINCT ON (sp.cat_id)
      sp.cat_id, sp.media_id, sp.score
    FROM scored_photos sp
    WHERE sp.score > 0  -- Don't hero-ify obviously bad photos
    ORDER BY sp.cat_id, sp.score DESC, sp.media_id
  )
  -- Set is_hero and return what was set
  UPDATE ops.request_media rm
  SET is_hero = TRUE
  FROM best_per_cat bpc
  WHERE rm.media_id = bpc.media_id
  RETURNING rm.cat_id, rm.media_id, bpc.score;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.auto_set_hero_photos IS
  'Auto-select best photo as hero for cats without one. '
  'Scores by: cat_photo role (0.40), confidence (0.25), file size (0.20), media_type (0.15). '
  'Penalizes waiver/barcode/discard photos. Pass cat_id for single cat, NULL for all.';

-- ============================================================================
-- 2. Backfill: set heroes for existing cats with photos
-- ============================================================================

\echo ''
\echo '2. Backfilling hero photos for cats without one...'

DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM ops.auto_set_hero_photos(NULL);

  RAISE NOTICE '   Set hero for % cats', v_count;
END;
$$;

-- ============================================================================
-- 3. Verification
-- ============================================================================

\echo ''
\echo '3. Verification...'

DO $$
DECLARE
  v_cats_with_photos INT;
  v_cats_with_hero INT;
BEGIN
  SELECT COUNT(DISTINCT cat_id) INTO v_cats_with_photos
  FROM ops.request_media
  WHERE cat_id IS NOT NULL AND NOT is_archived;

  SELECT COUNT(DISTINCT cat_id) INTO v_cats_with_hero
  FROM ops.request_media
  WHERE cat_id IS NOT NULL AND NOT is_archived AND is_hero = TRUE;

  RAISE NOTICE '   Cats with photos: %', v_cats_with_photos;
  RAISE NOTICE '   Cats with hero:   % (%.1f%%)',
    v_cats_with_hero,
    CASE WHEN v_cats_with_photos > 0
      THEN v_cats_with_hero::NUMERIC / v_cats_with_photos * 100
      ELSE 0 END;
END;
$$;

COMMIT;

\echo ''
\echo '✓ MIG_3089 complete'
\echo ''
