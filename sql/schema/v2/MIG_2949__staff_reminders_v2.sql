-- MIG_2949: Port staff_reminders to V2 schema (FFS-584)
--
-- V1 MIG_460 created trapper.staff_reminders but it was never ported to V2.
-- Used by /api/me/reminders, Tippy AI assistant, and personal dashboard.

BEGIN;

CREATE TABLE IF NOT EXISTS ops.staff_reminders (
  reminder_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owner
  staff_id UUID NOT NULL REFERENCES ops.staff(staff_id) ON DELETE CASCADE,

  -- Content
  title TEXT NOT NULL,
  notes TEXT,

  -- Entity reference (optional link to place/cat/person/request)
  entity_type TEXT CHECK (entity_type IS NULL OR entity_type IN ('place', 'cat', 'person', 'request', 'intake')),
  entity_id UUID,

  -- Scheduling
  due_at TIMESTAMPTZ NOT NULL,
  remind_at TIMESTAMPTZ NOT NULL,

  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'due', 'snoozed', 'completed', 'archived'
  )),

  -- Snooze tracking
  snooze_count INT DEFAULT 0,
  last_snoozed_at TIMESTAMPTZ,

  -- Source tracking
  created_via TEXT DEFAULT 'tippy' CHECK (created_via IN ('tippy', 'dashboard', 'api')),
  tippy_conversation_id TEXT,

  -- Timestamps
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Staff's pending reminders (dashboard query)
CREATE INDEX IF NOT EXISTS idx_staff_reminders_staff_pending
  ON ops.staff_reminders(staff_id, remind_at)
  WHERE status IN ('pending', 'due', 'snoozed');

-- Due reminders (cron job)
CREATE INDEX IF NOT EXISTS idx_staff_reminders_due
  ON ops.staff_reminders(remind_at)
  WHERE status IN ('pending', 'snoozed');

-- Entity lookups
CREATE INDEX IF NOT EXISTS idx_staff_reminders_entity
  ON ops.staff_reminders(entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

COMMENT ON TABLE ops.staff_reminders IS 'Personal reminders for staff created via Tippy AI assistant or dashboard (ported from V1 MIG_460)';

COMMIT;
