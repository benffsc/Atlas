-- MIG_162__add_microchip_to_person_detail_view.sql
-- Add microchip number to cats in v_person_detail view
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_162__add_microchip_to_person_detail_view.sql

\echo ''
\echo 'MIG_162: Add Microchip to Person Detail View'
\echo '============================================='
\echo ''

-- Update v_person_detail to include microchip in cats
CREATE OR REPLACE VIEW trapper.v_person_detail AS
SELECT
    person_id,
    display_name,
    merged_into_person_id,
    created_at,
    updated_at,
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
    (
        SELECT jsonb_agg(
            jsonb_build_object(
                'place_id', ppr.place_id,
                'place_name', pl.display_name,
                'formatted_address', pl.formatted_address,
                'place_kind', pl.place_kind,
                'role', ppr.role,
                'confidence', ppr.confidence
            )
            ORDER BY ppr.role, pl.display_name
        )
        FROM trapper.person_place_relationships ppr
        JOIN trapper.places pl ON pl.place_id = ppr.place_id
        WHERE ppr.person_id = p.person_id
    ) AS places,
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
    (SELECT count(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id) AS place_count
FROM trapper.sot_people p
WHERE merged_into_person_id IS NULL;

\echo 'View updated successfully'

-- Verify
\echo ''
\echo 'Sample cat with microchip:'
SELECT cats->0 as sample_cat
FROM trapper.v_person_detail
WHERE cat_count > 0
LIMIT 1;

SELECT 'MIG_162 Complete' AS status;
