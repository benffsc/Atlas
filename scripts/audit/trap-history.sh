#!/bin/bash
# ==============================================================================
# Trap History Audit
# ==============================================================================
# Quickly see the complete event history for an equipment barcode, who should
# currently have the trap, and whether the kiosk state matches reality.
#
# Usage:
#   ./scripts/audit/trap-history.sh 0106
#   ./scripts/audit/trap-history.sh 0106 50    # Last 50 events instead of 20
# ==============================================================================

set -e

BARCODE="${1:-}"
LIMIT="${2:-20}"

if [ -z "$BARCODE" ]; then
  echo "Usage: $0 <barcode> [limit]"
  echo "Example: $0 0106"
  exit 1
fi

if [ -f .env ]; then
  export $(grep -v '^#' .env | grep DATABASE_URL | xargs)
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not set"
  exit 1
fi

echo ""
echo "=============================================================================="
echo "  TRAP HISTORY AUDIT — barcode $BARCODE"
echo "=============================================================================="
echo ""

# ── 1. Current state on ops.equipment ─────────────────────────────────────────
echo "── 1. CURRENT STATE (ops.equipment + sot.people JOIN) ─────────────────────"
psql "$DATABASE_URL" -c "
SELECT
  e.barcode,
  e.custody_status,
  e.current_custodian_id::text,
  cust.display_name                  AS custodian_name_via_join,
  e.current_holder_name              AS holder_name_raw_column,
  e.updated_at::timestamp(0),
  CASE
    WHEN e.custody_status = 'checked_out' AND cust.display_name IS NOT NULL
         THEN '→ Kiosk will display: ' || cust.display_name
    WHEN e.custody_status = 'checked_out' AND e.current_holder_name IS NOT NULL
         THEN '→ Kiosk will display: ' || e.current_holder_name || ' (raw, no person link)'
    WHEN e.custody_status = 'checked_out'
         THEN '→ Kiosk will display: Unknown (checked out but no custodian recorded!)'
    ELSE '→ Kiosk will display: ' || e.custody_status
  END AS kiosk_display_prediction
FROM ops.equipment e
LEFT JOIN sot.people cust ON cust.person_id = e.current_custodian_id
WHERE e.barcode = '$BARCODE';
"

# ── 2. Last N events — newest first ───────────────────────────────────────────
echo ""
echo "── 2. EVENT HISTORY (last $LIMIT events, newest first) ──────────────────"
psql "$DATABASE_URL" -c "
SELECT
  ev.created_at::timestamp(0) AS when_recorded,
  ev.event_type,
  LEFT(COALESCE(p.display_name, ev.custodian_name, '—'), 30) AS custodian,
  CASE WHEN ev.custodian_person_id IS NULL THEN 'free-text' ELSE 'resolved' END AS custodian_type,
  LEFT(COALESCE(ev.notes, '—'), 40) AS notes,
  ev.source_system
FROM ops.equipment_events ev
LEFT JOIN sot.people p ON p.person_id = ev.custodian_person_id
WHERE ev.equipment_id = (SELECT equipment_id FROM ops.equipment WHERE barcode = '$BARCODE')
ORDER BY ev.created_at DESC
LIMIT $LIMIT;
"

# ── 3. "Who should have it" — most recent checkout without matching checkin ─
echo ""
echo "── 3. LAST UNRESOLVED CHECKOUT (who the trap SHOULD go to) ───────────────"
psql "$DATABASE_URL" -c "
WITH eq AS (
  SELECT equipment_id FROM ops.equipment WHERE barcode = '$BARCODE'
),
events AS (
  SELECT
    ev.event_id,
    ev.created_at,
    ev.event_type,
    ev.custodian_person_id,
    COALESCE(p.display_name, ev.custodian_name, '(none)') AS custodian,
    ev.notes
  FROM ops.equipment_events ev
  LEFT JOIN sot.people p ON p.person_id = ev.custodian_person_id
  WHERE ev.equipment_id = (SELECT equipment_id FROM eq)
  ORDER BY ev.created_at DESC
),
latest_terminal AS (
  -- Find the most recent event that ended custody (check_in, found, retired, transfer)
  SELECT *
  FROM events
  WHERE event_type IN ('check_in', 'found', 'retired', 'transfer')
  ORDER BY created_at DESC
  LIMIT 1
),
latest_checkout AS (
  -- Find the most recent check_out that has NOT been terminated
  SELECT *
  FROM events
  WHERE event_type = 'check_out'
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT
  'Last check_out event:' AS entry,
  co.created_at::timestamp(0)::text AS when_recorded,
  co.custodian,
  CASE
    WHEN lt.created_at IS NULL THEN 'NO TERMINAL EVENT AFTER — this person should still have the trap'
    WHEN lt.created_at > co.created_at THEN 'TERMINATED by ' || lt.event_type || ' on ' || lt.created_at::timestamp(0)::text
    ELSE 'still active'
  END AS status
FROM latest_checkout co
LEFT JOIN latest_terminal lt ON true
UNION ALL
SELECT
  'Last transfer/check_in event:' AS entry,
  lt.created_at::timestamp(0)::text,
  lt.custodian,
  lt.event_type || ' — ' || COALESCE(lt.notes, 'no notes')
FROM latest_terminal lt;
"

# ── 4. Sanity check — does the trigger state match the event log? ─────────────
echo ""
echo "── 4. TRIGGER-STATE SANITY CHECK ─────────────────────────────────────────"
psql "$DATABASE_URL" -c "
WITH eq AS (SELECT equipment_id FROM ops.equipment WHERE barcode = '$BARCODE'),
latest AS (
  SELECT event_type, custodian_person_id
  FROM ops.equipment_events
  WHERE equipment_id = (SELECT equipment_id FROM eq)
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT
  l.event_type AS last_event_type,
  l.custodian_person_id::text AS last_event_custodian_id,
  e.current_custodian_id::text AS equipment_current_custodian_id,
  CASE
    WHEN l.event_type IN ('check_in', 'found', 'retired')
         AND e.current_custodian_id IS NOT NULL
         THEN '❌ MISMATCH: equipment row still has a custodian but last event was ' || l.event_type
    WHEN l.event_type = 'check_out'
         AND e.current_custodian_id IS DISTINCT FROM l.custodian_person_id
         THEN '❌ MISMATCH: last check_out was to ' || COALESCE(l.custodian_person_id::text, 'free-text') || ' but equipment row has ' || COALESCE(e.current_custodian_id::text, 'NULL')
    WHEN l.event_type = 'transfer'
         AND e.current_custodian_id IS DISTINCT FROM l.custodian_person_id
         THEN '❌ MISMATCH: last transfer was to ' || COALESCE(l.custodian_person_id::text, 'free-text') || ' but equipment row has ' || COALESCE(e.current_custodian_id::text, 'NULL')
    ELSE '✓ Trigger state matches event log'
  END AS trigger_state_sanity
FROM ops.equipment e, latest l
WHERE e.barcode = '$BARCODE';
"

echo ""
echo "=============================================================================="
echo "  Done. If the sanity check shows a MISMATCH, the trigger didn't fire"
echo "  correctly on a recent event — that's a data integrity bug."
echo "=============================================================================="
echo ""
