-- Trapper Activity Queries

-- Attribution method:
-- request_trapper_assignments → requests → places → appointments
-- This links trappers to cats via the request they were assigned to
-- and the place where the request was made, matching to appointments at that place.

-- Weekly time series (for stacked bar chart)
SELECT
  DATE_TRUNC('week', a.appointment_date)::date as week_start,
  p.display_name as trapper_name,
  COUNT(DISTINCT a.cat_id) as cats_count
FROM ops.request_trapper_assignments rta
JOIN sot.people p ON p.person_id = rta.trapper_person_id
JOIN ops.requests r ON r.request_id = rta.request_id
JOIN sot.places pl ON pl.place_id = r.place_id
JOIN ops.appointments a ON a.inferred_place_id = pl.place_id OR a.place_id = pl.place_id
WHERE a.appointment_date >= '2025-11-21'
  AND a.appointment_date <= '2026-02-19'
  AND p.merged_into_person_id IS NULL
GROUP BY DATE_TRUNC('week', a.appointment_date)::date, p.display_name
ORDER BY week_start, trapper_name;

-- Top trappers summary
SELECT
  p.display_name as trapper_name,
  COUNT(DISTINCT a.cat_id) as cats_count,
  COUNT(DISTINCT DATE_TRUNC('week', a.appointment_date)) as active_weeks,
  MIN(a.appointment_date) as first_cat,
  MAX(a.appointment_date) as last_cat
FROM ops.request_trapper_assignments rta
JOIN sot.people p ON p.person_id = rta.trapper_person_id
JOIN ops.requests r ON r.request_id = rta.request_id
JOIN sot.places pl ON pl.place_id = r.place_id
JOIN ops.appointments a ON a.inferred_place_id = pl.place_id OR a.place_id = pl.place_id
WHERE a.appointment_date >= '2025-11-21'
  AND a.appointment_date <= '2026-02-19'
  AND p.merged_into_person_id IS NULL
GROUP BY p.person_id, p.display_name
ORDER BY cats_count DESC;

-- Total weekly (for line chart overlay)
SELECT
  DATE_TRUNC('week', a.appointment_date)::date as week_start,
  'TOTAL' as trapper_name,
  COUNT(DISTINCT a.cat_id) as cats_count
FROM ops.request_trapper_assignments rta
JOIN sot.people p ON p.person_id = rta.trapper_person_id
JOIN ops.requests r ON r.request_id = rta.request_id
JOIN sot.places pl ON pl.place_id = r.place_id
JOIN ops.appointments a ON a.inferred_place_id = pl.place_id OR a.place_id = pl.place_id
WHERE a.appointment_date >= '2025-11-21'
  AND a.appointment_date <= '2026-02-19'
  AND p.merged_into_person_id IS NULL
GROUP BY DATE_TRUNC('week', a.appointment_date)::date
ORDER BY week_start;
