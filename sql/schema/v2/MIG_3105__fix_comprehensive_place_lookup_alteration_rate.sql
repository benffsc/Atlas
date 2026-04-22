-- MIG_3105: Fix comprehensive_place_lookup alteration rate calculation
--
-- BUG: alteration_rate was computed from place_colony_estimates.eartip_count_observed
-- which is a stale colony observation count, NOT the actual verified cat altered_status.
-- This caused Tippy to report 0% for places with 100% altered cats.
--
-- FIX: Compute alteration rate directly from sot.cats.altered_status, same approach
-- as ops.tippy_place_full_report() which gets it right.
--
-- Example failure: 1209 Trombetta St (33 cats, 33 altered = 100%) was reported as 0%.

CREATE OR REPLACE FUNCTION ops.comprehensive_place_lookup(p_search_term text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
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
            'cat_count', COALESCE(cat_stats.total_cats, 0),
            'altered_cats', COALESCE(cat_stats.altered_cats, 0),
            'intact_confirmed', COALESCE(cat_stats.intact_confirmed, 0),
            'null_status_count', COALESCE(cat_stats.null_status_count, 0),
            'request_count', COALESCE(req_counts.cnt, 0),
            'people_count', COALESCE(people_counts.cnt, 0),
            'has_active_request', EXISTS (
                SELECT 1 FROM ops.requests r
                WHERE r.place_id = p.place_id
                AND r.status NOT IN ('completed', 'cancelled')
            ),
            'colony_estimate', ce.current_estimate,
            -- Compute alteration rate from actual cat records, NOT colony estimates
            'alteration_rate', CASE
                WHEN COALESCE(cat_stats.total_cats, 0) > 0
                THEN ROUND(COALESCE(cat_stats.altered_cats, 0)::NUMERIC / cat_stats.total_cats * 100, 1)
                ELSE NULL
            END
        ) as place_data
        FROM sot.places p
        LEFT JOIN sot.addresses a ON a.address_id = p.sot_address_id
        -- Actual cat alteration stats from sot.cats
        LEFT JOIN LATERAL (
            SELECT
                COUNT(DISTINCT c.cat_id)::INT as total_cats,
                COUNT(DISTINCT c.cat_id) FILTER (
                    WHERE c.altered_status IN ('spayed', 'neutered', 'altered', 'Yes')
                )::INT as altered_cats,
                COUNT(DISTINCT c.cat_id) FILTER (
                    WHERE c.altered_status IN ('intact', 'No')
                )::INT as intact_confirmed,
                COUNT(DISTINCT c.cat_id) FILTER (
                    WHERE c.altered_status IS NULL
                       OR c.altered_status NOT IN ('spayed', 'neutered', 'altered', 'Yes', 'intact', 'No')
                )::INT as null_status_count
            FROM sot.cat_place cp
            JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
            WHERE cp.place_id = p.place_id
        ) cat_stats ON true
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
            SELECT pce.total_count_observed as current_estimate
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
$function$;
