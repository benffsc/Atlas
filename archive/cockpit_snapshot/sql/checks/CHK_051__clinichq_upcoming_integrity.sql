-- CHK_051__clinichq_upcoming_integrity
-- Verifies clinichq_upcoming_appointments table integrity using composite logical key
SELECT
    (SELECT COUNT(*) FROM trapper.clinichq_upcoming_appointments) AS total_rows,
    (SELECT COUNT(DISTINCT (source_system, source_row_hash)) FROM trapper.clinichq_upcoming_appointments) AS distinct_composite_keys,
    (SELECT COUNT(*) - COUNT(DISTINCT (source_system, source_row_hash)) FROM trapper.clinichq_upcoming_appointments) AS duplicate_composite_keys,
    (SELECT COUNT(*) FROM trapper.clinichq_upcoming_appointments WHERE appt_date IS NULL) AS missing_appt_date,
    (SELECT COUNT(*) FROM trapper.clinichq_upcoming_appointments WHERE client_address IS NULL) AS missing_address,
    (SELECT COUNT(*) FROM trapper.clinichq_upcoming_appointments WHERE client_first_name IS NULL AND client_last_name IS NULL) AS missing_client_name;
