-- ============================================================================
-- MIG_2999: Proactive Alert Queue (Phase 1A — Long-Term Strategy)
-- ============================================================================
-- Problem: Data quality cron computes alerts every 6 hours, but results vanish
-- into API responses nobody reads. Staff only finds issues when checking
-- /admin/anomalies manually.
--
-- Solution: Persistent alert queue with Slack webhook + email digest support.
-- The data quality cron writes here; external integrations consume from here.
--
-- FFS-897
-- ============================================================================

\echo ''
\echo '================================================'
\echo '  MIG_2999: Proactive Alert Queue'
\echo '================================================'
\echo ''

-- ============================================================================
-- 1. Create ops.alert_queue table
-- ============================================================================

\echo '1. Creating ops.alert_queue table...'

CREATE TABLE IF NOT EXISTS ops.alert_queue (
  alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Alert classification
  level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'critical')),
  source TEXT NOT NULL DEFAULT 'data_quality_check',
  metric TEXT NOT NULL,

  -- Alert content
  message TEXT NOT NULL,
  current_value NUMERIC,
  threshold_value NUMERIC,
  details JSONB,

  -- Notification tracking
  slack_notified_at TIMESTAMPTZ,
  email_notified_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'notified', 'acknowledged', 'resolved', 'suppressed')),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,

  -- Dedup: same metric shouldn't fire repeatedly
  dedup_key TEXT GENERATED ALWAYS AS (source || ':' || metric) STORED,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_queue_status ON ops.alert_queue(status);
CREATE INDEX IF NOT EXISTS idx_alert_queue_level ON ops.alert_queue(level);
CREATE INDEX IF NOT EXISTS idx_alert_queue_created ON ops.alert_queue(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_queue_dedup ON ops.alert_queue(dedup_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_queue_pending_slack
  ON ops.alert_queue(level, created_at)
  WHERE slack_notified_at IS NULL AND status = 'new';

COMMENT ON TABLE ops.alert_queue IS
'Persistent alert queue for data quality and operational alerts.
Consumed by Slack webhook (immediate for critical/warning) and email digest (daily summary).
Phase 1A of long-term data strategy. FFS-897.';

\echo '   Created ops.alert_queue'

-- ============================================================================
-- 2. Helper: Write an alert with dedup
-- ============================================================================

\echo ''
\echo '2. Creating ops.write_alert() function...'

CREATE OR REPLACE FUNCTION ops.write_alert(
  p_level TEXT,
  p_source TEXT,
  p_metric TEXT,
  p_message TEXT,
  p_current_value NUMERIC DEFAULT NULL,
  p_threshold_value NUMERIC DEFAULT NULL,
  p_details JSONB DEFAULT NULL,
  p_dedup_hours INT DEFAULT 6
)
RETURNS UUID AS $$
DECLARE
  v_existing UUID;
  v_alert_id UUID;
BEGIN
  -- Dedup: skip if same source+metric alert exists within dedup window
  SELECT alert_id INTO v_existing
  FROM ops.alert_queue
  WHERE dedup_key = (p_source || ':' || p_metric)
    AND created_at > NOW() - (p_dedup_hours || ' hours')::INTERVAL
    AND status IN ('new', 'notified')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    -- Update existing alert with latest values
    UPDATE ops.alert_queue SET
      current_value = COALESCE(p_current_value, current_value),
      message = p_message,
      details = COALESCE(p_details, details)
    WHERE alert_id = v_existing;
    RETURN v_existing;
  END IF;

  -- Insert new alert
  INSERT INTO ops.alert_queue (level, source, metric, message, current_value, threshold_value, details)
  VALUES (p_level, p_source, p_metric, p_message, p_current_value, p_threshold_value, p_details)
  RETURNING alert_id INTO v_alert_id;

  RETURN v_alert_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.write_alert IS
'Write an alert to the queue with dedup. If same source+metric alert exists
within dedup window (default 6h), updates existing alert instead of creating new.
Returns alert_id (new or existing).';

\echo '   Created ops.write_alert()'

-- ============================================================================
-- 3. Helper: Get pending alerts for Slack notification
-- ============================================================================

\echo ''
\echo '3. Creating ops.get_pending_slack_alerts() function...'

CREATE OR REPLACE FUNCTION ops.get_pending_slack_alerts()
RETURNS TABLE (
  alert_id UUID,
  level TEXT,
  source TEXT,
  metric TEXT,
  message TEXT,
  current_value NUMERIC,
  threshold_value NUMERIC,
  details JSONB,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    aq.alert_id,
    aq.level,
    aq.source,
    aq.metric,
    aq.message,
    aq.current_value,
    aq.threshold_value,
    aq.details,
    aq.created_at
  FROM ops.alert_queue aq
  WHERE aq.slack_notified_at IS NULL
    AND aq.status = 'new'
    AND aq.level IN ('warning', 'critical')
  ORDER BY
    CASE aq.level WHEN 'critical' THEN 0 ELSE 1 END,
    aq.created_at ASC;
END;
$$ LANGUAGE plpgsql STABLE;

\echo '   Created ops.get_pending_slack_alerts()'

-- ============================================================================
-- 4. Helper: Mark alerts as Slack-notified
-- ============================================================================

\echo ''
\echo '4. Creating ops.mark_alerts_slack_notified() function...'

CREATE OR REPLACE FUNCTION ops.mark_alerts_slack_notified(p_alert_ids UUID[])
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE ops.alert_queue
  SET slack_notified_at = NOW(),
      status = 'notified'
  WHERE alert_id = ANY(p_alert_ids)
    AND slack_notified_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

\echo '   Created ops.mark_alerts_slack_notified()'

-- ============================================================================
-- 5. Helper: Get daily digest (for email)
-- ============================================================================

\echo ''
\echo '5. Creating ops.get_alert_digest() function...'

CREATE OR REPLACE FUNCTION ops.get_alert_digest(p_hours INT DEFAULT 24)
RETURNS TABLE (
  level TEXT,
  alert_count BIGINT,
  alerts JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    aq.level,
    COUNT(*) AS alert_count,
    jsonb_agg(jsonb_build_object(
      'metric', aq.metric,
      'message', aq.message,
      'current_value', aq.current_value,
      'threshold_value', aq.threshold_value,
      'created_at', aq.created_at
    ) ORDER BY aq.created_at DESC) AS alerts
  FROM ops.alert_queue aq
  WHERE aq.created_at > NOW() - (p_hours || ' hours')::INTERVAL
    AND aq.email_notified_at IS NULL
  GROUP BY aq.level
  ORDER BY
    CASE aq.level WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END;
END;
$$ LANGUAGE plpgsql STABLE;

\echo '   Created ops.get_alert_digest()'

-- ============================================================================
-- 6. Helper: Mark alerts as email-notified
-- ============================================================================

\echo ''
\echo '6. Creating ops.mark_alerts_email_notified() function...'

CREATE OR REPLACE FUNCTION ops.mark_alerts_email_notified(p_hours INT DEFAULT 24)
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE ops.alert_queue
  SET email_notified_at = NOW()
  WHERE created_at > NOW() - (p_hours || ' hours')::INTERVAL
    AND email_notified_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

\echo '   Created ops.mark_alerts_email_notified()'

-- ============================================================================
-- 7. Config defaults for alerting
-- ============================================================================

\echo ''
\echo '7. Inserting alert config defaults...'

INSERT INTO ops.app_config (key, value, description) VALUES
  ('alerts.slack_enabled', 'true', 'Enable Slack webhook notifications for alerts'),
  ('alerts.email_digest_enabled', 'true', 'Enable daily email digest of alerts'),
  ('alerts.dedup_hours', '6', 'Hours to deduplicate same metric alerts'),
  ('alerts.digest_recipient', '', 'Email address for daily alert digest (leave empty to skip)')
ON CONFLICT (key) DO NOTHING;

\echo '   Inserted config defaults'

-- ============================================================================
-- 8. Verification
-- ============================================================================

\echo ''
\echo '8. Verifying...'

SELECT
  c.relname AS table_name,
  (SELECT COUNT(*) FROM information_schema.columns ic
   WHERE ic.table_schema = 'ops' AND ic.table_name = c.relname) AS column_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'ops' AND c.relname = 'alert_queue';

SELECT p.proname, pg_get_function_arguments(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'ops' AND p.proname LIKE '%alert%'
ORDER BY p.proname;

\echo ''
\echo '================================================'
\echo '  MIG_2999 Complete (FFS-897)'
\echo '================================================'
\echo ''
\echo 'Created:'
\echo '  - ops.alert_queue table'
\echo '  - ops.write_alert() — deduped alert insertion'
\echo '  - ops.get_pending_slack_alerts() — unnotified critical/warning alerts'
\echo '  - ops.mark_alerts_slack_notified() — mark as sent to Slack'
\echo '  - ops.get_alert_digest() — daily digest aggregation'
\echo '  - ops.mark_alerts_email_notified() — mark as sent in digest'
\echo ''
