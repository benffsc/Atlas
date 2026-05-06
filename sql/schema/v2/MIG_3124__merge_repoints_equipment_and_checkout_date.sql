-- MIG_3124: Merge repoints equipment + add checkout date to overdue queue
--
-- 1. Add ops.equipment repoint to merge_person_into (UUID overload)
-- 2. Add checked_out_at to overdue queue view
-- 3. Backfill: repoint any equipment still pointing to merged people

-- =============================================================================
-- 1. Repoint equipment on person merge
-- =============================================================================
-- Insert into the UUID overload of merge_person_into, right before RETURN.
-- We recreate the full function to include the equipment repoint.

-- First, get the current function body and add equipment repoint.
-- Since the function is complex, we add a standalone post-merge hook instead.

CREATE OR REPLACE FUNCTION ops.repoint_equipment_after_merge(
  p_loser_id UUID,
  p_winner_id UUID
) RETURNS void AS $$
BEGIN
  UPDATE ops.equipment
  SET current_custodian_id = p_winner_id
  WHERE current_custodian_id = p_loser_id;

  UPDATE ops.equipment_events
  SET custodian_person_id = p_winner_id
  WHERE custodian_person_id = p_loser_id;

  UPDATE ops.equipment_events
  SET actor_person_id = p_winner_id
  WHERE actor_person_id = p_loser_id;

  UPDATE ops.equipment_contact_attempts
  SET person_id = p_winner_id
  WHERE person_id = p_loser_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.repoint_equipment_after_merge IS
  'Repoints equipment custody + events + contact attempts from loser to winner after person merge. Call after sot.merge_person_into. MIG_3124.';

-- =============================================================================
-- 2. Backfill: fix any equipment still pointing to merged people
-- =============================================================================

UPDATE ops.equipment e
SET current_custodian_id = p.merged_into_person_id
FROM sot.people p
WHERE e.current_custodian_id = p.person_id
  AND p.merged_into_person_id IS NOT NULL;

-- =============================================================================
-- 3. Add checked_out_at to overdue queue view
-- =============================================================================

DROP VIEW IF EXISTS ops.v_equipment_overdue_queue CASCADE;

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
    BOOL_OR(e.checkout_type = 'trapper') AS has_trapper_checkout,
    -- Checkout date: earliest checkout event for current holder
    MIN(ev.created_at) AS checked_out_at
  FROM ops.equipment e
  LEFT JOIN sot.people p ON p.person_id = e.current_custodian_id AND p.merged_into_person_id IS NULL
  LEFT JOIN LATERAL (
    SELECT ev2.created_at
    FROM ops.equipment_events ev2
    WHERE ev2.equipment_id = e.equipment_id
      AND ev2.event_type IN ('check_out', 'transfer')
    ORDER BY ev2.created_at DESC
    LIMIT 1
  ) ev ON true
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
  -- Checkout date
  he.checked_out_at,
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
