-- MIG_2952: Cat presence tracking — columns, view, function (FFS-587)
--
-- sot.cat_place needs presence-related columns for colony reconciliation.
-- v_cat_place_presence view and update_cat_presence() function were in V1
-- but never ported to V2.

BEGIN;

-- ── Add presence columns to sot.cat_place ──────────────────────────────

ALTER TABLE sot.cat_place
  ADD COLUMN IF NOT EXISTS presence_status TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS last_observed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS presence_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS presence_confirmed_by TEXT,
  ADD COLUMN IF NOT EXISTS departure_reason TEXT,
  ADD COLUMN IF NOT EXISTS reactivation_reason TEXT;

-- Check constraint for presence_status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_cat_place_presence_status'
  ) THEN
    ALTER TABLE sot.cat_place
    ADD CONSTRAINT chk_cat_place_presence_status
    CHECK (presence_status IN ('current', 'uncertain', 'departed', 'unknown'));
  END IF;
END $$;

-- Index for presence queries
CREATE INDEX IF NOT EXISTS idx_cat_place_presence
  ON sot.cat_place(place_id, presence_status)
  WHERE presence_status IN ('current', 'uncertain');

-- ── View: v_cat_place_presence ──────────────────────────────────────────

CREATE OR REPLACE VIEW sot.v_cat_place_presence AS
SELECT
  cp.id AS cat_place_id,
  cp.cat_id,
  c.display_name AS cat_name,
  c.altered_status,
  cp.place_id,
  cp.relationship_type,
  cp.last_observed_at,
  COALESCE(cp.presence_status, 'unknown') AS explicit_status,
  -- Effective status: inferred from observation recency if explicit is unknown
  CASE
    WHEN cp.presence_status IN ('current', 'departed') THEN cp.presence_status
    WHEN cp.last_observed_at IS NOT NULL
         AND cp.last_observed_at >= CURRENT_DATE - INTERVAL '12 months' THEN 'current'
    WHEN cp.last_observed_at IS NOT NULL
         AND cp.last_observed_at >= CURRENT_DATE - INTERVAL '36 months' THEN 'uncertain'
    WHEN cp.last_observed_at IS NOT NULL THEN 'departed'
    ELSE 'unknown'
  END AS effective_status,
  -- Inferred status label
  CASE
    WHEN cp.presence_status IS NOT NULL AND cp.presence_status != 'unknown' THEN 'confirmed'
    WHEN cp.last_observed_at IS NOT NULL THEN 'inferred'
    ELSE 'unknown'
  END AS inferred_status,
  cp.presence_confirmed_at,
  cp.presence_confirmed_by,
  cp.departure_reason,
  cp.reactivation_reason,
  cp.last_observed_at IS NOT NULL AS has_observation,
  CASE
    WHEN cp.last_observed_at IS NOT NULL
    THEN EXTRACT(DAY FROM NOW() - cp.last_observed_at)::INT
  END AS days_since_observed,
  -- Alteration info
  CASE
    WHEN c.altered_status IN ('spayed', 'neutered', 'altered') THEN c.verified_at
  END AS altered_date,
  c.altered_status IN ('spayed', 'neutered', 'altered') AS is_altered
FROM sot.cat_place cp
JOIN sot.cats c ON c.cat_id = cp.cat_id
  AND c.merged_into_cat_id IS NULL
WHERE cp.relationship_type IN ('home', 'residence', 'colony_member', 'seen_at');

COMMENT ON VIEW sot.v_cat_place_presence IS 'Cat presence at places with inferred/confirmed status (ported from V1)';

-- ── Function: update_cat_presence ───────────────────────────────────────

CREATE OR REPLACE FUNCTION ops.update_cat_presence(
  p_cat_id UUID,
  p_place_id UUID,
  p_presence_status TEXT,
  p_departure_reason TEXT DEFAULT NULL,
  p_confirmed_by TEXT DEFAULT 'staff'
) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE sot.cat_place
  SET
    presence_status = p_presence_status,
    departure_reason = CASE
      WHEN p_presence_status = 'departed' THEN COALESCE(p_departure_reason, 'unknown')
      ELSE NULL
    END,
    reactivation_reason = CASE
      WHEN p_presence_status = 'current'
           AND presence_status = 'departed' THEN 'staff_reactivated'
      ELSE reactivation_reason
    END,
    presence_confirmed_at = NOW(),
    presence_confirmed_by = p_confirmed_by,
    updated_at = NOW()
  WHERE cat_id = p_cat_id
    AND place_id = p_place_id
    AND relationship_type IN ('home', 'residence', 'colony_member', 'seen_at');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

COMMENT ON FUNCTION ops.update_cat_presence IS 'Update cat presence status at a place (ported from V1)';

-- ── Backfill last_observed_at from appointments ─────────────────────────

UPDATE sot.cat_place cp
SET last_observed_at = sub.last_seen
FROM (
  SELECT
    cpr.cat_id,
    cpr.place_id,
    MAX(a.appointment_date) AS last_seen
  FROM sot.cat_place cpr
  JOIN sot.cats c ON c.cat_id = cpr.cat_id
  JOIN ops.appointments a ON a.cat_id = c.cat_id
  WHERE cpr.last_observed_at IS NULL
    AND a.appointment_date IS NOT NULL
  GROUP BY cpr.cat_id, cpr.place_id
) sub
WHERE cp.cat_id = sub.cat_id
  AND cp.place_id = sub.place_id
  AND cp.last_observed_at IS NULL;

COMMIT;
