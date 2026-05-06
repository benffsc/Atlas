-- MIG_3123: Overdue queue — treat checkout_type='trapper' as trapper
--
-- BUG: is_trapper only checked sot.trapper_profiles. Equipment checked out
-- with checkout_type='trapper' (e.g. via kiosk) but to a person without a
-- trapper_profiles row would show in the Public queue.
--
-- FIX: is_trapper = true if person has trapper_profiles OR any of their
-- checked-out equipment has checkout_type='trapper'.

CREATE OR REPLACE VIEW ops.v_equipment_overdue_queue AS
WITH holder_equipment AS (
  SELECT
    e.current_custodian_id AS person_id,
    COALESCE(p.display_name, e.current_holder_name) AS holder_name,
    ARRAY_AGG(e.barcode ORDER BY e.barcode) FILTER (WHERE e.barcode IS NOT NULL) AS trap_barcodes,
    ARRAY_AGG(e.equipment_id) AS equipment_ids,
    COUNT(*) AS trap_count,
    -- Type-split barcodes
    ARRAY_AGG(e.barcode ORDER BY e.barcode) FILTER (WHERE e.barcode IS NOT NULL AND e.equipment_type_key LIKE '%trap%') AS trap_only_barcodes,
    ARRAY_AGG(e.barcode ORDER BY e.barcode) FILTER (WHERE e.barcode IS NOT NULL AND e.equipment_type_key = 'transfer_cage') AS cage_barcodes,
    COUNT(*) FILTER (WHERE e.equipment_type_key LIKE '%trap%') AS trap_only_count,
    COUNT(*) FILTER (WHERE e.equipment_type_key = 'transfer_cage') AS cage_count,
    -- Dates
    MIN(e.expected_return_date) AS earliest_due_date,
    MAX(e.expected_return_date) AS latest_due_date,
    MAX(EXTRACT(DAY FROM NOW() - e.expected_return_date))::int AS max_days_overdue,
    BOOL_OR(e.expected_return_date IS NOT NULL AND e.expected_return_date < NOW()) AS has_overdue,
    BOOL_OR(e.checkout_type = 'trapper') AS has_trapper_checkout
  FROM ops.equipment e
  LEFT JOIN sot.people p ON p.person_id = e.current_custodian_id AND p.merged_into_person_id IS NULL
  WHERE e.custody_status = 'checked_out'
    AND e.retired_at IS NULL
    AND e.current_holder_name NOT ILIKE 'cat room%'
    AND e.current_holder_name NOT ILIKE 'foster%'
    AND e.current_holder_name NOT ILIKE 'fosters:%'
    AND e.current_holder_name NOT ILIKE 'SN CLIENT%'
    AND COALESCE(e.current_holder_name, '') != 'Heidi'
  GROUP BY e.current_custodian_id, COALESCE(p.display_name, e.current_holder_name)
),
contact_info AS (
  SELECT
    pi.person_id,
    MAX(CASE WHEN pi.id_type = 'phone' THEN pi.id_value_raw END) AS phone,
    MAX(CASE WHEN pi.id_type = 'email' THEN pi.id_value_raw END) AS email
  FROM sot.person_identifiers pi
  WHERE pi.confidence >= 0.5
  GROUP BY pi.person_id
),
last_contact AS (
  SELECT DISTINCT ON (COALESCE(ca.person_id::text, ca.holder_name))
    ca.person_id,
    ca.holder_name,
    ca.attempted_at AS last_contact_at,
    ca.method AS last_contact_method,
    ca.outcome AS last_contact_outcome,
    ca.notes AS last_contact_notes
  FROM ops.equipment_contact_attempts ca
  ORDER BY COALESCE(ca.person_id::text, ca.holder_name), ca.attempted_at DESC
),
contact_counts AS (
  SELECT
    COALESCE(ca.person_id::text, ca.holder_name) AS key,
    COUNT(*) AS attempt_count
  FROM ops.equipment_contact_attempts ca
  GROUP BY COALESCE(ca.person_id::text, ca.holder_name)
)
SELECT
  he.person_id,
  he.holder_name,
  ci.phone,
  ci.email,
  he.trap_barcodes,
  he.equipment_ids,
  he.trap_count,
  he.trap_only_barcodes,
  he.cage_barcodes,
  he.trap_only_count,
  he.cage_count,
  he.earliest_due_date,
  he.latest_due_date,
  he.max_days_overdue,
  he.has_overdue,
  -- Trapper detection: trapper_profiles OR checkout_type='trapper'
  COALESCE(
    EXISTS(SELECT 1 FROM sot.trapper_profiles tp WHERE tp.person_id = he.person_id)
    OR he.has_trapper_checkout,
    false
  ) AS is_trapper,
  -- Contact history
  lc.last_contact_at,
  lc.last_contact_method,
  lc.last_contact_outcome,
  lc.last_contact_notes,
  COALESCE(cc.attempt_count, 0)::int AS contact_attempt_count,
  -- Urgency tier
  CASE
    WHEN he.max_days_overdue >= 30 THEN 'critical'
    WHEN he.max_days_overdue >= 14 THEN 'warning'
    WHEN he.max_days_overdue >= 1  THEN 'new'
    ELSE 'on_time'
  END AS urgency_tier,
  -- Days since last contact (NULL = never contacted)
  EXTRACT(DAY FROM NOW() - lc.last_contact_at)::int AS days_since_last_contact,
  -- Priority score (higher = more urgent)
  COALESCE(he.max_days_overdue, 0)
    + CASE WHEN lc.last_contact_at IS NULL THEN 30 ELSE 0 END
    + CASE WHEN COALESCE(cc.attempt_count, 0) = 0 THEN 20 ELSE 0 END
    - COALESCE(EXTRACT(DAY FROM NOW() - lc.last_contact_at)::int, 0) / 3
  AS priority_score
FROM holder_equipment he
LEFT JOIN contact_info ci ON ci.person_id = he.person_id
LEFT JOIN last_contact lc ON
  lc.person_id = he.person_id OR lc.holder_name = he.holder_name
LEFT JOIN contact_counts cc ON
  cc.key = COALESCE(he.person_id::text, he.holder_name)
WHERE he.has_overdue = true
ORDER BY
  CASE
    WHEN he.max_days_overdue >= 30 THEN 1
    WHEN he.max_days_overdue >= 14 THEN 2
    ELSE 3
  END,
  COALESCE(he.max_days_overdue, 0)
    + CASE WHEN lc.last_contact_at IS NULL THEN 30 ELSE 0 END
    + CASE WHEN COALESCE(cc.attempt_count, 0) = 0 THEN 20 ELSE 0 END
    - COALESCE(EXTRACT(DAY FROM NOW() - lc.last_contact_at)::int, 0) / 3
  DESC;
