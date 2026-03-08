-- MIG_2874__enrich_search_metadata.sql
-- Add activity signals to search metadata JSONB
--
-- Adds last_appointment_date, appointment_count, and request_count to
-- sot.search_unified() metadata so the UI can show activity signals
-- (recency dots, visit counts) directly in search results.
--
-- Same 4-param signature, same return type. Only metadata JSONB contents change.
-- Created: 2026-03-08

\echo ''
\echo '=============================================='
\echo '  MIG_2874: Enrich Search Metadata'
\echo '=============================================='
\echo ''

CREATE OR REPLACE FUNCTION sot.search_unified(
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
                                WHERE pcr.cat_id = c.cat_id AND pcr.relationship_type = 'owner'),
                'last_appointment_date', (SELECT MAX(a.appointment_date)::TEXT FROM ops.appointments a WHERE a.cat_id = c.cat_id),
                'appointment_count', (SELECT COUNT(*) FROM ops.appointments a WHERE a.cat_id = c.cat_id)
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

        -- ========== PEOPLE ==========
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
            CASE
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
            AS score,
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
                'is_merged', p.merged_into_person_id IS NOT NULL,
                'last_appointment_date', (SELECT MAX(a.appointment_date)::TEXT FROM ops.appointments a WHERE a.person_id = p.person_id),
                'request_count', (SELECT COUNT(*) FROM ops.requests r WHERE r.requester_person_id = p.person_id AND r.merged_into_request_id IS NULL)
            ) AS metadata
        FROM sot.people p
        WHERE p.merged_into_person_id IS NULL
          AND COALESCE(p.data_quality, 'normal') NOT IN ('garbage', 'needs_review')
          AND (p_type IS NULL OR p_type = 'person')
          AND (
              LOWER(p.display_name) LIKE v_query_pattern
              OR similarity(p.display_name, p_query) >= 0.3
          )

        UNION ALL

        -- ========== PLACES (with clinic account alias matching) ==========
        SELECT
            'place'::TEXT AS entity_type,
            pl.place_id::TEXT AS entity_id,
            pl.display_name,
            CASE
                WHEN ca.display_name IS NOT NULL
                     AND (LOWER(ca.display_name) LIKE v_query_pattern
                          OR LOWER(ca.display_name) LIKE v_expanded_pattern
                          OR similarity(ca.display_name, p_query) >= 0.3)
                THEN 'Also known as: ' || ca.display_name || ' - ' || COALESCE(sa.city, '')
                ELSE COALESCE(pl.place_kind::TEXT, 'place') || ' - ' || COALESCE(sa.city, '')
            END AS subtitle,
            GREATEST(
                CASE
                    WHEN LOWER(pl.display_name) = v_query_lower THEN 100
                    WHEN LOWER(pl.formatted_address) = v_query_lower THEN 99
                    WHEN LOWER(pl.display_name) = v_query_expanded THEN 98
                    WHEN LOWER(pl.formatted_address) = v_query_expanded THEN 97
                    WHEN LOWER(pl.display_name) LIKE v_query_prefix THEN 95
                    WHEN LOWER(pl.formatted_address) LIKE v_query_prefix THEN 92
                    WHEN (
                        SELECT bool_and(
                            LOWER(COALESCE(pl.display_name, '') || ' ' || COALESCE(pl.formatted_address, '')) LIKE '%' || token || '%'
                        )
                        FROM unnest(v_tokens) AS token
                        WHERE LENGTH(token) >= 2
                    ) THEN 75
                    WHEN similarity(pl.display_name, p_query) >= 0.5 THEN 60 + (similarity(pl.display_name, p_query) * 30)::INT
                    WHEN similarity(pl.formatted_address, p_query) >= 0.5 THEN 55 + (similarity(pl.formatted_address, p_query) * 30)::INT
                    WHEN LOWER(pl.formatted_address) LIKE v_expanded_pattern THEN 50
                    WHEN LOWER(pl.display_name) LIKE v_query_pattern THEN 40
                    WHEN LOWER(pl.formatted_address) LIKE v_query_pattern THEN 35
                    WHEN LOWER(sa.city) LIKE v_query_pattern THEN 30
                    ELSE 0
                END,
                CASE
                    WHEN ca.display_name IS NOT NULL AND LOWER(ca.display_name) = v_query_lower
                        THEN 100 + LEAST(COALESCE(ca.appointment_count, 0), 20)
                    WHEN ca.display_name IS NOT NULL AND LOWER(ca.display_name) = v_query_expanded
                        THEN 98 + LEAST(COALESCE(ca.appointment_count, 0), 18)
                    WHEN ca.display_name IS NOT NULL AND LOWER(ca.display_name) LIKE v_query_prefix
                        THEN 95 + LEAST(COALESCE(ca.appointment_count, 0), 15)
                    WHEN ca.display_name IS NOT NULL AND similarity(ca.display_name, p_query) >= 0.5
                        THEN 60 + (similarity(ca.display_name, p_query) * 30)::INT + LEAST(COALESCE(ca.appointment_count, 0), 10)
                    WHEN ca.display_name IS NOT NULL AND LOWER(ca.display_name) LIKE v_query_pattern
                        THEN 40 + LEAST(COALESCE(ca.appointment_count, 0), 10)
                    WHEN ca.display_name IS NOT NULL AND LOWER(ca.display_name) LIKE v_expanded_pattern
                        THEN 45 + LEAST(COALESCE(ca.appointment_count, 0), 10)
                    ELSE 0
                END
            )
            + CASE WHEN v_intent = 'place' THEN v_intent_boost ELSE 0 END
            AS score,
            CASE
                WHEN ca.display_name IS NOT NULL AND (
                    LOWER(ca.display_name) = v_query_lower
                    OR LOWER(ca.display_name) = v_query_expanded
                    OR LOWER(ca.display_name) LIKE v_query_prefix
                    OR LOWER(ca.display_name) LIKE v_query_pattern
                    OR LOWER(ca.display_name) LIKE v_expanded_pattern
                    OR similarity(ca.display_name, p_query) >= 0.3
                ) THEN 'alias_match'
                WHEN LOWER(pl.display_name) = v_query_lower THEN 'exact_name'
                WHEN LOWER(pl.formatted_address) = v_query_lower THEN 'exact_address'
                WHEN LOWER(pl.display_name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN LOWER(pl.formatted_address) LIKE v_query_prefix THEN 'prefix_address'
                WHEN similarity(pl.display_name, p_query) >= 0.5 THEN 'similar_name'
                WHEN similarity(pl.formatted_address, p_query) >= 0.5 THEN 'similar_address'
                WHEN LOWER(pl.formatted_address) LIKE v_expanded_pattern THEN 'expanded_address'
                WHEN LOWER(pl.display_name) LIKE v_query_pattern THEN 'contains_name'
                WHEN LOWER(pl.formatted_address) LIKE v_query_pattern THEN 'contains_address'
                WHEN LOWER(sa.city) LIKE v_query_pattern THEN 'contains_locality'
                ELSE 'trigram'
            END AS match_reason,
            jsonb_build_object(
                'place_kind', pl.place_kind,
                'locality', sa.city,
                'postal_code', sa.postal_code,
                'cat_count', (SELECT COUNT(*) FROM sot.cat_place cpr WHERE cpr.place_id = pl.place_id),
                'person_count', (SELECT COUNT(*) FROM sot.person_place ppr WHERE ppr.place_id = pl.place_id),
                'is_address_backed', pl.is_address_backed,
                'alias_matched', ca.display_name IS NOT NULL AND (
                    LOWER(ca.display_name) LIKE v_query_pattern
                    OR LOWER(ca.display_name) LIKE v_expanded_pattern
                    OR similarity(ca.display_name, p_query) >= 0.3
                ),
                'alias_name', ca.display_name,
                'alias_appointment_count', ca.appointment_count,
                'last_appointment_date', (SELECT MAX(a.appointment_date)::TEXT FROM ops.appointments a WHERE a.place_id = pl.place_id OR a.inferred_place_id = pl.place_id),
                'request_count', (SELECT COUNT(*) FROM ops.requests r WHERE r.place_id = pl.place_id AND r.merged_into_request_id IS NULL)
            ) AS metadata
        FROM sot.places pl
        LEFT JOIN sot.addresses sa ON sa.address_id = pl.sot_address_id
        LEFT JOIN ops.clinic_accounts ca ON ca.resolved_place_id = pl.place_id
            AND ca.merged_into_account_id IS NULL
            AND ca.account_type IN ('site_name', 'address')
        WHERE pl.merged_into_place_id IS NULL
          AND COALESCE(pl.quality_tier, 'good') NOT IN ('garbage', 'needs_review')
          AND (p_type IS NULL OR p_type = 'place')
          AND (
              LOWER(pl.display_name) LIKE v_query_pattern
              OR LOWER(pl.formatted_address) LIKE v_query_pattern
              OR LOWER(sa.city) LIKE v_query_pattern
              OR similarity(pl.display_name, p_query) >= 0.3
              OR similarity(pl.formatted_address, p_query) >= 0.3
              OR LOWER(pl.formatted_address) LIKE v_expanded_pattern
              OR (ca.display_name IS NOT NULL AND LOWER(ca.display_name) LIKE v_query_pattern)
              OR (ca.display_name IS NOT NULL AND LOWER(ca.display_name) LIKE v_expanded_pattern)
              OR (ca.display_name IS NOT NULL AND similarity(ca.display_name, p_query) >= 0.3)
          )
    )
    SELECT
        r.entity_type,
        r.entity_id,
        r.display_name,
        r.subtitle,
        CASE
            WHEN r.score >= 90 THEN 'strong'
            WHEN r.score >= 50 THEN 'medium'
            ELSE 'weak'
        END AS match_strength,
        r.match_reason,
        r.score::NUMERIC,
        r.metadata
    FROM ranked_results r
    WHERE r.score > 0
    ORDER BY r.score DESC, r.display_name ASC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

\echo ''
\echo '  MIG_2874 Complete — Activity fields added to search metadata'
\echo '  - Cats: last_appointment_date, appointment_count'
\echo '  - People: last_appointment_date, request_count'
\echo '  - Places: last_appointment_date, request_count'
\echo ''
