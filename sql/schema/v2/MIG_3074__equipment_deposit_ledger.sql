-- MIG_3074: Equipment deposit ledger view
--
-- FFS-1204 (Layer 1.3 of the Equipment Overhaul epic FFS-1201).
--
-- Today: ops.equipment_events.deposit_amount records the deposit at checkout,
-- and deposit_returned_at records when it's refunded. But there's no way to
-- see "who owes us money right now" without querying the event log manually.
--
-- This migration creates a view that surfaces all outstanding deposits so
-- staff can see at a glance: who has a deposit, how much, for what equipment,
-- and how long it's been out.
--
-- Run with:
--   psql $DATABASE_URL -f sql/schema/v2/MIG_3074__equipment_deposit_ledger.sql

BEGIN;

DROP VIEW IF EXISTS ops.v_equipment_deposits_outstanding;

CREATE VIEW ops.v_equipment_deposits_outstanding AS
WITH latest_checkout AS (
  -- For each equipment item currently checked out, find the most recent
  -- check_out event (which carries the deposit_amount).
  SELECT DISTINCT ON (ev.equipment_id)
    ev.equipment_id,
    ev.event_id,
    ev.deposit_amount,
    ev.deposit_returned_at,
    ev.custodian_person_id,
    COALESCE(p.display_name, ev.custodian_name, ev.custodian_name_raw) AS custodian_name,
    sot.get_phone(ev.custodian_person_id) AS custodian_phone,
    sot.get_email(ev.custodian_person_id) AS custodian_email,
    ev.created_at AS checked_out_at,
    ev.due_date,
    ev.checkout_purpose,
    ev.notes
  FROM ops.equipment_events ev
  LEFT JOIN sot.people p ON p.person_id = ev.custodian_person_id
  WHERE ev.event_type = 'check_out'
  ORDER BY ev.equipment_id, ev.created_at DESC
)
SELECT
  e.equipment_id,
  e.barcode,
  COALESCE(e.equipment_name, e.barcode, et.display_name) AS equipment_name,
  et.display_name AS type_name,
  et.category AS equipment_category,
  lc.deposit_amount,
  lc.deposit_returned_at,
  lc.custodian_person_id,
  lc.custodian_name,
  lc.custodian_phone,
  lc.custodian_email,
  lc.checked_out_at,
  lc.due_date,
  lc.checkout_purpose,
  lc.notes,
  -- Computed: days since checkout
  EXTRACT(DAY FROM NOW() - lc.checked_out_at)::int AS days_out,
  -- Computed: is overdue?
  CASE
    WHEN lc.due_date IS NOT NULL AND lc.due_date < CURRENT_DATE THEN true
    ELSE false
  END AS is_overdue,
  -- Computed: days overdue (0 if not overdue)
  CASE
    WHEN lc.due_date IS NOT NULL AND lc.due_date < CURRENT_DATE
    THEN (CURRENT_DATE - lc.due_date)
    ELSE 0
  END AS days_overdue
FROM ops.equipment e
JOIN ops.equipment_types et ON et.type_key = e.equipment_type_key
JOIN latest_checkout lc ON lc.equipment_id = e.equipment_id
WHERE
  -- Only checked-out items
  e.custody_status = 'checked_out'
  -- Only items with a deposit recorded
  AND lc.deposit_amount IS NOT NULL
  AND lc.deposit_amount > 0
  -- Deposit NOT yet returned
  AND lc.deposit_returned_at IS NULL
  -- Not retired
  AND e.retired_at IS NULL
ORDER BY
  -- Most overdue first, then by deposit amount (highest first)
  is_overdue DESC,
  days_overdue DESC,
  lc.deposit_amount DESC;

COMMENT ON VIEW ops.v_equipment_deposits_outstanding IS
  'All equipment items currently checked out with an unreturned deposit. Shows who owes what, how long, and whether overdue. Used by the admin equipment dashboard. See FFS-1204 / MIG_3074.';

-- Also create a summary view for the dashboard stat cards
DROP VIEW IF EXISTS ops.v_equipment_deposit_summary;

CREATE VIEW ops.v_equipment_deposit_summary AS
SELECT
  COUNT(*) AS total_deposits_outstanding,
  COALESCE(SUM(deposit_amount), 0)::numeric(10,2) AS total_amount_outstanding,
  COUNT(*) FILTER (WHERE is_overdue) AS overdue_deposits,
  COALESCE(SUM(deposit_amount) FILTER (WHERE is_overdue), 0)::numeric(10,2) AS overdue_amount,
  COALESCE(AVG(days_out), 0)::int AS avg_days_out,
  COALESCE(MAX(days_out), 0) AS max_days_out
FROM ops.v_equipment_deposits_outstanding;

COMMENT ON VIEW ops.v_equipment_deposit_summary IS
  'Aggregate stats for the equipment deposit dashboard: total outstanding, total $, overdue count, overdue $, average days out, max days out. See FFS-1204.';

COMMIT;

\echo 'MIG_3074 applied:'
\echo '  - ops.v_equipment_deposits_outstanding (per-item outstanding deposit view)'
\echo '  - ops.v_equipment_deposit_summary (aggregate stats for dashboard)'
