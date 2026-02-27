-- MIG_2521: Tippy V2 Column Name Fixes
-- Date: 2026-02-26
--
-- Purpose: Fix column name mismatches from MIG_2520
-- V2 uses different column names than V1:
--   - sot.cats: ear_tip (not is_eartipped), altered_status (not is_altered), is_deceased (not deceased)
--   - sot.places: place_kind (not place_type)

\echo ''
\echo '=============================================='
\echo '  MIG_2521: Tippy V2 Column Name Fixes'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. FIX comprehensive_place_lookup
-- ============================================================================

\echo '1. Fixing comprehensive_place_lookup column names...'

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
            'place_kind', p.place_kind,
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

\echo '   Fixed comprehensive_place_lookup'

-- ============================================================================
-- 2. FIX comprehensive_cat_lookup
-- ============================================================================

\echo ''
\echo '2. Fixing comprehensive_cat_lookup column names...'

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
            'altered_status', c.altered_status,
            'ear_tip', c.ear_tip,
            'is_deceased', c.is_deceased,
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

\echo '   Fixed comprehensive_cat_lookup'

-- ============================================================================
-- 3. FIX tippy_cats_at_place
-- ============================================================================

\echo ''
\echo '3. Fixing tippy_cats_at_place column names...'

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
        COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered')) as altered_cats,
        COUNT(DISTINCT c.cat_id) FILTER (WHERE c.ear_tip IS NOT NULL AND c.ear_tip != 'none') as eartipped_cats,
        COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IS NULL OR c.altered_status = 'intact') as unaltered_cats
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE cp.place_id = p_place_id;
$$;

\echo '   Fixed tippy_cats_at_place'

-- ============================================================================
-- 4. FIX tippy_region_stats
-- ============================================================================

\echo ''
\echo '4. Fixing tippy_region_stats column names...'

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
            AND c.altered_status IN ('spayed', 'neutered', 'altered')
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

\echo '   Fixed tippy_region_stats'

-- ============================================================================
-- 5. Update tippy_view_catalog filter columns
-- ============================================================================

\echo ''
\echo '5. Updating tippy_view_catalog with correct column names...'

UPDATE ops.tippy_view_catalog
SET filter_columns = ARRAY['city', 'place_kind']
WHERE view_name = 'v_place_detail_v2';

UPDATE ops.tippy_view_catalog
SET filter_columns = ARRAY['sex', 'altered_status', 'primary_color']
WHERE view_name = 'v_cat_detail';

\echo '   Updated tippy_view_catalog'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Testing comprehensive_place_lookup...'
SELECT jsonb_pretty(ops.comprehensive_place_lookup('bodega')) as place_results;

\echo ''
\echo 'Testing comprehensive_cat_lookup...'
SELECT jsonb_pretty(ops.comprehensive_cat_lookup('whiskers')) as cat_results;

\echo ''
\echo 'Testing tippy_region_stats...'
SELECT jsonb_pretty(ops.tippy_region_stats('west county')) as region_results;

\echo ''
\echo '=============================================='
\echo '  MIG_2521 Complete!'
\echo '=============================================='
\echo ''
