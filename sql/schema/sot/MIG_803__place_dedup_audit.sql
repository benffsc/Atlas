\echo ''
\echo '=============================================='
\echo 'MIG_803: Place Duplicate Detection (Table + Function)'
\echo '=============================================='
\echo ''
\echo 'Detects fuzzy duplicate places using geographic proximity + address similarity.'
\echo 'Uses materialized table approach (not views) for performance on 11K+ places.'
\echo 'Tiers: 1=close+similar, 2=close+different, 3=farther+very similar'

-- ============================================================================
-- PART 1: Supporting indexes for spatial + trigram queries
-- ============================================================================

\echo '1. Creating supporting indexes...'

CREATE INDEX IF NOT EXISTS idx_places_normalized_address_trgm
  ON trapper.places USING gin (normalized_address gin_trgm_ops)
  WHERE merged_into_place_id IS NULL
    AND normalized_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_places_location_gist
  ON trapper.places USING gist (location)
  WHERE merged_into_place_id IS NULL
    AND location IS NOT NULL;

-- ============================================================================
-- PART 2: place_dedup_candidates table — stores detected pairs
-- ============================================================================

\echo '2. Creating place_dedup_candidates table...'

CREATE TABLE IF NOT EXISTS trapper.place_dedup_candidates (
  candidate_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_place_id UUID NOT NULL REFERENCES trapper.places(place_id),
  duplicate_place_id UUID NOT NULL REFERENCES trapper.places(place_id),
  match_tier         INT NOT NULL CHECK (match_tier BETWEEN 1 AND 3),
  address_similarity NUMERIC,
  distance_meters    NUMERIC,
  canonical_address  TEXT,
  canonical_name     TEXT,
  canonical_kind     TEXT,
  duplicate_address  TEXT,
  duplicate_name     TEXT,
  duplicate_kind     TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'merged', 'kept_separate', 'dismissed')),
  resolved_at        TIMESTAMPTZ,
  resolved_by        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (canonical_place_id, duplicate_place_id)
);

CREATE INDEX IF NOT EXISTS idx_place_dedup_status
  ON trapper.place_dedup_candidates (status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_place_dedup_tier
  ON trapper.place_dedup_candidates (match_tier)
  WHERE status = 'pending';

COMMENT ON TABLE trapper.place_dedup_candidates IS
'Materialized place duplicate candidates detected via PostGIS proximity + trigram similarity.
Uses table (not view) because spatial cross-join on 11K+ places is too slow for a view.
Refreshed on-demand via refresh_place_dedup_candidates().
  Tier 1: Within 30m + address similarity >= 0.6 (almost certainly same place)
  Tier 2: Within 30m + low similarity (same spot, different text — unit vs parent?)
  Tier 3: 30-100m + address similarity >= 0.7 (possible mis-geocode)
Status tracks resolution: pending, merged, kept_separate, dismissed.';

-- ============================================================================
-- PART 3: refresh_place_dedup_candidates() — populates the table
-- ============================================================================

\echo '3. Creating refresh_place_dedup_candidates function...'

CREATE OR REPLACE FUNCTION trapper.refresh_place_dedup_candidates()
RETURNS TABLE(tier1_count INT, tier2_count INT, tier3_count INT, total INT)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_t1 INT := 0;
  v_t2 INT := 0;
  v_t3 INT := 0;
BEGIN
  -- Clear unresolved candidates (keep resolved ones for audit)
  DELETE FROM trapper.place_dedup_candidates WHERE status = 'pending';

  -- Tier 1: Within 30m + similarity >= 0.6
  INSERT INTO trapper.place_dedup_candidates (
    canonical_place_id, duplicate_place_id, match_tier,
    address_similarity, distance_meters,
    canonical_address, canonical_name, canonical_kind,
    duplicate_address, duplicate_name, duplicate_kind
  )
  SELECT
    CASE WHEN a.created_at <= b.created_at THEN a.place_id ELSE b.place_id END,
    CASE WHEN a.created_at <= b.created_at THEN b.place_id ELSE a.place_id END,
    1,
    ROUND(similarity(a.normalized_address, b.normalized_address)::numeric, 3),
    ROUND(ST_Distance(a.location::geography, b.location::geography)::numeric, 1),
    CASE WHEN a.created_at <= b.created_at THEN a.formatted_address ELSE b.formatted_address END,
    CASE WHEN a.created_at <= b.created_at THEN a.display_name ELSE b.display_name END,
    CASE WHEN a.created_at <= b.created_at THEN a.place_kind::text ELSE b.place_kind::text END,
    CASE WHEN a.created_at <= b.created_at THEN b.formatted_address ELSE a.formatted_address END,
    CASE WHEN a.created_at <= b.created_at THEN b.display_name ELSE a.display_name END,
    CASE WHEN a.created_at <= b.created_at THEN b.place_kind::text ELSE a.place_kind::text END
  FROM trapper.places a
  JOIN trapper.places b
    ON a.place_id < b.place_id
    AND ST_DWithin(a.location::geography, b.location::geography, 30)
    AND similarity(a.normalized_address, b.normalized_address) >= 0.6
  WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
    AND a.location IS NOT NULL AND b.location IS NOT NULL
    AND a.normalized_address IS NOT NULL AND b.normalized_address IS NOT NULL
    AND a.parent_place_id IS NULL AND b.parent_place_id IS NULL
  ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;
  GET DIAGNOSTICS v_t1 = ROW_COUNT;

  -- Tier 2: Within 30m + similarity < 0.6
  INSERT INTO trapper.place_dedup_candidates (
    canonical_place_id, duplicate_place_id, match_tier,
    address_similarity, distance_meters,
    canonical_address, canonical_name, canonical_kind,
    duplicate_address, duplicate_name, duplicate_kind
  )
  SELECT
    CASE WHEN a.created_at <= b.created_at THEN a.place_id ELSE b.place_id END,
    CASE WHEN a.created_at <= b.created_at THEN b.place_id ELSE a.place_id END,
    2,
    ROUND(similarity(a.normalized_address, b.normalized_address)::numeric, 3),
    ROUND(ST_Distance(a.location::geography, b.location::geography)::numeric, 1),
    CASE WHEN a.created_at <= b.created_at THEN a.formatted_address ELSE b.formatted_address END,
    CASE WHEN a.created_at <= b.created_at THEN a.display_name ELSE b.display_name END,
    CASE WHEN a.created_at <= b.created_at THEN a.place_kind::text ELSE b.place_kind::text END,
    CASE WHEN a.created_at <= b.created_at THEN b.formatted_address ELSE a.formatted_address END,
    CASE WHEN a.created_at <= b.created_at THEN b.display_name ELSE a.display_name END,
    CASE WHEN a.created_at <= b.created_at THEN b.place_kind::text ELSE a.place_kind::text END
  FROM trapper.places a
  JOIN trapper.places b
    ON a.place_id < b.place_id
    AND ST_DWithin(a.location::geography, b.location::geography, 30)
    AND similarity(a.normalized_address, b.normalized_address) < 0.6
  WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
    AND a.location IS NOT NULL AND b.location IS NOT NULL
    AND a.normalized_address IS NOT NULL AND b.normalized_address IS NOT NULL
    AND a.parent_place_id IS NULL AND b.parent_place_id IS NULL
  ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;
  GET DIAGNOSTICS v_t2 = ROW_COUNT;

  -- Tier 3: 30-100m + similarity >= 0.7
  INSERT INTO trapper.place_dedup_candidates (
    canonical_place_id, duplicate_place_id, match_tier,
    address_similarity, distance_meters,
    canonical_address, canonical_name, canonical_kind,
    duplicate_address, duplicate_name, duplicate_kind
  )
  SELECT
    CASE WHEN a.created_at <= b.created_at THEN a.place_id ELSE b.place_id END,
    CASE WHEN a.created_at <= b.created_at THEN b.place_id ELSE a.place_id END,
    3,
    ROUND(similarity(a.normalized_address, b.normalized_address)::numeric, 3),
    ROUND(ST_Distance(a.location::geography, b.location::geography)::numeric, 1),
    CASE WHEN a.created_at <= b.created_at THEN a.formatted_address ELSE b.formatted_address END,
    CASE WHEN a.created_at <= b.created_at THEN a.display_name ELSE b.display_name END,
    CASE WHEN a.created_at <= b.created_at THEN a.place_kind::text ELSE b.place_kind::text END,
    CASE WHEN a.created_at <= b.created_at THEN b.formatted_address ELSE a.formatted_address END,
    CASE WHEN a.created_at <= b.created_at THEN b.display_name ELSE a.display_name END,
    CASE WHEN a.created_at <= b.created_at THEN b.place_kind::text ELSE a.place_kind::text END
  FROM trapper.places a
  JOIN trapper.places b
    ON a.place_id < b.place_id
    AND ST_DWithin(a.location::geography, b.location::geography, 100)
    AND NOT ST_DWithin(a.location::geography, b.location::geography, 30)
    AND similarity(a.normalized_address, b.normalized_address) >= 0.7
  WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
    AND a.location IS NOT NULL AND b.location IS NOT NULL
    AND a.normalized_address IS NOT NULL AND b.normalized_address IS NOT NULL
    AND a.parent_place_id IS NULL AND b.parent_place_id IS NULL
  ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;
  GET DIAGNOSTICS v_t3 = ROW_COUNT;

  RETURN QUERY SELECT v_t1, v_t2, v_t3, v_t1 + v_t2 + v_t3;
END;
$function$;

COMMENT ON FUNCTION trapper.refresh_place_dedup_candidates IS
'Refreshes the place_dedup_candidates table with current proximity-based duplicates.
Clears pending candidates and re-detects across 3 tiers using PostGIS + trigram.
Returns counts per tier. Safe to run repeatedly — preserves resolved decisions.';

-- ============================================================================
-- PART 4: place_safe_to_merge() — safety guard
-- ============================================================================

\echo '4. Creating place_safe_to_merge function...'

CREATE OR REPLACE FUNCTION trapper.place_safe_to_merge(
  p_place_a UUID,
  p_place_b UUID
) RETURNS TEXT AS $$
DECLARE
  v_a RECORD;
  v_b RECORD;
  v_sim NUMERIC;
BEGIN
  SELECT place_id, formatted_address, normalized_address, merged_into_place_id,
         parent_place_id, is_ffsc_facility
  INTO v_a FROM trapper.places WHERE place_id = p_place_a;
  IF NOT FOUND THEN RETURN 'place_a_not_found'; END IF;
  IF v_a.merged_into_place_id IS NOT NULL THEN RETURN 'place_a_already_merged'; END IF;

  SELECT place_id, formatted_address, normalized_address, merged_into_place_id,
         parent_place_id, is_ffsc_facility
  INTO v_b FROM trapper.places WHERE place_id = p_place_b;
  IF NOT FOUND THEN RETURN 'place_b_not_found'; END IF;
  IF v_b.merged_into_place_id IS NOT NULL THEN RETURN 'place_b_already_merged'; END IF;

  -- Don't merge FFSC facilities
  IF v_a.is_ffsc_facility OR v_b.is_ffsc_facility THEN
    RETURN 'is_ffsc_facility';
  END IF;

  -- Don't merge if one is a parent of the other
  IF v_a.parent_place_id = p_place_b OR v_b.parent_place_id = p_place_a THEN
    RETURN 'parent_child_relationship';
  END IF;

  -- Same normalized address = safe
  IF v_a.normalized_address = v_b.normalized_address THEN
    RETURN 'safe';
  END IF;

  -- High address similarity = safe
  v_sim := similarity(
    COALESCE(v_a.normalized_address, ''),
    COALESCE(v_b.normalized_address, '')
  );
  IF v_sim >= 0.8 THEN
    RETURN 'safe';
  END IF;

  RETURN 'review';
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.place_safe_to_merge IS
'Safety guard for place merges. Returns:
  - ''safe'' for same/very similar normalized address
  - ''review'' for lower similarity
  - Block reasons: already_merged, is_ffsc_facility, parent_child_relationship';

-- ============================================================================
-- PART 5: Add to Tippy catalog
-- ============================================================================

\echo '5. Adding table to Tippy catalog...'

INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
VALUES
  ('place_dedup_candidates', 'quality',
   'Materialized place duplicate candidates detected via PostGIS proximity + trigram similarity. Tier 1=close+similar, Tier 2=close+different, Tier 3=farther+very similar. Refreshed via refresh_place_dedup_candidates().',
   ARRAY['canonical_place_id', 'duplicate_place_id', 'match_tier', 'address_similarity', 'distance_meters', 'status'],
   ARRAY['match_tier', 'status'],
   ARRAY['Are there duplicate places?', 'Which places are near each other with similar addresses?', 'How many place duplicates by tier?'])
ON CONFLICT (view_name) DO UPDATE SET
  description = EXCLUDED.description,
  key_columns = EXCLUDED.key_columns,
  filter_columns = EXCLUDED.filter_columns,
  example_questions = EXCLUDED.example_questions,
  updated_at = NOW();

-- Clean up stale view-based entries if they exist
DELETE FROM trapper.tippy_view_catalog
WHERE view_name IN ('v_place_dedup_candidates', 'v_place_dedup_summary');

-- ============================================================================
-- PART 6: Initial population
-- ============================================================================

\echo '6. Populating candidates...'

SELECT * FROM trapper.refresh_place_dedup_candidates();

-- ============================================================================
-- PART 7: Verification
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Place dedup summary by tier:'
SELECT
  match_tier,
  CASE match_tier
    WHEN 1 THEN 'Close + Similar Address'
    WHEN 2 THEN 'Close + Different Address'
    WHEN 3 THEN 'Farther + Very Similar'
  END AS tier_label,
  COUNT(*) AS pair_count
FROM trapper.place_dedup_candidates
WHERE status = 'pending'
GROUP BY match_tier
ORDER BY match_tier;

\echo ''
\echo 'Sample candidates (first 10):'
SELECT
  match_tier,
  distance_meters || 'm' AS dist,
  address_similarity AS sim,
  canonical_address,
  duplicate_address
FROM trapper.place_dedup_candidates
WHERE status = 'pending'
ORDER BY match_tier, address_similarity DESC
LIMIT 10;

\echo ''
\echo '=============================================='
\echo 'MIG_803 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - place_dedup_candidates: Materialized duplicate pairs table'
\echo '  - refresh_place_dedup_candidates(): On-demand refresh function'
\echo '  - place_safe_to_merge(): Safety guard function'
\echo '  - Indexes for spatial + trigram queries'
