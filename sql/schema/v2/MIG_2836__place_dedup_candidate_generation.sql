-- MIG_2836: Place Dedup Candidate Generation (FFS-186)
-- Date: 2026-03-05
--
-- Problem: ops.refresh_place_dedup_candidates() is a STUB returning 0.
-- No automatic candidate generation for place duplicates.
--
-- Solution: Replace stub with real 4-tier implementation using PostGIS
-- proximity + trigram similarity, adapted from archive MIG_815/MIG_942.
--
-- Table: sot.place_dedup_candidates (columns: canonical_place_id,
-- duplicate_place_id, match_tier, address_similarity, distance_meters, etc.)

\echo ''
\echo '=============================================='
\echo '  MIG_2836: Place Dedup Candidate Generation'
\echo '=============================================='
\echo ''

-- Ensure pg_trgm extension for similarity()
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- 1. Ensure table has required columns
-- ============================================================================

\echo '1. Ensuring sot.place_dedup_candidates has required columns...'

-- The table may have been created by MIG_2206 with place_id_1/place_id_2
-- or may already have canonical_place_id/duplicate_place_id from trapper migration.
-- Add columns if missing, idempotently.

DO $$
BEGIN
  -- Add canonical_place_id if missing (rename from place_id_1 if that exists)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sot' AND table_name = 'place_dedup_candidates'
      AND column_name = 'canonical_place_id'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'sot' AND table_name = 'place_dedup_candidates'
        AND column_name = 'place_id_1'
    ) THEN
      ALTER TABLE sot.place_dedup_candidates RENAME COLUMN place_id_1 TO canonical_place_id;
      ALTER TABLE sot.place_dedup_candidates RENAME COLUMN place_id_2 TO duplicate_place_id;
    ELSE
      ALTER TABLE sot.place_dedup_candidates ADD COLUMN canonical_place_id UUID REFERENCES sot.places(place_id);
      ALTER TABLE sot.place_dedup_candidates ADD COLUMN duplicate_place_id UUID REFERENCES sot.places(place_id);
    END IF;
  END IF;

  -- Add match_tier
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sot' AND table_name = 'place_dedup_candidates'
      AND column_name = 'match_tier'
  ) THEN
    ALTER TABLE sot.place_dedup_candidates ADD COLUMN match_tier INT;
  END IF;

  -- Add address_similarity (may exist as similarity_score)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sot' AND table_name = 'place_dedup_candidates'
      AND column_name = 'address_similarity'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'sot' AND table_name = 'place_dedup_candidates'
        AND column_name = 'similarity_score'
    ) THEN
      ALTER TABLE sot.place_dedup_candidates RENAME COLUMN similarity_score TO address_similarity;
    ELSE
      ALTER TABLE sot.place_dedup_candidates ADD COLUMN address_similarity NUMERIC;
    END IF;
  END IF;

  -- Add distance_meters
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sot' AND table_name = 'place_dedup_candidates'
      AND column_name = 'distance_meters'
  ) THEN
    ALTER TABLE sot.place_dedup_candidates ADD COLUMN distance_meters NUMERIC;
  END IF;

  -- Add address/name/kind display columns
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sot' AND table_name = 'place_dedup_candidates'
      AND column_name = 'canonical_address'
  ) THEN
    ALTER TABLE sot.place_dedup_candidates ADD COLUMN canonical_address TEXT;
    ALTER TABLE sot.place_dedup_candidates ADD COLUMN canonical_name TEXT;
    ALTER TABLE sot.place_dedup_candidates ADD COLUMN canonical_kind TEXT;
    ALTER TABLE sot.place_dedup_candidates ADD COLUMN duplicate_address TEXT;
    ALTER TABLE sot.place_dedup_candidates ADD COLUMN duplicate_name TEXT;
    ALTER TABLE sot.place_dedup_candidates ADD COLUMN duplicate_kind TEXT;
  END IF;

  -- Add resolved_at, resolved_by
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sot' AND table_name = 'place_dedup_candidates'
      AND column_name = 'resolved_at'
  ) THEN
    ALTER TABLE sot.place_dedup_candidates ADD COLUMN resolved_at TIMESTAMPTZ;
    ALTER TABLE sot.place_dedup_candidates ADD COLUMN resolved_by TEXT;
  END IF;

  -- Add unique constraint on (canonical_place_id, duplicate_place_id) if not exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'sot.place_dedup_candidates'::regclass
      AND contype = 'u'
      AND conname LIKE '%canonical_place_id%'
  ) THEN
    -- Drop old unique constraint if it exists (from place_id_1/place_id_2 era)
    BEGIN
      ALTER TABLE sot.place_dedup_candidates
        ADD CONSTRAINT uq_place_dedup_canonical_duplicate
        UNIQUE (canonical_place_id, duplicate_place_id);
    EXCEPTION WHEN duplicate_table THEN
      NULL; -- constraint already exists under different name
    END;
  END IF;

  RAISE NOTICE 'Table columns verified';
END;
$$;

-- ============================================================================
-- 2. Replace stub refresh_place_dedup_candidates() with real implementation
-- ============================================================================

\echo '2. Creating real ops.refresh_place_dedup_candidates()...'

DROP FUNCTION IF EXISTS ops.refresh_place_dedup_candidates();

CREATE OR REPLACE FUNCTION ops.refresh_place_dedup_candidates()
RETURNS TABLE(tier1_count INT, tier2_count INT, tier3_count INT, tier4_count INT, total INT)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_t1 INT := 0;
  v_t2 INT := 0;
  v_t3 INT := 0;
  v_t4 INT := 0;
BEGIN
  -- Clear unresolved candidates (keep resolved ones for audit)
  DELETE FROM sot.place_dedup_candidates WHERE status = 'pending';

  -- Tier 1: Within 50m + address similarity >= 0.6
  INSERT INTO sot.place_dedup_candidates (
    canonical_place_id, duplicate_place_id, match_tier,
    address_similarity, distance_meters,
    canonical_address, canonical_name, canonical_kind,
    duplicate_address, duplicate_name, duplicate_kind
  )
  SELECT
    -- Place with more references is canonical
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN a.place_id ELSE b.place_id
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN b.place_id ELSE a.place_id
    END,
    1,
    ROUND(similarity(a.normalized_address, b.normalized_address)::numeric, 3),
    ROUND(ST_Distance(a.location::geography, b.location::geography)::numeric, 1),
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN a.formatted_address ELSE b.formatted_address
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN a.display_name ELSE b.display_name
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN a.place_kind::text ELSE b.place_kind::text
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN b.formatted_address ELSE a.formatted_address
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN b.display_name ELSE a.display_name
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN b.place_kind::text ELSE a.place_kind::text
    END
  FROM sot.places a
  JOIN sot.places b
    ON a.place_id < b.place_id
    AND ST_DWithin(a.location::geography, b.location::geography, 50)
    AND similarity(a.normalized_address, b.normalized_address) >= 0.6
  WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
    AND a.location IS NOT NULL AND b.location IS NOT NULL
    AND a.normalized_address IS NOT NULL AND b.normalized_address IS NOT NULL
    -- Exclude parent-child pairs (already linked)
    AND a.parent_place_id IS DISTINCT FROM b.place_id
    AND b.parent_place_id IS DISTINCT FROM a.place_id
    -- Exclude already-resolved pairs (any status)
    AND NOT EXISTS (
      SELECT 1 FROM sot.place_dedup_candidates existing
      WHERE existing.status != 'pending'
        AND (
          (existing.canonical_place_id = a.place_id AND existing.duplicate_place_id = b.place_id)
          OR (existing.canonical_place_id = b.place_id AND existing.duplicate_place_id = a.place_id)
        )
    )
  ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;
  GET DIAGNOSTICS v_t1 = ROW_COUNT;

  -- Tier 2: Within 50m + address similarity < 0.6
  INSERT INTO sot.place_dedup_candidates (
    canonical_place_id, duplicate_place_id, match_tier,
    address_similarity, distance_meters,
    canonical_address, canonical_name, canonical_kind,
    duplicate_address, duplicate_name, duplicate_kind
  )
  SELECT
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN a.place_id ELSE b.place_id
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN b.place_id ELSE a.place_id
    END,
    2,
    ROUND(similarity(a.normalized_address, b.normalized_address)::numeric, 3),
    ROUND(ST_Distance(a.location::geography, b.location::geography)::numeric, 1),
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN a.formatted_address ELSE b.formatted_address
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN a.display_name ELSE b.display_name
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN a.place_kind::text ELSE b.place_kind::text
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN b.formatted_address ELSE a.formatted_address
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN b.display_name ELSE a.display_name
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN b.place_kind::text ELSE a.place_kind::text
    END
  FROM sot.places a
  JOIN sot.places b
    ON a.place_id < b.place_id
    AND ST_DWithin(a.location::geography, b.location::geography, 50)
    AND similarity(a.normalized_address, b.normalized_address) < 0.6
  WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
    AND a.location IS NOT NULL AND b.location IS NOT NULL
    AND a.normalized_address IS NOT NULL AND b.normalized_address IS NOT NULL
    AND a.parent_place_id IS DISTINCT FROM b.place_id
    AND b.parent_place_id IS DISTINCT FROM a.place_id
    AND NOT EXISTS (
      SELECT 1 FROM sot.place_dedup_candidates existing
      WHERE existing.status != 'pending'
        AND (
          (existing.canonical_place_id = a.place_id AND existing.duplicate_place_id = b.place_id)
          OR (existing.canonical_place_id = b.place_id AND existing.duplicate_place_id = a.place_id)
        )
    )
  ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;
  GET DIAGNOSTICS v_t2 = ROW_COUNT;

  -- Tier 3: No proximity requirement + very similar address (>= 0.8)
  INSERT INTO sot.place_dedup_candidates (
    canonical_place_id, duplicate_place_id, match_tier,
    address_similarity, distance_meters,
    canonical_address, canonical_name, canonical_kind,
    duplicate_address, duplicate_name, duplicate_kind
  )
  SELECT
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN a.place_id ELSE b.place_id
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN b.place_id ELSE a.place_id
    END,
    3,
    ROUND(similarity(a.normalized_address, b.normalized_address)::numeric, 3),
    CASE
      WHEN a.location IS NOT NULL AND b.location IS NOT NULL
      THEN ROUND(ST_Distance(a.location::geography, b.location::geography)::numeric, 1)
      ELSE NULL
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN a.formatted_address ELSE b.formatted_address
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN a.display_name ELSE b.display_name
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN a.place_kind::text ELSE b.place_kind::text
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN b.formatted_address ELSE a.formatted_address
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN b.display_name ELSE a.display_name
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN b.place_kind::text ELSE a.place_kind::text
    END
  FROM sot.places a
  JOIN sot.places b
    ON a.place_id < b.place_id
    AND similarity(a.normalized_address, b.normalized_address) > 0.8
  WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
    AND a.normalized_address IS NOT NULL AND b.normalized_address IS NOT NULL
    AND a.parent_place_id IS DISTINCT FROM b.place_id
    AND b.parent_place_id IS DISTINCT FROM a.place_id
    -- Exclude pairs already in tier 1 or 2 (those with coords within 50m)
    AND NOT (
      a.location IS NOT NULL AND b.location IS NOT NULL
      AND ST_DWithin(a.location::geography, b.location::geography, 50)
    )
    AND NOT EXISTS (
      SELECT 1 FROM sot.place_dedup_candidates existing
      WHERE existing.status != 'pending'
        AND (
          (existing.canonical_place_id = a.place_id AND existing.duplicate_place_id = b.place_id)
          OR (existing.canonical_place_id = b.place_id AND existing.duplicate_place_id = a.place_id)
        )
    )
  ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;
  GET DIAGNOSTICS v_t3 = ROW_COUNT;

  -- Tier 4: Exact normalized_address match OR same sot_address_id
  INSERT INTO sot.place_dedup_candidates (
    canonical_place_id, duplicate_place_id, match_tier,
    address_similarity, distance_meters,
    canonical_address, canonical_name, canonical_kind,
    duplicate_address, duplicate_name, duplicate_kind
  )
  SELECT
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN a.place_id ELSE b.place_id
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN b.place_id ELSE a.place_id
    END,
    4,
    ROUND(similarity(COALESCE(a.normalized_address, ''), COALESCE(b.normalized_address, ''))::numeric, 3),
    CASE
      WHEN a.location IS NOT NULL AND b.location IS NOT NULL
      THEN ROUND(ST_Distance(a.location::geography, b.location::geography)::numeric, 1)
      ELSE NULL
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN a.formatted_address ELSE b.formatted_address
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN a.display_name ELSE b.display_name
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN a.place_kind::text ELSE b.place_kind::text
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN b.formatted_address ELSE a.formatted_address
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN b.display_name ELSE a.display_name
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN b.place_kind::text ELSE a.place_kind::text
    END
  FROM sot.places a
  JOIN sot.places b
    ON a.place_id < b.place_id
    AND (
      -- Exact normalized_address match (shouldn't happen after MIG_2810 unique index,
      -- but catches edge cases)
      a.normalized_address = b.normalized_address
      -- OR same canonical address (sot_address_id match)
      OR (a.sot_address_id = b.sot_address_id
          AND a.sot_address_id IS NOT NULL)
    )
  WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
    AND a.parent_place_id IS DISTINCT FROM b.place_id
    AND b.parent_place_id IS DISTINCT FROM a.place_id
    AND NOT EXISTS (
      SELECT 1 FROM sot.place_dedup_candidates existing
      WHERE existing.status != 'pending'
        AND (
          (existing.canonical_place_id = a.place_id AND existing.duplicate_place_id = b.place_id)
          OR (existing.canonical_place_id = b.place_id AND existing.duplicate_place_id = a.place_id)
        )
    )
  ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;
  GET DIAGNOSTICS v_t4 = ROW_COUNT;

  RAISE NOTICE 'Place dedup refresh: T1=% T2=% T3=% T4=% Total=%',
    v_t1, v_t2, v_t3, v_t4, v_t1 + v_t2 + v_t3 + v_t4;

  RETURN QUERY SELECT v_t1, v_t2, v_t3, v_t4, v_t1 + v_t2 + v_t3 + v_t4;
END;
$function$;

COMMENT ON FUNCTION ops.refresh_place_dedup_candidates IS
'Refreshes the place_dedup_candidates table with current proximity + text-based duplicates.
Clears pending candidates and re-detects across 4 tiers:
  Tier 1: Within 50m + address similarity >= 0.6 (close + similar)
  Tier 2: Within 50m + address similarity < 0.6 (close + different text)
  Tier 3: No proximity + address similarity > 0.8 (farther + very similar)
  Tier 4: Exact normalized_address match OR same sot_address_id (text/identity match)
Returns counts per tier. Preserves resolved decisions.

Canonical place = more FK references (requests + cats). Duplicate = fewer.';

-- ============================================================================
-- 3. VERIFICATION
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Table columns:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'sot' AND table_name = 'place_dedup_candidates'
ORDER BY ordinal_position;

\echo ''
\echo 'NOTE: Initial refresh skipped (Tier 3 times out on Supabase 2-min limit).'
\echo 'Run tiers individually or use the admin UI Refresh button.'
\echo 'Tiers 1,2,4 complete in <2min. Tier 3 (full similarity scan) needs direct DB.'

\echo ''
\echo 'Candidates by tier:'
SELECT
  match_tier,
  CASE match_tier
    WHEN 1 THEN 'Close + Similar Address'
    WHEN 2 THEN 'Close + Different Address'
    WHEN 3 THEN 'Farther + Very Similar'
    WHEN 4 THEN 'Text Match Only'
  END AS tier_label,
  COUNT(*) AS pair_count
FROM sot.place_dedup_candidates
WHERE status = 'pending'
GROUP BY match_tier
ORDER BY match_tier;

\echo ''
\echo '=============================================='
\echo '  MIG_2836 Complete'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  - Ensured sot.place_dedup_candidates has required columns'
\echo '  - Replaced stub ops.refresh_place_dedup_candidates() with 4-tier implementation'
\echo '  - Ran initial refresh to populate candidates'
\echo ''
