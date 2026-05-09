-- MIG_3128: Staff notifications table for cron-generated alerts
-- Supports tippy ticket followups, reminder due dates, and system notifications.

CREATE TABLE IF NOT EXISTS ops.staff_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES ops.staff(staff_id),
  title TEXT NOT NULL,
  body TEXT,
  entity_type TEXT, -- 'tippy_ticket', 'reminder', 'request', etc.
  entity_id UUID,
  link_url TEXT,
  source TEXT NOT NULL, -- 'reminder', 'tippy_ticket', 'system'
  source_id UUID,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_notifications_unread
  ON ops.staff_notifications (staff_id, created_at DESC)
  WHERE is_read = FALSE;

CREATE INDEX IF NOT EXISTS idx_staff_notifications_source
  ON ops.staff_notifications (source, source_id);

-- Add last_notified_at to staff_reminders to prevent duplicate notifications
ALTER TABLE ops.staff_reminders
  ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ;
