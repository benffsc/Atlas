-- MIG_052__create_intake_feed_views
-- Creates feed views for appointment requests and upcoming appointments
BEGIN;

-- View for appointment requests (demand/intake)
CREATE OR REPLACE VIEW trapper.v_appointment_requests_feed AS
SELECT
    ar.id,
    ar.airtable_record_id,
    ar.submitted_at,
    ar.requester_name,
    ar.first_name,
    ar.last_name,
    ar.email,
    ar.phone,
    ar.requester_address,
    ar.requester_city,
    ar.requester_zip,
    ar.cats_address,
    ar.cats_address_clean,
    ar.county,
    ar.cat_count_estimate,
    ar.situation_description,
    ar.notes,
    ar.submission_status,
    ar.appointment_date,
    ar.source_file,
    ar.created_at,
    ar.updated_at,
    false AS is_scheduled
FROM trapper.appointment_requests ar;

-- View for ClinicHQ upcoming appointments (scheduled pipeline)
CREATE OR REPLACE VIEW trapper.v_upcoming_appointments_feed AS
SELECT
    ua.id,
    ua.appt_date,
    ua.appt_number,
    ua.client_first_name,
    ua.client_last_name,
    concat_ws(' ', ua.client_first_name, ua.client_last_name) AS client_full_name,
    ua.client_address,
    ua.client_cell_phone,
    ua.client_phone,
    ua.client_email,
    ua.client_type,
    ua.animal_name,
    ua.ownership_type,
    ua.source_file,
    ua.created_at,
    ua.updated_at,
    true AS is_scheduled
FROM trapper.clinichq_upcoming_appointments ua;

COMMIT;
