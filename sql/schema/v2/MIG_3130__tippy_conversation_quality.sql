-- MIG_3130: Tippy conversation quality metrics (FFS-1449)
-- Track iteration usage, empty responses, and continuation patterns.

ALTER TABLE ops.tippy_conversations
  ADD COLUMN IF NOT EXISTS iterations_used INT,
  ADD COLUMN IF NOT EXISTS hit_iteration_limit BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS had_empty_response BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS continue_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS schema_exploration_blocked INT DEFAULT 0;

-- Monitoring view
CREATE OR REPLACE VIEW ops.v_tippy_conversation_quality AS
SELECT
  staff_id,
  DATE_TRUNC('week', started_at) AS week,
  COUNT(*) AS conversations,
  COUNT(*) FILTER (WHERE hit_iteration_limit) AS exhausted,
  COUNT(*) FILTER (WHERE had_empty_response) AS empty,
  ROUND(AVG(continue_count)::numeric, 1) AS avg_continues,
  ROUND(AVG(iterations_used)::numeric, 1) AS avg_iterations,
  ROUND(AVG(schema_exploration_blocked)::numeric, 1) AS avg_schema_blocks
FROM ops.tippy_conversations
WHERE started_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY staff_id, DATE_TRUNC('week', started_at)
ORDER BY week DESC;
