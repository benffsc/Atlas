-- MIG_149__search_aliases.sql
-- Add person alias searching to unified search
--
-- Problem:
--   Search for "Cal Eggs" returns nothing because Cal Eggs FFSC
--   is stored as a person_alias, not a display_name.
--
-- Solution:
--   Update search_unified to also search person_aliases.
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_149__search_aliases.sql

-- ============================================================
-- 1. Create index on person_aliases for search
-- ============================================================

\echo ''
\echo 'Creating index on person_aliases for search...'

CREATE INDEX IF NOT EXISTS idx_person_aliases_name_raw_trgm
ON trapper.person_aliases USING gin (name_raw gin_trgm_ops);

-- ============================================================
-- 2. Create view that includes aliases in search text
-- ============================================================

\echo 'Creating v_person_search_text view...'

CREATE OR REPLACE VIEW trapper.v_person_search_text AS
SELECT
    p.person_id,
    p.display_name,
    p.entity_type,
    p.data_source,
    -- Concatenate all alias names for search
    (
        SELECT string_agg(DISTINCT pa.name_raw, ' | ')
        FROM trapper.person_aliases pa
        WHERE pa.person_id = p.person_id
    ) AS alias_names,
    -- Best alias for display (most common or most recent)
    (
        SELECT pa.name_raw
        FROM trapper.person_aliases pa
        WHERE pa.person_id = p.person_id
        GROUP BY pa.name_raw
        ORDER BY COUNT(*) DESC, MAX(pa.created_at) DESC
        LIMIT 1
    ) AS primary_alias
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL;

COMMENT ON VIEW trapper.v_person_search_text IS
'View of people with their aliases concatenated for search.';

-- ============================================================
-- 3. Update v_search_unified_v3 to include aliases
-- ============================================================

\echo 'Updating v_search_unified_v3 to include aliases...'

-- First drop the existing view
DROP VIEW IF EXISTS trapper.v_search_unified_v3 CASCADE;

-- Recreate with alias support
CREATE OR REPLACE VIEW trapper.v_search_unified_v3 AS
-- Cats
SELECT
    'cat'::TEXT AS entity_type,
    c.cat_id::TEXT AS entity_id,
    c.display_name,
    COALESCE(
        (SELECT 'Microchip: ' || ci.id_value
         FROM trapper.cat_identifiers ci
         WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
         LIMIT 1),
        TRIM(COALESCE(c.sex, '') || ' ' || COALESCE(c.altered_status, '') || ' ' || COALESCE(c.breed, ''))
    ) AS subtitle,
    c.display_name || ' ' || COALESCE(
        (SELECT string_agg(ci.id_value, ' ')
         FROM trapper.cat_identifiers ci
         WHERE ci.cat_id = c.cat_id),
        ''
    ) AS search_text,
    '' AS search_text_extra,
    jsonb_build_object(
        'sex', c.sex,
        'altered_status', c.altered_status,
        'breed', c.breed,
        'data_source', c.data_source,
        'has_place', EXISTS (SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.cat_id = c.cat_id),
        'owner_count', (SELECT COUNT(DISTINCT trapper.canonical_person_id(pcr.person_id))
                        FROM trapper.person_cat_relationships pcr
                        WHERE pcr.cat_id = c.cat_id AND pcr.relationship_type = 'owner')
    ) AS metadata
FROM trapper.sot_cats c

UNION ALL

-- People (with aliases)
SELECT
    'person'::TEXT AS entity_type,
    p.person_id::TEXT AS entity_id,
    COALESCE(p.display_name, pst.primary_alias, 'Unknown') AS display_name,
    CASE
        WHEN p.entity_type = 'site' THEN 'Site'
        WHEN p.entity_type = 'unknown' THEN 'Needs Review'
        ELSE COALESCE(
            (SELECT COUNT(*)::TEXT || ' cats'
             FROM trapper.person_cat_relationships pcr
             WHERE pcr.person_id = p.person_id),
            '0 cats'
        )
    END AS subtitle,
    -- Search text includes display_name AND all aliases
    COALESCE(p.display_name, '') || ' ' || COALESCE(pst.alias_names, '') AS search_text,
    -- Extra search includes cat microchips for this person
    COALESCE(
        (SELECT string_agg(ci.id_value, ' ')
         FROM trapper.person_cat_relationships pcr
         JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id AND ci.id_type = 'microchip'
         WHERE pcr.person_id = p.person_id),
        ''
    ) AS search_text_extra,
    jsonb_build_object(
        'entity_type', p.entity_type,
        'data_source', p.data_source,
        'cat_count', (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id),
        'is_merged', p.merged_into_person_id IS NOT NULL,
        'place_count', (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id),
        'has_identifiers', EXISTS (SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id),
        'alias_count', (SELECT COUNT(*) FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id)
    ) AS metadata
FROM trapper.sot_people p
LEFT JOIN trapper.v_person_search_text pst ON pst.person_id = p.person_id
WHERE p.merged_into_person_id IS NULL

UNION ALL

-- Places
SELECT
    'place'::TEXT AS entity_type,
    pl.place_id::TEXT AS entity_id,
    COALESCE(pl.display_name, pl.formatted_address, 'Unknown Place') AS display_name,
    COALESCE(pl.formatted_address, '') AS subtitle,
    COALESCE(pl.display_name, '') || ' ' || COALESCE(pl.formatted_address, '') AS search_text,
    '' AS search_text_extra,
    jsonb_build_object(
        'place_kind', pl.place_kind,
        'effective_type', pl.effective_type,
        'has_activity', pl.has_trapping_activity OR pl.has_appointment_activity OR pl.has_cat_activity
    ) AS metadata
FROM trapper.places pl;

COMMENT ON VIEW trapper.v_search_unified_v3 IS
'Unified search view v3 with person alias support. Use search_unified() function for ranked results.';

-- ============================================================
-- 4. Verification
-- ============================================================

\echo ''
\echo 'Testing search for Cal Eggs...'
SELECT
    entity_type,
    entity_id,
    display_name,
    subtitle,
    LEFT(search_text, 100) as search_text_preview
FROM trapper.v_search_unified_v3
WHERE search_text ILIKE '%cal egg%'
LIMIT 5;

SELECT 'MIG_149 Complete' AS status;
