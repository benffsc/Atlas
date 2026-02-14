-- MIG_231: Dedupe Detail Views
--
-- Problem: When a person has multiple roles at the same place (owner AND requester),
-- or a place has the same person with multiple roles, the detail views show
-- duplicate entries instead of aggregating roles.
--
-- Solution: Group by entity ID and aggregate roles into an array
--
-- MANUAL APPLY:
--   source .env.local && psql "$DATABASE_URL" -f sql/schema/sot/MIG_231__dedupe_detail_views.sql

\echo ''
\echo '=============================================='
\echo 'MIG_231: Dedupe Detail Views'
\echo '=============================================='
\echo ''

-- Fix v_person_detail to dedupe places
CREATE OR REPLACE VIEW trapper.v_person_detail AS
SELECT
    person_id,
    display_name,
    merged_into_person_id,
    created_at,
    updated_at,
    -- Cats (no change - cats shouldn't have duplicate relationships)
    (
        SELECT jsonb_agg(
            jsonb_build_object(
                'cat_id', pcr.cat_id,
                'cat_name', c.display_name,
                'relationship_type', pcr.relationship_type,
                'confidence', pcr.confidence,
                'source_system', pcr.source_system,
                'data_source', c.data_source,
                'microchip', (
                    SELECT ci.id_value
                    FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
                    LIMIT 1
                )
            )
            ORDER BY
                CASE c.data_source
                    WHEN 'clinichq' THEN 1
                    WHEN 'legacy_import' THEN 2
                    ELSE 3
                END,
                pcr.relationship_type,
                c.display_name
        )
        FROM trapper.person_cat_relationships pcr
        JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
        WHERE pcr.person_id = p.person_id
    ) AS cats,
    -- Places - DEDUPED by place_id, aggregate roles
    (
        SELECT jsonb_agg(
            jsonb_build_object(
                'place_id', place_id,
                'place_name', display_name,
                'formatted_address', formatted_address,
                'place_kind', place_kind,
                'role', role,  -- Primary role (first alphabetically)
                'roles', roles, -- All roles as array
                'confidence', confidence
            )
            ORDER BY role, display_name
        )
        FROM (
            SELECT
                ppr.place_id,
                pl.display_name,
                pl.formatted_address,
                pl.place_kind,
                MIN(ppr.role) AS role,  -- Primary role
                array_agg(DISTINCT ppr.role ORDER BY ppr.role) AS roles,  -- All roles
                MAX(ppr.confidence) AS confidence
            FROM trapper.person_place_relationships ppr
            JOIN trapper.places pl ON pl.place_id = ppr.place_id
            WHERE ppr.person_id = p.person_id
              AND pl.merged_into_place_id IS NULL  -- Exclude merged places
            GROUP BY ppr.place_id, pl.display_name, pl.formatted_address, pl.place_kind
        ) deduped
    ) AS places,
    -- Person relationships (no change)
    (
        SELECT jsonb_agg(
            jsonb_build_object(
                'person_id', CASE WHEN ppe.person_id_a = p.person_id THEN ppe.person_id_b ELSE ppe.person_id_a END,
                'person_name', CASE WHEN ppe.person_id_a = p.person_id THEN p2.display_name ELSE p1.display_name END,
                'relationship_type', rt.code,
                'relationship_label', rt.label,
                'confidence', ppe.confidence
            )
            ORDER BY rt.label
        )
        FROM trapper.person_person_edges ppe
        JOIN trapper.relationship_types rt ON rt.id = ppe.relationship_type_id
        LEFT JOIN trapper.sot_people p1 ON p1.person_id = ppe.person_id_a
        LEFT JOIN trapper.sot_people p2 ON p2.person_id = ppe.person_id_b
        WHERE ppe.person_id_a = p.person_id OR ppe.person_id_b = p.person_id
    ) AS person_relationships,
    (SELECT count(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id) AS cat_count,
    -- Place count - count DISTINCT places, not relationships
    (SELECT count(DISTINCT ppr.place_id)
     FROM trapper.person_place_relationships ppr
     JOIN trapper.places pl ON pl.place_id = ppr.place_id
     WHERE ppr.person_id = p.person_id
       AND pl.merged_into_place_id IS NULL) AS place_count
FROM trapper.sot_people p
WHERE merged_into_person_id IS NULL;

\echo 'Updated v_person_detail - places now deduped by place_id'

-- Fix v_place_detail_v2 to dedupe people
DROP VIEW IF EXISTS trapper.v_place_detail_v2 CASCADE;

CREATE OR REPLACE VIEW trapper.v_place_detail_v2 AS
WITH place_people AS (
  -- Get all people associated with each place
  SELECT
    ppr.place_id,
    array_agg(LOWER(TRIM(p.display_name))) AS person_names
  FROM trapper.person_place_relationships ppr
  JOIN trapper.sot_people p ON p.person_id = ppr.person_id
  WHERE p.merged_into_person_id IS NULL
  GROUP BY ppr.place_id
)
SELECT
    pl.place_id,
    -- Smart display name: use address if name matches any associated person
    CASE
      WHEN pp.person_names IS NOT NULL
        AND LOWER(TRIM(pl.display_name)) = ANY(pp.person_names)
      THEN COALESCE(SPLIT_PART(pl.formatted_address, ',', 1), pl.formatted_address, pl.display_name)
      ELSE COALESCE(pl.display_name, SPLIT_PART(pl.formatted_address, ',', 1))
    END AS display_name,
    -- Keep original name for reference
    pl.display_name AS original_display_name,
    pl.formatted_address,
    pl.place_kind,
    pl.is_address_backed,
    pl.has_cat_activity,
    sa.locality,
    sa.postal_code,
    sa.admin_area_1 AS state_province,
    CASE WHEN pl.location IS NOT NULL THEN
        jsonb_build_object(
            'lat', ST_Y(pl.location::geometry),
            'lng', ST_X(pl.location::geometry)
        )
    ELSE NULL END AS coordinates,
    pl.created_at,
    pl.updated_at,
    -- Cats at this place (no change)
    (SELECT jsonb_agg(jsonb_build_object(
        'cat_id', cpr.cat_id,
        'cat_name', c.display_name,
        'relationship_type', cpr.relationship_type,
        'confidence', cpr.confidence
    ) ORDER BY c.display_name)
     FROM trapper.cat_place_relationships cpr
     JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
     WHERE cpr.place_id = pl.place_id) AS cats,
    -- People at this place - DEDUPED by person_id, aggregate roles
    (SELECT jsonb_agg(
        jsonb_build_object(
            'person_id', person_id,
            'person_name', display_name,
            'role', role,       -- Primary role
            'roles', roles,     -- All roles as array
            'confidence', confidence
        )
        ORDER BY display_name
    )
    FROM (
        SELECT
            ppr.person_id,
            p.display_name,
            MIN(ppr.role) AS role,
            array_agg(DISTINCT ppr.role ORDER BY ppr.role) AS roles,
            MAX(ppr.confidence) AS confidence
        FROM trapper.person_place_relationships ppr
        JOIN trapper.sot_people p ON p.person_id = ppr.person_id
        WHERE ppr.place_id = pl.place_id
          AND p.merged_into_person_id IS NULL
          AND trapper.is_valid_person_name(p.display_name) = TRUE
        GROUP BY ppr.person_id, p.display_name
    ) deduped) AS people,
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
    -- Person count - count DISTINCT people, not relationships
    (SELECT COUNT(DISTINCT ppr.person_id)
     FROM trapper.person_place_relationships ppr
     JOIN trapper.sot_people p ON p.person_id = ppr.person_id
     WHERE ppr.place_id = pl.place_id
       AND p.merged_into_person_id IS NULL
       AND trapper.is_valid_person_name(p.display_name) = TRUE) AS person_count
FROM trapper.places pl
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = pl.sot_address_id
LEFT JOIN place_people pp ON pp.place_id = pl.place_id
WHERE pl.is_address_backed = true;

COMMENT ON VIEW trapper.v_place_detail_v2 IS
'Full place detail for API including cats, people, and place relationships.
People are DEDUPED by person_id - multiple roles shown in roles array.
display_name uses smart logic: shows address if name matches any associated person.';

\echo 'Updated v_place_detail_v2 - people now deduped by person_id'

-- Also update v_place_detail (the original one used by the API) if it exists
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
    sa.admin_area_1 AS state_province,
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
    -- People at this place - DEDUPED by person_id, aggregate roles
    (SELECT jsonb_agg(
        jsonb_build_object(
            'person_id', person_id,
            'person_name', display_name,
            'role', role,
            'roles', roles,
            'confidence', confidence
        )
        ORDER BY display_name
    )
    FROM (
        SELECT
            ppr.person_id,
            p.display_name,
            MIN(ppr.role) AS role,
            array_agg(DISTINCT ppr.role ORDER BY ppr.role) AS roles,
            MAX(ppr.confidence) AS confidence
        FROM trapper.person_place_relationships ppr
        JOIN trapper.sot_people p ON p.person_id = ppr.person_id
        WHERE ppr.place_id = pl.place_id
          AND p.merged_into_person_id IS NULL
        GROUP BY ppr.person_id, p.display_name
    ) deduped) AS people,
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
    -- Stats - count DISTINCT entities
    (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = pl.place_id) AS cat_count,
    (SELECT COUNT(DISTINCT ppr.person_id)
     FROM trapper.person_place_relationships ppr
     JOIN trapper.sot_people p ON p.person_id = ppr.person_id
     WHERE ppr.place_id = pl.place_id
       AND p.merged_into_person_id IS NULL) AS person_count
FROM trapper.places pl
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = pl.sot_address_id
WHERE pl.merged_into_place_id IS NULL;

COMMENT ON VIEW trapper.v_place_detail IS
'Place detail for API with deduped people (roles aggregated).';

\echo 'Updated v_place_detail - people now deduped by person_id'
\echo ''
\echo '=============================================='
\echo 'MIG_231 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  - v_person_detail.places: Deduped by place_id, roles in array'
\echo '  - v_person_detail.place_count: Now counts DISTINCT places'
\echo '  - v_place_detail.people: Deduped by person_id, roles in array'
\echo '  - v_place_detail.person_count: Now counts DISTINCT people'
\echo '  - v_place_detail_v2: Same changes as v_place_detail'
\echo ''
\echo 'Note: Places also now filtered to exclude merged_into_place_id IS NOT NULL'
\echo ''

-- Verify with Rosie Favila
\echo 'Verifying fix with Rosie Favila:'
SELECT
    display_name,
    place_count,
    jsonb_array_length(places) as places_in_array
FROM trapper.v_person_detail
WHERE display_name ILIKE '%rosie%favila%';
