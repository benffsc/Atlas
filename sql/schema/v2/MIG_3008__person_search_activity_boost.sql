-- MIG_3008: Add activity-based scoring boost to person search
-- FFS-976: People with appointments/cats/requests should rank higher
--
-- Rationale: Staff almost always search for people they've interacted with before.
-- "Sarah Fields" (23 appointments, 18 cats) should rank above "Sarah Alzubaidi" (0 activity).
--
-- Boost formula (max +15 points, capped to avoid overwhelming name match quality):
--   appointment_count: ln(count+1) * 3  (diminishing returns, max ~10 at 30 appts)
--   cat_count:         ln(count+1) * 2  (diminishing returns, max ~7 at 30 cats)
--   recency:           +3 if last appointment within 2 years, +1 if within 5 years
--   has_request:       +2 if linked to any request
--
-- Total boost capped at 15 to preserve name match quality as primary signal.

-- Step 1: Create a helper function for the activity boost
CREATE OR REPLACE FUNCTION sot.person_activity_boost(p_person_id UUID)
RETURNS INT
LANGUAGE sql STABLE
AS $$
  SELECT LEAST(15, (
    -- Appointment volume (logarithmic, diminishing returns)
    COALESCE((
      SELECT (ln(count(*) + 1) * 3)::INT
      FROM ops.appointments WHERE person_id = p_person_id
    ), 0)
    +
    -- Cat links (logarithmic)
    COALESCE((
      SELECT (ln(count(*) + 1) * 2)::INT
      FROM sot.person_cat WHERE person_id = p_person_id
    ), 0)
    +
    -- Recency boost
    COALESCE((
      SELECT CASE
        WHEN max(appointment_date) >= CURRENT_DATE - INTERVAL '2 years' THEN 3
        WHEN max(appointment_date) >= CURRENT_DATE - INTERVAL '5 years' THEN 1
        ELSE 0
      END
      FROM ops.appointments WHERE person_id = p_person_id
    ), 0)
    +
    -- Request involvement
    CASE WHEN EXISTS (
      SELECT 1 FROM ops.requests WHERE requester_person_id = p_person_id
    ) THEN 2 ELSE 0 END
  ));
$$;

COMMENT ON FUNCTION sot.person_activity_boost IS
  'Returns 0-15 activity boost score for person search ranking. Uses appointment count (log), cat count (log), recency, and request involvement.';


-- Step 2: Update search_unified to add activity boost to person scores
-- We replace just the person scoring section
CREATE OR REPLACE FUNCTION sot.search_unified(
  p_query TEXT,
  p_type TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE(
  entity_type TEXT,
  entity_id TEXT,
  display_name TEXT,
  subtitle TEXT,
  match_strength TEXT,
  match_reason TEXT,
  score NUMERIC,
  metadata JSONB
)
LANGUAGE plpgsql STABLE
AS $function$
DECLARE
    v_query_lower TEXT := LOWER(TRIM(p_query));
    v_query_expanded TEXT := sot.expand_abbreviations(p_query);
    v_query_pattern TEXT := '%' || v_query_lower || '%';
    v_query_prefix TEXT := v_query_lower || '%';
    v_expanded_pattern TEXT := '%' || v_query_expanded || '%';
    v_tokens TEXT[];
    v_intent TEXT := sot.detect_query_intent(p_query);
    v_intent_boost INT := 0;
BEGIN
    v_intent_boost := CASE v_intent WHEN 'unknown' THEN 0 ELSE 15 END;
    v_tokens := regexp_split_to_array(v_query_lower, '\s+');

    RETURN QUERY
    WITH ranked_results AS (
        -- ========== CATS ==========
        SELECT
            'cat'::TEXT AS entity_type,
            c.cat_id::TEXT AS entity_id,
            c.name AS display_name,
            COALESCE(
                (SELECT 'Microchip: ' || ci.id_value
                 FROM sot.cat_identifiers ci
                 WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
                 LIMIT 1),
                TRIM(COALESCE(c.sex, '') || ' ' || COALESCE(c.altered_status, '') || ' ' || COALESCE(c.breed, ''))
            ) AS subtitle,
            CASE
                WHEN LOWER(c.name) = v_query_lower THEN 100
                WHEN LOWER(c.name) LIKE v_query_prefix THEN 95
                WHEN EXISTS (
                    SELECT 1 FROM sot.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id
                      AND LOWER(ci.id_value) = v_query_lower
                ) THEN 98
                WHEN EXISTS (
                    SELECT 1 FROM sot.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id
                      AND LOWER(ci.id_value) LIKE v_query_prefix
                ) THEN 90
                WHEN (
                    SELECT bool_and(LOWER(c.name) LIKE '%' || token || '%')
                    FROM unnest(v_tokens) AS token
                    WHERE LENGTH(token) >= 2
                ) THEN 75
                WHEN similarity(c.name, p_query) >= 0.5 THEN 60 + (similarity(c.name, p_query) * 30)::INT
                WHEN LOWER(c.name) LIKE v_query_pattern THEN 40
                WHEN EXISTS (
                    SELECT 1 FROM sot.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id
                      AND LOWER(ci.id_value) LIKE v_query_pattern
                ) THEN 35
                ELSE 0
            END
            + CASE WHEN v_intent = 'cat' THEN v_intent_boost ELSE 0 END
            AS score,
            CASE
                WHEN LOWER(c.name) = v_query_lower THEN 'exact_name'
                WHEN LOWER(c.name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN EXISTS (
                    SELECT 1 FROM sot.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) = v_query_lower
                ) THEN 'exact_microchip'
                WHEN EXISTS (
                    SELECT 1 FROM sot.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) LIKE v_query_prefix
                ) THEN 'prefix_microchip'
                WHEN similarity(c.name, p_query) >= 0.5 THEN 'similar_name'
                WHEN LOWER(c.name) LIKE v_query_pattern THEN 'contains_name'
                WHEN EXISTS (
                    SELECT 1 FROM sot.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) LIKE v_query_pattern
                ) THEN 'contains_identifier'
                ELSE 'trigram'
            END AS match_reason,
            jsonb_build_object(
                'sex', c.sex,
                'altered_status', c.altered_status,
                'breed', c.breed,
                'has_place', EXISTS (SELECT 1 FROM sot.cat_place cpr WHERE cpr.cat_id = c.cat_id),
                'owner_count', (SELECT COUNT(DISTINCT pcr.person_id)
                                FROM sot.person_cat pcr
                                WHERE pcr.cat_id = c.cat_id AND pcr.relationship_type = 'owner')
            ) AS metadata
        FROM sot.cats c
        WHERE c.merged_into_cat_id IS NULL
          AND COALESCE(c.data_quality, 'normal') NOT IN ('garbage', 'needs_review')
          AND (p_type IS NULL OR p_type = 'cat')
          AND (
              LOWER(c.name) LIKE v_query_pattern
              OR similarity(c.name, p_query) >= 0.3
              OR EXISTS (
                  SELECT 1 FROM sot.cat_identifiers ci
                  WHERE ci.cat_id = c.cat_id
                    AND (LOWER(ci.id_value) LIKE v_query_pattern
                         OR similarity(ci.id_value, p_query) >= 0.4)
              )
          )

        UNION ALL

        -- ========== PEOPLE (with activity boost) ==========
        SELECT
            'person'::TEXT AS entity_type,
            p.person_id::TEXT AS entity_id,
            p.display_name,
            COALESCE(
                (SELECT pr.role FROM sot.person_roles pr WHERE pr.person_id = p.person_id AND pr.role_status = 'active' LIMIT 1),
                (SELECT 'Cats: ' || COUNT(*)::TEXT
                 FROM sot.person_cat pcr
                 WHERE pcr.person_id = p.person_id)
            ) AS subtitle,
            (CASE
                WHEN LOWER(p.display_name) = v_query_lower THEN 100
                WHEN LOWER(p.display_name) LIKE v_query_prefix THEN 95
                WHEN (
                    SELECT bool_and(LOWER(p.display_name) LIKE '%' || token || '%')
                    FROM unnest(v_tokens) AS token
                    WHERE LENGTH(token) >= 2
                ) THEN 75
                WHEN similarity(p.display_name, p_query) >= 0.5 THEN 60 + (similarity(p.display_name, p_query) * 30)::INT
                WHEN LOWER(p.display_name) LIKE v_query_pattern THEN 40
                ELSE 0
            END
            + CASE WHEN v_intent = 'person' THEN v_intent_boost ELSE 0 END
            + sot.person_activity_boost(p.person_id)  -- Activity boost (0-15)
            )::NUMERIC AS score,
            CASE
                WHEN LOWER(p.display_name) = v_query_lower THEN 'exact_name'
                WHEN LOWER(p.display_name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN similarity(p.display_name, p_query) >= 0.5 THEN 'similar_name'
                WHEN LOWER(p.display_name) LIKE v_query_pattern THEN 'contains_name'
                ELSE 'trigram'
            END AS match_reason,
            jsonb_build_object(
                'cat_count', (SELECT COUNT(*) FROM sot.person_cat pcr WHERE pcr.person_id = p.person_id),
                'place_count', (SELECT COUNT(*) FROM sot.person_place ppr WHERE ppr.person_id = p.person_id),
                'is_merged', p.merged_into_person_id IS NOT NULL
            ) AS metadata
        FROM sot.people p
        WHERE p.merged_into_person_id IS NULL
          AND COALESCE(p.data_quality, 'normal') NOT IN ('garbage', 'needs_review')
          AND (p_type IS NULL OR p_type = 'person')
          AND (
              LOWER(p.display_name) LIKE v_query_pattern
              OR similarity(p.display_name, p_query) >= 0.3
              OR EXISTS (
                  SELECT 1 FROM sot.person_identifiers pi
                  WHERE pi.person_id = p.person_id
                    AND pi.confidence >= 0.5
                    AND (
                        LOWER(pi.id_value_norm) LIKE v_query_pattern
                        OR (pi.id_type = 'email' AND LOWER(pi.id_value_norm) LIKE v_query_prefix)
                    )
              )
          )

        UNION ALL

        -- ========== PLACES ==========
        SELECT
            'place'::TEXT AS entity_type,
            pl.place_id::TEXT AS entity_id,
            COALESCE(pl.display_name, pl.formatted_address, 'Unnamed Place') AS display_name,
            pl.formatted_address AS subtitle,
            CASE
                WHEN LOWER(COALESCE(pl.display_name, '')) = v_query_lower
                  OR LOWER(COALESCE(pl.formatted_address, '')) = v_query_lower THEN 100
                WHEN LOWER(COALESCE(pl.display_name, '')) LIKE v_query_prefix
                  OR LOWER(COALESCE(pl.formatted_address, '')) LIKE v_query_prefix THEN 95
                WHEN LOWER(COALESCE(pl.formatted_address, '')) LIKE v_expanded_pattern
                  AND v_query_expanded != v_query_lower THEN 85
                WHEN (
                    SELECT bool_and(
                        LOWER(COALESCE(pl.display_name, '') || ' ' || COALESCE(pl.formatted_address, '')) LIKE '%' || token || '%'
                    )
                    FROM unnest(v_tokens) AS token
                    WHERE LENGTH(token) >= 2
                ) THEN 75
                WHEN similarity(COALESCE(pl.formatted_address, ''), p_query) >= 0.5 THEN
                    60 + (similarity(COALESCE(pl.formatted_address, ''), p_query) * 30)::INT
                WHEN LOWER(COALESCE(pl.display_name, '')) LIKE v_query_pattern
                  OR LOWER(COALESCE(pl.formatted_address, '')) LIKE v_query_pattern THEN 40
                ELSE 0
            END
            + CASE WHEN v_intent = 'place' THEN v_intent_boost ELSE 0 END
            AS score,
            CASE
                WHEN LOWER(COALESCE(pl.display_name, '')) = v_query_lower
                  OR LOWER(COALESCE(pl.formatted_address, '')) = v_query_lower THEN 'exact_address'
                WHEN LOWER(COALESCE(pl.display_name, '')) LIKE v_query_prefix
                  OR LOWER(COALESCE(pl.formatted_address, '')) LIKE v_query_prefix THEN 'prefix_address'
                WHEN similarity(COALESCE(pl.formatted_address, ''), p_query) >= 0.5 THEN 'similar_address'
                WHEN LOWER(COALESCE(pl.display_name, '')) LIKE v_query_pattern
                  OR LOWER(COALESCE(pl.formatted_address, '')) LIKE v_query_pattern THEN 'contains_address'
                ELSE 'trigram'
            END AS match_reason,
            jsonb_build_object(
                'kind', pl.place_kind,
                'formatted_address', pl.formatted_address,
                'cat_count', (SELECT COUNT(*) FROM sot.cat_place cpr WHERE cpr.place_id = pl.place_id),
                'request_count', (SELECT COUNT(*) FROM ops.requests r
                                   WHERE r.place_id = pl.place_id
                                     AND r.merged_into_request_id IS NULL)
            ) AS metadata
        FROM sot.places pl
        WHERE pl.merged_into_place_id IS NULL
          AND COALESCE(pl.quality_tier, 'normal') NOT IN ('garbage', 'needs_review')
          AND (p_type IS NULL OR p_type = 'place')
          AND (
              LOWER(COALESCE(pl.display_name, '')) LIKE v_query_pattern
              OR LOWER(COALESCE(pl.formatted_address, '')) LIKE v_query_pattern
              OR LOWER(COALESCE(pl.formatted_address, '')) LIKE v_expanded_pattern
              OR similarity(COALESCE(pl.formatted_address, ''), p_query) >= 0.3
          )
    )
    SELECT
        rr.entity_type,
        rr.entity_id,
        rr.display_name,
        rr.subtitle,
        CASE
            WHEN rr.score >= 90 THEN 'strong'
            WHEN rr.score >= 60 THEN 'medium'
            ELSE 'weak'
        END AS match_strength,
        rr.match_reason,
        rr.score,
        rr.metadata
    FROM ranked_results rr
    WHERE rr.score > 0
    ORDER BY rr.score DESC, rr.display_name
    LIMIT p_limit OFFSET p_offset;
END;
$function$;


-- Step 3: Also boost fuzzy search results by activity
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
  ORDER BY
    -- Primary: similarity, Secondary: activity boost (normalized 0-1)
    similarity(p.display_name, p_query) + (sot.person_activity_boost(p.person_id)::NUMERIC / 100) DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION sot.search_person_fuzzy IS
  'Fuzzy person search using pg_trgm similarity with activity boost. Returns people with similar names, preferring those with appointments/cats/requests.';
