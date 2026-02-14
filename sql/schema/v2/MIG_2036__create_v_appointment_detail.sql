-- MIG_2036: Create ops.v_appointment_detail view for Appointments page
-- Date: 2026-02-13
-- Issue: Appointments page needs detail view for listing and filtering

CREATE OR REPLACE VIEW ops.v_appointment_detail AS
SELECT
  a.appointment_id,
  a.appointment_date,
  a.appointment_number,
  -- Computed appointment category
  CASE
    WHEN a.is_spay OR a.is_neuter THEN 'Spay/Neuter'
    WHEN a.service_type ILIKE '%wellness%' OR a.service_type ILIKE '%exam%' THEN 'Wellness'
    WHEN a.service_type ILIKE '%recheck%' OR a.service_type ILIKE '%follow%' THEN 'Recheck'
    WHEN a.service_type ILIKE '%euthan%' THEN 'Euthanasia'
    ELSE 'Other'
  END AS appointment_category,
  a.service_type,
  a.is_spay,
  a.is_neuter,
  a.is_alteration,
  a.vet_name,
  a.technician,
  a.temperature,
  a.medical_notes,
  a.is_lactating,
  a.is_pregnant,
  a.is_in_heat,
  -- Cat info
  a.cat_id,
  c.name AS cat_name,
  c.microchip AS cat_microchip,
  c.sex AS cat_sex,
  c.altered_status AS cat_altered_status,
  c.breed AS cat_breed,
  c.primary_color AS cat_color,
  -- Person info (resolved or original)
  COALESCE(a.resolved_person_id, a.person_id) AS person_id,
  COALESCE(p.display_name, p.first_name || ' ' || p.last_name) AS person_name,
  -- Place info (inferred takes precedence)
  COALESCE(a.inferred_place_id, a.place_id) AS place_id,
  pl.display_name AS place_name,
  pl.formatted_address AS place_address,
  -- Owner info from raw payload
  a.owner_email,
  a.owner_phone,
  a.owner_first_name,
  a.owner_last_name,
  a.owner_address,
  COALESCE(a.owner_first_name || ' ' || a.owner_last_name, '') AS client_name,
  a.owner_address AS client_address,
  -- Source tracking
  a.source_system,
  a.source_record_id,
  a.clinichq_appointment_id,
  a.created_at,
  a.updated_at,
  a.original_created_at
FROM ops.appointments a
LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
LEFT JOIN sot.people p ON p.person_id = COALESCE(a.resolved_person_id, a.person_id) AND p.merged_into_person_id IS NULL
LEFT JOIN sot.places pl ON pl.place_id = COALESCE(a.inferred_place_id, a.place_id) AND pl.merged_into_place_id IS NULL;
