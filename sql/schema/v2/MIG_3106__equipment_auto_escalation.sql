-- =============================================================================
-- MIG_3106: Equipment Auto-Escalation — system contact method + auto_escalated outcome
-- =============================================================================
-- FFS-1338. Extends the equipment contact attempts table to support automated
-- escalation entries from the equipment-overdue cron.
--
-- 1. Adds 'system' to the method CHECK constraint
-- 2. Adds 'auto_escalated' to the outcome CHECK constraint
-- =============================================================================

BEGIN;

-- Drop and recreate CHECK constraints with new values
ALTER TABLE ops.equipment_contact_attempts
  DROP CONSTRAINT IF EXISTS equipment_contact_attempts_method_check;

ALTER TABLE ops.equipment_contact_attempts
  ADD CONSTRAINT equipment_contact_attempts_method_check
  CHECK (method IN ('call', 'text', 'email', 'in_person', 'system'));

ALTER TABLE ops.equipment_contact_attempts
  DROP CONSTRAINT IF EXISTS equipment_contact_attempts_outcome_check;

ALTER TABLE ops.equipment_contact_attempts
  ADD CONSTRAINT equipment_contact_attempts_outcome_check
  CHECK (outcome IN (
    'connected_will_return', 'connected_needs_time', 'connected_other',
    'left_voicemail', 'no_answer', 'wrong_number', 'texted', 'emailed',
    'auto_escalated'
  ));

COMMENT ON TABLE ops.equipment_contact_attempts IS 'Timestamped log of outreach attempts for equipment follow-up. FFS-1332. Extended with system/auto_escalated for cron escalation (FFS-1338).';

COMMIT;
