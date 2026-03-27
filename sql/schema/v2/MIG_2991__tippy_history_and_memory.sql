-- MIG_2991: Tippy conversation history + cross-session memory
-- FFS-863: Conversation history sidebar in chat widget
-- FFS-864: Cross-session per-user memory via conversation summaries

-- 1a. Add missing columns to tippy_conversations
ALTER TABLE ops.tippy_conversations
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS message_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS summary TEXT;

-- 1b. Index for staff-facing history queries
CREATE INDEX IF NOT EXISTS idx_tippy_conversations_staff_active
  ON ops.tippy_conversations(staff_id, started_at DESC)
  WHERE is_archived = false;

-- 1c. Per-staff conversation memory table
CREATE TABLE IF NOT EXISTS ops.tippy_staff_memory (
  memory_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES ops.staff(staff_id),
  conversation_id UUID REFERENCES ops.tippy_conversations(conversation_id),
  summary TEXT NOT NULL,
  topics TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tippy_staff_memory_staff
  ON ops.tippy_staff_memory(staff_id, created_at DESC);

-- 1d. Backfill message_count from existing data
UPDATE ops.tippy_conversations c
SET message_count = sub.cnt
FROM (
  SELECT conversation_id, COUNT(*) as cnt
  FROM ops.tippy_messages GROUP BY conversation_id
) sub
WHERE c.conversation_id = sub.conversation_id;

-- 1e. Backfill ended_at from existing data
UPDATE ops.tippy_conversations c
SET ended_at = sub.last_msg
FROM (
  SELECT conversation_id, MAX(created_at) as last_msg
  FROM ops.tippy_messages GROUP BY conversation_id
) sub
WHERE c.conversation_id = sub.conversation_id AND c.ended_at IS NULL;
