-- =============================================================================
-- MIG_3105: Equipment Call Queue — Contact Attempts + Overdue Queue View
-- =============================================================================
-- FFS-1332. Creates the infrastructure for the person-centric overdue
-- equipment follow-up dashboard.
--
-- 1. ops.equipment_contact_attempts — timestamped log of outreach per person
-- 2. ops.v_equipment_overdue_queue — person-centric view with priority scoring
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Contact Attempts Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS ops.equipment_contact_attempts (
  attempt_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who was contacted (prefer person_id, fall back to holder_name)
  person_id       UUID REFERENCES sot.people(person_id),
  holder_name     TEXT NOT NULL,
  -- What happened
  attempted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method          TEXT NOT NULL CHECK (method IN ('call', 'text', 'email', 'in_person')),
  outcome         TEXT NOT NULL CHECK (outcome IN (
    'connected_will_return', 'connected_needs_time', 'connected_other',
    'left_voicemail', 'no_answer', 'wrong_number', 'texted', 'emailed'
  )),
  notes           TEXT,
  -- Who on staff made the attempt
  staff_person_id UUID,
  staff_name      TEXT,
  -- Which equipment this is about (optional — may cover all of a person's traps)
  equipment_ids   UUID[],
  -- Metadata
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_equip_contact_person ON ops.equipment_contact_attempts(person_id) WHERE person_id IS NOT NULL;
CREATE INDEX idx_equip_contact_holder ON ops.equipment_contact_attempts(holder_name);
CREATE INDEX idx_equip_contact_date ON ops.equipment_contact_attempts(attempted_at DESC);

COMMENT ON TABLE ops.equipment_contact_attempts IS 'Timestamped log of outreach attempts for equipment follow-up. FFS-1332.';

-- =============================================================================
-- 2. Person-Centric Overdue Queue View
-- =============================================================================
-- Groups checked-out equipment by holder, enriches with contact info,
-- trapper status, last contact attempt, and computed priority score.

CREATE OR REPLACE VIEW ops.v_equipment_overdue_queue AS
WITH holder_equipment AS (
  -- Group equipment by holder (use person_id if linked, else holder_name)
  SELECT
    e.current_custodian_id AS person_id,
    COALESCE(p.display_name, e.current_holder_name) AS holder_name,
    ARRAY_AGG(e.barcode ORDER BY e.barcode) FILTER (WHERE e.barcode IS NOT NULL) AS trap_barcodes,
    ARRAY_AGG(e.equipment_id) AS equipment_ids,
    COUNT(*) AS trap_count,
    MIN(e.expected_return_date) AS earliest_due_date,
    MAX(EXTRACT(DAY FROM NOW() - e.expected_return_date))::int AS max_days_overdue,
    BOOL_OR(e.expected_return_date IS NOT NULL AND e.expected_return_date < NOW()) AS has_overdue
  FROM ops.equipment e
  LEFT JOIN sot.people p ON p.person_id = e.current_custodian_id AND p.merged_into_person_id IS NULL
  WHERE e.custody_status = 'checked_out'
    AND e.retired_at IS NULL
    -- Exclude internal holders
    AND e.current_holder_name NOT ILIKE 'cat room%'
    AND e.current_holder_name NOT ILIKE 'foster%'
    AND e.current_holder_name NOT ILIKE 'fosters:%'
    AND e.current_holder_name NOT ILIKE 'SN CLIENT%'
    AND COALESCE(e.current_holder_name, '') != 'Heidi'
  GROUP BY e.current_custodian_id, COALESCE(p.display_name, e.current_holder_name)
),
contact_info AS (
  -- Get phone + email for linked people
  SELECT
    pi.person_id,
    MAX(CASE WHEN pi.id_type = 'phone' THEN pi.id_value_raw END) AS phone,
    MAX(CASE WHEN pi.id_type = 'email' THEN pi.id_value_raw END) AS email
  FROM sot.person_identifiers pi
  WHERE pi.confidence >= 0.5
  GROUP BY pi.person_id
),
last_contact AS (
  -- Most recent contact attempt per person/holder
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
  he.earliest_due_date,
  he.max_days_overdue,
  he.has_overdue,
  -- Trapper detection
  EXISTS(SELECT 1 FROM sot.trapper_profiles tp WHERE tp.person_id = he.person_id) AS is_trapper,
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
  -- Priority score: higher = more urgent, call first
  (
    COALESCE(he.max_days_overdue, 0) * 2
    + he.trap_count * 5
    + COALESCE(EXTRACT(DAY FROM NOW() - lc.last_contact_at)::int, 999) * 1.5
    + CASE WHEN NOT EXISTS(SELECT 1 FROM sot.trapper_profiles tp WHERE tp.person_id = he.person_id) THEN 10 ELSE 0 END
  )::int AS priority_score
FROM holder_equipment he
LEFT JOIN contact_info ci ON ci.person_id = he.person_id
LEFT JOIN last_contact lc ON (
  lc.person_id = he.person_id
  OR (he.person_id IS NULL AND lc.holder_name = he.holder_name)
)
LEFT JOIN contact_counts cc ON cc.key = COALESCE(he.person_id::text, he.holder_name)
WHERE he.has_overdue = true
ORDER BY
  -- Critical first, then warning, then new
  CASE
    WHEN he.max_days_overdue >= 30 THEN 0
    WHEN he.max_days_overdue >= 14 THEN 1
    WHEN he.max_days_overdue >= 1  THEN 2
    ELSE 3
  END,
  -- Within each tier, highest priority score first
  (
    COALESCE(he.max_days_overdue, 0) * 2
    + he.trap_count * 5
    + COALESCE(EXTRACT(DAY FROM NOW() - lc.last_contact_at)::int, 999) * 1.5
    + CASE WHEN NOT EXISTS(SELECT 1 FROM sot.trapper_profiles tp WHERE tp.person_id = he.person_id) THEN 10 ELSE 0 END
  ) DESC;

COMMENT ON VIEW ops.v_equipment_overdue_queue IS 'Person-centric overdue equipment call queue with priority scoring. FFS-1332.';

COMMIT;
