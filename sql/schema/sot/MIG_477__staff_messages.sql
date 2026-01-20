-- =====================================================
-- MIG_477: Staff Messages
-- =====================================================
-- Enables staff to send messages to each other via Tippy
-- Messages appear on the recipient's /me dashboard
-- =====================================================

\echo '=========================================='
\echo 'MIG_477: Staff Messages'
\echo '=========================================='

-- -----------------------------------------------------
-- Table: staff_messages
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS trapper.staff_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Sender/Recipient
  sender_staff_id UUID REFERENCES trapper.staff(staff_id),
  sender_name TEXT,  -- For display or system messages
  recipient_staff_id UUID NOT NULL REFERENCES trapper.staff(staff_id),

  -- Content
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

  -- Entity links (optional - what is this message about?)
  entity_type TEXT CHECK (entity_type IN ('place', 'cat', 'person', 'request')),
  entity_id UUID,
  entity_label TEXT,  -- Display name for quick reference

  -- Status
  status TEXT DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'archived')),
  read_at TIMESTAMPTZ,

  -- Source tracking
  source TEXT DEFAULT 'tippy' CHECK (source IN ('tippy', 'dashboard', 'api', 'system')),
  conversation_id TEXT,  -- Link to Tippy conversation if created via chat

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.staff_messages IS 'Internal staff messages sent via Tippy or dashboard';
COMMENT ON COLUMN trapper.staff_messages.sender_staff_id IS 'Staff member who sent the message (null for system)';
COMMENT ON COLUMN trapper.staff_messages.sender_name IS 'Sender display name (populated from staff table or system)';
COMMENT ON COLUMN trapper.staff_messages.recipient_staff_id IS 'Staff member receiving the message';
COMMENT ON COLUMN trapper.staff_messages.subject IS 'Brief subject line';
COMMENT ON COLUMN trapper.staff_messages.content IS 'Full message content';
COMMENT ON COLUMN trapper.staff_messages.priority IS 'Message priority: low, normal, high, urgent';
COMMENT ON COLUMN trapper.staff_messages.entity_type IS 'Type of linked entity (place, cat, person, request)';
COMMENT ON COLUMN trapper.staff_messages.entity_id IS 'ID of linked entity for quick navigation';
COMMENT ON COLUMN trapper.staff_messages.entity_label IS 'Display label for the linked entity';
COMMENT ON COLUMN trapper.staff_messages.source IS 'Where message was created: tippy, dashboard, api, system';
COMMENT ON COLUMN trapper.staff_messages.conversation_id IS 'Tippy conversation ID if created via chat';

-- -----------------------------------------------------
-- Indexes
-- -----------------------------------------------------

-- Fast lookup for unread messages (most common query)
CREATE INDEX IF NOT EXISTS idx_staff_messages_recipient_unread
  ON trapper.staff_messages(recipient_staff_id, created_at DESC)
  WHERE status = 'unread';

-- All messages for a recipient
CREATE INDEX IF NOT EXISTS idx_staff_messages_recipient
  ON trapper.staff_messages(recipient_staff_id, created_at DESC);

-- Messages about a specific entity
CREATE INDEX IF NOT EXISTS idx_staff_messages_entity
  ON trapper.staff_messages(entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

-- Messages from a sender
CREATE INDEX IF NOT EXISTS idx_staff_messages_sender
  ON trapper.staff_messages(sender_staff_id, created_at DESC)
  WHERE sender_staff_id IS NOT NULL;

-- -----------------------------------------------------
-- Views
-- -----------------------------------------------------

CREATE OR REPLACE VIEW trapper.v_staff_messages_inbox AS
SELECT
  m.message_id,
  m.sender_staff_id,
  COALESCE(m.sender_name, s.display_name, 'System') as sender_name,
  m.recipient_staff_id,
  r.display_name as recipient_name,
  m.subject,
  m.content,
  m.priority,
  m.entity_type,
  m.entity_id,
  m.entity_label,
  m.status,
  m.read_at,
  m.source,
  m.created_at,
  -- Age formatting
  CASE
    WHEN m.created_at > NOW() - INTERVAL '1 hour' THEN
      EXTRACT(MINUTE FROM NOW() - m.created_at)::int || 'm ago'
    WHEN m.created_at > NOW() - INTERVAL '1 day' THEN
      EXTRACT(HOUR FROM NOW() - m.created_at)::int || 'h ago'
    ELSE
      TO_CHAR(m.created_at, 'Mon DD')
  END as age_display
FROM trapper.staff_messages m
LEFT JOIN trapper.staff s ON s.staff_id = m.sender_staff_id
JOIN trapper.staff r ON r.staff_id = m.recipient_staff_id;

COMMENT ON VIEW trapper.v_staff_messages_inbox IS 'Staff messages with sender/recipient names for inbox display';

-- -----------------------------------------------------
-- Functions
-- -----------------------------------------------------

-- Send a message (for Tippy tool use)
CREATE OR REPLACE FUNCTION trapper.send_staff_message(
  p_sender_staff_id UUID,
  p_recipient_name TEXT,
  p_subject TEXT,
  p_content TEXT,
  p_priority TEXT DEFAULT 'normal',
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_entity_label TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'tippy',
  p_conversation_id TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_recipient_id UUID;
  v_sender_name TEXT;
  v_message_id UUID;
BEGIN
  -- Find recipient by name (fuzzy match)
  SELECT staff_id INTO v_recipient_id
  FROM trapper.staff
  WHERE is_active = TRUE
    AND (
      LOWER(display_name) LIKE '%' || LOWER(p_recipient_name) || '%'
      OR LOWER(first_name) = LOWER(p_recipient_name)
      OR LOWER(last_name) = LOWER(p_recipient_name)
    )
  ORDER BY
    CASE WHEN LOWER(first_name) = LOWER(p_recipient_name) THEN 0 ELSE 1 END,
    CASE WHEN LOWER(display_name) = LOWER(p_recipient_name) THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_recipient_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Could not find staff member: ' || p_recipient_name
    );
  END IF;

  -- Get sender name
  SELECT display_name INTO v_sender_name
  FROM trapper.staff
  WHERE staff_id = p_sender_staff_id;

  -- Create message
  INSERT INTO trapper.staff_messages (
    sender_staff_id,
    sender_name,
    recipient_staff_id,
    subject,
    content,
    priority,
    entity_type,
    entity_id,
    entity_label,
    source,
    conversation_id
  ) VALUES (
    p_sender_staff_id,
    v_sender_name,
    v_recipient_id,
    p_subject,
    p_content,
    COALESCE(p_priority, 'normal'),
    p_entity_type,
    p_entity_id,
    p_entity_label,
    p_source,
    p_conversation_id
  )
  RETURNING message_id INTO v_message_id;

  RETURN jsonb_build_object(
    'success', true,
    'message_id', v_message_id,
    'recipient_name', (SELECT display_name FROM trapper.staff WHERE staff_id = v_recipient_id),
    'recipient_id', v_recipient_id
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.send_staff_message IS 'Send a message to a staff member by name. Used by Tippy tell command.';

-- Get unread count for a staff member
CREATE OR REPLACE FUNCTION trapper.get_unread_message_count(p_staff_id UUID)
RETURNS INT AS $$
  SELECT COUNT(*)::int
  FROM trapper.staff_messages
  WHERE recipient_staff_id = p_staff_id
    AND status = 'unread';
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION trapper.get_unread_message_count IS 'Get count of unread messages for a staff member';

-- -----------------------------------------------------
-- Summary
-- -----------------------------------------------------

\echo ''
\echo 'Created table:'
\echo '  - staff_messages: Internal staff messaging'
\echo ''
\echo 'Created view:'
\echo '  - v_staff_messages_inbox: Messages with names'
\echo ''
\echo 'Created functions:'
\echo '  - send_staff_message(): Send message by recipient name'
\echo '  - get_unread_message_count(): Count unread messages'
\echo ''
\echo 'MIG_477 complete'
\echo '=========================================='
