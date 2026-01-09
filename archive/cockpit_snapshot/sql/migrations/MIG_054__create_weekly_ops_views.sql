-- MIG_054__create_weekly_ops_views
-- Creates unified intake feed and this-week focus views for weekly ops
-- Depends on: MIG_050, MIG_051, MIG_052, MIG_053
BEGIN;

-- Unified feed combining appointment requests and upcoming appointments
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

-- This-week focus: rolling 14-day window with derived columns
CREATE OR REPLACE VIEW trapper.v_this_week_focus AS
SELECT
    uf.feed_type,
    uf.is_scheduled,
    uf.event_date,
    uf.submitted_at,
    uf.appt_date,
    uf.person_full_name,
    uf.email,
    uf.phone,
    uf.address,
    uf.county,
    uf.status,
    uf.animal_name,
    uf.ownership_type,
    uf.client_type,
    uf.source_system,
    uf.source_file,
    uf.source_row_hash,
    uf.created_at,
    uf.updated_at,
    uf.id,
    -- Derived: age in days
    CASE
        WHEN uf.is_scheduled = false THEN (current_date - uf.event_date)
        ELSE (uf.appt_date - current_date)
    END AS age_days,
    -- Derived: needs follow-up if missing contact OR missing address
    (
        (NULLIF(TRIM(uf.email), '') IS NULL AND NULLIF(TRIM(uf.phone), '') IS NULL)
        OR
        (NULLIF(TRIM(uf.address), '') IS NULL)
    ) AS needs_follow_up,
    -- Reserved: kittens flag (not yet wired to source data)
    NULL::boolean AS kittens_flag
FROM trapper.v_intake_unified_feed uf
WHERE
    -- Requests: submitted in last 14 days
    (uf.is_scheduled = false AND uf.event_date BETWEEN (current_date - 14) AND current_date)
    OR
    -- Upcoming: scheduled in next 14 days
    (uf.is_scheduled = true AND uf.appt_date BETWEEN current_date AND (current_date + 14));

COMMIT;
