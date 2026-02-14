-- MIG_2080: Core Detail Views for V2
-- Date: 2026-02-14
-- Purpose: Create v_cat_detail and v_request_detail views for V2 schema
-- These replace V1 trapper.* detail views with proper V2 table references

\echo ''
\echo '=============================================='
\echo '  MIG_2080: Core Detail Views'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CAT DETAIL VIEW
-- ============================================================================

\echo '1. Creating sot.v_cat_detail...'

CREATE OR REPLACE VIEW sot.v_cat_detail AS
SELECT
    c.cat_id,
    c.name AS display_name,
    c.sex,
    c.altered_status,
    c.breed,
    c.color,
    c.primary_color,
    c.pattern,
    c.coat_length,
    c.microchip,
    c.clinichq_animal_id,
    c.shelterluv_animal_id,
    c.ownership_type,
    c.ear_tip,
    c.is_deceased,
    c.deceased_at,
    c.source_system AS data_source,
    c.merged_into_cat_id,
    c.created_at,
    c.updated_at,
    -- Identifiers as JSONB array
    (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'type', ci.id_type,
            'value', ci.id_value,
            'source', ci.source_system
        ) ORDER BY ci.id_type), '[]'::jsonb)
        FROM sot.cat_identifiers ci
        WHERE ci.cat_id = c.cat_id
    ) AS identifiers,
    -- Owners/people as JSONB array
    (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'person_id', pc.person_id,
            'name', p.display_name,
            'relationship_type', pc.relationship_type,
            'confidence', pc.confidence,
            'source_system', pc.source_system
        ) ORDER BY pc.confidence DESC NULLS LAST, pc.created_at DESC), '[]'::jsonb)
        FROM sot.person_cat pc
        JOIN sot.people p ON p.person_id = pc.person_id
            AND p.merged_into_person_id IS NULL
        WHERE pc.cat_id = c.cat_id
    ) AS owners,
    -- Places as JSONB array
    (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'place_id', cp.place_id,
            'name', pl.display_name,
            'address', pl.formatted_address,
            'relationship_type', cp.relationship_type,
            'confidence', cp.confidence,
            'source_system', cp.source_system
        ) ORDER BY cp.confidence DESC NULLS LAST, cp.created_at DESC), '[]'::jsonb)
        FROM sot.cat_place cp
        JOIN sot.places pl ON pl.place_id = cp.place_id
            AND pl.merged_into_place_id IS NULL
        WHERE cp.cat_id = c.cat_id
    ) AS places,
    -- Appointment history summary
    (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'appointment_id', a.appointment_id,
            'date', a.appointment_date,
            'service_type', a.service_type,
            'is_alteration', a.is_alteration
        ) ORDER BY a.appointment_date DESC), '[]'::jsonb)
        FROM ops.appointments a
        WHERE a.cat_id = c.cat_id
    ) AS appointments,
    -- Counts
    (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.cat_id = c.cat_id) AS owner_count,
    (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id) AS place_count,
    (SELECT COUNT(*) FROM ops.appointments a WHERE a.cat_id = c.cat_id) AS appointment_count
FROM sot.cats c
WHERE c.merged_into_cat_id IS NULL;

COMMENT ON VIEW sot.v_cat_detail IS 'Full cat profile view with identifiers, owners, places, and appointment history';

-- ============================================================================
-- 2. REQUEST DETAIL VIEW
-- ============================================================================

\echo ''
\echo '2. Creating ops.v_request_detail...'

CREATE OR REPLACE VIEW ops.v_request_detail AS
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
        SELECT pi.id_value_norm
        FROM sot.person_identifiers pi
        WHERE pi.person_id = r.requester_person_id
            AND pi.id_type = 'email'
            AND pi.confidence >= 0.5
        ORDER BY pi.confidence DESC
        LIMIT 1
    ) AS requester_email,
    (
        SELECT pi.id_value_norm
        FROM sot.person_identifiers pi
        WHERE pi.person_id = r.requester_person_id
            AND pi.id_type = 'phone'
            AND pi.confidence >= 0.5
        ORDER BY pi.confidence DESC
        LIMIT 1
    ) AS requester_phone,
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
    AND p.merged_into_person_id IS NULL;

COMMENT ON VIEW ops.v_request_detail IS 'Full request profile view with place, requester, trappers, and linked cats';

-- ============================================================================
-- 3. COMPATIBILITY VIEW IN TRAPPER SCHEMA
-- ============================================================================

\echo ''
\echo '3. Creating trapper compatibility views...'

-- Create trapper.v_cat_detail pointing to sot.v_cat_detail
CREATE OR REPLACE VIEW trapper.v_cat_detail AS
SELECT * FROM sot.v_cat_detail;

-- Create trapper.v_request_detail pointing to ops.v_request_detail
CREATE OR REPLACE VIEW trapper.v_request_detail AS
SELECT * FROM ops.v_request_detail;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

SELECT 'sot.v_cat_detail' AS view_name, COUNT(*) AS row_count FROM sot.v_cat_detail
UNION ALL
SELECT 'ops.v_request_detail', COUNT(*) FROM ops.v_request_detail;

\echo ''
\echo '=============================================='
\echo '  MIG_2080 Complete!'
\echo '=============================================='
\echo ''
