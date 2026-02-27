-- MIG_2529: Tippy Strategic Analysis
-- Date: 2026-02-26
--
-- Purpose: Enable strategic reasoning about resource allocation, worst-affected areas,
-- and multi-dimensional analysis with appropriate caveats about data limitations.

\echo ''
\echo '=============================================='
\echo '  MIG_2529: Tippy Strategic Analysis'
\echo '=============================================='
\echo ''

-- City-level metrics with TNR coverage analysis
CREATE OR REPLACE FUNCTION ops.tippy_city_analysis()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT JSONB_AGG(city_data ORDER BY (city_data->>'unaltered_cats')::INT DESC NULLS LAST)
    INTO v_result
    FROM (
        SELECT JSONB_BUILD_OBJECT(
            'city', a.city,
            'total_places', COUNT(DISTINCT p.place_id),
            'places_with_cats', COUNT(DISTINCT p.place_id) FILTER (WHERE cat_stats.cat_count > 0),
            'total_cats', COALESCE(SUM(cat_stats.cat_count), 0),
            'altered_cats', COALESCE(SUM(cat_stats.altered_count), 0),
            'unaltered_cats', COALESCE(SUM(cat_stats.unaltered_count), 0),
            'alteration_rate', ROUND(
                COALESCE(SUM(cat_stats.altered_count), 0)::NUMERIC
                / NULLIF(COALESCE(SUM(cat_stats.cat_count), 0), 0) * 100, 1
            ),
            'active_requests', COUNT(DISTINCT r.request_id) FILTER (WHERE r.status NOT IN ('completed', 'cancelled')),
            'completed_requests', COUNT(DISTINCT r.request_id) FILTER (WHERE r.status = 'completed'),
            'total_requests', COUNT(DISTINCT r.request_id),
            -- Coverage metrics
            'coverage_score', ROUND(
                COALESCE(SUM(cat_stats.altered_count), 0)::NUMERIC
                / NULLIF(COALESCE(SUM(cat_stats.cat_count), 0) +
                         COUNT(DISTINCT r.request_id) FILTER (WHERE r.status NOT IN ('completed', 'cancelled')) * 5, 0) * 100, 1
            ),
            -- Demographics if available
            'median_income', (
                SELECT ROUND(AVG(d.median_income), 0)
                FROM ops.sonoma_zip_demographics d
                WHERE d.city ILIKE a.city
            ),
            'rural_classification', (
                SELECT STRING_AGG(DISTINCT d.rural_classification, ', ')
                FROM ops.sonoma_zip_demographics d
                WHERE d.city ILIKE a.city
            )
        ) as city_data
        FROM sot.places p
        JOIN sot.addresses a ON a.address_id = p.sot_address_id
        LEFT JOIN ops.requests r ON r.place_id = p.place_id
        LEFT JOIN LATERAL (
            SELECT
                COUNT(DISTINCT c.cat_id) as cat_count,
                COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered')) as altered_count,
                COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IS NULL OR c.altered_status = 'intact') as unaltered_count
            FROM sot.cat_place cp
            JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
            WHERE cp.place_id = p.place_id
        ) cat_stats ON true
        WHERE p.merged_into_place_id IS NULL
        AND a.city IS NOT NULL
        GROUP BY a.city
        HAVING COUNT(DISTINCT p.place_id) > 0
    ) subq;

    RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

-- Strategic resource allocation analysis
CREATE OR REPLACE FUNCTION ops.tippy_strategic_analysis(p_question TEXT DEFAULT 'overview')
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_city_data JSONB;
    v_worst_city JSONB;
    v_underserved JSONB;
    v_hot_spots JSONB;
    v_result JSONB;
BEGIN
    -- Get city-level data
    v_city_data := ops.tippy_city_analysis();

    -- Find city with worst problem (most unaltered cats)
    SELECT city_data INTO v_worst_city
    FROM jsonb_array_elements(v_city_data) as city_data
    WHERE (city_data->>'total_cats')::INT > 0
    ORDER BY (city_data->>'unaltered_cats')::INT DESC
    LIMIT 1;

    -- Find potentially underserved areas (low request count but nearby cities have high cat counts)
    SELECT JSONB_AGG(city_data) INTO v_underserved
    FROM jsonb_array_elements(v_city_data) as city_data
    WHERE (city_data->>'total_requests')::INT < 3
    AND (city_data->>'total_places')::INT > 5;

    -- Find cities needing immediate attention (low alteration rate, active unaltered cats)
    SELECT JSONB_AGG(city_data ORDER BY (city_data->>'unaltered_cats')::INT DESC) INTO v_hot_spots
    FROM jsonb_array_elements(v_city_data) as city_data
    WHERE (city_data->>'alteration_rate')::NUMERIC < 70
    AND (city_data->>'unaltered_cats')::INT > 5;

    RETURN JSONB_BUILD_OBJECT(
        'analysis_type', p_question,
        'generated_at', NOW(),
        'city_rankings', v_city_data,
        'worst_affected', v_worst_city,
        'underserved_areas', v_underserved,
        'needs_immediate_attention', v_hot_spots,
        'data_caveats', ARRAY[
            'Data reflects only cats we have recorded through clinic visits and requests',
            'Low numbers in a city may indicate lack of outreach rather than lack of cats',
            'Alteration rates are based on KNOWN cats - actual colony sizes may be larger',
            'Cities with zero data should not be assumed cat-free - they may be unserved',
            'Economic data may be incomplete - use median_income with caution'
        ],
        'interpretation_guidance', JSONB_BUILD_OBJECT(
            'worst_city_meaning', 'Most KNOWN unaltered cats, but cities with zero data may actually be worse',
            'underserved_meaning', 'Few requests despite having places - possible outreach gap',
            'coverage_score', '100 = all known cats altered, <50 = significant work remaining',
            'economic_context', 'Lower income areas may have less access to TNR resources'
        )
    );
END;
$$;

-- Compare two addresses or places
CREATE OR REPLACE FUNCTION ops.tippy_compare_places(p_address1 TEXT, p_address2 TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_place1 JSONB;
    v_place2 JSONB;
    v_comparison JSONB;
BEGIN
    -- Get full reports for both
    v_place1 := ops.tippy_place_full_report(p_address1);
    v_place2 := ops.tippy_place_full_report(p_address2);

    -- Build comparison
    RETURN JSONB_BUILD_OBJECT(
        'place1', JSONB_BUILD_OBJECT(
            'address', COALESCE(v_place1->'place'->>'display_name', p_address1),
            'found', v_place1->>'found',
            'total_cats', v_place1->'cat_statistics'->>'total_cats',
            'altered_cats', v_place1->'cat_statistics'->>'altered_cats',
            'alteration_rate', v_place1->'cat_statistics'->>'alteration_rate',
            'status', v_place1->>'status_assessment',
            'people_count', JSONB_ARRAY_LENGTH(v_place1->'people'),
            'disease_tests', JSONB_ARRAY_LENGTH(v_place1->'disease_testing'),
            'active_requests', v_place1->'request_history'->>'active'
        ),
        'place2', JSONB_BUILD_OBJECT(
            'address', COALESCE(v_place2->'place'->>'display_name', p_address2),
            'found', v_place2->>'found',
            'total_cats', v_place2->'cat_statistics'->>'total_cats',
            'altered_cats', v_place2->'cat_statistics'->>'altered_cats',
            'alteration_rate', v_place2->'cat_statistics'->>'alteration_rate',
            'status', v_place2->>'status_assessment',
            'people_count', JSONB_ARRAY_LENGTH(v_place2->'people'),
            'disease_tests', JSONB_ARRAY_LENGTH(v_place2->'disease_testing'),
            'active_requests', v_place2->'request_history'->>'active'
        ),
        'comparison', JSONB_BUILD_OBJECT(
            'more_cats', CASE
                WHEN (v_place1->'cat_statistics'->>'total_cats')::INT > (v_place2->'cat_statistics'->>'total_cats')::INT
                THEN p_address1 ELSE p_address2 END,
            'better_alteration_rate', CASE
                WHEN COALESCE((v_place1->'cat_statistics'->>'alteration_rate')::NUMERIC, 0) >
                     COALESCE((v_place2->'cat_statistics'->>'alteration_rate')::NUMERIC, 0)
                THEN p_address1 ELSE p_address2 END,
            'more_urgent', CASE
                WHEN (v_place1->'cat_statistics'->>'unaltered_cats')::INT > (v_place2->'cat_statistics'->>'unaltered_cats')::INT
                THEN p_address1 ELSE p_address2 END,
            'needs_more_work', CASE
                WHEN COALESCE((v_place1->'cat_statistics'->>'alteration_rate')::NUMERIC, 100) <
                     COALESCE((v_place2->'cat_statistics'->>'alteration_rate')::NUMERIC, 100)
                THEN p_address1 ELSE p_address2 END
        ),
        'recommendation', CASE
            WHEN (v_place1->'cat_statistics'->>'unaltered_cats')::INT > 10
                 AND (v_place1->'cat_statistics'->>'unaltered_cats')::INT > (v_place2->'cat_statistics'->>'unaltered_cats')::INT
            THEN 'Prioritize ' || p_address1 || ' - more unaltered cats needing TNR'
            WHEN (v_place2->'cat_statistics'->>'unaltered_cats')::INT > 10
            THEN 'Prioritize ' || p_address2 || ' - more unaltered cats needing TNR'
            WHEN COALESCE((v_place1->'cat_statistics'->>'alteration_rate')::NUMERIC, 100) < 70
            THEN p_address1 || ' needs continued attention - below 70% alteration threshold'
            WHEN COALESCE((v_place2->'cat_statistics'->>'alteration_rate')::NUMERIC, 100) < 70
            THEN p_address2 || ' needs continued attention - below 70% alteration threshold'
            ELSE 'Both locations appear stable or have minimal known cat activity'
        END
    );
END;
$$;

COMMENT ON FUNCTION ops.tippy_city_analysis() IS
'Aggregates TNR metrics by city for strategic analysis';

COMMENT ON FUNCTION ops.tippy_strategic_analysis(TEXT) IS
'Strategic analysis with caveats about data limitations, underserved areas, and resource allocation guidance';

COMMENT ON FUNCTION ops.tippy_compare_places(TEXT, TEXT) IS
'Multi-dimensional comparison of two addresses';

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Test 1: City analysis top 5...'
SELECT
    city_data->>'city' as city,
    city_data->>'total_cats' as cats,
    city_data->>'alteration_rate' as rate,
    city_data->>'unaltered_cats' as unaltered
FROM jsonb_array_elements(ops.tippy_city_analysis()) as city_data
LIMIT 5;

\echo ''
\echo 'Test 2: Strategic analysis caveats...'
SELECT jsonb_array_length(ops.tippy_strategic_analysis()->'data_caveats') as num_caveats;

\echo ''
\echo '=============================================='
\echo '  MIG_2529 Complete!'
\echo '=============================================='
