-- MIG_027__hardening_search_and_views.sql
-- Hardening for search_deep and v_place_detail
--
-- Fixes:
--   1. v_place_detail: Replace sa.state_province with sa.admin_area_1
--   2. search_deep: Add defensive guards for missing tables and NULL handling
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_027__hardening_search_and_views.sql

\echo '============================================'
\echo 'MIG_027: Hardening Search and Views'
\echo '============================================'

-- ============================================
-- PART 1: Fix v_place_detail (state_province → admin_area_1)
-- ============================================
\echo ''
\echo 'Fixing v_place_detail view...'

CREATE OR REPLACE VIEW trapper.v_place_detail AS
SELECT
    pl.place_id,
    pl.display_name,
    pl.formatted_address,
    pl.place_kind,
    pl.is_address_backed,
    pl.has_cat_activity,
    sa.locality,
    sa.postal_code,
    sa.admin_area_1 AS state_province,  -- Fixed: was referencing non-existent column
    CASE WHEN pl.location IS NOT NULL THEN
        jsonb_build_object(
            'lat', ST_Y(pl.location::geometry),
            'lng', ST_X(pl.location::geometry)
        )
    ELSE NULL END AS coordinates,
    pl.created_at,
    pl.updated_at,
    -- Cats at this place
    (SELECT jsonb_agg(jsonb_build_object(
        'cat_id', cpr.cat_id,
        'cat_name', c.display_name,
        'relationship_type', cpr.relationship_type,
        'confidence', cpr.confidence
    ) ORDER BY c.display_name)
     FROM trapper.cat_place_relationships cpr
     JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
     WHERE cpr.place_id = pl.place_id) AS cats,
    -- People at this place
    (SELECT jsonb_agg(jsonb_build_object(
        'person_id', ppr.person_id,
        'person_name', p.display_name,
        'role', ppr.role,
        'confidence', ppr.confidence
    ) ORDER BY p.display_name)
     FROM trapper.person_place_relationships ppr
     JOIN trapper.sot_people p ON p.person_id = ppr.person_id
     WHERE ppr.place_id = pl.place_id
       AND p.merged_into_person_id IS NULL) AS people,
    -- Place relationships (from edges)
    (SELECT jsonb_agg(jsonb_build_object(
        'place_id', CASE WHEN ppe.place_id_a = pl.place_id THEN ppe.place_id_b ELSE ppe.place_id_a END,
        'place_name', CASE WHEN ppe.place_id_a = pl.place_id THEN pl2.display_name ELSE pl1.display_name END,
        'relationship_type', rt.code,
        'relationship_label', rt.label
    ) ORDER BY rt.label)
     FROM trapper.place_place_edges ppe
     JOIN trapper.relationship_types rt ON rt.id = ppe.relationship_type_id
     LEFT JOIN trapper.places pl1 ON pl1.place_id = ppe.place_id_a
     LEFT JOIN trapper.places pl2 ON pl2.place_id = ppe.place_id_b
     WHERE ppe.place_id_a = pl.place_id OR ppe.place_id_b = pl.place_id) AS place_relationships,
    -- Stats
    (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = pl.place_id) AS cat_count,
    (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.place_id = pl.place_id) AS person_count
FROM trapper.places pl
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = pl.sot_address_id
WHERE pl.is_address_backed = true;

COMMENT ON VIEW trapper.v_place_detail IS
'Full place detail for API including cats, people, and place relationships as JSONB arrays.
Fixed in MIG_027: state_province now correctly references admin_area_1.';

-- ============================================
-- PART 2: Hardened search_deep function
-- ============================================
\echo ''
\echo 'Creating hardened search_deep function...'

CREATE OR REPLACE FUNCTION trapper.search_deep(
    p_query TEXT,
    p_limit INT DEFAULT 50
)
RETURNS TABLE (
    source_table TEXT,
    source_row_id TEXT,
    match_field TEXT,
    match_value TEXT,
    snippet JSONB,
    score NUMERIC
) AS $$
DECLARE
    v_query_lower TEXT;
    v_query_pattern TEXT;
    v_has_hist_cats BOOLEAN := FALSE;
    v_has_hist_owners BOOLEAN := FALSE;
    v_has_hist_appts BOOLEAN := FALSE;
BEGIN
    -- Sanitize input
    IF p_query IS NULL OR TRIM(p_query) = '' THEN
        RETURN;  -- Return empty result set for empty queries
    END IF;

    v_query_lower := LOWER(TRIM(p_query));
    v_query_pattern := '%' || v_query_lower || '%';

    -- Check which tables exist (defensive for fresh DBs)
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'trapper' AND table_name = 'clinichq_hist_cats'
    ) INTO v_has_hist_cats;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'trapper' AND table_name = 'clinichq_hist_owners'
    ) INTO v_has_hist_owners;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'trapper' AND table_name = 'clinichq_hist_appts'
    ) INTO v_has_hist_appts;

    -- If no raw tables exist, return empty
    IF NOT v_has_hist_cats AND NOT v_has_hist_owners AND NOT v_has_hist_appts THEN
        RETURN;
    END IF;

    -- Build and execute query dynamically based on available tables
    RETURN QUERY EXECUTE format($sql$
        WITH deep_results AS (
            %s
        )
        SELECT
            dr.source_table,
            dr.source_row_id,
            dr.match_field,
            dr.match_value,
            dr.snippet,
            dr.score
        FROM deep_results dr
        ORDER BY dr.score DESC, dr.match_value ASC
        LIMIT %s
    $sql$,
    -- Build UNION of available tables
    array_to_string(ARRAY[
        CASE WHEN v_has_hist_cats THEN format($q$
            SELECT
                'clinichq_hist_cats'::TEXT AS source_table,
                chc.id::TEXT AS source_row_id,
                CASE
                    WHEN LOWER(COALESCE(chc.animal_name, '')) LIKE %L THEN 'animal_name'
                    WHEN LOWER(COALESCE(chc.microchip_number, '')) LIKE %L THEN 'microchip_number'
                    WHEN LOWER(COALESCE(chc.breed, '')) LIKE %L THEN 'breed'
                    ELSE 'multiple'
                END AS match_field,
                COALESCE(chc.animal_name, chc.microchip_number, 'Unknown') AS match_value,
                jsonb_build_object(
                    'animal_name', chc.animal_name,
                    'microchip_number', chc.microchip_number,
                    'breed', chc.breed,
                    'sex', chc.sex,
                    'appt_date', chc.appt_date,
                    'appt_number', chc.appt_number
                ) AS snippet,
                CASE
                    WHEN LOWER(COALESCE(chc.microchip_number, '')) = %L THEN 95
                    WHEN LOWER(COALESCE(chc.animal_name, '')) = %L THEN 90
                    WHEN LOWER(COALESCE(chc.microchip_number, '')) LIKE %L THEN 70
                    WHEN LOWER(COALESCE(chc.animal_name, '')) LIKE %L THEN 65
                    ELSE 30
                END::NUMERIC AS score
            FROM trapper.clinichq_hist_cats chc
            WHERE LOWER(COALESCE(chc.animal_name, '')) LIKE %L
               OR LOWER(COALESCE(chc.microchip_number, '')) LIKE %L
               OR LOWER(COALESCE(chc.breed, '')) LIKE %L
        $q$, v_query_pattern, v_query_pattern, v_query_pattern,
            v_query_lower, v_query_lower, v_query_pattern, v_query_pattern,
            v_query_pattern, v_query_pattern, v_query_pattern)
        END,
        CASE WHEN v_has_hist_owners THEN format($q$
            SELECT
                'clinichq_hist_owners'::TEXT AS source_table,
                cho.id::TEXT AS source_row_id,
                CASE
                    WHEN LOWER(COALESCE(cho.owner_first_name, '') || ' ' || COALESCE(cho.owner_last_name, '')) LIKE %L THEN 'owner_name'
                    WHEN LOWER(COALESCE(cho.owner_email, '')) LIKE %L THEN 'owner_email'
                    WHEN LOWER(COALESCE(cho.owner_address, '')) LIKE %L THEN 'owner_address'
                    WHEN LOWER(COALESCE(cho.animal_name, '')) LIKE %L THEN 'animal_name'
                    WHEN LOWER(COALESCE(cho.phone_normalized, '')) LIKE %L THEN 'phone'
                    ELSE 'multiple'
                END AS match_field,
                COALESCE(
                    NULLIF(TRIM(COALESCE(cho.owner_first_name, '') || ' ' || COALESCE(cho.owner_last_name, '')), ''),
                    cho.owner_email,
                    cho.animal_name,
                    'Unknown'
                ) AS match_value,
                jsonb_build_object(
                    'owner_name', TRIM(COALESCE(cho.owner_first_name, '') || ' ' || COALESCE(cho.owner_last_name, '')),
                    'owner_email', cho.owner_email,
                    'owner_address', cho.owner_address,
                    'animal_name', cho.animal_name,
                    'appt_date', cho.appt_date
                ) AS snippet,
                CASE
                    WHEN LOWER(COALESCE(cho.owner_email, '')) = %L THEN 95
                    WHEN LOWER(TRIM(COALESCE(cho.owner_first_name, '') || ' ' || COALESCE(cho.owner_last_name, ''))) = %L THEN 90
                    WHEN LOWER(COALESCE(cho.phone_normalized, '')) LIKE %L THEN 80
                    WHEN LOWER(COALESCE(cho.owner_email, '')) LIKE %L THEN 70
                    WHEN LOWER(COALESCE(cho.owner_address, '')) LIKE %L THEN 60
                    ELSE 30
                END::NUMERIC AS score
            FROM trapper.clinichq_hist_owners cho
            WHERE LOWER(COALESCE(cho.owner_first_name, '') || ' ' || COALESCE(cho.owner_last_name, '')) LIKE %L
               OR LOWER(COALESCE(cho.owner_last_name, '')) LIKE %L
               OR LOWER(COALESCE(cho.owner_email, '')) LIKE %L
               OR LOWER(COALESCE(cho.owner_address, '')) LIKE %L
               OR LOWER(COALESCE(cho.animal_name, '')) LIKE %L
               OR LOWER(COALESCE(cho.phone_normalized, '')) LIKE %L
        $q$, v_query_pattern, v_query_pattern, v_query_pattern, v_query_pattern, v_query_pattern,
            v_query_lower, v_query_lower, v_query_pattern, v_query_pattern, v_query_pattern,
            v_query_pattern, v_query_pattern, v_query_pattern, v_query_pattern, v_query_pattern, v_query_pattern)
        END,
        CASE WHEN v_has_hist_appts THEN format($q$
            SELECT
                'clinichq_hist_appts'::TEXT AS source_table,
                cha.id::TEXT AS source_row_id,
                CASE
                    WHEN LOWER(COALESCE(cha.animal_name, '')) LIKE %L THEN 'animal_name'
                    WHEN LOWER(COALESCE(cha.microchip_number, '')) LIKE %L THEN 'microchip_number'
                    ELSE 'multiple'
                END AS match_field,
                COALESCE(cha.animal_name, cha.microchip_number, 'Appt #' || COALESCE(cha.appt_number::TEXT, '?')) AS match_value,
                jsonb_build_object(
                    'animal_name', cha.animal_name,
                    'microchip_number', cha.microchip_number,
                    'appt_date', cha.appt_date,
                    'appt_number', cha.appt_number,
                    'vet_name', cha.vet_name,
                    'had_surgery', COALESCE(cha.neuter, FALSE) OR COALESCE(cha.spay, FALSE)
                ) AS snippet,
                CASE
                    WHEN LOWER(COALESCE(cha.microchip_number, '')) = %L THEN 95
                    WHEN LOWER(COALESCE(cha.animal_name, '')) = %L THEN 90
                    WHEN LOWER(COALESCE(cha.microchip_number, '')) LIKE %L THEN 70
                    WHEN LOWER(COALESCE(cha.animal_name, '')) LIKE %L THEN 65
                    ELSE 30
                END::NUMERIC AS score
            FROM trapper.clinichq_hist_appts cha
            WHERE LOWER(COALESCE(cha.animal_name, '')) LIKE %L
               OR LOWER(COALESCE(cha.microchip_number, '')) LIKE %L
        $q$, v_query_pattern, v_query_pattern,
            v_query_lower, v_query_lower, v_query_pattern, v_query_pattern,
            v_query_pattern, v_query_pattern)
        END
    ]::TEXT[], ' UNION ALL '),
    p_limit);

EXCEPTION
    WHEN OTHERS THEN
        -- Log error but don't crash - return empty result
        RAISE WARNING 'search_deep error: % (query: %)', SQLERRM, LEFT(p_query, 50);
        RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.search_deep IS
'Search across raw/staged tables (clinichq_hist_*).
Hardened in MIG_027: handles missing tables, NULL values, and arbitrary input gracefully.
Returns empty result set rather than error on edge cases.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_027 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'v_place_detail columns:'
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'v_place_detail'
ORDER BY ordinal_position;

\echo ''
\echo 'Testing search_deep with alphanumeric query:'
SELECT COUNT(*) AS result_count FROM trapper.search_deep('a36', 5);

\echo ''
\echo 'Testing search_deep with empty query:'
SELECT COUNT(*) AS result_count FROM trapper.search_deep('', 5);

\echo ''
\echo 'Testing search_deep with NULL query:'
SELECT COUNT(*) AS result_count FROM trapper.search_deep(NULL, 5);

\echo ''
\echo 'MIG_027 applied successfully.'
\echo ''
