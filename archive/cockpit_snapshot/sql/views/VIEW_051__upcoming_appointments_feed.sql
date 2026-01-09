-- VIEW_051__upcoming_appointments_feed
-- Feed view for ClinicHQ upcoming appointments (scheduled pipeline)
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
