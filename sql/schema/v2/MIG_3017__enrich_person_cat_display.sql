-- MIG_3017: Enrich Person-Cat Display with Adoption/Source Context
--
-- Problem: Person detail page shows cats with just name + relationship badge.
-- For adopters like Audra Nay, there's no adoption date, no source system,
-- no placement type — just "Adopter" badge. Staff can't see WHEN or HOW
-- the adoption happened.
--
-- Fix: Enrich the cats JSONB in v_person_detail with adoption_date,
-- source_system, placement_type, and data_source from existing tables.
--
-- Created: 2026-03-31

\echo ''
\echo '=============================================='
\echo '  MIG_3017: Enrich Person-Cat Display'
\echo '=============================================='
\echo ''

-- ============================================================================
-- Update v_person_detail cats subquery
-- ============================================================================
-- The view's cats JSON currently has: cat_id, name, microchip, sex, relationship_type
-- We add: source_system, data_source, adoption_date, placement_type

\echo '1. Updating v_person_detail cats subquery...'

-- Must DROP + CREATE because we're adding new columns to the cats JSON
DROP VIEW IF EXISTS sot.v_person_detail CASCADE;

CREATE VIEW sot.v_person_detail AS
SELECT
    p.person_id,
    p.display_name,
    p.first_name,
    p.last_name,
    p.source_system,
    p.data_source,
    p.source_record_id,
    p.source_created_at,
    p.entity_type,
    p.primary_place_id,
    pl.formatted_address AS primary_place_address,
    p.primary_address_id,
    p.data_quality,
    p.created_at,
    p.updated_at,
    -- Places subquery
    COALESCE((
        SELECT json_agg(json_build_object(
            'place_id', pp.place_id,
            'display_name', COALESCE(pp_pl.display_name, split_part(pp_pl.formatted_address, ',', 1)),
            'formatted_address', pp_pl.formatted_address,
            'relationship_type', pp.relationship_type,
            'source_system', pp.source_system
        ))
        FROM sot.person_place pp
        JOIN sot.places pp_pl ON pp_pl.place_id = pp.place_id AND pp_pl.merged_into_place_id IS NULL
        WHERE pp.person_id = p.person_id
    ), '[]'::json) AS places,
    -- ENRICHED cats subquery (MIG_3017): adds source_system, data_source, adoption_date, placement_type
    COALESCE((
        SELECT json_agg(json_build_object(
            'cat_id', c.cat_id,
            'name', COALESCE(c.name, 'Unknown'),
            'microchip', c.microchip,
            'sex', c.sex,
            'relationship_type', pc.relationship_type,
            'source_system', pc.source_system,
            'data_source', COALESCE(c.data_source, c.source_system),
            'adoption_date', vac.adoption_date,
            'placement_type', vac.placement_type
        ))
        FROM sot.person_cat pc
        JOIN sot.cats c ON c.cat_id = pc.cat_id AND c.merged_into_cat_id IS NULL
        LEFT JOIN sot.v_adoption_context vac ON vac.cat_id = pc.cat_id AND vac.adopter_person_id = pc.person_id
        WHERE pc.person_id = p.person_id
    ), '[]'::json) AS cats,
    -- Roles subquery
    COALESCE((
        SELECT json_agg(json_build_object(
            'role', pr.role,
            'role_status', pr.role_status,
            'trapper_type', pr.trapper_type,
            'started_at', pr.started_at,
            'ended_at', pr.ended_at
        ))
        FROM sot.person_roles pr
        WHERE pr.person_id = p.person_id
    ), '[]'::json) AS roles,
    -- Counts
    (SELECT COUNT(*)::integer FROM sot.person_cat pc WHERE pc.person_id = p.person_id) AS cat_count,
    (SELECT COUNT(*)::integer FROM sot.person_place pp WHERE pp.person_id = p.person_id) AS place_count,
    (SELECT COUNT(*)::integer FROM ops.requests r WHERE r.requester_person_id = p.person_id) AS request_count,
    (SELECT COUNT(*)::integer FROM ops.appointments a WHERE a.person_id = p.person_id OR a.resolved_person_id = p.person_id) AS appointment_count
FROM sot.people p
LEFT JOIN sot.places pl ON pl.place_id = p.primary_place_id AND pl.merged_into_place_id IS NULL
WHERE p.merged_into_person_id IS NULL;

COMMENT ON VIEW sot.v_person_detail IS
'Person detail view with enriched cats JSONB including adoption_date,
source_system, placement_type, and data_source. MIG_3017.';

\echo '   View updated'

-- ============================================================================
-- Verification
-- ============================================================================

\echo ''
\echo 'Audra Nay cats (should now show adoption context):'
SELECT jsonb_pretty(cats::jsonb)
FROM sot.v_person_detail
WHERE person_id = '8b092fbf-ba2d-49c7-a4d3-4050efe5386c';

\echo ''
\echo '=============================================='
\echo '  MIG_3017 Complete'
\echo '=============================================='
