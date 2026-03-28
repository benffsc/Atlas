-- MIG_3007: Fuzzy person search using pg_trgm similarity
-- FFS-974: Enables "did you mean?" suggestions when exact search returns few results
--
-- Requires: pg_trgm extension (already enabled)
-- Uses existing GIN index on sot.people.display_name

CREATE OR REPLACE FUNCTION sot.search_person_fuzzy(
  p_query TEXT,
  p_limit INT DEFAULT 5,
  p_exclude_ids UUID[] DEFAULT '{}'
)
RETURNS TABLE (
  entity_id TEXT,
  display_name TEXT,
  subtitle TEXT,
  similarity_score NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.person_id::TEXT AS entity_id,
    p.display_name,
    COALESCE(
      (SELECT id_value_norm FROM sot.person_identifiers
       WHERE person_id = p.person_id AND id_type = 'email' AND confidence >= 0.5
       ORDER BY confidence DESC LIMIT 1),
      (SELECT id_value_norm FROM sot.person_identifiers
       WHERE person_id = p.person_id AND id_type = 'phone' AND confidence >= 0.5
       ORDER BY confidence DESC LIMIT 1),
      ''
    ) AS subtitle,
    similarity(p.display_name, p_query)::NUMERIC AS similarity_score
  FROM sot.people p
  WHERE p.merged_into_person_id IS NULL
    AND p.person_id != ALL(p_exclude_ids)
    AND similarity(p.display_name, p_query) >= 0.3
  ORDER BY similarity(p.display_name, p_query) DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION sot.search_person_fuzzy IS
  'Fuzzy person search using pg_trgm similarity. Returns people with similar names when exact search yields few results. Threshold: 0.3 similarity.';
