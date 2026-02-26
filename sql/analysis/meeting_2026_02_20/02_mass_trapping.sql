-- Mass Trapping Stats (2026-01-29)

-- Summary stats
SELECT
  COUNT(*) as total_cats,
  COUNT(*) FILTER (WHERE is_spay = true) as females_spayed,
  COUNT(*) FILTER (WHERE is_neuter = true) as males_neutered,
  COUNT(*) FILTER (WHERE is_spay = false AND is_neuter = false) as wellness_only
FROM ops.appointments
WHERE appointment_date = '2026-01-29';

-- Site breakdown
SELECT
  COALESCE(p.display_name, p.formatted_address) as site_name,
  p.formatted_address,
  COUNT(*) as cats
FROM ops.appointments a
LEFT JOIN sot.places p ON p.place_id = COALESCE(a.inferred_place_id, a.place_id)
WHERE a.appointment_date = '2026-01-29'
GROUP BY p.place_id, p.display_name, p.formatted_address
ORDER BY cats DESC;

-- Full cohort for audit
SELECT
  a.appointment_id,
  a.cat_id,
  c.name as cat_name,
  CASE
    WHEN a.is_spay = true THEN 'female'
    WHEN a.is_neuter = true THEN 'male'
    ELSE 'unknown'
  END as sex_inferred,
  CASE
    WHEN a.is_spay = true THEN 'spay'
    WHEN a.is_neuter = true THEN 'neuter'
    ELSE 'wellness'
  END as procedure_type,
  a.appointment_date,
  COALESCE(p.display_name, p.formatted_address) as site_name,
  p.place_id as site_id
FROM ops.appointments a
LEFT JOIN sot.cats c ON c.cat_id = a.cat_id
LEFT JOIN sot.places p ON p.place_id = COALESCE(a.inferred_place_id, a.place_id)
WHERE a.appointment_date = '2026-01-29'
ORDER BY p.display_name, a.appointment_id;
