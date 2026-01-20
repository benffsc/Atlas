-- =====================================================
-- MIG_514: Fix Tippy Conversation Stats Trigger
-- =====================================================
-- Fixes UNION type mismatch error in the trigger that
-- updates tools_used array. The original query tried to
-- UNION text[] with text, now uses UNNEST to fix.
-- =====================================================

\echo '=========================================='
\echo 'MIG_514: Fix Tippy Stats Trigger'
\echo '=========================================='

-- Fix the trigger function
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
      SELECT COALESCE(array_agg(DISTINCT tool_name), '{}')
      FROM (
        -- UNNEST the existing array to get individual text values
        SELECT UNNEST(tools_used) AS tool_name
        FROM trapper.tippy_conversations
        WHERE conversation_id = NEW.conversation_id
        UNION ALL
        -- jsonb_array_elements_text returns text, so now types match
        SELECT jsonb_array_elements_text(NEW.tool_calls->'tools')
      ) t
      WHERE tool_name IS NOT NULL AND tool_name != ''
    )
    WHERE conversation_id = NEW.conversation_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

\echo ''
\echo 'Fixed trigger function trapper.update_tippy_conversation_stats()'
\echo 'Changed SELECT tools_used to SELECT UNNEST(tools_used) to fix UNION type mismatch'
\echo ''
\echo 'MIG_514 complete'
\echo '=========================================='

SELECT trapper.record_migration(514, 'MIG_514__fix_tippy_stats_trigger');
