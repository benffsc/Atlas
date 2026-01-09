-- VIEW_050__appointment_requests_feed
-- Feed view for appointment requests (demand/intake)
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
