-- MIG_189: Place Deduplication
-- Normalizes addresses and merges duplicate places
--
-- Problem: 30+ duplicate place clusters exist due to address variations:
--   - "Rd" vs "Road", "St" vs "Street", "Ave" vs "Avenue"
--   - With/without ", USA"
--   - Period variations (Rd vs Rd.)

\echo '=============================================='
\echo 'MIG_189: Place Deduplication'
\echo '=============================================='

-- ============================================
-- PART 1: Address Normalization Function
-- ============================================

\echo 'Creating normalize_address function...'

CREATE OR REPLACE FUNCTION trapper.normalize_address(addr TEXT)
RETURNS TEXT AS $$
DECLARE
  result TEXT;
BEGIN
  IF addr IS NULL THEN
    RETURN NULL;
  END IF;

  result := addr;

  -- Lowercase
  result := LOWER(result);

  -- Remove ", USA" and ", United States" (case insensitive already)
  result := REGEXP_REPLACE(result, ',?\s*(usa|united states)\s*$', '', 'i');

  -- Remove periods from abbreviations
  result := REGEXP_REPLACE(result, '\.(?=\s|$|,)', '', 'g');

  -- Expand common street suffix abbreviations to full words
  -- Do this BEFORE normalizing to ensure consistent output
  result := REGEXP_REPLACE(result, '\brd\b', 'road', 'gi');
  result := REGEXP_REPLACE(result, '\bst\b', 'street', 'gi');
  result := REGEXP_REPLACE(result, '\bave\b', 'avenue', 'gi');
  result := REGEXP_REPLACE(result, '\bdr\b', 'drive', 'gi');
  result := REGEXP_REPLACE(result, '\bln\b', 'lane', 'gi');
  result := REGEXP_REPLACE(result, '\bct\b', 'court', 'gi');
  result := REGEXP_REPLACE(result, '\bblvd\b', 'boulevard', 'gi');
  result := REGEXP_REPLACE(result, '\bpl\b', 'place', 'gi');
  result := REGEXP_REPLACE(result, '\bcir\b', 'circle', 'gi');
  result := REGEXP_REPLACE(result, '\bpkwy\b', 'parkway', 'gi');
  result := REGEXP_REPLACE(result, '\bhwy\b', 'highway', 'gi');
  result := REGEXP_REPLACE(result, '\bway\b', 'way', 'gi');

  -- Normalize directional abbreviations
  result := REGEXP_REPLACE(result, '\bn\b', 'north', 'gi');
  result := REGEXP_REPLACE(result, '\bs\b', 'south', 'gi');
  result := REGEXP_REPLACE(result, '\be\b', 'east', 'gi');
  result := REGEXP_REPLACE(result, '\bw\b', 'west', 'gi');
  result := REGEXP_REPLACE(result, '\bne\b', 'northeast', 'gi');
  result := REGEXP_REPLACE(result, '\bnw\b', 'northwest', 'gi');
  result := REGEXP_REPLACE(result, '\bse\b', 'southeast', 'gi');
  result := REGEXP_REPLACE(result, '\bsw\b', 'southwest', 'gi');

  -- Normalize apartment/unit designations
  result := REGEXP_REPLACE(result, '\bapt\.?\s*', 'apartment ', 'gi');
  result := REGEXP_REPLACE(result, '\bunit\s*', 'unit ', 'gi');
  result := REGEXP_REPLACE(result, '\bste\.?\s*', 'suite ', 'gi');
  result := REGEXP_REPLACE(result, '\bspace\s*', 'space ', 'gi');
  result := REGEXP_REPLACE(result, '#\s*', 'unit ', 'g');

  -- Normalize whitespace (collapse multiple spaces to single)
  result := REGEXP_REPLACE(result, '\s+', ' ', 'g');

  -- Trim leading/trailing whitespace
  result := TRIM(result);

  -- Remove trailing comma
  result := REGEXP_REPLACE(result, ',\s*$', '');

  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.normalize_address(TEXT) IS
'Normalizes address strings for deduplication comparison. Expands abbreviations, removes USA suffix, normalizes whitespace.';

-- ============================================
-- PART 2: Place Merge Infrastructure
-- ============================================

\echo 'Adding merge columns to places table...'

-- Add merge tracking columns if they don't exist
ALTER TABLE trapper.places
  ADD COLUMN IF NOT EXISTS merged_into_place_id UUID REFERENCES trapper.places(place_id),
  ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS merge_reason TEXT;

-- Create merge audit table
CREATE TABLE IF NOT EXISTS trapper.place_merge_audit (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kept_place_id UUID NOT NULL,
  merged_place_id UUID NOT NULL,
  merge_reason TEXT,
  requests_moved INT DEFAULT 0,
  cats_moved INT DEFAULT 0,
  people_moved INT DEFAULT 0,
  merged_by TEXT NOT NULL,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_place_merge_audit_kept ON trapper.place_merge_audit(kept_place_id);
CREATE INDEX IF NOT EXISTS idx_place_merge_audit_merged ON trapper.place_merge_audit(merged_place_id);

\echo 'Creating merge_duplicate_places function...'

CREATE OR REPLACE FUNCTION trapper.merge_duplicate_places(
  p_keep_place_id UUID,
  p_merge_place_id UUID,
  p_merged_by TEXT DEFAULT 'system'
) RETURNS TABLE(requests_moved INT, cats_moved INT, people_moved INT) AS $$
DECLARE
  v_requests_moved INT := 0;
  v_cats_moved INT := 0;
  v_people_moved INT := 0;
BEGIN
  -- Don't merge a place into itself
  IF p_keep_place_id = p_merge_place_id THEN
    RAISE EXCEPTION 'Cannot merge place into itself';
  END IF;

  -- Don't merge if already merged
  IF EXISTS (SELECT 1 FROM trapper.places WHERE place_id = p_merge_place_id AND merged_into_place_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Place % is already merged', p_merge_place_id;
  END IF;

  -- Move requests
  UPDATE trapper.sot_requests
  SET place_id = p_keep_place_id,
      updated_at = NOW()
  WHERE place_id = p_merge_place_id;
  GET DIAGNOSTICS v_requests_moved = ROW_COUNT;

  -- Move cat relationships (handle conflicts by keeping existing)
  UPDATE trapper.cat_place_relationships
  SET place_id = p_keep_place_id
  WHERE place_id = p_merge_place_id
    AND NOT EXISTS (
      SELECT 1 FROM trapper.cat_place_relationships cpr2
      WHERE cpr2.cat_id = cat_place_relationships.cat_id
        AND cpr2.place_id = p_keep_place_id
    );
  GET DIAGNOSTICS v_cats_moved = ROW_COUNT;

  -- Delete conflicting cat relationships (cat already at keep place)
  DELETE FROM trapper.cat_place_relationships
  WHERE place_id = p_merge_place_id;

  -- Move person relationships (handle conflicts by keeping existing)
  UPDATE trapper.person_place_relationships
  SET place_id = p_keep_place_id
  WHERE place_id = p_merge_place_id
    AND NOT EXISTS (
      SELECT 1 FROM trapper.person_place_relationships ppr2
      WHERE ppr2.person_id = person_place_relationships.person_id
        AND ppr2.place_id = p_keep_place_id
    );
  GET DIAGNOSTICS v_people_moved = ROW_COUNT;

  -- Delete conflicting person relationships
  DELETE FROM trapper.person_place_relationships
  WHERE place_id = p_merge_place_id;

  -- Mark merged place
  UPDATE trapper.places
  SET merged_into_place_id = p_keep_place_id,
      merged_at = NOW(),
      merge_reason = 'duplicate_address'
  WHERE place_id = p_merge_place_id;

  -- Log the merge
  INSERT INTO trapper.place_merge_audit (
    kept_place_id, merged_place_id, merge_reason,
    requests_moved, cats_moved, people_moved, merged_by
  ) VALUES (
    p_keep_place_id, p_merge_place_id, 'duplicate_address',
    v_requests_moved, v_cats_moved, v_people_moved, p_merged_by
  );

  RETURN QUERY SELECT v_requests_moved, v_cats_moved, v_people_moved;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 3: Find Duplicate Clusters
-- ============================================

\echo 'Creating view for duplicate detection...'

CREATE OR REPLACE VIEW trapper.v_place_duplicate_candidates AS
WITH place_stats AS (
  SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    trapper.normalize_address(p.formatted_address) as normalized_address,
    p.merged_into_place_id,
    p.created_at,
    (SELECT COUNT(*) FROM trapper.cat_place_relationships WHERE place_id = p.place_id) as cat_count,
    (SELECT COUNT(*) FROM trapper.sot_requests WHERE place_id = p.place_id) as request_count,
    (SELECT COUNT(*) FROM trapper.person_place_relationships WHERE place_id = p.place_id) as person_count
  FROM trapper.places p
  WHERE p.formatted_address IS NOT NULL
    AND p.merged_into_place_id IS NULL  -- Not already merged
),
duplicate_groups AS (
  SELECT
    normalized_address,
    COUNT(*) as place_count,
    SUM(cat_count) as total_cats,
    SUM(request_count) as total_requests
  FROM place_stats
  GROUP BY normalized_address
  HAVING COUNT(*) > 1
)
SELECT
  ps.place_id,
  ps.display_name,
  ps.formatted_address,
  ps.normalized_address,
  ps.cat_count,
  ps.request_count,
  ps.person_count,
  ps.created_at,
  dg.place_count as duplicates_in_group,
  dg.total_cats as group_total_cats,
  dg.total_requests as group_total_requests,
  -- Rank within group: prefer place with most data, then oldest
  ROW_NUMBER() OVER (
    PARTITION BY ps.normalized_address
    ORDER BY (ps.cat_count + ps.request_count * 10) DESC, ps.created_at ASC
  ) as rank_in_group
FROM place_stats ps
JOIN duplicate_groups dg ON ps.normalized_address = dg.normalized_address
ORDER BY dg.total_cats + dg.total_requests DESC, ps.normalized_address, rank_in_group;

-- ============================================
-- PART 4: Batch Deduplication Function
-- ============================================

\echo 'Creating batch deduplication function...'

CREATE OR REPLACE FUNCTION trapper.deduplicate_all_places(
  p_dry_run BOOLEAN DEFAULT TRUE,
  p_merged_by TEXT DEFAULT 'system'
) RETURNS TABLE(
  clusters_found INT,
  places_merged INT,
  requests_moved INT,
  cats_moved INT,
  people_moved INT
) AS $$
DECLARE
  v_clusters_found INT := 0;
  v_places_merged INT := 0;
  v_requests_moved INT := 0;
  v_cats_moved INT := 0;
  v_people_moved INT := 0;
  v_cluster RECORD;
  v_keeper_id UUID;
  v_merge_id UUID;
  v_result RECORD;
BEGIN
  -- Find all duplicate clusters
  FOR v_cluster IN
    SELECT DISTINCT normalized_address
    FROM trapper.v_place_duplicate_candidates
    WHERE rank_in_group = 1
  LOOP
    v_clusters_found := v_clusters_found + 1;

    -- Get the keeper (rank 1)
    SELECT place_id INTO v_keeper_id
    FROM trapper.v_place_duplicate_candidates
    WHERE normalized_address = v_cluster.normalized_address
      AND rank_in_group = 1;

    -- Merge all non-keepers into keeper
    FOR v_merge_id IN
      SELECT place_id
      FROM trapper.v_place_duplicate_candidates
      WHERE normalized_address = v_cluster.normalized_address
        AND rank_in_group > 1
    LOOP
      IF p_dry_run THEN
        RAISE NOTICE 'DRY RUN: Would merge % into %', v_merge_id, v_keeper_id;
        v_places_merged := v_places_merged + 1;
      ELSE
        SELECT * INTO v_result FROM trapper.merge_duplicate_places(v_keeper_id, v_merge_id, p_merged_by);
        v_places_merged := v_places_merged + 1;
        v_requests_moved := v_requests_moved + v_result.requests_moved;
        v_cats_moved := v_cats_moved + v_result.cats_moved;
        v_people_moved := v_people_moved + v_result.people_moved;
      END IF;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT v_clusters_found, v_places_merged, v_requests_moved, v_cats_moved, v_people_moved;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 5: Backup and Execute
-- ============================================

\echo 'Creating backup of places table...'

CREATE TABLE IF NOT EXISTS trapper.backup_places_pre_dedup AS
SELECT * FROM trapper.places;

\echo ''
\echo '=============================================='
\echo 'DRY RUN: Checking for duplicates...'
\echo '=============================================='

SELECT * FROM trapper.deduplicate_all_places(TRUE, 'mig_189');

\echo ''
\echo 'Top 20 duplicate clusters:'
SELECT
  normalized_address,
  COUNT(*) as places,
  STRING_AGG(display_name, ' | ' ORDER BY rank_in_group) as place_names,
  SUM(cat_count) as total_cats,
  SUM(request_count) as total_requests
FROM trapper.v_place_duplicate_candidates
GROUP BY normalized_address
ORDER BY SUM(cat_count) + SUM(request_count) DESC
LIMIT 20;

\echo ''
\echo '=============================================='
\echo 'EXECUTING DEDUPLICATION...'
\echo '=============================================='

SELECT * FROM trapper.deduplicate_all_places(FALSE, 'mig_189');

\echo ''
\echo 'Deduplication complete!'
\echo 'Check trapper.place_merge_audit for details.'

-- Verify results
\echo ''
\echo 'Remaining duplicates (should be 0 or only units):'
SELECT COUNT(*) as remaining_duplicate_clusters
FROM (
  SELECT trapper.normalize_address(formatted_address)
  FROM trapper.places
  WHERE merged_into_place_id IS NULL
    AND formatted_address IS NOT NULL
  GROUP BY trapper.normalize_address(formatted_address)
  HAVING COUNT(*) > 1
) x;
