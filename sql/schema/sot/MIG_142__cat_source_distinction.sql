-- MIG_142__cat_source_distinction.sql
-- Add data_source to cat views to distinguish ClinicHQ patients from PetLink-only cats
--
-- Purpose:
--   Staff need to immediately see which cats actually came to clinic (ClinicHQ)
--   vs cats that are just microchip registrations (PetLink).
--
-- Changes:
--   - Add data_source to v_cat_detail
--   - Add data_source to cats array in v_person_detail
--
-- MANUAL APPLY:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_142__cat_source_distinction.sql

-- ============================================================
-- 1. Update v_cat_detail to include data_source
-- ============================================================

DROP VIEW IF EXISTS trapper.v_cat_detail CASCADE;

CREATE VIEW trapper.v_cat_detail AS
SELECT
    c.cat_id,
    c.display_name,
    c.sex,
    c.altered_status,
    c.breed,
    c.primary_color AS color,
    NULL::TEXT AS coat_pattern,
    c.data_source,  -- NEW: clinichq, petlink, or legacy_import
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
'Cat detail view with data_source to distinguish ClinicHQ patients from PetLink registrations.
data_source: clinichq (actual clinic patient), petlink (microchip only), legacy_import (historical)';

-- ============================================================
-- 2. Update v_person_detail to include cat data_source
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_person_detail AS
SELECT
    p.person_id,
    p.display_name,
    p.merged_into_person_id,
    p.created_at,
    p.updated_at,
    -- Cat relationships - NOW includes data_source from sot_cats
    (SELECT jsonb_agg(jsonb_build_object(
        'cat_id', pcr.cat_id,
        'cat_name', c.display_name,
        'relationship_type', pcr.relationship_type,
        'confidence', pcr.confidence,
        'source_system', pcr.source_system,
        'data_source', c.data_source  -- NEW: clinichq, petlink, or legacy_import
    ) ORDER BY
        -- ClinicHQ cats first, then legacy, then petlink
        CASE c.data_source
            WHEN 'clinichq' THEN 1
            WHEN 'legacy_import' THEN 2
            ELSE 3
        END,
        pcr.relationship_type,
        c.display_name)
     FROM trapper.person_cat_relationships pcr
     JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
     WHERE pcr.person_id = p.person_id) AS cats,
    -- Place relationships
    (SELECT jsonb_agg(jsonb_build_object(
        'place_id', ppr.place_id,
        'place_name', pl.display_name,
        'formatted_address', pl.formatted_address,
        'place_kind', pl.place_kind,
        'role', ppr.role,
        'confidence', ppr.confidence
    ) ORDER BY ppr.role, pl.display_name)
     FROM trapper.person_place_relationships ppr
     JOIN trapper.places pl ON pl.place_id = ppr.place_id
     WHERE ppr.person_id = p.person_id) AS places,
    -- Person relationships (from edges)
    (SELECT jsonb_agg(jsonb_build_object(
        'person_id', CASE WHEN ppe.person_id_a = p.person_id THEN ppe.person_id_b ELSE ppe.person_id_a END,
        'person_name', CASE WHEN ppe.person_id_a = p.person_id THEN p2.display_name ELSE p1.display_name END,
        'relationship_type', rt.code,
        'relationship_label', rt.label,
        'confidence', ppe.confidence
    ) ORDER BY rt.label)
     FROM trapper.person_person_edges ppe
     JOIN trapper.relationship_types rt ON rt.id = ppe.relationship_type_id
     LEFT JOIN trapper.sot_people p1 ON p1.person_id = ppe.person_id_a
     LEFT JOIN trapper.sot_people p2 ON p2.person_id = ppe.person_id_b
     WHERE ppe.person_id_a = p.person_id OR ppe.person_id_b = p.person_id) AS person_relationships,
    -- Stats
    (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id) AS cat_count,
    (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id) AS place_count
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL;

COMMENT ON VIEW trapper.v_person_detail IS
'Full person detail for API. Cats include data_source (clinichq/petlink/legacy_import) to distinguish actual clinic patients from microchip-only registrations.';

-- ============================================================
-- Verification
-- ============================================================

DO $$
DECLARE
    v_clinichq_count INT;
    v_petlink_count INT;
BEGIN
    SELECT COUNT(*) INTO v_clinichq_count FROM trapper.sot_cats WHERE data_source = 'clinichq';
    SELECT COUNT(*) INTO v_petlink_count FROM trapper.sot_cats WHERE data_source = 'petlink';

    RAISE NOTICE 'MIG_142: Cat source distinction added';
    RAISE NOTICE '  - ClinicHQ patients: %', v_clinichq_count;
    RAISE NOTICE '  - PetLink registrations: %', v_petlink_count;
END $$;

SELECT 'MIG_142 Complete' AS status;

-- Test: Show sample person with cats from different sources
SELECT
    p.display_name,
    jsonb_array_length(p.cats) AS total_cats,
    (SELECT COUNT(*) FROM jsonb_array_elements(p.cats) c WHERE c->>'data_source' = 'clinichq') AS clinichq_cats,
    (SELECT COUNT(*) FROM jsonb_array_elements(p.cats) c WHERE c->>'data_source' = 'petlink') AS petlink_cats
FROM trapper.v_person_detail p
WHERE jsonb_array_length(p.cats) > 0
LIMIT 3;
