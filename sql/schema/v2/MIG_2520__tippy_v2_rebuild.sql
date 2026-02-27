-- MIG_2520: Tippy V2 Rebuild
-- Date: 2026-02-26
--
-- Purpose: Rebuild Tippy infrastructure for V2 schema
--
-- Problems fixed:
--   1. comprehensive_place_lookup references wrong table names
--   2. tippy_view_catalog doesn't exist (needed for dynamic discovery)
--   3. comprehensive_* functions need V2 table/view names
--
-- V2 Schema Reference:
--   - sot.cat_place (base) / sot.cat_place_relationships (alias view)
--   - sot.person_place (base) / sot.person_place_relationships (alias view)
--   - sot.person_cat (base) / sot.person_cat_relationships (alias view)
--   - sot.cats, sot.people, sot.places
--   - ops.requests, ops.appointments

\echo ''
\echo '=============================================='
\echo '  MIG_2520: Tippy V2 Rebuild'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. FIX comprehensive_place_lookup
-- ============================================================================

\echo '1. Fixing comprehensive_place_lookup...'

CREATE OR REPLACE FUNCTION ops.comprehensive_place_lookup(p_search_term TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_results JSONB;
BEGIN
    SELECT JSONB_AGG(place_data ORDER BY (place_data->>'cat_count')::INT DESC)
    INTO v_results
    FROM (
        SELECT JSONB_BUILD_OBJECT(
            'place_id', p.place_id,
            'display_name', p.display_name,
            'address', COALESCE(a.display_address, p.display_name),
            'city', a.city,
            'place_type', p.place_type,
            'cat_count', COALESCE(cat_counts.cnt, 0),
            'request_count', COALESCE(req_counts.cnt, 0),
            'people_count', COALESCE(people_counts.cnt, 0),
            'has_active_request', EXISTS (
                SELECT 1 FROM ops.requests r
                WHERE r.place_id = p.place_id
                AND r.status NOT IN ('completed', 'cancelled')
            ),
            'colony_estimate', ce.current_estimate,
            'alteration_rate', ce.alteration_rate
        ) as place_data
        FROM sot.places p
        LEFT JOIN sot.addresses a ON a.address_id = p.sot_address_id
        LEFT JOIN LATERAL (
            SELECT COUNT(DISTINCT cp.cat_id)::INT as cnt
            FROM sot.cat_place cp
            WHERE cp.place_id = p.place_id
        ) cat_counts ON true
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::INT as cnt
            FROM ops.requests r
            WHERE r.place_id = p.place_id
        ) req_counts ON true
        LEFT JOIN LATERAL (
            SELECT COUNT(DISTINCT pp.person_id)::INT as cnt
            FROM sot.person_place pp
            WHERE pp.place_id = p.place_id
        ) people_counts ON true
        LEFT JOIN LATERAL (
            SELECT
                pce.total_count_observed as current_estimate,
                CASE
                    WHEN pce.total_count_observed > 0
                    THEN ROUND(pce.eartip_count_observed::NUMERIC / pce.total_count_observed * 100, 1)
                    ELSE NULL
                END as alteration_rate
            FROM sot.place_colony_estimates pce
            WHERE pce.place_id = p.place_id
            ORDER BY pce.observed_date DESC NULLS LAST, pce.created_at DESC
            LIMIT 1
        ) ce ON true
        WHERE p.merged_into_place_id IS NULL
            AND (
                p.display_name ILIKE '%' || p_search_term || '%'
                OR a.display_address ILIKE '%' || p_search_term || '%'
                OR a.city ILIKE '%' || p_search_term || '%'
            )
        LIMIT 20
    ) subq;

    RETURN COALESCE(v_results, '[]'::JSONB);
END;
$$;

COMMENT ON FUNCTION ops.comprehensive_place_lookup(TEXT) IS 'V2-compatible comprehensive place search with cat counts, requests, and colony estimates';

\echo '   Fixed comprehensive_place_lookup'

-- ============================================================================
-- 2. FIX comprehensive_person_lookup
-- ============================================================================

\echo ''
\echo '2. Fixing comprehensive_person_lookup...'

CREATE OR REPLACE FUNCTION ops.comprehensive_person_lookup(p_search_term TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_results JSONB;
BEGIN
    SELECT JSONB_AGG(person_data)
    INTO v_results
    FROM (
        SELECT JSONB_BUILD_OBJECT(
            'person_id', p.person_id,
            'display_name', p.display_name,
            'first_name', p.first_name,
            'last_name', p.last_name,
            'email', (
                SELECT pi.id_value FROM sot.person_identifiers pi
                WHERE pi.person_id = p.person_id
                AND pi.identifier_type = 'email'
                AND pi.confidence >= 0.5
                ORDER BY pi.is_primary DESC, pi.confidence DESC
                LIMIT 1
            ),
            'phone', (
                SELECT pi.id_value FROM sot.person_identifiers pi
                WHERE pi.person_id = p.person_id
                AND pi.identifier_type = 'phone'
                AND pi.confidence >= 0.5
                ORDER BY pi.is_primary DESC, pi.confidence DESC
                LIMIT 1
            ),
            'cat_count', COALESCE(cat_counts.cnt, 0),
            'place_count', COALESCE(place_counts.cnt, 0),
            'request_count', COALESCE(req_counts.cnt, 0),
            'is_trapper', EXISTS (
                SELECT 1 FROM ops.request_trapper_assignments rta
                WHERE rta.person_id = p.person_id
            ),
            'roles', COALESCE(roles.role_list, ARRAY[]::TEXT[])
        ) as person_data
        FROM sot.people p
        LEFT JOIN LATERAL (
            SELECT COUNT(DISTINCT pc.cat_id)::INT as cnt
            FROM sot.person_cat pc
            WHERE pc.person_id = p.person_id
        ) cat_counts ON true
        LEFT JOIN LATERAL (
            SELECT COUNT(DISTINCT pp.place_id)::INT as cnt
            FROM sot.person_place pp
            WHERE pp.person_id = p.person_id
        ) place_counts ON true
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::INT as cnt
            FROM ops.requests r
            WHERE r.requester_person_id = p.person_id
        ) req_counts ON true
        LEFT JOIN LATERAL (
            SELECT ARRAY_AGG(DISTINCT pp.role) as role_list
            FROM sot.person_place pp
            WHERE pp.person_id = p.person_id
            AND pp.role IS NOT NULL
        ) roles ON true
        WHERE p.merged_into_person_id IS NULL
            AND (
                p.display_name ILIKE '%' || p_search_term || '%'
                OR EXISTS (
                    SELECT 1 FROM sot.person_identifiers pi
                    WHERE pi.person_id = p.person_id
                    AND pi.id_value ILIKE '%' || p_search_term || '%'
                )
            )
        LIMIT 20
    ) subq;

    RETURN COALESCE(v_results, '[]'::JSONB);
END;
$$;

COMMENT ON FUNCTION ops.comprehensive_person_lookup(TEXT) IS 'V2-compatible comprehensive person search with cats, places, and requests';

\echo '   Fixed comprehensive_person_lookup'

-- ============================================================================
-- 3. FIX comprehensive_cat_lookup
-- ============================================================================

\echo ''
\echo '3. Fixing comprehensive_cat_lookup...'

CREATE OR REPLACE FUNCTION ops.comprehensive_cat_lookup(p_search_term TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_results JSONB;
BEGIN
    SELECT JSONB_AGG(cat_data)
    INTO v_results
    FROM (
        SELECT JSONB_BUILD_OBJECT(
            'cat_id', c.cat_id,
            'name', c.name,
            'display_name', COALESCE(c.display_name, c.name),
            'microchip', c.microchip,
            'sex', c.sex,
            'primary_color', c.primary_color,
            'is_altered', c.is_altered,
            'is_eartipped', c.is_eartipped,
            'deceased', c.deceased,
            'place_count', COALESCE(place_counts.cnt, 0),
            'owner_count', COALESCE(owner_counts.cnt, 0),
            'appointment_count', COALESCE(appt_counts.cnt, 0),
            'primary_place', (
                SELECT JSONB_BUILD_OBJECT(
                    'place_id', pl.place_id,
                    'display_name', pl.display_name
                )
                FROM sot.cat_place cp
                JOIN sot.places pl ON pl.place_id = cp.place_id
                WHERE cp.cat_id = c.cat_id
                AND pl.merged_into_place_id IS NULL
                ORDER BY cp.confidence DESC, cp.created_at DESC
                LIMIT 1
            ),
            'owners', (
                SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
                    'person_id', pe.person_id,
                    'display_name', pe.display_name,
                    'relationship_type', pc.relationship_type
                ))
                FROM sot.person_cat pc
                JOIN sot.people pe ON pe.person_id = pc.person_id
                WHERE pc.cat_id = c.cat_id
                AND pe.merged_into_person_id IS NULL
            )
        ) as cat_data
        FROM sot.cats c
        LEFT JOIN LATERAL (
            SELECT COUNT(DISTINCT cp.place_id)::INT as cnt
            FROM sot.cat_place cp
            WHERE cp.cat_id = c.cat_id
        ) place_counts ON true
        LEFT JOIN LATERAL (
            SELECT COUNT(DISTINCT pc.person_id)::INT as cnt
            FROM sot.person_cat pc
            WHERE pc.cat_id = c.cat_id
        ) owner_counts ON true
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::INT as cnt
            FROM ops.appointments a
            WHERE a.cat_id = c.cat_id
        ) appt_counts ON true
        WHERE c.merged_into_cat_id IS NULL
            AND (
                c.name ILIKE '%' || p_search_term || '%'
                OR c.microchip ILIKE '%' || p_search_term || '%'
                OR (c.display_name IS NOT NULL AND c.display_name ILIKE '%' || p_search_term || '%')
            )
        LIMIT 20
    ) subq;

    RETURN COALESCE(v_results, '[]'::JSONB);
END;
$$;

COMMENT ON FUNCTION ops.comprehensive_cat_lookup(TEXT) IS 'V2-compatible comprehensive cat search with places, owners, and appointments';

\echo '   Fixed comprehensive_cat_lookup'

-- ============================================================================
-- 4. CREATE tippy_view_catalog (if not exists)
-- ============================================================================

\echo ''
\echo '4. Creating tippy_view_catalog...'

CREATE TABLE IF NOT EXISTS ops.tippy_view_catalog (
    view_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    view_name TEXT NOT NULL UNIQUE,
    schema_name TEXT NOT NULL DEFAULT 'ops',
    category TEXT NOT NULL CHECK (category IN ('entity', 'stats', 'processing', 'quality', 'ecology', 'linkage')),
    description TEXT NOT NULL,
    key_columns TEXT[] DEFAULT '{}',
    filter_columns TEXT[] DEFAULT '{}',
    example_questions TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tippy_view_catalog_category ON ops.tippy_view_catalog(category);
CREATE INDEX IF NOT EXISTS idx_tippy_view_catalog_active ON ops.tippy_view_catalog(is_active) WHERE is_active = true;

\echo '   Created tippy_view_catalog table'

-- ============================================================================
-- 5. SEED tippy_view_catalog with useful V2 views
-- ============================================================================

\echo ''
\echo '5. Seeding tippy_view_catalog...'

-- Clear existing and insert fresh
DELETE FROM ops.tippy_view_catalog;

INSERT INTO ops.tippy_view_catalog (schema_name, view_name, category, description, key_columns, filter_columns, example_questions) VALUES
-- Entity views
('sot', 'v_place_detail_v2', 'entity', 'Detailed place info including address, type, and cat counts',
 ARRAY['place_id', 'display_name'], ARRAY['city', 'place_type'],
 ARRAY['What is at this address?', 'Show me place details']),

('sot', 'v_cat_detail', 'entity', 'Full cat information including status, colors, and relationships',
 ARRAY['cat_id', 'name', 'microchip'], ARRAY['sex', 'is_altered', 'primary_color'],
 ARRAY['Find cat by microchip', 'Look up cat named X']),

('sot', 'v_person_detail', 'entity', 'Person information with identifiers and roles',
 ARRAY['person_id', 'display_name'], ARRAY['city'],
 ARRAY['Find person by name', 'Look up contact info']),

-- Stats views
('ops', 'v_beacon_summary', 'stats', 'Overall TNR statistics and impact metrics',
 ARRAY['metric'], ARRAY['time_period'],
 ARRAY['What are our total numbers?', 'How many cats have we helped?']),

('ops', 'v_trapper_full_stats', 'stats', 'Trapper performance statistics',
 ARRAY['person_id', 'display_name'], ARRAY['trapper_type'],
 ARRAY['How many cats has X trapped?', 'Top trappers']),

('ops', 'v_request_list', 'stats', 'Request overview with status and progress',
 ARRAY['request_id'], ARRAY['status', 'city', 'priority'],
 ARRAY['Active requests in X area', 'Pending requests']),

-- Ecology views
('sot', 'v_place_colony_status', 'ecology', 'Colony size estimates and alteration rates',
 ARRAY['place_id'], ARRAY['city'],
 ARRAY['Colony status at X', 'Alteration rate at location']),

('ops', 'v_colony_stats', 'ecology', 'Colony statistics aggregated by area',
 ARRAY['city'], ARRAY['place_type'],
 ARRAY['Colonies in X city', 'Colony overview']),

-- Quality views
('sot', 'v_cat_quality', 'quality', 'Data quality scores for cats',
 ARRAY['cat_id'], ARRAY['quality_tier'],
 ARRAY['Cats needing data cleanup', 'Low quality cat records']),

('ops', 'v_processing_dashboard', 'processing', 'Data processing job status',
 ARRAY['job_type'], ARRAY['status'],
 ARRAY['Processing status', 'Pending jobs']),

-- Linkage views
('ops', 'v_active_requests', 'linkage', 'Active requests with trappers and progress',
 ARRAY['request_id'], ARRAY['status', 'city'],
 ARRAY['Who is assigned to X request?', 'Request progress']),

('ops', 'v_active_trappers', 'linkage', 'Currently active trappers',
 ARRAY['person_id'], ARRAY['trapper_type'],
 ARRAY['List active trappers', 'Trapper availability'])

ON CONFLICT (view_name) DO UPDATE SET
    description = EXCLUDED.description,
    key_columns = EXCLUDED.key_columns,
    filter_columns = EXCLUDED.filter_columns,
    example_questions = EXCLUDED.example_questions,
    updated_at = NOW();

\echo '   Seeded tippy_view_catalog with V2 views'

-- ============================================================================
-- 6. CREATE tippy_discover_schema function
-- ============================================================================

\echo ''
\echo '6. Creating tippy_discover_schema function...'

CREATE OR REPLACE FUNCTION ops.tippy_discover_schema(
    p_category TEXT DEFAULT NULL,
    p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
    view_name TEXT,
    schema_name TEXT,
    category TEXT,
    description TEXT,
    key_columns TEXT[],
    filter_columns TEXT[],
    example_questions TEXT[]
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        tvc.view_name,
        tvc.schema_name,
        tvc.category,
        tvc.description,
        tvc.key_columns,
        tvc.filter_columns,
        tvc.example_questions
    FROM ops.tippy_view_catalog tvc
    WHERE tvc.is_active = true
        AND (p_category IS NULL OR tvc.category = p_category)
        AND (
            p_search IS NULL
            OR tvc.view_name ILIKE '%' || p_search || '%'
            OR tvc.description ILIKE '%' || p_search || '%'
            OR EXISTS (
                SELECT 1 FROM unnest(tvc.example_questions) eq
                WHERE eq ILIKE '%' || p_search || '%'
            )
        )
    ORDER BY tvc.category, tvc.view_name;
END;
$$;

COMMENT ON FUNCTION ops.tippy_discover_schema(TEXT, TEXT) IS 'Discover available views by category or search term for Tippy';

\echo '   Created tippy_discover_schema function'

-- ============================================================================
-- 7. CREATE tippy_query_view function
-- ============================================================================

\echo ''
\echo '7. Creating tippy_query_view function...'

CREATE OR REPLACE FUNCTION ops.tippy_query_view(
    p_view_name TEXT,
    p_filters JSONB DEFAULT '[]',
    p_limit INT DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_schema TEXT;
    v_sql TEXT;
    v_filter JSONB;
    v_where_clauses TEXT[] := ARRAY[]::TEXT[];
    v_result JSONB;
BEGIN
    -- Get schema from catalog
    SELECT tvc.schema_name INTO v_schema
    FROM ops.tippy_view_catalog tvc
    WHERE tvc.view_name = p_view_name AND tvc.is_active = true;

    IF v_schema IS NULL THEN
        RETURN JSONB_BUILD_OBJECT('error', 'View not found in catalog: ' || p_view_name);
    END IF;

    -- Build WHERE clauses from filters
    FOR v_filter IN SELECT * FROM jsonb_array_elements(p_filters)
    LOOP
        v_where_clauses := v_where_clauses || (
            format('%I %s %L',
                v_filter->>'column_name',
                COALESCE(v_filter->>'operator', '='),
                v_filter->>'value'
            )
        );
    END LOOP;

    -- Build query
    v_sql := format('SELECT JSONB_AGG(row_to_json(t)) FROM (SELECT * FROM %I.%I', v_schema, p_view_name);

    IF array_length(v_where_clauses, 1) > 0 THEN
        v_sql := v_sql || ' WHERE ' || array_to_string(v_where_clauses, ' AND ');
    END IF;

    v_sql := v_sql || format(' LIMIT %s) t', LEAST(p_limit, 200));

    EXECUTE v_sql INTO v_result;

    RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

COMMENT ON FUNCTION ops.tippy_query_view(TEXT, JSONB, INT) IS 'Execute a query against a cataloged view for Tippy';

\echo '   Created tippy_query_view function'

-- ============================================================================
-- 8. CREATE simple helper functions for common Tippy queries
-- ============================================================================

\echo ''
\echo '8. Creating helper functions...'

-- Count cats at place
CREATE OR REPLACE FUNCTION ops.tippy_cats_at_place(p_place_id UUID)
RETURNS TABLE (
    total_cats BIGINT,
    altered_cats BIGINT,
    eartipped_cats BIGINT,
    unaltered_cats BIGINT
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        COUNT(DISTINCT c.cat_id) as total_cats,
        COUNT(DISTINCT c.cat_id) FILTER (WHERE c.is_altered = true) as altered_cats,
        COUNT(DISTINCT c.cat_id) FILTER (WHERE c.is_eartipped = true) as eartipped_cats,
        COUNT(DISTINCT c.cat_id) FILTER (WHERE c.is_altered IS NOT TRUE) as unaltered_cats
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE cp.place_id = p_place_id;
$$;

-- Get colony estimate for place
CREATE OR REPLACE FUNCTION ops.tippy_colony_estimate(p_place_id UUID)
RETURNS TABLE (
    current_estimate INT,
    alteration_rate NUMERIC,
    observation_date DATE,
    estimate_method TEXT
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        pce.total_count_observed::INT,
        CASE
            WHEN pce.total_count_observed > 0
            THEN ROUND(pce.eartip_count_observed::NUMERIC / pce.total_count_observed * 100, 1)
            ELSE NULL
        END,
        pce.observed_date,
        pce.estimate_method
    FROM sot.place_colony_estimates pce
    WHERE pce.place_id = p_place_id
    ORDER BY pce.observed_date DESC NULLS LAST, pce.created_at DESC
    LIMIT 1;
$$;

-- Regional stats
CREATE OR REPLACE FUNCTION ops.tippy_region_stats(p_region TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_cities TEXT[];
    v_result JSONB;
BEGIN
    -- Expand regional names to cities
    v_cities := CASE LOWER(p_region)
        WHEN 'west county' THEN ARRAY['Sebastopol', 'Forestville', 'Guerneville', 'Monte Rio', 'Occidental', 'Bodega Bay', 'Jenner', 'Cazadero', 'Camp Meeker', 'Graton', 'Freestone']
        WHEN 'russian river' THEN ARRAY['Guerneville', 'Monte Rio', 'Rio Nido', 'Forestville', 'Cazadero', 'Duncans Mills', 'Jenner']
        WHEN 'north county' THEN ARRAY['Healdsburg', 'Windsor', 'Geyserville', 'Cloverdale']
        WHEN 'south county' THEN ARRAY['Petaluma', 'Cotati', 'Penngrove', 'Two Rock']
        WHEN 'sonoma valley' THEN ARRAY['Sonoma', 'Glen Ellen', 'Kenwood', 'Boyes Hot Springs']
        ELSE ARRAY[p_region]  -- Treat as single city
    END;

    SELECT JSONB_BUILD_OBJECT(
        'region', p_region,
        'cities', v_cities,
        'total_places', (
            SELECT COUNT(*) FROM sot.places p
            JOIN sot.addresses a ON a.address_id = p.sot_address_id
            WHERE a.city = ANY(v_cities) AND p.merged_into_place_id IS NULL
        ),
        'total_cats_altered', (
            SELECT COUNT(DISTINCT c.cat_id)
            FROM sot.cats c
            JOIN sot.cat_place cp ON cp.cat_id = c.cat_id
            JOIN sot.places p ON p.place_id = cp.place_id
            JOIN sot.addresses a ON a.address_id = p.sot_address_id
            WHERE a.city = ANY(v_cities)
            AND c.is_altered = true
            AND c.merged_into_cat_id IS NULL
            AND p.merged_into_place_id IS NULL
        ),
        'active_requests', (
            SELECT COUNT(*)
            FROM ops.requests r
            JOIN sot.places p ON p.place_id = r.place_id
            JOIN sot.addresses a ON a.address_id = p.sot_address_id
            WHERE a.city = ANY(v_cities)
            AND r.status NOT IN ('completed', 'cancelled')
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION ops.tippy_region_stats(TEXT) IS 'Get regional TNR statistics for Tippy';

\echo '   Created helper functions'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Testing comprehensive_place_lookup...'
SELECT jsonb_pretty(ops.comprehensive_place_lookup('bodega')) as test_place;

\echo ''
\echo 'Testing tippy_discover_schema...'
SELECT * FROM ops.tippy_discover_schema('entity') LIMIT 3;

\echo ''
\echo 'View catalog contents:'
SELECT category, COUNT(*) as view_count
FROM ops.tippy_view_catalog
WHERE is_active = true
GROUP BY category;

\echo ''
\echo '=============================================='
\echo '  MIG_2520 Complete!'
\echo '=============================================='
\echo ''
\echo 'Tippy V2 infrastructure rebuilt:'
\echo '  - ops.comprehensive_place_lookup (fixed for V2 schema)'
\echo '  - ops.comprehensive_person_lookup (fixed for V2 schema)'
\echo '  - ops.comprehensive_cat_lookup (fixed for V2 schema)'
\echo '  - ops.tippy_view_catalog (created and seeded)'
\echo '  - ops.tippy_discover_schema (dynamic view discovery)'
\echo '  - ops.tippy_query_view (dynamic view queries)'
\echo '  - ops.tippy_cats_at_place (helper)'
\echo '  - ops.tippy_colony_estimate (helper)'
\echo '  - ops.tippy_region_stats (helper)'
\echo ''
