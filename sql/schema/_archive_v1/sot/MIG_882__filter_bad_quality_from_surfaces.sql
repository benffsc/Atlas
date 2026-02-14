-- ============================================================================
-- MIG_882: Filter bad-quality people from map pins and search results
-- ============================================================================
-- People with data_quality='garbage' or 'needs_review' currently appear in:
--   1. Map pin popups (v_map_atlas_pins people CTE)
--   2. Search results (search_unified() PEOPLE section)
--   3. Volunteers layer (map-data API)
--
-- This migration adds data_quality filtering to the SQL view and function.
-- The volunteers layer fix is in the API route (apps/web/src/app/api/beacon/map-data/route.ts).
-- ============================================================================

\echo ''
\echo '============================================================'
\echo 'MIG_882: Filter Bad-Quality People from Map & Search'
\echo '============================================================'
\echo ''

-- ============================================================================
-- Phase 1: Recreate v_map_atlas_pins with data_quality filter on people CTE
-- ============================================================================

\echo 'Phase 1: Updating v_map_atlas_pins...'

CREATE OR REPLACE VIEW trapper.v_map_atlas_pins AS
SELECT
  p.place_id as id,
  p.formatted_address as address,
  COALESCE(org.org_display_name, p.display_name) as display_name,
  ST_Y(p.location::geometry) as lat,
  ST_X(p.location::geometry) as lng,
  p.service_zone,

  -- Parent place for clustering
  p.parent_place_id,
  p.place_kind,
  p.unit_identifier,

  -- Cat counts
  COALESCE(cc.cat_count, 0) as cat_count,

  -- People linked
  COALESCE(ppl.people, '[]'::JSONB) as people,
  COALESCE(ppl.person_count, 0) as person_count,

  -- Disease risk (backward compat boolean)
  (COALESCE(p.disease_risk, FALSE)
   OR COALESCE(gme.has_disease_risk, FALSE)
   OR COALESCE(ds.has_any_disease, FALSE)) as disease_risk,
  p.disease_risk_notes,

  -- Per-disease badges
  COALESCE(ds.disease_badges, '[]'::JSONB) as disease_badges,
  COALESCE(ds.active_disease_count, 0) as disease_count,

  -- Watch list
  (COALESCE(p.watch_list, FALSE) OR COALESCE(gme.has_watch_list, FALSE)) as watch_list,
  p.watch_list_reason,

  -- Google Maps history
  COALESCE(gme.entry_count, 0) as google_entry_count,
  COALESCE(gme.ai_summaries, '[]'::JSONB) as google_summaries,

  -- Request counts
  COALESCE(req.request_count, 0) as request_count,
  COALESCE(req.active_request_count, 0) as active_request_count,

  -- Intake submission counts
  COALESCE(intake.intake_count, 0) as intake_count,

  -- TNR stats
  COALESCE(tnr.total_altered, 0) as total_altered,
  tnr.last_alteration_at,

  -- Pin style
  CASE
    WHEN (COALESCE(p.disease_risk, FALSE)
          OR COALESCE(gme.has_disease_risk, FALSE)
          OR COALESCE(ds.has_any_disease, FALSE)) THEN 'disease'
    WHEN (COALESCE(p.watch_list, FALSE) OR COALESCE(gme.has_watch_list, FALSE)) THEN 'watch_list'
    WHEN COALESCE(cc.cat_count, 0) > 0 THEN 'active'
    WHEN COALESCE(req.request_count, 0) > 0
      OR COALESCE(intake.intake_count, 0) > 0 THEN 'active_requests'
    WHEN COALESCE(gme.entry_count, 0) > 0 THEN 'has_history'
    ELSE 'minimal'
  END as pin_style,

  -- Pin tier (active = full teardrop, reference = smaller muted pin)
  CASE
    WHEN (COALESCE(p.disease_risk, FALSE)
          OR COALESCE(gme.has_disease_risk, FALSE)
          OR COALESCE(ds.has_any_disease, FALSE)) THEN 'active'
    WHEN (COALESCE(p.watch_list, FALSE) OR COALESCE(gme.has_watch_list, FALSE)) THEN 'active'
    WHEN COALESCE(cc.cat_count, 0) > 0 THEN 'active'
    WHEN COALESCE(req.request_count, 0) > 0
      OR COALESCE(intake.intake_count, 0) > 0 THEN 'active'
    WHEN active_roles.place_id IS NOT NULL THEN 'active'
    ELSE 'reference'
  END as pin_tier,

  -- Metadata
  p.created_at,
  p.last_activity_at,

  -- MIG_857: Requests needing trapper assignment
  COALESCE(req.needs_trapper_count, 0) as needs_trapper_count

FROM trapper.places p

-- Cat counts
LEFT JOIN (
  SELECT place_id, COUNT(DISTINCT cat_id) as cat_count
  FROM trapper.cat_place_relationships
  GROUP BY place_id
) cc ON cc.place_id = p.place_id

-- People with role info
-- MIG_882: Added data_quality filter to exclude garbage/needs_review people
LEFT JOIN (
  SELECT
    ppr.place_id,
    COUNT(DISTINCT per.person_id) as person_count,
    JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
      'name', per.display_name,
      'roles', COALESCE((
        SELECT ARRAY_AGG(DISTINCT pr.role)
        FROM trapper.person_roles pr
        WHERE pr.person_id = per.person_id
          AND pr.role_status = 'active'
      ), ARRAY[]::TEXT[]),
      'is_staff', COALESCE(per.is_system_account, FALSE)
    )) FILTER (WHERE per.display_name IS NOT NULL) as people
  FROM trapper.person_place_relationships ppr
  JOIN trapper.sot_people per ON per.person_id = ppr.person_id
  WHERE per.merged_into_person_id IS NULL
    AND NOT trapper.is_organization_name(per.display_name)
    AND COALESCE(per.data_quality, 'normal') NOT IN ('garbage', 'needs_review')
    AND (
      COALESCE(per.is_system_account, FALSE) = FALSE
      OR ppr.source_system = 'volunteerhub'
    )
  GROUP BY ppr.place_id
) ppl ON ppl.place_id = p.place_id

-- Organization display name fallback
LEFT JOIN (
  SELECT DISTINCT ON (place_id) place_id, org_display_name
  FROM trapper.organization_place_mappings
  WHERE auto_link_enabled = TRUE AND org_display_name IS NOT NULL
  ORDER BY place_id, created_at DESC
) org ON org.place_id = p.place_id

-- Disease summary
LEFT JOIN trapper.v_place_disease_summary ds ON ds.place_id = p.place_id

-- Google Maps entries
LEFT JOIN (
  SELECT
    COALESCE(place_id, linked_place_id) as place_id,
    COUNT(*) as entry_count,
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'summary', COALESCE(ai_summary, SUBSTRING(original_content FROM 1 FOR 200)),
        'meaning', ai_meaning,
        'date', parsed_date::text
      )
      ORDER BY imported_at DESC
    ) FILTER (WHERE ai_summary IS NOT NULL OR original_content IS NOT NULL) as ai_summaries,
    BOOL_OR(ai_meaning IN ('disease_risk', 'felv_colony', 'fiv_colony')) as has_disease_risk,
    BOOL_OR(ai_meaning = 'watch_list') as has_watch_list
  FROM trapper.google_map_entries
  WHERE place_id IS NOT NULL OR linked_place_id IS NOT NULL
  GROUP BY COALESCE(place_id, linked_place_id)
) gme ON gme.place_id = p.place_id

-- Request counts
LEFT JOIN (
  SELECT
    place_id,
    COUNT(*) as request_count,
    COUNT(*) FILTER (WHERE status IN ('new', 'triaged', 'scheduled', 'in_progress')) as active_request_count,
    COUNT(*) FILTER (
      WHERE status IN ('new', 'triaged', 'scheduled', 'in_progress')
        AND assignment_status = 'pending'
        AND no_trapper_reason IS NULL
    ) as needs_trapper_count
  FROM trapper.sot_requests
  WHERE place_id IS NOT NULL
  GROUP BY place_id
) req ON req.place_id = p.place_id

-- Intake submissions
LEFT JOIN (
  SELECT
    place_id,
    COUNT(DISTINCT submission_id) as intake_count
  FROM trapper.web_intake_submissions
  WHERE place_id IS NOT NULL
  GROUP BY place_id
) intake ON intake.place_id = p.place_id

-- Active important roles at this place (for auto-graduation)
LEFT JOIN (
  SELECT DISTINCT ppr.place_id
  FROM trapper.person_place_relationships ppr
  JOIN trapper.person_roles pr ON pr.person_id = ppr.person_id
  WHERE pr.role_status = 'active'
    AND pr.role IN ('volunteer', 'trapper', 'coordinator', 'head_trapper',
                    'ffsc_trapper', 'community_trapper', 'foster')
) active_roles ON active_roles.place_id = p.place_id

-- TNR stats
LEFT JOIN (
  SELECT
    place_id,
    total_cats_altered as total_altered,
    latest_request_date as last_alteration_at
  FROM trapper.v_place_alteration_history
) tnr ON tnr.place_id = p.place_id

WHERE p.merged_into_place_id IS NULL
  AND p.location IS NOT NULL
  -- MIG_820: Exclude empty apartment_building shell records
  AND NOT (
    p.place_kind = 'apartment_building'
    AND COALESCE(cc.cat_count, 0) = 0
    AND COALESCE(ppl.person_count, 0) = 0
    AND COALESCE(req.request_count, 0) = 0
    AND COALESCE(gme.entry_count, 0) = 0
    AND COALESCE(intake.intake_count, 0) = 0
  )
  -- MIG_822: Exclude empty unclassified co-located places
  AND NOT (
    p.parent_place_id IS NULL
    AND p.place_kind NOT IN ('apartment_building', 'apartment_unit')
    AND COALESCE(cc.cat_count, 0) = 0
    AND COALESCE(ppl.person_count, 0) = 0
    AND COALESCE(req.request_count, 0) = 0
    AND COALESCE(gme.entry_count, 0) = 0
    AND COALESCE(intake.intake_count, 0) = 0
    AND EXISTS (
      SELECT 1 FROM trapper.places p2
      WHERE p2.place_id != p.place_id
        AND p2.merged_into_place_id IS NULL
        AND p2.location IS NOT NULL
        AND ST_DWithin(p2.location, p.location, 1)
    )
  );

COMMENT ON VIEW trapper.v_map_atlas_pins IS
  'MIG_882: Added data_quality filter to exclude garbage/needs_review people from pin popups. '
  'MIG_857: needs_trapper_count for trapper status indicators. '
  'Pin tier: active (disease, cats, requests, volunteers) vs reference (history only, minimal). '
  'Use get_place_family() for cross-place data aggregation in detail views.';

-- ============================================================================
-- Phase 2: Update search_unified() with data_quality filter on PEOPLE section
-- ============================================================================

\echo ''
\echo 'Phase 2: Updating search_unified()...'

CREATE OR REPLACE FUNCTION trapper.search_unified(
    p_query TEXT,
    p_type TEXT DEFAULT NULL,
    p_limit INT DEFAULT 25,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    entity_type TEXT,
    entity_id TEXT,
    display_name TEXT,
    subtitle TEXT,
    match_strength TEXT,
    match_reason TEXT,
    score NUMERIC,
    metadata JSONB
) AS $$
DECLARE
    v_query_lower TEXT := LOWER(TRIM(p_query));
    v_query_pattern TEXT := '%' || v_query_lower || '%';
    v_query_prefix TEXT := v_query_lower || '%';
    v_tokens TEXT[];
BEGIN
    v_tokens := regexp_split_to_array(v_query_lower, '\s+');

    RETURN QUERY
    WITH ranked_results AS (
        -- ========== CATS ==========
        SELECT
            'cat'::TEXT AS entity_type,
            c.cat_id::TEXT AS entity_id,
            c.display_name,
            COALESCE(
                (SELECT 'Microchip: ' || ci.id_value
                 FROM trapper.cat_identifiers ci
                 WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
                 LIMIT 1),
                TRIM(COALESCE(c.sex, '') || ' ' || COALESCE(c.altered_status, '') || ' ' || COALESCE(c.breed, ''))
            ) AS subtitle,
            CASE
                WHEN LOWER(c.display_name) = v_query_lower THEN 100
                WHEN LOWER(c.display_name) LIKE v_query_prefix THEN 95
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) = v_query_lower
                ) THEN 98
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) LIKE v_query_prefix
                ) THEN 90
                WHEN (SELECT bool_and(LOWER(c.display_name) LIKE '%' || token || '%')
                      FROM unnest(v_tokens) AS token WHERE LENGTH(token) >= 2) THEN 75
                WHEN similarity(c.display_name, p_query) >= 0.5 THEN 60 + (similarity(c.display_name, p_query) * 30)::INT
                WHEN LOWER(c.display_name) LIKE v_query_pattern THEN 40
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) LIKE v_query_pattern
                ) THEN 35
                ELSE 0
            END AS score,
            CASE
                WHEN LOWER(c.display_name) = v_query_lower THEN 'exact_name'
                WHEN LOWER(c.display_name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN EXISTS (SELECT 1 FROM trapper.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) = v_query_lower) THEN 'exact_microchip'
                WHEN EXISTS (SELECT 1 FROM trapper.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) LIKE v_query_prefix) THEN 'prefix_microchip'
                WHEN similarity(c.display_name, p_query) >= 0.5 THEN 'similar_name'
                WHEN LOWER(c.display_name) LIKE v_query_pattern THEN 'contains_name'
                ELSE 'other'
            END AS match_reason,
            jsonb_build_object(
                'sex', c.sex,
                'altered_status', c.altered_status,
                'breed', c.breed,
                'data_source', c.data_source,
                'has_place', EXISTS (SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.cat_id = c.cat_id),
                'owner_count', (SELECT COUNT(DISTINCT trapper.canonical_person_id(pcr.person_id))
                                FROM trapper.person_cat_relationships pcr
                                WHERE pcr.cat_id = c.cat_id AND pcr.relationship_type = 'owner')
            ) AS metadata
        FROM trapper.sot_cats c
        WHERE (p_type IS NULL OR p_type = 'cat')
          AND (
              LOWER(c.display_name) LIKE v_query_pattern
              OR similarity(c.display_name, p_query) >= 0.3
              OR EXISTS (
                  SELECT 1 FROM trapper.cat_identifiers ci
                  WHERE ci.cat_id = c.cat_id
                    AND (LOWER(ci.id_value) LIKE v_query_pattern OR similarity(ci.id_value, p_query) >= 0.4)
              )
          )

        UNION ALL

        -- ========== PEOPLE (with alias search) ==========
        -- MIG_882: Added data_quality filter to exclude garbage/needs_review
        SELECT
            'person'::TEXT AS entity_type,
            p.person_id::TEXT AS entity_id,
            p.display_name,
            -- MIG_855: Show active roles in subtitle (e.g., "Trapper, Volunteer")
            CASE
                WHEN p.entity_type = 'site' THEN 'Site - ' || (SELECT COUNT(*) FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id)::TEXT || ' aliases'
                WHEN p.entity_type = 'unknown' THEN 'Needs Review'
                WHEN EXISTS (SELECT 1 FROM trapper.person_roles pr WHERE pr.person_id = p.person_id AND pr.role_status = 'active') THEN
                    (SELECT string_agg(INITCAP(REPLACE(pr.role, '_', ' ')), ', '
                        ORDER BY CASE pr.role
                            WHEN 'staff' THEN 1
                            WHEN 'trapper' THEN 2
                            WHEN 'foster' THEN 3
                            WHEN 'volunteer' THEN 4
                            WHEN 'caretaker' THEN 5
                            ELSE 6
                        END)
                     FROM trapper.person_roles pr
                     WHERE pr.person_id = p.person_id AND pr.role_status = 'active')
                ELSE (SELECT COUNT(*)::TEXT || ' cats' FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id)
            END AS subtitle,
            CASE
                -- Exact display_name match
                WHEN LOWER(p.display_name) = v_query_lower THEN 100
                -- Exact alias match
                WHEN EXISTS (SELECT 1 FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id AND LOWER(pa.name_raw) = v_query_lower) THEN 95
                -- Prefix display_name match
                WHEN LOWER(p.display_name) LIKE v_query_prefix THEN 90
                -- Prefix alias match
                WHEN EXISTS (SELECT 1 FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id AND LOWER(pa.name_raw) LIKE v_query_prefix) THEN 85
                -- Contains in display_name
                WHEN LOWER(p.display_name) LIKE v_query_pattern THEN 70
                -- Contains in alias
                WHEN EXISTS (SELECT 1 FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id AND LOWER(pa.name_raw) LIKE v_query_pattern) THEN 65
                -- Similarity on display_name
                WHEN similarity(p.display_name, p_query) >= 0.5 THEN 60 + (similarity(p.display_name, p_query) * 30)::INT
                -- Cat microchip match
                WHEN EXISTS (
                    SELECT 1 FROM trapper.person_cat_relationships pcr
                    JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id AND ci.id_type = 'microchip'
                    WHERE pcr.person_id = p.person_id AND LOWER(ci.id_value) = v_query_lower
                ) THEN 99
                ELSE 0
            END AS score,
            CASE
                WHEN LOWER(p.display_name) = v_query_lower THEN 'exact_name'
                WHEN EXISTS (SELECT 1 FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id AND LOWER(pa.name_raw) = v_query_lower) THEN 'exact_alias'
                WHEN LOWER(p.display_name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN EXISTS (SELECT 1 FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id AND LOWER(pa.name_raw) LIKE v_query_prefix) THEN 'prefix_alias'
                WHEN LOWER(p.display_name) LIKE v_query_pattern THEN 'contains_name'
                WHEN EXISTS (SELECT 1 FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id AND LOWER(pa.name_raw) LIKE v_query_pattern) THEN 'contains_alias'
                WHEN EXISTS (
                    SELECT 1 FROM trapper.person_cat_relationships pcr
                    JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id AND ci.id_type = 'microchip'
                    WHERE pcr.person_id = p.person_id AND LOWER(ci.id_value) = v_query_lower
                ) THEN 'cat_microchip'
                ELSE 'other'
            END AS match_reason,
            jsonb_build_object(
                'entity_type', p.entity_type,
                'data_source', p.data_source,
                'cat_count', (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id),
                'alias_count', (SELECT COUNT(*) FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id),
                'is_merged', p.merged_into_person_id IS NOT NULL,
                'place_count', (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id),
                'has_identifiers', EXISTS (SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id),
                -- Include matched alias if match was via alias
                'matched_alias', (SELECT pa.name_raw FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id AND LOWER(pa.name_raw) LIKE v_query_pattern LIMIT 1),
                -- Coordinates from linked place (for map navigation)
                'lat', person_loc.lat,
                'lng', person_loc.lng
            ) AS metadata
        FROM trapper.sot_people p
        LEFT JOIN LATERAL (
            SELECT ST_Y(pl2.location::geometry) AS lat, ST_X(pl2.location::geometry) AS lng
            FROM trapper.person_place_relationships ppr2
            JOIN trapper.places pl2 ON pl2.place_id = ppr2.place_id
            WHERE ppr2.person_id = p.person_id AND pl2.location IS NOT NULL
            ORDER BY
              ppr2.confidence DESC,
              CASE ppr2.source_system WHEN 'volunteerhub' THEN 1 WHEN 'atlas_ui' THEN 2 WHEN 'airtable' THEN 3 ELSE 4 END,
              CASE ppr2.role WHEN 'owner' THEN 1 WHEN 'resident' THEN 2 ELSE 3 END,
              ppr2.created_at DESC
            LIMIT 1
        ) person_loc ON true
        WHERE (p_type IS NULL OR p_type = 'person')
          AND p.merged_into_person_id IS NULL
          -- MIG_882: Exclude garbage and needs_review people from search
          AND COALESCE(p.data_quality, 'normal') NOT IN ('garbage', 'needs_review')
          AND (
              -- Match on display_name
              LOWER(p.display_name) LIKE v_query_pattern
              OR similarity(p.display_name, p_query) >= 0.3
              -- Match on alias
              OR EXISTS (
                  SELECT 1 FROM trapper.person_aliases pa
                  WHERE pa.person_id = p.person_id
                    AND (LOWER(pa.name_raw) LIKE v_query_pattern OR similarity(pa.name_raw, p_query) >= 0.4)
              )
              -- Match on cat microchip
              OR EXISTS (
                  SELECT 1 FROM trapper.person_cat_relationships pcr
                  JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id AND ci.id_type = 'microchip'
                  WHERE pcr.person_id = p.person_id
                    AND (LOWER(ci.id_value) LIKE v_query_pattern OR LOWER(ci.id_value) = v_query_lower)
              )
          )

        UNION ALL

        -- ========== PLACES ==========
        SELECT
            'place'::TEXT AS entity_type,
            pl.place_id::TEXT AS entity_id,
            COALESCE(pl.display_name, pl.formatted_address, 'Unknown Place') AS display_name,
            COALESCE(pl.formatted_address, '') AS subtitle,
            CASE
                WHEN LOWER(COALESCE(pl.display_name, '')) = v_query_lower THEN 100
                WHEN LOWER(COALESCE(pl.formatted_address, '')) = v_query_lower THEN 95
                WHEN LOWER(COALESCE(pl.display_name, '')) LIKE v_query_prefix THEN 90
                WHEN LOWER(COALESCE(pl.display_name, '')) LIKE v_query_pattern THEN 70
                WHEN LOWER(COALESCE(pl.formatted_address, '')) LIKE v_query_pattern THEN 65
                WHEN similarity(COALESCE(pl.display_name, ''), p_query) >= 0.5 THEN 60 + (similarity(pl.display_name, p_query) * 30)::INT
                ELSE 0
            END AS score,
            CASE
                WHEN LOWER(COALESCE(pl.display_name, '')) = v_query_lower THEN 'exact_name'
                WHEN LOWER(COALESCE(pl.display_name, '')) LIKE v_query_pattern THEN 'contains_name'
                WHEN LOWER(COALESCE(pl.formatted_address, '')) LIKE v_query_pattern THEN 'contains_address'
                ELSE 'other'
            END AS match_reason,
            jsonb_build_object(
                'place_kind', pl.place_kind,
                'effective_type', pl.effective_type,
                'has_activity', pl.has_trapping_activity OR pl.has_appointment_activity OR pl.has_cat_activity,
                -- Coordinates for map navigation
                'lat', CASE WHEN pl.location IS NOT NULL THEN ST_Y(pl.location::geometry) END,
                'lng', CASE WHEN pl.location IS NOT NULL THEN ST_X(pl.location::geometry) END
            ) AS metadata
        FROM trapper.places pl
        WHERE (p_type IS NULL OR p_type = 'place')
          AND pl.merged_into_place_id IS NULL
          AND (
              LOWER(COALESCE(pl.display_name, '')) LIKE v_query_pattern
              OR LOWER(COALESCE(pl.formatted_address, '')) LIKE v_query_pattern
              OR similarity(COALESCE(pl.display_name, ''), p_query) >= 0.3
          )
    )
    SELECT
        rr.entity_type,
        rr.entity_id,
        rr.display_name,
        rr.subtitle,
        CASE
            WHEN rr.score >= 90 THEN 'strong'
            WHEN rr.score >= 50 THEN 'medium'
            ELSE 'weak'
        END AS match_strength,
        rr.match_reason,
        rr.score::NUMERIC,
        rr.metadata
    FROM ranked_results rr
    WHERE rr.score > 0
    ORDER BY rr.score DESC, rr.display_name
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.search_unified IS
'Unified search across cats, people (including aliases), and places. MIG_882: Excludes people with data_quality=garbage or needs_review. MIG_855: Person subtitle shows active roles.';

-- ============================================================================
-- Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='

\echo 'People excluded from map pins by data_quality filter:'
SELECT data_quality, COUNT(*) as excluded_count
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
  AND data_quality IN ('garbage', 'needs_review')
GROUP BY data_quality ORDER BY data_quality;

\echo ''
\echo 'Search for "Gordon" should show only canonical Gordon Maxwell:'
SELECT display_name, subtitle, match_strength, score
FROM trapper.search_unified('Gordon', 'person', 10, 0)
ORDER BY score DESC;

\echo ''
\echo '=== MIG_882 Complete ==='
