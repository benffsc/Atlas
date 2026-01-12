-- MIG_143__search_people_by_cat_microchip.sql
-- Enhance unified search VIEW to include people's linked cat microchips
--
-- Problem:
--   When searching for microchip 981020053084012, only the cat shows up.
--   Staff need to see the person (Dee Anne Thom) who brought that cat in.
--
-- Solution:
--   Add linked cat identifiers to person's search_text_extra in the view.
--   (The actual search function is updated in MIG_144)
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_143__search_people_by_cat_microchip.sql

-- ============================================================
-- Update v_search_unified_v3 to include cat identifiers for people
-- ============================================================

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
        'data_source', c.data_source,
        'owner_count', (SELECT COUNT(DISTINCT trapper.canonical_person_id(pcr.person_id))
                        FROM trapper.person_cat_relationships pcr
                        WHERE pcr.cat_id = c.cat_id AND pcr.relationship_type = 'owner'),
        'has_place', EXISTS (SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.cat_id = c.cat_id)
    ) AS metadata

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

-- PEOPLE (now includes linked cat identifiers for search by microchip)
SELECT
    'person'::TEXT AS entity_type,
    p.person_id::TEXT AS entity_id,
    p.display_name AS display,
    -- Improved subtitle showing ClinicHQ cat count vs total
    COALESCE(
        (SELECT
            CASE
                WHEN COUNT(*) FILTER (WHERE c.data_source = 'clinichq') > 0 THEN
                    COUNT(*) FILTER (WHERE c.data_source = 'clinichq')::TEXT || ' ClinicHQ cats' ||
                    CASE WHEN COUNT(*) > COUNT(*) FILTER (WHERE c.data_source = 'clinichq')
                         THEN ', ' || (COUNT(*) - COUNT(*) FILTER (WHERE c.data_source = 'clinichq'))::TEXT || ' other'
                         ELSE ''
                    END
                ELSE
                    COUNT(*)::TEXT || ' cats'
            END
         FROM trapper.person_cat_relationships pcr
         JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
         WHERE pcr.person_id = p.person_id),
        ''
    ) AS subtitle,
    p.display_name AS search_text,
    -- NEW: Include all microchips from linked cats so people are found by cat microchip
    (SELECT string_agg(DISTINCT ci.id_value, ' ')
     FROM trapper.person_cat_relationships pcr
     JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id
     WHERE pcr.person_id = p.person_id
       AND ci.id_type = 'microchip') AS search_text_extra,
    p.created_at AS last_activity,
    jsonb_build_object(
        'cat_count', (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id),
        'clinichq_cat_count', (SELECT COUNT(*)
                               FROM trapper.person_cat_relationships pcr
                               JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
                               WHERE pcr.person_id = p.person_id AND c.data_source = 'clinichq'),
        'place_count', (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id),
        'is_merged', p.merged_into_person_id IS NOT NULL
    ) AS metadata
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL;  -- Only canonical people

COMMENT ON VIEW trapper.v_search_unified_v3 IS
'Unified search view across cats, places, and people.
People are now searchable by their linked cats'' microchips.
search_text + search_text_extra are used for full-text matching.
entity_type: cat | place | person
metadata: entity-specific attributes as JSONB.';

-- ============================================================
-- Verification
-- ============================================================

-- Test: Search for a microchip and see both cat AND person
SELECT 'MIG_143 Complete' AS status;

\echo ''
\echo 'Testing microchip search (should now return both cat AND person):'
SELECT entity_type, display, subtitle
FROM trapper.v_search_unified_v3
WHERE search_text_extra ILIKE '%981020053084012%'
ORDER BY
    CASE entity_type
        WHEN 'person' THEN 1  -- People first (staff usually want the caller)
        WHEN 'cat' THEN 2
        ELSE 3
    END;

\echo ''
\echo 'Sample people with cat microchips in search_text_extra:'
SELECT display,
       LEFT(search_text_extra, 50) as microchips_preview,
       metadata->>'clinichq_cat_count' as clinichq_cats
FROM trapper.v_search_unified_v3
WHERE entity_type = 'person'
  AND search_text_extra IS NOT NULL
LIMIT 5;
