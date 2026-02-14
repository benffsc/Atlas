-- =====================================================
-- MIG_471: Tippy Chat History Storage
-- =====================================================
-- Stores Tippy conversation history for:
-- 1. Review and feedback on AI responses
-- 2. Analytics on what users ask
-- 3. Debugging tool usage patterns
-- 4. Training data for prompt improvements
-- =====================================================

\echo '=========================================='
\echo 'MIG_471: Tippy Chat History'
\echo '=========================================='

-- -----------------------------------------------------
-- Table: tippy_conversations
-- -----------------------------------------------------
-- Top-level conversation record linking messages together

CREATE TABLE IF NOT EXISTS trapper.tippy_conversations (
  conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID REFERENCES trapper.staff(staff_id),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  message_count INT DEFAULT 0,
  tools_used TEXT[] DEFAULT '{}',
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.tippy_conversations IS 'Top-level Tippy chat conversations for history tracking';
COMMENT ON COLUMN trapper.tippy_conversations.conversation_id IS 'Unique identifier for the conversation session';
COMMENT ON COLUMN trapper.tippy_conversations.staff_id IS 'Staff member who initiated the conversation';
COMMENT ON COLUMN trapper.tippy_conversations.started_at IS 'When conversation began';
COMMENT ON COLUMN trapper.tippy_conversations.ended_at IS 'When conversation ended (null if ongoing)';
COMMENT ON COLUMN trapper.tippy_conversations.message_count IS 'Running count of messages in this conversation';
COMMENT ON COLUMN trapper.tippy_conversations.tools_used IS 'Array of tool names used during conversation';
COMMENT ON COLUMN trapper.tippy_conversations.is_archived IS 'Soft delete flag for old conversations';

-- -----------------------------------------------------
-- Table: tippy_messages
-- -----------------------------------------------------
-- Individual messages within a conversation

CREATE TABLE IF NOT EXISTS trapper.tippy_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES trapper.tippy_conversations(conversation_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool_result')),
  content TEXT NOT NULL,
  tool_calls JSONB,
  tool_results JSONB,
  tokens_used INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.tippy_messages IS 'Individual messages in Tippy conversations';
COMMENT ON COLUMN trapper.tippy_messages.conversation_id IS 'Parent conversation';
COMMENT ON COLUMN trapper.tippy_messages.role IS 'Message role: user, assistant, system, or tool_result';
COMMENT ON COLUMN trapper.tippy_messages.content IS 'Message text content';
COMMENT ON COLUMN trapper.tippy_messages.tool_calls IS 'Tools Claude requested to call (for assistant messages)';
COMMENT ON COLUMN trapper.tippy_messages.tool_results IS 'Results from tool execution (for tool_result messages)';
COMMENT ON COLUMN trapper.tippy_messages.tokens_used IS 'Token count for this message (for cost tracking)';

-- -----------------------------------------------------
-- Indexes
-- -----------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_tippy_conversations_staff
  ON trapper.tippy_conversations(staff_id);

CREATE INDEX IF NOT EXISTS idx_tippy_conversations_started
  ON trapper.tippy_conversations(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_tippy_messages_conversation
  ON trapper.tippy_messages(conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tippy_messages_created
  ON trapper.tippy_messages(created_at DESC);

-- Index for finding conversations that used specific tools
CREATE INDEX IF NOT EXISTS idx_tippy_conversations_tools
  ON trapper.tippy_conversations USING GIN(tools_used);

-- -----------------------------------------------------
-- Add conversation_id to tippy_feedback if not exists
-- (Must be before view creation which references it)
-- -----------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper'
      AND table_name = 'tippy_feedback'
      AND column_name = 'conversation_id'
  ) THEN
    ALTER TABLE trapper.tippy_feedback ADD COLUMN conversation_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_tippy_feedback_conversation
      ON trapper.tippy_feedback(conversation_id);
    COMMENT ON COLUMN trapper.tippy_feedback.conversation_id IS 'Links feedback to specific conversation';
  END IF;
END $$;

-- -----------------------------------------------------
-- View: v_tippy_conversation_summary
-- -----------------------------------------------------
-- Summary view for admin review

CREATE OR REPLACE VIEW trapper.v_tippy_conversation_summary AS
SELECT
  c.conversation_id,
  c.staff_id,
  s.display_name AS staff_name,
  s.email AS staff_email,
  c.started_at,
  c.ended_at,
  c.message_count,
  c.tools_used,
  c.is_archived,
  -- First user message as preview
  (
    SELECT content
    FROM trapper.tippy_messages m
    WHERE m.conversation_id = c.conversation_id
      AND m.role = 'user'
    ORDER BY m.created_at
    LIMIT 1
  ) AS first_message_preview,
  -- Check if any feedback was left
  EXISTS (
    SELECT 1 FROM trapper.tippy_feedback f
    WHERE f.conversation_id = c.conversation_id::text
  ) AS has_feedback
FROM trapper.tippy_conversations c
LEFT JOIN trapper.staff s ON s.staff_id = c.staff_id;

COMMENT ON VIEW trapper.v_tippy_conversation_summary IS 'Summary of Tippy conversations for admin review';

-- -----------------------------------------------------
-- Function: update_conversation_stats
-- -----------------------------------------------------
-- Trigger function to update conversation stats when messages added

CREATE OR REPLACE FUNCTION trapper.update_tippy_conversation_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Update message count
  UPDATE trapper.tippy_conversations
  SET
    message_count = (
      SELECT COUNT(*) FROM trapper.tippy_messages
      WHERE conversation_id = NEW.conversation_id
    ),
    updated_at = NOW()
  WHERE conversation_id = NEW.conversation_id;

  -- If assistant message with tool calls, update tools_used
  IF NEW.role = 'assistant' AND NEW.tool_calls IS NOT NULL THEN
    UPDATE trapper.tippy_conversations
    SET tools_used = (
      SELECT array_agg(DISTINCT tool_name)
      FROM (
        SELECT tools_used AS tool_name FROM trapper.tippy_conversations WHERE conversation_id = NEW.conversation_id
        UNION ALL
        SELECT jsonb_array_elements_text(NEW.tool_calls->'tools')
      ) t
      WHERE tool_name IS NOT NULL
    )
    WHERE conversation_id = NEW.conversation_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_tippy_conversation_stats ON trapper.tippy_messages;

CREATE TRIGGER trg_update_tippy_conversation_stats
AFTER INSERT ON trapper.tippy_messages
FOR EACH ROW
EXECUTE FUNCTION trapper.update_tippy_conversation_stats();

-- -----------------------------------------------------
-- Summary
-- -----------------------------------------------------

\echo ''
\echo 'Created tables:'
\echo '  - tippy_conversations: Conversation sessions'
\echo '  - tippy_messages: Individual messages'
\echo ''
\echo 'Created views:'
\echo '  - v_tippy_conversation_summary: Admin review view'
\echo ''
\echo 'Created triggers:'
\echo '  - trg_update_tippy_conversation_stats: Auto-update stats'
\echo ''
\echo 'MIG_471 complete'
\echo '=========================================='
