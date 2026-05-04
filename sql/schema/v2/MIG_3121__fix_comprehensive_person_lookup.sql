-- MIG_3121: Fix comprehensive_person_lookup — wrong column names
-- id_value → id_value_raw, identifier_type → id_type, is_primary → (removed), role → relationship_type
-- This function has been broken since creation — Tippy person lookups always errored.

CREATE OR REPLACE FUNCTION ops.comprehensive_person_lookup(p_search_term text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $function$
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
                SELECT pi.id_value_raw FROM sot.person_identifiers pi
                WHERE pi.person_id = p.person_id
                AND pi.id_type = 'email'
                AND pi.confidence >= 0.5
                ORDER BY pi.confidence DESC
                LIMIT 1
            ),
            'phone', (
                SELECT pi.id_value_raw FROM sot.person_identifiers pi
                WHERE pi.person_id = p.person_id
                AND pi.id_type = 'phone'
                AND pi.confidence >= 0.5
                ORDER BY pi.confidence DESC
                LIMIT 1
            ),
            'cat_count', COALESCE(cat_counts.cnt, 0),
            'place_count', COALESCE(place_counts.cnt, 0),
            'request_count', COALESCE(req_counts.cnt, 0),
            'is_trapper', EXISTS (
                SELECT 1 FROM ops.request_trapper_assignments rta
                WHERE rta.trapper_person_id = p.person_id
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
            SELECT ARRAY_AGG(DISTINCT pp.relationship_type) as role_list
            FROM sot.person_place pp
            WHERE pp.person_id = p.person_id
            AND pp.relationship_type IS NOT NULL
        ) roles ON true
        WHERE p.merged_into_person_id IS NULL
            AND (
                p.display_name ILIKE '%' || p_search_term || '%'
                OR EXISTS (
                    SELECT 1 FROM sot.person_identifiers pi
                    WHERE pi.person_id = p.person_id
                    AND (pi.id_value_raw ILIKE '%' || p_search_term || '%'
                         OR pi.id_value_norm ILIKE '%' || p_search_term || '%')
                )
            )
        LIMIT 20
    ) subq;

    RETURN COALESCE(v_results, '[]'::JSONB);
END;
$function$;

-- Also fix the 2-arg version (drop first to avoid param default issues)
DROP FUNCTION IF EXISTS ops.comprehensive_person_lookup(text, jsonb);
CREATE FUNCTION ops.comprehensive_person_lookup(p_search_term text, p_options jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $function$
BEGIN
    RETURN ops.comprehensive_person_lookup(p_search_term);
END;
$function$;

-- Verify
DO $$
DECLARE
    result JSONB;
BEGIN
    SELECT ops.comprehensive_person_lookup('Sheila Aguilar'::text) INTO result;
    IF result IS NOT NULL AND jsonb_array_length(result) > 0 THEN
        RAISE NOTICE 'MIG_3121: OK — found % result(s) for Sheila Aguilar', jsonb_array_length(result);
    ELSE
        RAISE WARNING 'MIG_3121: No results for Sheila Aguilar — check if person exists';
    END IF;
END $$;
