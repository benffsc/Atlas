-- MIG_460: Staff Reminders for Tippy Personal Assistant
-- Personal reminders created via Tippy or dashboard
--
\echo '=== MIG_460: Staff Reminders ==='

-- Create staff reminders table
CREATE TABLE IF NOT EXISTS trapper.staff_reminders (
  reminder_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owner
  staff_id UUID NOT NULL REFERENCES trapper.staff(staff_id) ON DELETE CASCADE,

  -- Content
  title TEXT NOT NULL,
  notes TEXT,

  -- Entity reference (optional link to place/cat/person/request)
  entity_type TEXT CHECK (entity_type IS NULL OR entity_type IN ('place', 'cat', 'person', 'request', 'intake')),
  entity_id UUID,

  -- Scheduling
  due_at TIMESTAMPTZ NOT NULL,
  remind_at TIMESTAMPTZ NOT NULL,  -- When to surface (may differ from due_at for snoozes)

  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending',     -- Active, not yet due
    'due',         -- Due now, awaiting action
    'snoozed',     -- Snoozed to later time
    'completed',   -- Marked done
    'archived'     -- Hidden but not deleted
  )),

  -- Snooze tracking
  snooze_count INT DEFAULT 0,
  last_snoozed_at TIMESTAMPTZ,

  -- Source tracking
  created_via TEXT DEFAULT 'tippy' CHECK (created_via IN ('tippy', 'dashboard', 'api')),
  tippy_conversation_id TEXT,  -- For context if created via chat

  -- Timestamps
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for listing staff's pending reminders
CREATE INDEX IF NOT EXISTS idx_staff_reminders_staff_pending
  ON trapper.staff_reminders(staff_id, remind_at)
  WHERE status IN ('pending', 'due', 'snoozed');

-- Index for finding due reminders (cron job)
CREATE INDEX IF NOT EXISTS idx_staff_reminders_due
  ON trapper.staff_reminders(remind_at)
  WHERE status IN ('pending', 'snoozed');

-- Index for entity lookups
CREATE INDEX IF NOT EXISTS idx_staff_reminders_entity
  ON trapper.staff_reminders(entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

COMMENT ON TABLE trapper.staff_reminders IS
'Personal reminders for staff created via Tippy AI assistant or dashboard. Each staff member sees only their own reminders.';

COMMENT ON COLUMN trapper.staff_reminders.remind_at IS
'When to show the reminder - can differ from due_at when snoozed';

COMMENT ON COLUMN trapper.staff_reminders.entity_type IS
'Optional link to an Atlas entity (place, cat, person, request, intake)';

\echo 'MIG_460 complete: Staff reminders table created'
