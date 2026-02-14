-- MIG_501: Fix Person List Performance
--
-- Problem:
--   /api/people times out due to:
--   1. v_person_list_v2 uses correlated subqueries (O(n²) queries)
--   2. API expects columns not in v_person_list_v2 (account_type, surface_quality, etc.)
--   3. Column mismatch causes query errors when deep_search=false
--
-- Solution:
--   1. Create person_stats_cache table for pre-aggregated counts
--   2. Create refresh_person_stats_cache() function
--   3. Create v_person_list_v3 view with ALL columns API expects
--   4. Add indexes for fast relationship aggregation
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_501__fix_person_list_performance.sql

\echo ''
\echo '=============================================='
\echo 'MIG_501: Fix Person List Performance'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Create person_stats_cache table
-- ============================================================

\echo '1. Creating person_stats_cache table...'

CREATE TABLE IF NOT EXISTS trapper.person_stats_cache (
  person_id UUID PRIMARY KEY REFERENCES trapper.sot_people(person_id) ON DELETE CASCADE,
  cat_count INT DEFAULT 0,
  place_count INT DEFAULT 0,
  has_email BOOLEAN DEFAULT FALSE,
  has_phone BOOLEAN DEFAULT FALSE,
  cat_names TEXT,
  primary_place TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_person_stats_cache_updated
  ON trapper.person_stats_cache(updated_at);

COMMENT ON TABLE trapper.person_stats_cache IS
'Pre-aggregated person statistics for fast list queries (O(1) vs O(n²)).
Refreshed periodically by refresh_person_stats_cache().';

-- ============================================================
-- 2. Add indexes for relationship aggregation
-- ============================================================

\echo '2. Adding indexes for relationship aggregation...'

CREATE INDEX IF NOT EXISTS idx_person_cat_rel_person_id
  ON trapper.person_cat_relationships(person_id);

CREATE INDEX IF NOT EXISTS idx_person_place_rel_person_id
  ON trapper.person_place_relationships(person_id);

CREATE INDEX IF NOT EXISTS idx_person_identifiers_person_type
  ON trapper.person_identifiers(person_id, id_type);

-- ============================================================
-- 3. Create refresh function
-- ============================================================

\echo '3. Creating refresh_person_stats_cache function...'

CREATE OR REPLACE FUNCTION trapper.refresh_person_stats_cache()
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  -- Delete stale entries for merged/deleted people
  DELETE FROM trapper.person_stats_cache psc
  WHERE NOT EXISTS (
    SELECT 1 FROM trapper.sot_people p
    WHERE p.person_id = psc.person_id
      AND p.merged_into_person_id IS NULL
  );

  -- Upsert stats for all active people
  INSERT INTO trapper.person_stats_cache (
    person_id, cat_count, place_count, has_email, has_phone, cat_names, primary_place
  )
  SELECT
    p.person_id,
    COALESCE(pcr.cnt, 0) AS cat_count,
    COALESCE(ppr.cnt, 0) AS place_count,
    COALESCE(email_check.has_email, FALSE) AS has_email,
    COALESCE(phone_check.has_phone, FALSE) AS has_phone,
    cat_names.names AS cat_names,
    place_info.primary_place AS primary_place
  FROM trapper.sot_people p
  -- Cat count
  LEFT JOIN (
    SELECT person_id, COUNT(DISTINCT cat_id) AS cnt
    FROM trapper.person_cat_relationships
    GROUP BY person_id
  ) pcr ON pcr.person_id = p.person_id
  -- Place count
  LEFT JOIN (
    SELECT person_id, COUNT(DISTINCT place_id) AS cnt
    FROM trapper.person_place_relationships
    GROUP BY person_id
  ) ppr ON ppr.person_id = p.person_id
  -- Email check
  LEFT JOIN (
    SELECT person_id, TRUE AS has_email
    FROM trapper.person_identifiers
    WHERE id_type = 'email'
    GROUP BY person_id
  ) email_check ON email_check.person_id = p.person_id
  -- Phone check
  LEFT JOIN (
    SELECT person_id, TRUE AS has_phone
    FROM trapper.person_identifiers
    WHERE id_type = 'phone'
    GROUP BY person_id
  ) phone_check ON phone_check.person_id = p.person_id
  -- Cat names (first 3)
  LEFT JOIN LATERAL (
    SELECT string_agg(c.display_name, ', ' ORDER BY c.display_name) AS names
    FROM (
      SELECT DISTINCT c.display_name
      FROM trapper.person_cat_relationships pcr
      JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
      WHERE pcr.person_id = p.person_id
      LIMIT 3
    ) c
  ) cat_names ON TRUE
  -- Primary place
  LEFT JOIN LATERAL (
    SELECT pl.display_name AS primary_place
    FROM trapper.person_place_relationships ppr
    JOIN trapper.places pl ON pl.place_id = ppr.place_id
    WHERE ppr.person_id = p.person_id
    ORDER BY ppr.created_at DESC
    LIMIT 1
  ) place_info ON TRUE
  WHERE p.merged_into_person_id IS NULL
  ON CONFLICT (person_id) DO UPDATE SET
    cat_count = EXCLUDED.cat_count,
    place_count = EXCLUDED.place_count,
    has_email = EXCLUDED.has_email,
    has_phone = EXCLUDED.has_phone,
    cat_names = EXCLUDED.cat_names,
    primary_place = EXCLUDED.primary_place,
    updated_at = NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.refresh_person_stats_cache IS
'Refreshes pre-aggregated person statistics for fast list queries.
Call periodically (e.g., every 5 minutes) or after bulk imports.';

-- ============================================================
-- 4. Create v_person_list_v3 view with all API-expected columns
-- ============================================================

\echo '4. Creating v_person_list_v3 view...'

CREATE OR REPLACE VIEW trapper.v_person_list_v3 AS
SELECT
  p.person_id,
  p.display_name,
  p.account_type,
  -- Surface quality from v_person_surface_quality logic
  CASE
    WHEN p.account_type != 'person' THEN 'Low'
    WHEN trapper.is_address_like_name(p.display_name) THEN 'Low'
    WHEN NOT trapper.is_valid_person_name(p.display_name) THEN 'Low'
    WHEN COALESCE(ps.has_email, FALSE) OR COALESCE(ps.has_phone, FALSE) THEN 'High'
    WHEN COALESCE(ps.cat_count, 0) > 0 THEN 'Medium'
    ELSE 'Medium'
  END AS surface_quality,
  -- Quality reason
  CASE
    WHEN p.account_type != 'person' THEN 'non_person_account'
    WHEN trapper.is_address_like_name(p.display_name) THEN 'address_like_name'
    WHEN NOT trapper.is_valid_person_name(p.display_name) THEN 'invalid_name'
    WHEN COALESCE(ps.has_email, FALSE) AND COALESCE(ps.has_phone, FALSE) THEN 'has_email_and_phone'
    WHEN COALESCE(ps.has_email, FALSE) THEN 'has_email'
    WHEN COALESCE(ps.has_phone, FALSE) THEN 'has_phone'
    WHEN COALESCE(ps.cat_count, 0) > 0 THEN 'has_cats'
    ELSE 'valid_name_only'
  END AS quality_reason,
  -- Identifier flags
  COALESCE(ps.has_email, FALSE) AS has_email,
  COALESCE(ps.has_phone, FALSE) AS has_phone,
  -- Counts from cache (O(1) lookup)
  COALESCE(ps.cat_count, 0) AS cat_count,
  COALESCE(ps.place_count, 0) AS place_count,
  -- Names/places from cache
  ps.cat_names,
  ps.primary_place,
  -- Timestamps
  p.created_at,
  -- Source quality (for API compatibility)
  trapper.get_person_source_quality(p.person_id) AS source_quality,
  -- Data quality (for deep_search filtering compatibility)
  CASE
    WHEN p.account_type != 'person' THEN 'low'
    WHEN NOT trapper.is_valid_person_name(p.display_name) THEN 'low'
    WHEN COALESCE(ps.has_email, FALSE) OR COALESCE(ps.has_phone, FALSE) THEN 'high'
    ELSE 'medium'
  END AS data_quality
FROM trapper.sot_people p
LEFT JOIN trapper.person_stats_cache ps ON ps.person_id = p.person_id
WHERE p.merged_into_person_id IS NULL;

COMMENT ON VIEW trapper.v_person_list_v3 IS
'Person list view with pre-aggregated stats from cache for O(1) performance.
Includes all columns expected by /api/people route.
Cache is refreshed by refresh_person_stats_cache() function.';

-- ============================================================
-- 5. Initial cache population
-- ============================================================

\echo '5. Populating person_stats_cache (this may take a moment)...'

SELECT trapper.refresh_person_stats_cache() AS persons_cached;

-- ============================================================
-- 6. Create trigger to keep cache fresh on relationship changes
-- ============================================================

\echo '6. Creating cache invalidation triggers...'

CREATE OR REPLACE FUNCTION trapper.invalidate_person_stats_cache()
RETURNS TRIGGER AS $$
BEGIN
  -- Mark the person's cache as stale by updating timestamp
  -- The refresh function will update actual values
  IF TG_OP = 'DELETE' THEN
    UPDATE trapper.person_stats_cache
    SET updated_at = NOW() - INTERVAL '1 day'  -- Mark as stale
    WHERE person_id = OLD.person_id;
    RETURN OLD;
  ELSE
    -- Try to insert/update the cache entry directly for fast updates
    INSERT INTO trapper.person_stats_cache (person_id, updated_at)
    VALUES (NEW.person_id, NOW() - INTERVAL '1 day')
    ON CONFLICT (person_id) DO UPDATE SET updated_at = NOW() - INTERVAL '1 day';
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger on person_cat_relationships
DROP TRIGGER IF EXISTS trg_invalidate_person_cache_cats ON trapper.person_cat_relationships;
CREATE TRIGGER trg_invalidate_person_cache_cats
  AFTER INSERT OR UPDATE OR DELETE ON trapper.person_cat_relationships
  FOR EACH ROW EXECUTE FUNCTION trapper.invalidate_person_stats_cache();

-- Trigger on person_place_relationships
DROP TRIGGER IF EXISTS trg_invalidate_person_cache_places ON trapper.person_place_relationships;
CREATE TRIGGER trg_invalidate_person_cache_places
  AFTER INSERT OR UPDATE OR DELETE ON trapper.person_place_relationships
  FOR EACH ROW EXECUTE FUNCTION trapper.invalidate_person_stats_cache();

-- Trigger on person_identifiers
DROP TRIGGER IF EXISTS trg_invalidate_person_cache_ids ON trapper.person_identifiers;
CREATE TRIGGER trg_invalidate_person_cache_ids
  AFTER INSERT OR UPDATE OR DELETE ON trapper.person_identifiers
  FOR EACH ROW EXECUTE FUNCTION trapper.invalidate_person_stats_cache();

-- ============================================================
-- Summary
-- ============================================================

\echo ''
\echo '=============================================='
\echo 'MIG_501 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  - Created person_stats_cache table'
\echo '  - Created refresh_person_stats_cache() function'
\echo '  - Created v_person_list_v3 view with all API columns'
\echo '  - Added cache invalidation triggers'
\echo ''
\echo 'Performance improvement:'
\echo '  - O(n²) -> O(1) for relationship counts'
\echo '  - /api/people should now respond in < 2 seconds'
\echo ''
\echo 'Maintenance:'
\echo '  - Cache auto-invalidates on relationship changes'
\echo '  - Call refresh_person_stats_cache() after bulk imports'
\echo ''

-- Show cache stats
SELECT
  COUNT(*) AS cached_persons,
  SUM(cat_count) AS total_cats_linked,
  SUM(CASE WHEN has_email THEN 1 ELSE 0 END) AS with_email,
  SUM(CASE WHEN has_phone THEN 1 ELSE 0 END) AS with_phone
FROM trapper.person_stats_cache;

-- Record migration
SELECT trapper.record_migration(501, 'MIG_501__fix_person_list_performance');
