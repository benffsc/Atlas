-- MIG_3072: Equipment drift detection + self-heal + Airtable cron retirement
--
-- The trap 0106 audit on 2026-04-08 surfaced silent data corruption affecting
-- at least 3 traps (0106, 0176, 0208): the kiosk recorded check_out events
-- to the correct custodian, the events trigger updated ops.equipment
-- correctly, and then the Airtable equipment-sync cron (runs every 4 hours)
-- blindly overwrote current_holder_name with the stale Airtable "Current
-- Holder" field — silently reverting every kiosk reassignment.
--
-- Root cause: ops.equipment had TWO writers competing for the same columns
-- with no coordination. The kiosk events trigger was the source of truth
-- (the events table is canonical), but the Airtable cron treated Airtable
-- as canonical for descriptive fields and clobbered kiosk writes.
--
-- Fix (applied in the same commit):
--   1. The /api/cron/equipment-sync route is RETIRED. Atlas is now the
--      sole writer for ops.equipment. Airtable equipment tracking is no
--      longer in use; the kiosk add/check_out/check_in flow is fully
--      self-contained and writes natively to ops.equipment with
--      source_system='atlas_ui'. The cron entry was removed from
--      apps/web/vercel.json and the route handler now returns 410 Gone.
--
-- This migration adds the safety net that should have existed all along:
--
--   1. Drift detection view: ops.v_equipment_drift
--      Compares each equipment row against its latest atlas_ui event.
--      Empty drift_reasons = no drift; non-empty = silent corruption.
--
--   2. Active drift view: ops.v_equipment_drift_active
--      Filtered to only rows with active drift. Should be empty in steady
--      state. Use this in admin monitoring.
--
--   3. Self-heal function: ops.heal_equipment_from_events(equipment_id)
--      Recomputes the equipment row from the canonical event log. Idempotent.
--      Returns BEFORE/AFTER state if anything was changed, or empty if no
--      heal was needed.
--
--   4. Heals the 3 known stale traps from the audit.
--
--   5. Comments on ops.equipment columns documenting that Atlas is the sole
--      owner — no future writer should touch kiosk-managed columns without
--      going through the events trigger.
--
-- Run with:
--   psql $DATABASE_URL -f sql/schema/v2/MIG_3072__equipment_drift_detection_and_heal.sql

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Drift detection view
-- ─────────────────────────────────────────────────────────────────────────────
-- Surfaces every trap where the latest atlas_ui event disagrees with the
-- equipment row state. Empty result = no drift. Any rows here are bugs:
-- either the trigger didn't fire correctly OR a non-trigger writer (the
-- cron, an admin direct edit, etc.) clobbered kiosk data.

-- Drop dependent view first (v_equipment_drift_active depends on v_equipment_drift)
DROP VIEW IF EXISTS ops.v_equipment_drift_active;
DROP VIEW IF EXISTS ops.v_equipment_drift;

CREATE VIEW ops.v_equipment_drift AS
WITH last_atlas_event AS (
  -- Pick the latest atlas_ui event per equipment. Tiebreaker matters: when
  -- two events share a created_at (e.g. MIG_3041 inserted check_in + check_out
  -- in the same transaction → identical NOW() timestamps), prefer the event
  -- that represents the END state of custody. Set-custody events (check_out,
  -- transfer) win over release-custody events (check_in, found) at ties.
  SELECT DISTINCT ON (ev.equipment_id)
    ev.equipment_id,
    ev.event_id                AS last_event_id,
    ev.event_type              AS last_event_type,
    ev.custodian_person_id     AS last_event_custodian_id,
    ev.custodian_name          AS last_event_custodian_name,
    ev.created_at              AS last_event_at
  FROM ops.equipment_events ev
  WHERE ev.source_system = 'atlas_ui'
  ORDER BY
    ev.equipment_id,
    ev.created_at DESC,
    -- Logical priority tiebreaker (higher = winner)
    CASE ev.event_type
      WHEN 'check_out'         THEN 6
      WHEN 'transfer'          THEN 5
      WHEN 'found'             THEN 4
      WHEN 'check_in'          THEN 3
      WHEN 'maintenance_end'   THEN 2
      WHEN 'maintenance_start' THEN 1
      WHEN 'reported_missing'  THEN 0
      WHEN 'retired'           THEN -1
      ELSE -2
    END DESC,
    -- Final stable tiebreaker on event_id so the result is deterministic
    ev.event_id DESC
)
SELECT
  e.equipment_id,
  e.barcode,
  e.custody_status                                AS row_custody_status,
  e.current_custodian_id                          AS row_custodian_id,
  e.current_holder_name                           AS row_holder_name,
  e.updated_at                                    AS row_updated_at,
  lae.last_event_type,
  lae.last_event_custodian_id,
  lae.last_event_custodian_name,
  lae.last_event_at,
  -- Compute the drift reason(s)
  ARRAY_REMOVE(ARRAY[
    -- check_out / transfer should set holder name to event's custodian
    CASE
      WHEN lae.last_event_type IN ('check_out', 'transfer')
           AND lae.last_event_custodian_name IS NOT NULL
           AND e.current_holder_name IS DISTINCT FROM lae.last_event_custodian_name
        THEN 'holder_name_mismatch'
      ELSE NULL
    END,
    -- check_out / transfer should set custodian_id to event's person_id
    CASE
      WHEN lae.last_event_type IN ('check_out', 'transfer')
           AND lae.last_event_custodian_id IS NOT NULL
           AND e.current_custodian_id IS DISTINCT FROM lae.last_event_custodian_id
        THEN 'custodian_id_mismatch'
      ELSE NULL
    END,
    -- check_in / found / retired should clear custodian_id and holder_name
    CASE
      WHEN lae.last_event_type IN ('check_in', 'found', 'retired')
           AND (e.current_custodian_id IS NOT NULL OR e.current_holder_name IS NOT NULL)
        THEN 'should_be_cleared_after_' || lae.last_event_type
      ELSE NULL
    END,
    -- custody_status should match the last event semantics
    CASE
      WHEN lae.last_event_type IN ('check_out', 'transfer')
           AND e.custody_status <> 'checked_out'
        THEN 'custody_status_should_be_checked_out'
      WHEN lae.last_event_type = 'check_in'
           AND e.custody_status NOT IN ('available', 'maintenance')
        THEN 'custody_status_should_be_available_or_maintenance'
      WHEN lae.last_event_type = 'reported_missing'
           AND e.custody_status <> 'missing'
        THEN 'custody_status_should_be_missing'
      WHEN lae.last_event_type = 'found'
           AND e.custody_status <> 'available'
        THEN 'custody_status_should_be_available'
      ELSE NULL
    END
  ], NULL) AS drift_reasons
FROM ops.equipment e
JOIN last_atlas_event lae ON lae.equipment_id = e.equipment_id
WHERE e.retired_at IS NULL;

-- Filter to only show ROWS WITH DRIFT (non-empty drift_reasons array)
DROP VIEW IF EXISTS ops.v_equipment_drift_active;
CREATE VIEW ops.v_equipment_drift_active AS
SELECT * FROM ops.v_equipment_drift
WHERE COALESCE(array_length(drift_reasons, 1), 0) > 0
ORDER BY last_event_at DESC;

COMMENT ON VIEW ops.v_equipment_drift IS
  'Compares each equipment row against its latest atlas_ui event. Used for drift detection — any non-empty drift_reasons array indicates the equipment row state disagrees with what the kiosk recorded. See MIG_3072.';
COMMENT ON VIEW ops.v_equipment_drift_active IS
  'Filtered view of v_equipment_drift showing only rows with active drift. Should be empty in steady state. Any rows here = silent data corruption that needs healing via ops.heal_equipment_from_events(). See MIG_3072.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Self-heal function
-- ─────────────────────────────────────────────────────────────────────────────
-- Recomputes ops.equipment row state from the canonical event log. Safe to
-- call any time — it's idempotent. Returns the BEFORE/AFTER state of any
-- column that was changed, or NULL if no heal was needed.
--
-- This is a recovery tool, not a normal-path function. The kiosk's events
-- trigger should already keep state correct; if heal_equipment_from_events
-- ever changes anything, that's a sign that a non-trigger writer (the
-- Airtable cron, an admin direct edit, a migration, etc.) corrupted the row.

DROP FUNCTION IF EXISTS ops.heal_equipment_from_events(UUID);

CREATE OR REPLACE FUNCTION ops.heal_equipment_from_events(p_equipment_id UUID)
RETURNS TABLE (
  equipment_id        UUID,
  barcode             TEXT,
  changed             BOOLEAN,
  before_custody      TEXT,
  after_custody       TEXT,
  before_custodian_id UUID,
  after_custodian_id  UUID,
  before_holder_name  TEXT,
  after_holder_name   TEXT,
  source_event_id     UUID,
  source_event_type   TEXT,
  source_event_at     TIMESTAMPTZ
) LANGUAGE plpgsql AS $$
DECLARE
  v_last_event RECORD;
  v_before     RECORD;
  v_should_clear BOOLEAN;
BEGIN
  -- Find the latest atlas_ui event for this equipment. Same tiebreaker as
  -- v_equipment_drift: at identical timestamps, prefer set-custody events
  -- (check_out, transfer) over release-custody events (check_in, found).
  -- This is necessary because MIG_3041 inserted check_in + check_out for
  -- traps 0176 / 0208 / etc. in the same transaction, leaving them with
  -- identical NOW() timestamps.
  SELECT
    ev.event_id, ev.event_type, ev.custodian_person_id, ev.custodian_name,
    ev.created_at
  INTO v_last_event
  FROM ops.equipment_events ev
  WHERE ev.equipment_id = p_equipment_id
    AND ev.source_system = 'atlas_ui'
  ORDER BY
    ev.created_at DESC,
    CASE ev.event_type
      WHEN 'check_out'         THEN 6
      WHEN 'transfer'          THEN 5
      WHEN 'found'             THEN 4
      WHEN 'check_in'          THEN 3
      WHEN 'maintenance_end'   THEN 2
      WHEN 'maintenance_start' THEN 1
      WHEN 'reported_missing'  THEN 0
      WHEN 'retired'           THEN -1
      ELSE -2
    END DESC,
    ev.event_id DESC
  LIMIT 1;

  -- If no atlas_ui events, nothing to heal from
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Capture current state
  SELECT e.barcode, e.custody_status, e.current_custodian_id, e.current_holder_name
  INTO v_before
  FROM ops.equipment e WHERE e.equipment_id = p_equipment_id;

  -- Determine what state SHOULD be based on the last event
  v_should_clear := v_last_event.event_type IN ('check_in', 'found', 'retired');

  -- Compute target state, then check if heal is needed
  DECLARE
    v_target_custody    TEXT;
    v_target_custodian  UUID;
    v_target_holder     TEXT;
  BEGIN
    v_target_custody := CASE v_last_event.event_type
      WHEN 'check_out' THEN 'checked_out'
      WHEN 'transfer'  THEN 'checked_out'
      WHEN 'check_in'  THEN CASE WHEN v_before.custody_status = 'maintenance' THEN 'maintenance' ELSE 'available' END
      WHEN 'found'     THEN 'available'
      WHEN 'reported_missing' THEN 'missing'
      WHEN 'retired'   THEN 'retired'
      ELSE v_before.custody_status
    END;

    v_target_custodian := CASE
      WHEN v_should_clear THEN NULL
      WHEN v_last_event.event_type IN ('check_out', 'transfer') THEN v_last_event.custodian_person_id
      ELSE v_before.current_custodian_id
    END;

    v_target_holder := CASE
      WHEN v_should_clear THEN NULL
      WHEN v_last_event.event_type IN ('check_out', 'transfer') THEN v_last_event.custodian_name
      ELSE v_before.current_holder_name
    END;

    -- Only update if something is actually drifting
    IF v_before.custody_status     IS DISTINCT FROM v_target_custody
       OR v_before.current_custodian_id IS DISTINCT FROM v_target_custodian
       OR v_before.current_holder_name  IS DISTINCT FROM v_target_holder
    THEN
      UPDATE ops.equipment SET
        custody_status        = v_target_custody,
        current_custodian_id  = v_target_custodian,
        current_holder_name   = v_target_holder,
        updated_at            = NOW()
      WHERE ops.equipment.equipment_id = p_equipment_id;

      RETURN QUERY SELECT
        p_equipment_id,
        v_before.barcode,
        TRUE                          AS changed,
        v_before.custody_status       AS before_custody,
        v_target_custody              AS after_custody,
        v_before.current_custodian_id AS before_custodian_id,
        v_target_custodian            AS after_custodian_id,
        v_before.current_holder_name  AS before_holder_name,
        v_target_holder               AS after_holder_name,
        v_last_event.event_id         AS source_event_id,
        v_last_event.event_type       AS source_event_type,
        v_last_event.created_at       AS source_event_at;
    END IF;
  END;

  RETURN;
END;
$$;

COMMENT ON FUNCTION ops.heal_equipment_from_events(UUID) IS
  'Recomputes ops.equipment row state from the canonical equipment_events log. Returns BEFORE/AFTER state if anything was healed, or empty if no drift. The events table is the source of truth; this function exists because the row cache can drift if a non-trigger writer (Airtable cron, admin edit, migration) clobbers kiosk-owned columns. See MIG_3072.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Heal the 3 known stale traps from the 2026-04-08 audit
-- ─────────────────────────────────────────────────────────────────────────────
-- Trap 0106 — Krystianna Enriquez (kiosk recorded 2026-03-31)
-- Trap 0176 — Rebecca Sarino    (kiosk recorded 2026-04-03)
-- Trap 0208 — Deborah Delew     (kiosk recorded 2026-04-03)

\echo ''
\echo '── Healing trap 0106 ──'
SELECT * FROM ops.heal_equipment_from_events(
  (SELECT equipment_id FROM ops.equipment WHERE barcode = '0106')
);

\echo ''
\echo '── Healing trap 0176 ──'
SELECT * FROM ops.heal_equipment_from_events(
  (SELECT equipment_id FROM ops.equipment WHERE barcode = '0176')
);

\echo ''
\echo '── Healing trap 0208 ──'
SELECT * FROM ops.heal_equipment_from_events(
  (SELECT equipment_id FROM ops.equipment WHERE barcode = '0208')
);

\echo ''
\echo '── Verifying drift is now resolved ──'
SELECT barcode, drift_reasons FROM ops.v_equipment_drift_active
WHERE barcode IN ('0106', '0176', '0208');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Document Atlas-as-sole-owner model on ops.equipment columns
-- ─────────────────────────────────────────────────────────────────────────────
-- The Airtable equipment-sync cron is RETIRED as of 2026-04-08. Atlas is the
-- only writer. New equipment is created via /api/equipment (POST). State
-- changes flow through ops.equipment_events + the events trigger. Direct
-- updates to ops.equipment outside the trigger are FORBIDDEN — the trigger
-- exists to keep cached state coherent with the canonical event log.

COMMENT ON COLUMN ops.equipment.custody_status IS
  'ATLAS-OWNED via the events trigger. Written by ops.equipment_event_trigger() when an event is recorded via /api/equipment/[id]/events. Source of truth: ops.equipment_events. Do not write directly.';
COMMENT ON COLUMN ops.equipment.current_custodian_id IS
  'ATLAS-OWNED via the events trigger. Set to NEW.custodian_person_id on check_out / transfer; cleared on check_in / found / retired. Do not write directly.';
COMMENT ON COLUMN ops.equipment.current_holder_name IS
  'ATLAS-OWNED via the events trigger. Set to NEW.custodian_name on check_out / transfer; cleared on check_in / found / retired. Before MIG_3072 the Airtable cron silently overwrote this column every 4 hours from a stale "Current Holder" field, causing trap 0106 (and 0176, 0208) to display the wrong custodian. The cron was retired and Atlas is now the sole writer. Do not add a 2nd writer.';
COMMENT ON COLUMN ops.equipment.current_place_id IS
  'ATLAS-OWNED via the events trigger. Set from NEW.place_id on check_out / transfer; cleared on check_in / found. Do not write directly.';
COMMENT ON COLUMN ops.equipment.current_request_id IS
  'ATLAS-OWNED via the events trigger. Set from NEW.request_id on check_out / transfer; cleared on check_in / found. Do not write directly.';
COMMENT ON COLUMN ops.equipment.current_kit_id IS
  'ATLAS-OWNED via the events trigger. Set from NEW.kit_id on check_out; cleared on check_in / found. Do not write directly.';
COMMENT ON COLUMN ops.equipment.checkout_type IS
  'ATLAS-OWNED via the events trigger. Set from NEW.checkout_type on check_out; cleared on check_in / found. Do not write directly.';

-- Descriptive columns — written at create time via /api/equipment POST,
-- editable via the admin equipment edit UI. No cron / external writer.
COMMENT ON COLUMN ops.equipment.item_type IS
  'ATLAS-OWNED. Set on create via /api/equipment POST or the kiosk add-equipment flow at /kiosk/equipment/add. Editable via admin edit UI. Was previously synced from Airtable; the cron is retired as of 2026-04-08.';
COMMENT ON COLUMN ops.equipment.size IS
  'ATLAS-OWNED. Set on create via /api/equipment POST. Editable via admin edit UI.';
COMMENT ON COLUMN ops.equipment.functional_status IS
  'ATLAS-OWNED. Set on create via /api/equipment POST. Editable via admin edit UI.';
COMMENT ON COLUMN ops.equipment.expected_return_date IS
  'LEGACY — was synced from Airtable. The kiosk uses inferred_due_date instead, which is computed from event due_date by the trigger.';

COMMIT;

\echo ''
\echo 'MIG_3072 applied:'
\echo '  - ops.v_equipment_drift            (full comparison view)'
\echo '  - ops.v_equipment_drift_active     (only rows with active drift)'
\echo '  - ops.heal_equipment_from_events() (one-shot heal function)'
\echo '  - 3 stale traps healed (0106, 0176, 0208)'
\echo '  - Column-level ownership comments documented'
