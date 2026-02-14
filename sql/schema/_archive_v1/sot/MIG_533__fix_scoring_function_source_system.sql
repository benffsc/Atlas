\echo ''
\echo '=============================================='
\echo 'MIG_533: Fix scoring function source_system error'
\echo '=============================================='
\echo ''
\echo 'CRITICAL BUG FIX: The data_engine_score_candidates function'
\echo 'referenced p.source_system but places table does not have this column.'
\echo ''
\echo 'This caused: ERROR: column p.source_system does not exist'
\echo ''

-- ============================================================================
-- FIX data_engine_score_candidates() - Remove invalid column reference
-- ============================================================================

\echo 'Fixing data_engine_score_candidates...'

CREATE OR REPLACE FUNCTION trapper.data_engine_score_candidates(
    p_email_norm TEXT,
    p_phone_norm TEXT,
    p_display_name TEXT,
    p_address_norm TEXT
)
RETURNS TABLE (
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
    enrichment_source TEXT
) AS $$
DECLARE
    v_email_blacklisted BOOLEAN := FALSE;
BEGIN
    -- Check if incoming email is blacklisted
    IF p_email_norm IS NOT NULL AND p_email_norm != '' THEN
        v_email_blacklisted := trapper.is_blacklisted_email(p_email_norm);
    END IF;

    RETURN QUERY
    WITH
    -- Email matches (with blacklist check)
    email_matches AS (
        SELECT DISTINCT
            pi.person_id AS matched_person_id,
            -- If email is blacklisted, score is 0 (won't match based on placeholder emails)
            CASE
                WHEN v_email_blacklisted THEN 0.0::NUMERIC
                ELSE 1.0::NUMERIC
            END as score,
            CASE
                WHEN v_email_blacklisted THEN 'email_blacklisted'::TEXT
                ELSE 'exact_email'::TEXT
            END as rule
        FROM trapper.person_identifiers pi
        WHERE p_email_norm IS NOT NULL
          AND p_email_norm != ''
          AND NOT v_email_blacklisted  -- Don't match on blacklisted emails
          AND pi.id_type = 'email'
          AND pi.id_value_norm = p_email_norm
          AND EXISTS (
              SELECT 1 FROM trapper.sot_people sp
              WHERE sp.person_id = pi.person_id
              AND sp.merged_into_person_id IS NULL
          )
    ),

    -- Phone matches (check blacklists)
    phone_matches AS (
        SELECT DISTINCT
            pi.person_id AS matched_person_id,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM trapper.identity_phone_blacklist bl
                    WHERE bl.phone_norm = p_phone_norm
                    AND bl.allow_with_name_match = FALSE
                ) THEN 0.0::NUMERIC
                WHEN EXISTS (
                    SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_phone_norm
                    AND sbl.identifier_type = 'phone'
                ) THEN 0.5::NUMERIC
                ELSE 1.0::NUMERIC
            END as score,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_phone_norm
                    AND sbl.identifier_type = 'phone'
                ) THEN 'exact_phone_soft_blacklist'::TEXT
                ELSE 'exact_phone'::TEXT
            END as rule
        FROM trapper.person_identifiers pi
        WHERE p_phone_norm IS NOT NULL
          AND p_phone_norm != ''
          AND pi.id_type = 'phone'
          AND pi.id_value_norm = p_phone_norm
          AND NOT EXISTS (
              SELECT 1 FROM trapper.identity_phone_blacklist bl
              WHERE bl.phone_norm = p_phone_norm
              AND bl.allow_with_name_match = FALSE
          )
          AND EXISTS (
              SELECT 1 FROM trapper.sot_people sp
              WHERE sp.person_id = pi.person_id
              AND sp.merged_into_person_id IS NULL
          )
    ),

    -- All unique candidates from identifier matches
    all_candidates AS (
        SELECT matched_person_id FROM email_matches
        UNION
        SELECT matched_person_id FROM phone_matches
    ),

    -- Enriched address matching (cross-source)
    -- FIXED: Removed p.source_system reference (places table doesn't have this column)
    -- Instead, get data_source from sot_people
    enriched_address_matches AS (
        SELECT DISTINCT
            ppr.person_id AS matched_person_id,
            p.formatted_address AS enriched_address,
            sp.data_source::TEXT AS address_source
        FROM trapper.person_place_relationships ppr
        JOIN trapper.places p ON p.place_id = ppr.place_id
        JOIN trapper.sot_people sp ON sp.person_id = ppr.person_id
        WHERE ppr.person_id IN (SELECT matched_person_id FROM all_candidates)
          AND p.formatted_address IS NOT NULL
          AND p.merged_into_place_id IS NULL
          AND sp.merged_into_person_id IS NULL
    ),

    -- Calculate scores for each candidate
    scored_candidates AS (
        SELECT
            sp.person_id,
            sp.display_name,
            -- Email score: 40% weight
            COALESCE((SELECT em.score FROM email_matches em WHERE em.matched_person_id = sp.person_id), 0.0) * 0.40 AS email_component,
            -- Phone score: 25% weight
            COALESCE((SELECT pm.score FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id), 0.0) * 0.25 AS phone_component,
            -- Name similarity: 25% weight
            CASE
                WHEN p_display_name IS NULL OR p_display_name = '' THEN 0.0
                WHEN sp.display_name IS NULL OR sp.display_name = '' THEN 0.0
                ELSE trapper.name_similarity(p_display_name, sp.display_name) * 0.25
            END AS name_component,
            -- Address match: 10% weight (with enrichment from cross-source)
            CASE
                -- Direct address match
                WHEN p_address_norm IS NOT NULL AND p_address_norm != '' AND EXISTS (
                    SELECT 1 FROM trapper.person_place_relationships ppr
                    JOIN trapper.places pl ON pl.place_id = ppr.place_id
                    WHERE ppr.person_id = sp.person_id
                    AND pl.merged_into_place_id IS NULL
                    AND (
                        trapper.normalize_address(pl.formatted_address) = p_address_norm OR
                        pl.formatted_address ILIKE '%' || p_address_norm || '%'
                    )
                ) THEN 0.08
                -- Enriched address match (cross-source)
                WHEN p_address_norm IS NULL OR p_address_norm = '' THEN
                    CASE
                        WHEN EXISTS (SELECT 1 FROM enriched_address_matches eam WHERE eam.matched_person_id = sp.person_id)
                        THEN 0.06  -- Slight boost for having address in another source
                        ELSE 0.0
                    END
                ELSE 0.0
            END AS address_component,
            -- Collect matched rules
            ARRAY_REMOVE(ARRAY[
                (SELECT em.rule FROM email_matches em WHERE em.matched_person_id = sp.person_id),
                (SELECT pm.rule FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id)
            ], NULL) AS matched_rules,
            -- Household info
            hm.household_id,
            hm.household_id IS NOT NULL AS is_household_candidate,
            -- Enrichment tracking
            EXISTS (SELECT 1 FROM enriched_address_matches eam WHERE eam.matched_person_id = sp.person_id) AS used_enrichment,
            (SELECT eam.address_source FROM enriched_address_matches eam WHERE eam.matched_person_id = sp.person_id LIMIT 1) AS enrichment_source
        FROM trapper.sot_people sp
        LEFT JOIN trapper.household_members hm ON hm.person_id = sp.person_id
        WHERE sp.person_id IN (SELECT matched_person_id FROM all_candidates)
          AND sp.merged_into_person_id IS NULL
          AND sp.is_canonical = TRUE  -- Only match to canonical people
    )

    SELECT
        sc.person_id,
        sc.display_name,
        (sc.email_component + sc.phone_component + sc.name_component + sc.address_component)::NUMERIC AS total_score,
        sc.email_component::NUMERIC AS email_score,
        sc.phone_component::NUMERIC AS phone_score,
        sc.name_component::NUMERIC AS name_score,
        sc.address_component::NUMERIC AS address_score,
        sc.household_id,
        sc.is_household_candidate,
        sc.matched_rules,
        sc.used_enrichment,
        sc.enrichment_source
    FROM scored_candidates sc
    ORDER BY (sc.email_component + sc.phone_component + sc.name_component + sc.address_component) DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.data_engine_score_candidates IS
'Scores candidate people for identity matching with:
- Email blacklist check (placeholder emails score 0)
- Phone blacklist check (blocked phones excluded, soft-blacklist reduced)
- Name similarity scoring
- Address matching with cross-source enrichment
- Only returns canonical (non-merged, valid) people as candidates
FIXED in MIG_533: Removed invalid p.source_system reference, now uses sp.data_source';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_533 Complete!'
\echo '=============================================='
\echo ''
\echo 'Fixed: data_engine_score_candidates now correctly references'
\echo 'sp.data_source instead of non-existent p.source_system column.'
\echo ''
\echo 'Test with:'
\echo '  SELECT * FROM trapper.data_engine_resolve_identity('
\echo '    ''test@example.com'', ''+14155551234'', ''Chris'', ''Anderson'','
\echo '    ''123 Main St'', ''atlas_ui'''
\echo '  );'
\echo ''
