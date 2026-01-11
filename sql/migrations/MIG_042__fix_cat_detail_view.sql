-- MIG_042__fix_cat_detail_view.sql
-- Fix v_cat_detail view to match API contract
--
-- Purpose:
--   The cat detail API expects specific column names and JSON structures
--   that don't match the current view. This migration fixes the contract.
--
-- Changes:
--   - primary_color -> color (alias)
--   - Add coat_pattern (NULL for now, can be added to sot_cats later)
--   - Extract microchip from identifiers
--   - all_places -> places with correct structure {place_id, label, place_kind, role}
--   - owners structure: {person_id, display_name, role}
--   - identifiers structure: {type, value, source}
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_042__fix_cat_detail_view.sql

\echo '============================================'
\echo 'MIG_042: Fix Cat Detail View'
\echo '============================================'

\echo ''
\echo 'Dropping and recreating v_cat_detail...'

DROP VIEW IF EXISTS trapper.v_cat_detail CASCADE;

CREATE VIEW trapper.v_cat_detail AS
SELECT
    c.cat_id,
    c.display_name,
    c.sex,
    c.altered_status,
    c.breed,
    c.primary_color AS color,
    NULL::TEXT AS coat_pattern,  -- Not stored yet, can add to sot_cats later
    -- Extract microchip from identifiers
    (
        SELECT ci.id_value
        FROM trapper.cat_identifiers ci
        WHERE ci.cat_id = c.cat_id
        AND ci.id_type = 'microchip'
        LIMIT 1
    ) AS microchip,
    -- Quality tier from v_cat_quality
    cq.quality_tier,
    cq.quality_reason,
    c.notes,
    c.created_at,
    c.updated_at,
    -- Identifiers with API-expected structure
    (
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'type', ci.id_type,
                'value', ci.id_value,
                'source', ci.source_system
            )
            ORDER BY ci.id_type
        ), '[]'::jsonb)
        FROM trapper.cat_identifiers ci
        WHERE ci.cat_id = c.cat_id
    ) AS identifiers,
    -- Owners with API-expected structure
    (
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'person_id', trapper.canonical_person_id(pcr.person_id),
                'display_name', p.display_name,
                'role', pcr.relationship_type
            )
            ORDER BY pcr.relationship_type, p.display_name
        ), '[]'::jsonb)
        FROM trapper.person_cat_relationships pcr
        JOIN trapper.sot_people p ON p.person_id = trapper.canonical_person_id(pcr.person_id)
        WHERE pcr.cat_id = c.cat_id
    ) AS owners,
    -- Places with API-expected structure
    (
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'place_id', cpr.place_id,
                'label', pl.display_name,
                'place_kind', pl.place_kind,
                'role', cpr.relationship_type
            )
            ORDER BY cpr.relationship_type
        ), '[]'::jsonb)
        FROM trapper.cat_place_relationships cpr
        JOIN trapper.places pl ON pl.place_id = cpr.place_id
        WHERE cpr.cat_id = c.cat_id
    ) AS places
FROM trapper.sot_cats c
LEFT JOIN trapper.v_cat_quality cq ON cq.cat_id = c.cat_id;

COMMENT ON VIEW trapper.v_cat_detail IS
'Cat detail view matching the API contract.
Columns: cat_id, display_name, sex, altered_status, breed, color, coat_pattern,
microchip, notes, created_at, updated_at, identifiers[], owners[], places[]';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_042 Complete'
\echo '============================================'

\echo ''
\echo 'Testing v_cat_detail columns:'
SELECT column_name
FROM information_schema.columns
WHERE table_schema='trapper' AND table_name='v_cat_detail'
ORDER BY ordinal_position;

\echo ''
\echo 'Sample cat detail:'
SELECT cat_id, display_name, color, microchip,
       jsonb_array_length(identifiers) AS num_identifiers,
       jsonb_array_length(owners) AS num_owners,
       jsonb_array_length(places) AS num_places
FROM trapper.v_cat_detail
LIMIT 3;
