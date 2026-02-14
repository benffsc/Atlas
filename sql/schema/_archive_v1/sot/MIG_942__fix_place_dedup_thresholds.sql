\echo ''
\echo '=============================================='
\echo 'MIG_942: Fix Place Dedup Thresholds'
\echo '=============================================='
\echo ''
\echo 'Problem: Current thresholds produce 3,853 candidates, mostly false positives.'
\echo ''
\echo 'Root causes:'
\echo '  - Tier 2 (within 30m, LOW similarity) catches neighboring houses'
\echo '  - Tier 3 (30-100m) is too wide for Sonoma County geography'
\echo ''
\echo 'Fix:'
\echo '  - REMOVE Tier 2: Low similarity = different addresses, not duplicates'
\echo '  - TIGHTEN Tier 3: Reduce to 50m max, require similarity >= 0.85'
\echo ''

-- ============================================================================
-- PART 1: Update the refresh function with corrected thresholds
-- ============================================================================

\echo '1. Replacing refresh_place_dedup_candidates with corrected thresholds...'

CREATE OR REPLACE FUNCTION trapper.refresh_place_dedup_candidates()
RETURNS TABLE(tier1_count INT, tier2_count INT, tier3_count INT, total INT)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_t1 INT := 0;
  v_t2 INT := 0;  -- Will always be 0 now (Tier 2 removed)
  v_t3 INT := 0;
BEGIN
  -- Clear unresolved candidates (keep resolved ones for audit)
  DELETE FROM trapper.place_dedup_candidates WHERE status = 'pending';

  -- ══════════════════════════════════════════════════════════════════════════
  -- Tier 1: Within 30m + HIGH similarity (>= 0.6)
  -- These are likely the same place with minor formatting differences
  -- Examples: "123 Main St" vs "123 Main Street"
  -- ══════════════════════════════════════════════════════════════════════════
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
    -- Exclude if one is parent of the other
    AND a.place_id != COALESCE(b.parent_place_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND b.place_id != COALESCE(a.parent_place_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;
  GET DIAGNOSTICS v_t1 = ROW_COUNT;

  -- ══════════════════════════════════════════════════════════════════════════
  -- Tier 2: REMOVED
  --
  -- Previous: Within 30m + LOW similarity (< 0.6)
  -- Problem: This catches neighboring houses at different addresses
  -- Example: "1404 Quail Ct" vs "1409 Quail Ct" are NOT duplicates
  --
  -- Low similarity + close proximity = different buildings, not duplicates
  -- ══════════════════════════════════════════════════════════════════════════
  -- (No insert for Tier 2 - intentionally removed)
  v_t2 := 0;

  -- ══════════════════════════════════════════════════════════════════════════
  -- Tier 3: 30-50m + VERY HIGH similarity (>= 0.85)
  -- Only catch potential geocoding errors or duplicate entries
  -- Reduced from 100m to 50m, increased similarity from 0.7 to 0.85
  -- ══════════════════════════════════════════════════════════════════════════
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
    -- Changed: 30-50m instead of 30-100m
    AND ST_DWithin(a.location::geography, b.location::geography, 50)
    AND NOT ST_DWithin(a.location::geography, b.location::geography, 30)
    -- Changed: >= 0.85 instead of >= 0.7
    AND similarity(a.normalized_address, b.normalized_address) >= 0.85
  WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
    AND a.location IS NOT NULL AND b.location IS NOT NULL
    AND a.normalized_address IS NOT NULL AND b.normalized_address IS NOT NULL
    AND a.parent_place_id IS NULL AND b.parent_place_id IS NULL
    -- Exclude if one is parent of the other
    AND a.place_id != COALESCE(b.parent_place_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND b.place_id != COALESCE(a.parent_place_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;
  GET DIAGNOSTICS v_t3 = ROW_COUNT;

  RETURN QUERY SELECT v_t1, v_t2, v_t3, v_t1 + v_t2 + v_t3;
END;
$function$;

COMMENT ON FUNCTION trapper.refresh_place_dedup_candidates IS
'Refreshes the place_dedup_candidates table with proximity-based duplicates.
Clears pending candidates and re-detects across tiers using PostGIS + trigram.

Tier 1: Within 30m + similarity >= 0.6 (likely same place, formatting difference)
Tier 2: REMOVED (low similarity = different addresses, not duplicates)
Tier 3: 30-50m + similarity >= 0.85 (possible geocoding error)

Returns counts per tier. Safe to run repeatedly — preserves resolved decisions.
Updated by MIG_942 to reduce false positives.';

-- ============================================================================
-- PART 2: Re-run detection with new thresholds
-- ============================================================================

\echo ''
\echo '2. Re-running place dedup detection with corrected thresholds...'

SELECT * FROM trapper.refresh_place_dedup_candidates();

-- ============================================================================
-- PART 3: Verification
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'New place dedup summary by tier:'
SELECT
  match_tier,
  CASE match_tier
    WHEN 1 THEN 'Within 30m + High Similarity'
    WHEN 2 THEN 'REMOVED (was: low similarity neighbors)'
    WHEN 3 THEN 'Within 50m + Very High Similarity'
  END AS tier_label,
  COUNT(*) AS pair_count
FROM trapper.place_dedup_candidates
WHERE status = 'pending'
GROUP BY match_tier
ORDER BY match_tier;

\echo ''
\echo 'Sample Tier 1 candidates (first 5):'
SELECT
  distance_meters || 'm' AS dist,
  address_similarity AS sim,
  canonical_address,
  duplicate_address
FROM trapper.place_dedup_candidates
WHERE status = 'pending' AND match_tier = 1
ORDER BY address_similarity DESC
LIMIT 5;

\echo ''
\echo 'Sample Tier 3 candidates (first 5):'
SELECT
  distance_meters || 'm' AS dist,
  address_similarity AS sim,
  canonical_address,
  duplicate_address
FROM trapper.place_dedup_candidates
WHERE status = 'pending' AND match_tier = 3
ORDER BY address_similarity DESC
LIMIT 5;

\echo ''
\echo '=============================================='
\echo 'MIG_942 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  - Tier 2 REMOVED (low similarity = different addresses)'
\echo '  - Tier 3 tightened: 50m max (was 100m), similarity >= 0.85 (was 0.7)'
\echo '  - Added parent-place exclusion to prevent matching parent/child pairs'
\echo ''
\echo 'Expected reduction: 3,853 -> ~200-400 candidates'
\echo ''
