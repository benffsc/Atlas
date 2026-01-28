\echo '=== MIG_759: Add score_breakdown to data_engine_score_candidates ==='
\echo 'Fixes: record "v_top_candidate" has no field "score_breakdown"'
\echo ''

-- Drop and recreate function with score_breakdown and rules_applied columns
DROP FUNCTION IF EXISTS trapper.data_engine_score_candidates(text,text,text,text) CASCADE;

CREATE OR REPLACE FUNCTION trapper.data_engine_score_candidates(
    p_email TEXT,
    p_phone TEXT,
    p_name TEXT,
    p_address TEXT
)
RETURNS TABLE(
    person_id UUID,
    display_name TEXT,
    total_score NUMERIC,
    email_score NUMERIC,
    phone_score NUMERIC,
    name_score NUMERIC,
    address_score NUMERIC,
    household_id UUID,
    is_household_candidate BOOLEAN,
    matched_rules TEXT[],
    used_enrichment BOOLEAN,
    enrichment_source TEXT,
    score_breakdown JSONB,
    rules_applied JSONB
)
LANGUAGE plpgsql AS $$
DECLARE
    v_email_norm TEXT;
    v_phone_norm TEXT;
BEGIN
    v_email_norm := LOWER(TRIM(p_email));
    v_phone_norm := trapper.norm_phone_us(p_phone);

    RETURN QUERY
    WITH candidates AS (
        SELECT DISTINCT ON (p.person_id)
            p.person_id,
            p.display_name,
            -- Email score (cast to numeric)
            CASE
                WHEN v_email_norm IS NOT NULL AND EXISTS (
                    SELECT 1 FROM trapper.person_identifiers pi
                    WHERE pi.person_id = p.person_id
                      AND pi.id_type = 'email'
                      AND pi.id_value_norm = v_email_norm
                ) THEN 0.50::NUMERIC
                ELSE 0::NUMERIC
            END as email_score,
            -- Phone score (cast to numeric)
            CASE
                WHEN v_phone_norm IS NOT NULL AND EXISTS (
                    SELECT 1 FROM trapper.person_identifiers pi
                    WHERE pi.person_id = p.person_id
                      AND pi.id_type = 'phone'
                      AND pi.id_value_norm = v_phone_norm
                ) THEN 0.40::NUMERIC
                ELSE 0::NUMERIC
            END as phone_score,
            -- Name score (cast similarity result to numeric)
            CASE
                WHEN p_name IS NOT NULL AND
                     similarity(LOWER(p.display_name), LOWER(p_name)) > 0.6
                THEN (similarity(LOWER(p.display_name), LOWER(p_name)) * 0.25)::NUMERIC
                ELSE 0::NUMERIC
            END as name_score,
            -- Address score
            0::NUMERIC as address_score,
            NULL::UUID as household_id,
            false as is_household_candidate,
            false as used_enrichment,
            NULL::TEXT as enrichment_source
        FROM trapper.sot_people p
        WHERE p.merged_into_person_id IS NULL
          AND (
            (v_email_norm IS NOT NULL AND EXISTS (
                SELECT 1 FROM trapper.person_identifiers pi
                WHERE pi.person_id = p.person_id
                  AND pi.id_type = 'email'
                  AND pi.id_value_norm = v_email_norm
            ))
            OR
            (v_phone_norm IS NOT NULL AND EXISTS (
                SELECT 1 FROM trapper.person_identifiers pi
                WHERE pi.person_id = p.person_id
                  AND pi.id_type = 'phone'
                  AND pi.id_value_norm = v_phone_norm
            ))
          )
    )
    SELECT
        c.person_id,
        c.display_name,
        (c.email_score + c.phone_score + c.name_score + c.address_score) as total_score,
        c.email_score,
        c.phone_score,
        c.name_score,
        c.address_score,
        c.household_id,
        c.is_household_candidate,
        ARRAY[]::TEXT[] as matched_rules,
        c.used_enrichment,
        c.enrichment_source,
        jsonb_build_object(
            'email', c.email_score,
            'phone', c.phone_score,
            'name', c.name_score,
            'address', c.address_score
        ) as score_breakdown,
        '[]'::JSONB as rules_applied
    FROM candidates c
    WHERE (c.email_score + c.phone_score + c.name_score + c.address_score) > 0
    ORDER BY (c.email_score + c.phone_score + c.name_score + c.address_score) DESC;
END;
$$;

\echo ''
\echo '=== MIG_759 Complete ==='
\echo 'Added score_breakdown and rules_applied to data_engine_score_candidates'
