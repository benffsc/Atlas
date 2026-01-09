-- VIEW_052__intake_unified_feed
-- Unified feed combining appointment requests and upcoming appointments
-- Contract: explicit columns, no ORDER BY
CREATE OR REPLACE VIEW trapper.v_intake_unified_feed AS

-- Appointment requests (demand)
SELECT
    'appointment_request'::text AS feed_type,
    false AS is_scheduled,
    (ar.submitted_at AT TIME ZONE 'America/Los_Angeles')::date AS event_date,
    ar.submitted_at,
    NULL::date AS appt_date,
    CASE
        WHEN NULLIF(TRIM(COALESCE(ar.first_name, '') || ' ' || COALESCE(ar.last_name, '')), '') IS NOT NULL
        THEN TRIM(COALESCE(ar.first_name, '') || ' ' || COALESCE(ar.last_name, ''))
        ELSE NULLIF(TRIM(ar.requester_name), '')
    END AS person_full_name,
    ar.email,
    ar.phone,
    COALESCE(NULLIF(TRIM(ar.cats_address_clean), ''), NULLIF(TRIM(ar.cats_address), '')) AS address,
    ar.county,
    ar.submission_status AS status,
    NULL::text AS animal_name,
    NULL::text AS ownership_type,
    NULL::text AS client_type,
    ar.source_system,
    ar.source_file,
    ar.source_row_hash,
    ar.created_at,
    ar.updated_at,
    ar.id
FROM trapper.appointment_requests ar

UNION ALL

-- Upcoming appointments (scheduled)
SELECT
    'upcoming_appointment'::text AS feed_type,
    true AS is_scheduled,
    ua.appt_date AS event_date,
    NULL::timestamptz AS submitted_at,
    ua.appt_date,
    CASE
        WHEN NULLIF(TRIM(COALESCE(ua.client_first_name, '') || ' ' || COALESCE(ua.client_last_name, '')), '') IS NOT NULL
        THEN TRIM(COALESCE(ua.client_first_name, '') || ' ' || COALESCE(ua.client_last_name, ''))
        ELSE NULL
    END AS person_full_name,
    ua.client_email AS email,
    COALESCE(NULLIF(TRIM(ua.client_cell_phone), ''), NULLIF(TRIM(ua.client_phone), '')) AS phone,
    NULLIF(TRIM(ua.client_address), '') AS address,
    NULL::text AS county,
    NULL::text AS status,
    ua.animal_name,
    ua.ownership_type,
    ua.client_type,
    ua.source_system,
    ua.source_file,
    ua.source_row_hash,
    ua.created_at,
    ua.updated_at,
    ua.id
FROM trapper.clinichq_upcoming_appointments ua;
