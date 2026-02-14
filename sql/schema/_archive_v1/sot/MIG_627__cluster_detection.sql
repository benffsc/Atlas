-- MIG_627: Classification Cluster Detection
--
-- After AI backfill classifies places individually, we need to detect
-- geographic clusters of places that may form a single colony but have
-- inconsistent or different classifications.
--
-- This migration creates:
-- 1. View to find nearby place pairs with classification differences
-- 2. Function to identify clusters and score their consistency
-- 3. Table to track cluster review status
--
-- Key insight: Colonies often span multiple addresses (e.g., feeding station
-- attracts cats from 3-4 neighboring homes). This helps reconcile those.

\echo ''
\echo '========================================================'
\echo 'MIG_627: Classification Cluster Detection'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Create view for nearby place pairs
-- ============================================================

\echo 'Creating v_place_classification_pairs view...'

CREATE OR REPLACE VIEW trapper.v_place_classification_pairs AS
WITH classified_places AS (
  SELECT
    p.place_id,
    p.formatted_address,
    p.display_name,
    p.location,
    p.colony_classification,
    p.colony_id,
    -- Get suggestion stats
    COALESCE(rs.suggestion_count, 0) AS suggestion_count,
    rs.most_common_suggestion,
    rs.avg_confidence
  FROM trapper.places p
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS suggestion_count,
      MODE() WITHIN GROUP (ORDER BY suggested_classification) AS most_common_suggestion,
      AVG(classification_confidence) AS avg_confidence
    FROM trapper.sot_requests r
    WHERE r.place_id = p.place_id
      AND r.suggested_classification IS NOT NULL
  ) rs ON TRUE
  WHERE p.merged_into_place_id IS NULL
    AND p.location IS NOT NULL
    AND (p.colony_classification IS NOT NULL OR rs.suggestion_count > 0)
)
SELECT
  p1.place_id AS place1_id,
  p1.formatted_address AS place1_address,
  p1.colony_classification::TEXT AS place1_classification,
  p1.most_common_suggestion::TEXT AS place1_suggestion,
  p1.avg_confidence AS place1_confidence,
  p1.colony_id AS place1_colony_id,

  p2.place_id AS place2_id,
  p2.formatted_address AS place2_address,
  p2.colony_classification::TEXT AS place2_classification,
  p2.most_common_suggestion::TEXT AS place2_suggestion,
  p2.avg_confidence AS place2_confidence,
  p2.colony_id AS place2_colony_id,

  ST_Distance(p1.location::geography, p2.location::geography)::INT AS distance_meters,

  -- Flags for review
  CASE
    WHEN COALESCE(p1.colony_classification::TEXT, p1.most_common_suggestion::TEXT, 'unknown') !=
         COALESCE(p2.colony_classification::TEXT, p2.most_common_suggestion::TEXT, 'unknown')
    THEN TRUE
    ELSE FALSE
  END AS classifications_differ,

  CASE
    WHEN p1.colony_id IS NOT NULL AND p2.colony_id IS NOT NULL AND p1.colony_id = p2.colony_id
    THEN TRUE
    ELSE FALSE
  END AS same_colony,

  -- Both are colony types (might need merging)
  CASE
    WHEN COALESCE(p1.colony_classification::TEXT, p1.most_common_suggestion::TEXT) IN
         ('small_colony', 'large_colony', 'feeding_station')
    AND  COALESCE(p2.colony_classification::TEXT, p2.most_common_suggestion::TEXT) IN
         ('small_colony', 'large_colony', 'feeding_station')
    THEN TRUE
    ELSE FALSE
  END AS both_colony_types

FROM classified_places p1
JOIN classified_places p2 ON p1.place_id < p2.place_id  -- Avoid duplicates
WHERE ST_DWithin(p1.location::geography, p2.location::geography, 200);  -- Within 200m

COMMENT ON VIEW trapper.v_place_classification_pairs IS
'Shows pairs of nearby places (within 200m) with classification info.
Used to detect clusters that may need reconciliation.
Flags pairs with different classifications or both colony types.';

-- ============================================================
-- PART 2: Create cluster analysis table
-- ============================================================

\echo 'Creating classification_clusters table...'

CREATE TABLE IF NOT EXISTS trapper.classification_clusters (
  cluster_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cluster identity
  cluster_name TEXT,  -- Optional, can be auto-generated
  center_lat NUMERIC(10, 7),
  center_lng NUMERIC(10, 7),
  radius_meters INT DEFAULT 200,

  -- Places in cluster
  place_ids UUID[] NOT NULL,
  place_count INT GENERATED ALWAYS AS (array_length(place_ids, 1)) STORED,

  -- Classification analysis
  unique_classifications TEXT[],  -- Distinct classifications in cluster
  dominant_classification TEXT,   -- Most common classification
  consistency_score NUMERIC(3,2), -- 1.0 = all same, 0.0 = all different

  -- Review status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'merged', 'dismissed')),
  review_notes TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,

  -- Recommended action
  recommended_action TEXT
    CHECK (recommended_action IN ('merge_to_colony', 'reconcile_classification', 'leave_separate', 'needs_site_visit')),
  recommended_classification TEXT,
  recommended_colony_id UUID REFERENCES trapper.colonies(colony_id),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.classification_clusters IS
'Geographic clusters of nearby places that may need classification reconciliation.
Generated by the cluster detection script, reviewed by staff.';

CREATE INDEX IF NOT EXISTS idx_classification_clusters_status
ON trapper.classification_clusters(status);

CREATE INDEX IF NOT EXISTS idx_classification_clusters_places
ON trapper.classification_clusters USING GIN (place_ids);

-- ============================================================
-- PART 3: Create cluster detection function
-- ============================================================

\echo 'Creating detect_classification_clusters function...'

CREATE OR REPLACE FUNCTION trapper.detect_classification_clusters(
  p_radius_meters INT DEFAULT 200,
  p_min_places INT DEFAULT 2
)
RETURNS TABLE(
  cluster_id UUID,
  place_ids UUID[],
  classifications TEXT[],
  consistency_score NUMERIC
) AS $$
DECLARE
  v_processed UUID[] := ARRAY[]::UUID[];
  v_cluster RECORD;
  v_nearby RECORD;
  v_cluster_places UUID[];
  v_cluster_classifications TEXT[];
  v_classification_counts RECORD;
  v_total INT;
  v_max_count INT;
BEGIN
  -- Find clusters using a simple greedy algorithm
  FOR v_cluster IN
    SELECT DISTINCT p.place_id, p.location,
           COALESCE(p.colony_classification::TEXT, 'unknown') AS classification
    FROM trapper.places p
    WHERE p.merged_into_place_id IS NULL
      AND p.location IS NOT NULL
      AND p.place_id != ALL(v_processed)
    ORDER BY p.place_id
  LOOP
    -- Skip if already in a cluster
    IF v_cluster.place_id = ANY(v_processed) THEN
      CONTINUE;
    END IF;

    -- Find all nearby places within radius
    v_cluster_places := ARRAY[v_cluster.place_id];
    v_cluster_classifications := ARRAY[v_cluster.classification];

    FOR v_nearby IN
      SELECT p.place_id,
             COALESCE(p.colony_classification::TEXT, 'unknown') AS classification
      FROM trapper.places p
      WHERE p.merged_into_place_id IS NULL
        AND p.location IS NOT NULL
        AND p.place_id != v_cluster.place_id
        AND p.place_id != ALL(v_processed)
        AND ST_DWithin(
          v_cluster.location::geography,
          p.location::geography,
          p_radius_meters
        )
    LOOP
      v_cluster_places := array_append(v_cluster_places, v_nearby.place_id);
      v_cluster_classifications := array_append(v_cluster_classifications, v_nearby.classification);
    END LOOP;

    -- Only return if cluster has enough places
    IF array_length(v_cluster_places, 1) >= p_min_places THEN
      -- Calculate consistency score
      SELECT COUNT(DISTINCT unnest) INTO v_total FROM unnest(v_cluster_classifications);
      v_max_count := 0;
      FOR v_classification_counts IN
        SELECT c, COUNT(*) as cnt FROM unnest(v_cluster_classifications) c GROUP BY c ORDER BY COUNT(*) DESC LIMIT 1
      LOOP
        v_max_count := v_classification_counts.cnt;
      END LOOP;

      cluster_id := gen_random_uuid();
      place_ids := v_cluster_places;
      classifications := v_cluster_classifications;
      -- consistency = max_count / total. 1.0 = all same, lower = more variety
      consistency_score := ROUND(v_max_count::NUMERIC / array_length(v_cluster_classifications, 1), 2);
      RETURN NEXT;

      -- Mark all places in cluster as processed
      v_processed := v_processed || v_cluster_places;
    ELSE
      v_processed := array_append(v_processed, v_cluster.place_id);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.detect_classification_clusters IS
'Detects geographic clusters of places within a given radius.
Returns cluster_id, place_ids, classifications, and consistency_score.
Used by the backfill script to populate classification_clusters table.';

-- ============================================================
-- PART 4: Create view for pending cluster reviews
-- ============================================================

\echo 'Creating v_classification_clusters_pending view...'

CREATE OR REPLACE VIEW trapper.v_classification_clusters_pending AS
SELECT
  cc.cluster_id,
  cc.cluster_name,
  cc.place_count,
  cc.unique_classifications,
  cc.dominant_classification,
  cc.consistency_score,
  cc.recommended_action,
  cc.recommended_classification,
  cc.status,
  cc.created_at,
  -- Get place details
  (
    SELECT jsonb_agg(jsonb_build_object(
      'place_id', p.place_id,
      'address', p.formatted_address,
      'classification', COALESCE(p.colony_classification::TEXT, 'unknown'),
      'colony_id', p.colony_id
    ))
    FROM trapper.places p
    WHERE p.place_id = ANY(cc.place_ids)
  ) AS places,
  -- Get suggestion counts per classification
  (
    SELECT jsonb_object_agg(
      COALESCE(r.suggested_classification::TEXT, 'none'),
      cnt
    )
    FROM (
      SELECT suggested_classification, COUNT(*) as cnt
      FROM trapper.sot_requests r
      WHERE r.place_id = ANY(cc.place_ids)
        AND r.suggested_classification IS NOT NULL
      GROUP BY suggested_classification
    ) r
  ) AS suggestion_distribution
FROM trapper.classification_clusters cc
WHERE cc.status = 'pending'
ORDER BY cc.consistency_score ASC, cc.place_count DESC;

COMMENT ON VIEW trapper.v_classification_clusters_pending IS
'Pending classification clusters for staff review.
Ordered by consistency_score (lowest first = most inconsistent = needs attention).';

-- ============================================================
-- PART 5: Create cluster action functions
-- ============================================================

\echo 'Creating cluster action functions...'

-- Merge cluster to a colony
CREATE OR REPLACE FUNCTION trapper.merge_cluster_to_colony(
  p_cluster_id UUID,
  p_colony_id UUID,
  p_reviewed_by TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_cluster RECORD;
  v_place_id UUID;
BEGIN
  SELECT * INTO v_cluster FROM trapper.classification_clusters WHERE cluster_id = p_cluster_id;

  IF v_cluster IS NULL THEN
    RAISE EXCEPTION 'Cluster not found: %', p_cluster_id;
  END IF;

  -- Update all places in cluster to reference the colony
  FOREACH v_place_id IN ARRAY v_cluster.place_ids
  LOOP
    UPDATE trapper.places
    SET colony_id = p_colony_id,
        updated_at = NOW()
    WHERE place_id = v_place_id;
  END LOOP;

  -- Mark cluster as merged
  UPDATE trapper.classification_clusters
  SET status = 'merged',
      reviewed_by = p_reviewed_by,
      reviewed_at = NOW(),
      recommended_colony_id = p_colony_id,
      updated_at = NOW()
  WHERE cluster_id = p_cluster_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Reconcile cluster to a single classification
CREATE OR REPLACE FUNCTION trapper.reconcile_cluster_classification(
  p_cluster_id UUID,
  p_classification TEXT,
  p_reviewed_by TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_cluster RECORD;
  v_place_id UUID;
BEGIN
  SELECT * INTO v_cluster FROM trapper.classification_clusters WHERE cluster_id = p_cluster_id;

  IF v_cluster IS NULL THEN
    RAISE EXCEPTION 'Cluster not found: %', p_cluster_id;
  END IF;

  -- Update all places in cluster to the chosen classification
  FOREACH v_place_id IN ARRAY v_cluster.place_ids
  LOOP
    UPDATE trapper.places
    SET colony_classification = p_classification::trapper.colony_classification,
        updated_at = NOW()
    WHERE place_id = v_place_id;
  END LOOP;

  -- Mark cluster as reviewed
  UPDATE trapper.classification_clusters
  SET status = 'reviewed',
      reviewed_by = p_reviewed_by,
      reviewed_at = NOW(),
      recommended_classification = p_classification,
      updated_at = NOW()
  WHERE cluster_id = p_cluster_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Dismiss cluster (leave as-is)
CREATE OR REPLACE FUNCTION trapper.dismiss_cluster(
  p_cluster_id UUID,
  p_reviewed_by TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE trapper.classification_clusters
  SET status = 'dismissed',
      reviewed_by = p_reviewed_by,
      reviewed_at = NOW(),
      review_notes = p_notes,
      updated_at = NOW()
  WHERE cluster_id = p_cluster_id;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Verification:'

SELECT 'v_place_classification_pairs view' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'trapper' AND viewname = 'v_place_classification_pairs')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'classification_clusters table' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'trapper' AND tablename = 'classification_clusters')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'detect_classification_clusters function' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'detect_classification_clusters')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'v_classification_clusters_pending view' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'trapper' AND viewname = 'v_classification_clusters_pending')
            THEN 'OK' ELSE 'MISSING' END AS status;

\echo ''
\echo '========================================================'
\echo 'MIG_627 Complete!'
\echo '========================================================'
\echo ''
\echo 'Created:'
\echo '  - v_place_classification_pairs: View of nearby place pairs'
\echo '  - classification_clusters: Table for cluster tracking'
\echo '  - detect_classification_clusters(): Function to find clusters'
\echo '  - v_classification_clusters_pending: View for pending reviews'
\echo '  - merge_cluster_to_colony(): Link cluster places to colony'
\echo '  - reconcile_cluster_classification(): Set uniform classification'
\echo '  - dismiss_cluster(): Mark cluster as reviewed, no action'
\echo ''
\echo 'Next: Run scripts/jobs/detect_classification_clusters.mjs'
\echo ''
