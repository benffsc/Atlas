-- MIG_2904: Add site contact columns to v_request_detail
-- Date: 2026-03-10
-- Purpose: Add site_contact_person_id, site_contact_name, email, phone,
--          requester_is_site_contact, and requester_role_at_submission to the view.
--          Also fix requester email/phone to use COALESCE(id_value_raw, id_value_norm)
--          for consistency with the GET route.
-- Ticket: FFS-442
--
-- NOTE: Must DROP + CREATE because new columns change column order/count
--       (CREATE OR REPLACE VIEW cannot add columns in the middle).
--       No dependent views exist (trapper schema already dropped).

\echo ''
\echo '=============================================='
\echo 'MIG_2904: Add site contact to v_request_detail'
\echo '=============================================='

-- Drop and recreate (column order changes require this)
DROP VIEW IF EXISTS ops.v_request_detail CASCADE;

CREATE VIEW ops.v_request_detail AS
SELECT
    r.request_id,
    r.status,
    r.priority,
    r.summary,
    r.notes AS description,
    r.internal_notes,
    r.estimated_cat_count,
    r.total_cats_reported,
    r.cat_count_semantic,
    r.hold_reason,
    r.resolution,
    r.resolved_at,
    r.assignment_status,
    r.no_trapper_reason,
    r.last_activity_at,
    r.source_system,
    r.source_record_id,
    r.created_at,
    r.updated_at,
    -- Place info
    r.place_id,
    pl.display_name AS place_name,
    pl.formatted_address AS place_address,
    COALESCE(
        ST_Y(pl.location::geometry),
        (SELECT sa.latitude FROM sot.addresses sa WHERE sa.address_id = pl.sot_address_id)
    ) AS latitude,
    COALESCE(
        ST_X(pl.location::geometry),
        (SELECT sa.longitude FROM sot.addresses sa WHERE sa.address_id = pl.sot_address_id)
    ) AS longitude,
    pl.place_kind,
    -- Requester info
    r.requester_person_id AS requester_id,
    p.display_name AS requester_name,
    (
        SELECT COALESCE(pi.id_value_raw, pi.id_value_norm)
        FROM sot.person_identifiers pi
        WHERE pi.person_id = r.requester_person_id
            AND pi.id_type = 'email'
            AND pi.confidence >= 0.5
        ORDER BY pi.confidence DESC
        LIMIT 1
    ) AS requester_email,
    (
        SELECT COALESCE(pi.id_value_raw, pi.id_value_norm)
        FROM sot.person_identifiers pi
        WHERE pi.person_id = r.requester_person_id
            AND pi.id_type = 'phone'
            AND pi.confidence >= 0.5
        ORDER BY pi.confidence DESC
        LIMIT 1
    ) AS requester_phone,
    r.requester_role_at_submission,
    r.requester_is_site_contact,
    -- Site contact info (MIG_2522)
    r.site_contact_person_id,
    sc.display_name AS site_contact_name,
    (
        SELECT COALESCE(pi.id_value_raw, pi.id_value_norm)
        FROM sot.person_identifiers pi
        WHERE pi.person_id = r.site_contact_person_id
            AND pi.id_type = 'email'
            AND pi.confidence >= 0.5
        ORDER BY pi.confidence DESC
        LIMIT 1
    ) AS site_contact_email,
    (
        SELECT COALESCE(pi.id_value_raw, pi.id_value_norm)
        FROM sot.person_identifiers pi
        WHERE pi.person_id = r.site_contact_person_id
            AND pi.id_type = 'phone'
            AND pi.confidence >= 0.5
        ORDER BY pi.confidence DESC
        LIMIT 1
    ) AS site_contact_phone,
    -- Trapper assignments
    (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'person_id', rta.trapper_person_id,
            'name', tp.display_name,
            'role', rta.assignment_type,
            'status', rta.status,
            'assigned_at', rta.assigned_at
        ) ORDER BY rta.assigned_at DESC), '[]'::jsonb)
        FROM ops.request_trapper_assignments rta
        JOIN sot.people tp ON tp.person_id = rta.trapper_person_id
        WHERE rta.request_id = r.request_id
            AND rta.status IN ('active', 'accepted', 'pending')
    ) AS trappers,
    -- Linked cats
    (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'cat_id', rc.cat_id,
            'name', c.name,
            'microchip', c.microchip,
            'altered_status', c.altered_status
        ) ORDER BY c.name), '[]'::jsonb)
        FROM ops.request_cats rc
        JOIN sot.cats c ON c.cat_id = rc.cat_id
            AND c.merged_into_cat_id IS NULL
        WHERE rc.request_id = r.request_id
    ) AS linked_cats,
    -- Media count
    (SELECT COUNT(*) FROM ops.request_media rm WHERE rm.request_id = r.request_id) AS media_count,
    -- Trapper count
    (
        SELECT COUNT(*)
        FROM ops.request_trapper_assignments rta
        WHERE rta.request_id = r.request_id
          AND rta.status IN ('active', 'accepted', 'pending')
    ) AS trapper_count,
    -- Is legacy request (from Airtable)
    (r.source_system = 'airtable') AS is_legacy_request,
    -- Days since creation
    EXTRACT(DAY FROM NOW() - r.created_at)::INT AS days_open,
    -- Days since last activity
    EXTRACT(DAY FROM NOW() - COALESCE(r.last_activity_at, r.updated_at, r.created_at))::INT AS days_since_activity
FROM ops.requests r
LEFT JOIN sot.places pl ON pl.place_id = r.place_id
    AND pl.merged_into_place_id IS NULL
LEFT JOIN sot.people p ON p.person_id = r.requester_person_id
    AND p.merged_into_person_id IS NULL
LEFT JOIN sot.people sc ON sc.person_id = r.site_contact_person_id
    AND sc.merged_into_person_id IS NULL;

COMMENT ON VIEW ops.v_request_detail IS 'Full request profile view with place, requester, site contact, trappers, and linked cats';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo 'Verifying new columns exist...'

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'v_request_detail'
  AND column_name IN ('site_contact_person_id', 'site_contact_name', 'site_contact_email',
                       'site_contact_phone', 'requester_is_site_contact', 'requester_role_at_submission')
ORDER BY column_name;

\echo ''
\echo 'Sample row count:'
SELECT COUNT(*) AS total_requests FROM ops.v_request_detail;

\echo ''
\echo 'MIG_2904 complete.'
