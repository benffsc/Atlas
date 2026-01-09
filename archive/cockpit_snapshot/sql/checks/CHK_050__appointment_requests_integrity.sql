-- CHK_050__appointment_requests_integrity
-- Verifies appointment_requests table integrity using composite logical key
SELECT
    (SELECT COUNT(*) FROM trapper.appointment_requests) AS total_rows,
    (SELECT COUNT(DISTINCT (source_system, source_row_hash)) FROM trapper.appointment_requests) AS distinct_composite_keys,
    (SELECT COUNT(*) - COUNT(DISTINCT (source_system, source_row_hash)) FROM trapper.appointment_requests) AS duplicate_composite_keys,
    (SELECT COUNT(*) FROM trapper.appointment_requests WHERE submitted_at IS NULL) AS missing_submitted_at,
    (SELECT COUNT(*) FROM trapper.appointment_requests WHERE cats_address IS NULL AND cats_address_clean IS NULL) AS missing_cats_address,
    (SELECT COUNT(*) FROM trapper.appointment_requests WHERE email IS NULL AND phone IS NULL) AS missing_contact;
