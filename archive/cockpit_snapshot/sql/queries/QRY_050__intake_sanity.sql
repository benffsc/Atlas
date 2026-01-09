-- QRY_050__intake_sanity.sql
-- Quick sanity checks for intake tables

\pset pager off

-- 1) Row counts
SELECT 'appointment_requests' AS table_name, COUNT(*) AS row_count
FROM trapper.appointment_requests
UNION ALL
SELECT 'clinichq_upcoming_appointments', COUNT(*)
FROM trapper.clinichq_upcoming_appointments;

-- 2) Appointment requests by status
SELECT submission_status, COUNT(*) AS cnt
FROM trapper.appointment_requests
GROUP BY submission_status
ORDER BY cnt DESC;

-- 3) Recent appointment requests (last 5)
SELECT id, submitted_at::date, requester_name, cats_address, submission_status
FROM trapper.appointment_requests
ORDER BY created_at DESC
LIMIT 5;

-- 4) Upcoming appointments by date (next 7 days from today)
SELECT appt_date, COUNT(*) AS appts
FROM trapper.clinichq_upcoming_appointments
WHERE appt_date >= CURRENT_DATE
  AND appt_date < CURRENT_DATE + INTERVAL '7 days'
GROUP BY appt_date
ORDER BY appt_date;

-- 5) Null check: how many rows have key fields null?
SELECT
    'appointment_requests' AS table_name,
    SUM(CASE WHEN submitted_at IS NULL THEN 1 ELSE 0 END) AS null_submitted,
    SUM(CASE WHEN cats_address IS NULL THEN 1 ELSE 0 END) AS null_cats_addr,
    SUM(CASE WHEN requester_name IS NULL THEN 1 ELSE 0 END) AS null_name
FROM trapper.appointment_requests
UNION ALL
SELECT
    'clinichq_upcoming',
    SUM(CASE WHEN appt_date IS NULL THEN 1 ELSE 0 END),
    SUM(CASE WHEN client_address IS NULL THEN 1 ELSE 0 END),
    SUM(CASE WHEN client_first_name IS NULL THEN 1 ELSE 0 END)
FROM trapper.clinichq_upcoming_appointments;
