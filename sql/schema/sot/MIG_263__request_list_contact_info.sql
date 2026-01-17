-- MIG_263: Add Requester Contact Info to Request List View
--
-- Problem:
--   Request list view only returns requester name, not phone/email.
--   Staff need to see contact info quickly without drilling into detail page.
--
-- Solution:
--   Add requester_email and requester_phone to v_request_list view.
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_263__request_list_contact_info.sql

\echo ''
\echo '=============================================='
\echo 'MIG_263: Request List Contact Info'
\echo '=============================================='
\echo ''

-- Recreate v_request_list with contact info
DROP VIEW IF EXISTS trapper.v_request_list CASCADE;

CREATE VIEW trapper.v_request_list AS
SELECT
    r.request_id,
    r.status::TEXT,
    r.priority::TEXT,
    r.summary,
    r.estimated_cat_count,
    r.has_kittens,
    r.scheduled_date,
    r.assigned_to,
    r.assigned_trapper_type::TEXT,
    r.created_at,
    r.updated_at,
    r.source_created_at,
    r.last_activity_at,
    r.hold_reason::TEXT,
    -- Place info (use address if place name matches requester name)
    r.place_id,
    CASE
      WHEN p.display_name IS NOT NULL AND per.display_name IS NOT NULL
        AND LOWER(TRIM(p.display_name)) = LOWER(TRIM(per.display_name))
      THEN COALESCE(SPLIT_PART(p.formatted_address, ',', 1), p.formatted_address)
      ELSE COALESCE(p.display_name, SPLIT_PART(p.formatted_address, ',', 1))
    END AS place_name,
    p.formatted_address AS place_address,
    p.safety_notes AS place_safety_notes,
    sa.locality AS place_city,
    p.service_zone,
    ST_Y(p.location::geometry) AS latitude,
    ST_X(p.location::geometry) AS longitude,
    -- Requester info with contact details
    r.requester_person_id,
    per.display_name AS requester_name,
    -- Email: prefer primary_email, fall back to most recent identifier
    COALESCE(
        per.primary_email,
        (SELECT pi.id_value FROM trapper.person_identifiers pi
         WHERE pi.person_id = per.person_id AND pi.id_type = 'email'
         ORDER BY pi.created_at DESC LIMIT 1)
    ) AS requester_email,
    -- Phone: prefer primary_phone, fall back to most recent identifier
    COALESCE(
        per.primary_phone,
        (SELECT pi.id_value FROM trapper.person_identifiers pi
         WHERE pi.person_id = per.person_id AND pi.id_type = 'phone'
         ORDER BY pi.created_at DESC LIMIT 1)
    ) AS requester_phone,
    -- Cat count
    (SELECT COUNT(*) FROM trapper.request_cats rc WHERE rc.request_id = r.request_id) AS linked_cat_count,
    -- Staleness
    EXTRACT(DAY FROM NOW() - COALESCE(r.last_activity_at, r.created_at))::INT AS days_since_activity,
    -- Is this a legacy Airtable request?
    r.source_system = 'airtable' AS is_legacy_request
FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = p.sot_address_id
LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id;

COMMENT ON VIEW trapper.v_request_list IS
'Request list view for queue display with requester contact info.
Uses smart place_name logic (shows address when name matches requester).
Includes requester_email and requester_phone for quick contact access.';

\echo ''
\echo 'v_request_list now includes:'
\echo '  - requester_email (primary_email or most recent identifier)'
\echo '  - requester_phone (primary_phone or most recent identifier)'
\echo ''

SELECT 'MIG_263 Complete' AS status;
