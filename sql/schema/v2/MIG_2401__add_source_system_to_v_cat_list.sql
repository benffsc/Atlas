-- MIG_2401: Add source_system to v_cat_list view
-- Date: 2026-02-21
-- Issue: Cats API needs source_system for data provenance display
-- The API at /api/cats/route.ts expects source_system column

CREATE OR REPLACE VIEW sot.v_cat_list AS
SELECT
    c.cat_id,
    COALESCE(c.name, 'Unknown') AS display_name,
    c.sex,
    c.altered_status,
    c.breed,
    cq.microchip,
    COALESCE(cq.quality_tier, 'unranked') AS quality_tier,
    COALESCE(cq.quality_reason, 'Not assessed') AS quality_reason,
    COALESCE(cq.has_microchip, FALSE) AS has_microchip,
    -- Owner count
    COALESCE(
        (SELECT COUNT(DISTINCT pc.person_id)
         FROM sot.person_cat pc
         WHERE pc.cat_id = c.cat_id),
        0
    ) AS owner_count,
    -- Owner names
    (SELECT string_agg(DISTINCT p.display_name, ', ' ORDER BY p.display_name)
     FROM sot.person_cat pc
     JOIN sot.people p ON p.person_id = pc.person_id
     WHERE pc.cat_id = c.cat_id
       AND p.merged_into_person_id IS NULL) AS owner_names,
    -- Primary place
    cpp.place_id AS primary_place_id,
    cpp.place_name AS primary_place_label,
    cpp.place_kind,
    (cpp.place_id IS NOT NULL) AS has_place,
    c.created_at,
    c.updated_at,
    -- Last visit date from appointments
    (SELECT MAX(a.appointment_date)
     FROM ops.appointments a
     WHERE a.cat_id = c.cat_id) AS last_visit_date,
    -- Total visit count
    COALESCE(
        (SELECT COUNT(*)
         FROM ops.appointments a
         WHERE a.cat_id = c.cat_id),
        0
    ) AS visit_count,
    -- NEW: source_system for data provenance
    c.source_system
FROM sot.cats c
LEFT JOIN sot.v_cat_quality cq ON cq.cat_id = c.cat_id
LEFT JOIN sot.v_cat_primary_place cpp ON cpp.cat_id = c.cat_id
WHERE c.merged_into_cat_id IS NULL
  AND COALESCE(c.data_quality, 'good') NOT IN ('garbage', 'needs_review');

COMMENT ON VIEW sot.v_cat_list IS 'Cat list view for /api/cats endpoint. Updated in MIG_2401 to include source_system for data provenance.';
