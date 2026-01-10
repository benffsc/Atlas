-- MIG_025__search_unified_v3_cats_places.sql
-- Unified Search View v3: Cats + Places + People
--
-- Creates:
--   - trapper.v_search_unified_v3: Combined search across all entity types
--   - trapper.v_cat_list: Extended cat list for API with place info
--   - trapper.v_cat_detail: Full cat detail for API
--
-- Purpose:
--   - Enable unified search returning cats, places, and people
--   - Power the Cats list and detail pages
--   - Support search by name, microchip, address, etc.
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_025__search_unified_v3_cats_places.sql

\echo '============================================'
\echo 'MIG_025: Unified Search v3 (Cats + Places)'
\echo '============================================'

-- ============================================
-- PART 1: Extended Cat List View (for API)
-- ============================================
\echo ''
\echo 'Creating v_cat_list view...'

CREATE OR REPLACE VIEW trapper.v_cat_list AS
SELECT
    c.cat_id,
    c.display_name,
    c.sex,
    c.altered_status,
    c.breed,
    c.primary_color,
    c.birth_year,
    -- Microchip (first one found)
    (SELECT ci.id_value
     FROM trapper.cat_identifiers ci
     WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
     LIMIT 1) AS microchip,
    -- All identifiers as JSONB
    (SELECT jsonb_agg(jsonb_build_object('type', ci.id_type, 'value', ci.id_value) ORDER BY ci.id_type)
     FROM trapper.cat_identifiers ci
     WHERE ci.cat_id = c.cat_id) AS identifiers,
    -- Owner info
    (SELECT COUNT(DISTINCT trapper.canonical_person_id(pcr.person_id))
     FROM trapper.person_cat_relationships pcr
     WHERE pcr.cat_id = c.cat_id AND pcr.relationship_type = 'owner') AS owner_count,
    (SELECT string_agg(DISTINCT p.display_name, ', ' ORDER BY p.display_name)
     FROM trapper.person_cat_relationships pcr
     JOIN trapper.sot_people p ON p.person_id = trapper.canonical_person_id(pcr.person_id)
     WHERE pcr.cat_id = c.cat_id AND pcr.relationship_type = 'owner' AND p.display_name IS NOT NULL
     LIMIT 3) AS owner_names,
    -- Primary place info
    cpp.place_id AS primary_place_id,
    cpp.place_name AS primary_place_label,
    cpp.formatted_address AS primary_place_address,
    pl.place_kind,
    cpp.relationship_type AS place_relationship,
    cpp.confidence AS place_confidence,
    -- Has place flag
    cpp.place_id IS NOT NULL AS has_place,
    -- Source info
    c.created_at,
    c.updated_at
FROM trapper.sot_cats c
LEFT JOIN trapper.v_cat_primary_place cpp ON cpp.cat_id = c.cat_id
LEFT JOIN trapper.places pl ON pl.place_id = cpp.place_id;

COMMENT ON VIEW trapper.v_cat_list IS
'Extended cat list for API/UI with owner and place info.
Includes microchip, owner_count, primary_place_label, place_kind.';

-- ============================================
-- PART 2: Cat Detail View (for API)
-- ============================================
\echo 'Creating v_cat_detail view...'

CREATE OR REPLACE VIEW trapper.v_cat_detail AS
SELECT
    c.cat_id,
    c.display_name,
    c.sex,
    c.altered_status,
    c.breed,
    c.primary_color,
    c.birth_year,
    c.notes,
    c.created_at,
    c.updated_at,
    -- Identifiers array
    (SELECT jsonb_agg(jsonb_build_object(
        'id_type', ci.id_type,
        'id_value', ci.id_value,
        'source_system', ci.source_system,
        'created_at', ci.created_at
    ) ORDER BY ci.id_type)
     FROM trapper.cat_identifiers ci
     WHERE ci.cat_id = c.cat_id) AS identifiers,
    -- Owners array
    (SELECT jsonb_agg(jsonb_build_object(
        'person_id', trapper.canonical_person_id(pcr.person_id),
        'display_name', p.display_name,
        'relationship_type', pcr.relationship_type,
        'confidence', pcr.confidence,
        'source_system', pcr.source_system
    ) ORDER BY pcr.relationship_type, p.display_name)
     FROM trapper.person_cat_relationships pcr
     JOIN trapper.sot_people p ON p.person_id = trapper.canonical_person_id(pcr.person_id)
     WHERE pcr.cat_id = c.cat_id) AS owners,
    -- Primary place
    CASE WHEN cpp.place_id IS NOT NULL THEN
        jsonb_build_object(
            'place_id', cpp.place_id,
            'place_name', cpp.place_name,
            'formatted_address', cpp.formatted_address,
            'place_kind', pl.place_kind,
            'relationship_type', cpp.relationship_type,
            'confidence', cpp.confidence,
            'lat', ST_Y(cpp.location::geometry),
            'lng', ST_X(cpp.location::geometry)
        )
    ELSE NULL
    END AS primary_place,
    -- All places
    (SELECT jsonb_agg(jsonb_build_object(
        'place_id', cpr.place_id,
        'place_name', pl2.display_name,
        'relationship_type', cpr.relationship_type,
        'confidence', cpr.confidence,
        'source_system', cpr.source_system
    ) ORDER BY cpr.relationship_type)
     FROM trapper.cat_place_relationships cpr
     JOIN trapper.places pl2 ON pl2.place_id = cpr.place_id
     WHERE cpr.cat_id = c.cat_id) AS all_places
FROM trapper.sot_cats c
LEFT JOIN trapper.v_cat_primary_place cpp ON cpp.cat_id = c.cat_id
LEFT JOIN trapper.places pl ON pl.place_id = cpp.place_id;

COMMENT ON VIEW trapper.v_cat_detail IS
'Full cat detail for API including identifiers, owners, places as JSONB arrays.';

-- ============================================
-- PART 3: Unified Search View v3
-- ============================================
\echo 'Creating v_search_unified_v3 view...'

CREATE OR REPLACE VIEW trapper.v_search_unified_v3 AS
-- CATS
SELECT
    'cat'::TEXT AS entity_type,
    c.cat_id::TEXT AS entity_id,
    c.display_name AS display,
    COALESCE(
        'Microchip: ' || (SELECT ci.id_value FROM trapper.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip' LIMIT 1),
        COALESCE(c.sex, '') || ' ' || COALESCE(c.altered_status, '') || ' ' || COALESCE(c.breed, '')
    ) AS subtitle,
    c.display_name AS search_text,
    -- Additional search fields (microchips, animal numbers)
    (SELECT string_agg(ci.id_value, ' ')
     FROM trapper.cat_identifiers ci
     WHERE ci.cat_id = c.cat_id) AS search_text_extra,
    c.created_at AS last_activity,
    jsonb_build_object(
        'sex', c.sex,
        'altered_status', c.altered_status,
        'breed', c.breed,
        'owner_count', (SELECT COUNT(DISTINCT trapper.canonical_person_id(pcr.person_id))
                        FROM trapper.person_cat_relationships pcr
                        WHERE pcr.cat_id = c.cat_id AND pcr.relationship_type = 'owner'),
        'has_place', EXISTS (SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.cat_id = c.cat_id)
    ) AS metadata
FROM trapper.sot_cats c

UNION ALL

-- PLACES
SELECT
    'place'::TEXT AS entity_type,
    p.place_id::TEXT AS entity_id,
    p.display_name AS display,
    COALESCE(p.place_kind::TEXT, 'unknown') || ' • ' || COALESCE(sa.locality, '') AS subtitle,
    p.display_name || ' ' || COALESCE(p.formatted_address, '') AS search_text,
    sa.locality || ' ' || COALESCE(sa.postal_code, '') AS search_text_extra,
    p.created_at AS last_activity,
    jsonb_build_object(
        'place_kind', p.place_kind,
        'locality', sa.locality,
        'postal_code', sa.postal_code,
        'cat_count', (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = p.place_id),
        'person_count', (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.place_id = p.place_id),
        'has_cat_activity', p.has_cat_activity,
        'is_address_backed', p.is_address_backed
    ) AS metadata
FROM trapper.places p
JOIN trapper.sot_addresses sa ON sa.address_id = p.sot_address_id
WHERE p.is_address_backed = true

UNION ALL

-- PEOPLE
SELECT
    'person'::TEXT AS entity_type,
    p.person_id::TEXT AS entity_id,
    p.display_name AS display,
    COALESCE(
        (SELECT 'Cats: ' || COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id),
        ''
    ) AS subtitle,
    p.display_name AS search_text,
    NULL AS search_text_extra,
    p.created_at AS last_activity,
    jsonb_build_object(
        'cat_count', (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id),
        'place_count', (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id),
        'is_merged', p.merged_into_person_id IS NOT NULL
    ) AS metadata
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL;  -- Only canonical people

COMMENT ON VIEW trapper.v_search_unified_v3 IS
'Unified search view across cats, places, and people.
search_text + search_text_extra are used for full-text matching.
entity_type: cat | place | person
metadata: entity-specific attributes as JSONB.';

-- ============================================
-- PART 4: Create Indexes for Search Performance
-- ============================================
\echo 'Note: For production, consider adding indexes on display_name columns for search performance.'

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_025 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Views created:'
SELECT table_name FROM information_schema.views
WHERE table_schema = 'trapper'
  AND table_name IN ('v_cat_list', 'v_cat_detail', 'v_search_unified_v3')
ORDER BY table_name;

\echo ''
\echo 'Search unified v3 entity counts:'
SELECT entity_type, COUNT(*) AS count
FROM trapper.v_search_unified_v3
GROUP BY entity_type
ORDER BY entity_type;

\echo ''
\echo 'Cat list sample:'
SELECT cat_id, display_name, sex, altered_status, microchip, owner_count, primary_place_label, place_kind
FROM trapper.v_cat_list
LIMIT 5;

\echo ''
\echo 'Search example (cats with microchip):'
SELECT entity_type, entity_id, display, subtitle
FROM trapper.v_search_unified_v3
WHERE entity_type = 'cat' AND search_text_extra IS NOT NULL
LIMIT 5;

\echo ''
\echo 'Next steps:'
\echo '  1. Query cats: SELECT * FROM trapper.v_cat_list WHERE display_name ILIKE ''%fluffy%'';'
\echo '  2. Cat detail: SELECT * FROM trapper.v_cat_detail WHERE cat_id = ''...''::uuid;'
\echo '  3. Search: SELECT * FROM trapper.v_search_unified_v3 WHERE search_text ILIKE ''%main st%'';'
\echo ''
