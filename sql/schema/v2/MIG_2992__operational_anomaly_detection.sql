-- MIG_2992: Operational anomaly detection for proactive Tippy alerts
-- FFS-867: Proactive operational anomaly detection

-- Function to detect operational anomalies across the system.
-- Returns anomalies that should be surfaced to staff via Tippy briefings.
-- Designed to run on the existing 6-hour cron schedule.
CREATE OR REPLACE FUNCTION ops.detect_operational_anomalies()
RETURNS TABLE(
  anomaly_type TEXT,
  entity_type TEXT,
  entity_id UUID,
  severity TEXT,
  description TEXT,
  evidence JSONB
) LANGUAGE sql STABLE AS $$

  -- 1. Stale requests: in_progress or scheduled for 60+ days with no activity
  SELECT
    'stale_request'::TEXT,
    'request'::TEXT,
    r.request_id,
    CASE WHEN r.updated_at < NOW() - INTERVAL '90 days' THEN 'high' ELSE 'medium' END,
    format('Request at %s has been %s for %s days with no activity',
      COALESCE(p.formatted_address, 'unknown address'),
      r.status,
      EXTRACT(DAY FROM NOW() - r.updated_at)::int
    ),
    jsonb_build_object(
      'status', r.status,
      'days_stale', EXTRACT(DAY FROM NOW() - r.updated_at)::int,
      'address', p.formatted_address
    )
  FROM ops.requests r
  LEFT JOIN sot.places p ON r.place_id = p.place_id
  WHERE r.status IN ('in_progress', 'scheduled')
    AND r.updated_at < NOW() - INTERVAL '60 days'
    AND r.merged_into_request_id IS NULL

  UNION ALL

  -- 2. Places with cat count spike (50%+ increase detected via recent appointments)
  SELECT
    'cat_count_spike'::TEXT,
    'place'::TEXT,
    cp.place_id,
    'medium'::TEXT,
    format('%s has %s cats now vs %s cats 30 days ago — %s%% increase',
      COALESCE(p.formatted_address, 'unknown'),
      cp.current_count,
      cp.prior_count,
      ROUND(100.0 * (cp.current_count - cp.prior_count) / GREATEST(cp.prior_count, 1))
    ),
    jsonb_build_object(
      'current_count', cp.current_count,
      'prior_count', cp.prior_count,
      'address', p.formatted_address
    )
  FROM (
    SELECT
      place_id,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') +
        COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '30 days') AS current_count,
      COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '30 days') AS prior_count
    FROM sot.cat_place
    WHERE merged_into_cat_id IS NULL
    GROUP BY place_id
    HAVING COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '30 days') >= 5
      AND COUNT(*) > 1.5 * COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '30 days')
  ) cp
  JOIN sot.places p ON cp.place_id = p.place_id
  WHERE p.merged_into_place_id IS NULL

  UNION ALL

  -- 3. Intake submissions potentially duplicating existing open requests (same address)
  SELECT
    'duplicate_intake'::TEXT,
    'place'::TEXT,
    i.place_id,
    'medium'::TEXT,
    format('New intake at %s may duplicate existing open request (request updated %s)',
      COALESCE(p.formatted_address, 'unknown'),
      r.updated_at::date
    ),
    jsonb_build_object(
      'intake_id', i.submission_id,
      'request_id', r.request_id,
      'request_status', r.status,
      'address', p.formatted_address
    )
  FROM ops.intake_submissions i
  JOIN sot.places p ON i.place_id = p.place_id
  JOIN ops.requests r ON r.place_id = i.place_id
  WHERE i.status = 'pending'
    AND i.created_at > NOW() - INTERVAL '7 days'
    AND r.status NOT IN ('completed', 'cancelled', 'closed')
    AND r.merged_into_request_id IS NULL
    AND p.merged_into_place_id IS NULL

  UNION ALL

  -- 4. Alteration rate regressions: places where unaltered cats appeared after reaching 80%+
  SELECT
    'alteration_regression'::TEXT,
    'place'::TEXT,
    sub.place_id,
    CASE WHEN sub.new_unaltered >= 3 THEN 'high' ELSE 'medium' END,
    format('%s: %s new unaltered cat(s) appeared — rate dropped from ~%s%% to %s%%',
      COALESCE(sub.address, 'unknown'),
      sub.new_unaltered,
      sub.prior_rate,
      sub.current_rate
    ),
    jsonb_build_object(
      'address', sub.address,
      'new_unaltered', sub.new_unaltered,
      'prior_rate', sub.prior_rate,
      'current_rate', sub.current_rate
    )
  FROM (
    SELECT
      cp.place_id,
      p.formatted_address AS address,
      COUNT(*) FILTER (
        WHERE c.altered_status IN ('intact', 'unknown', 'NULL')
          AND cp.created_at > NOW() - INTERVAL '30 days'
      ) AS new_unaltered,
      ROUND(100.0 * COUNT(*) FILTER (
        WHERE c.altered_status = 'altered'
          AND cp.created_at <= NOW() - INTERVAL '30 days'
      ) / NULLIF(COUNT(*) FILTER (
        WHERE cp.created_at <= NOW() - INTERVAL '30 days'
      ), 0)) AS prior_rate,
      ROUND(100.0 * COUNT(*) FILTER (
        WHERE c.altered_status = 'altered'
      ) / NULLIF(COUNT(*), 0)) AS current_rate
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    JOIN sot.places p ON p.place_id = cp.place_id AND p.merged_into_place_id IS NULL
    WHERE cp.merged_into_cat_id IS NULL
    GROUP BY cp.place_id, p.formatted_address
    HAVING COUNT(*) FILTER (WHERE cp.created_at <= NOW() - INTERVAL '30 days') >= 5
  ) sub
  WHERE sub.prior_rate >= 80
    AND sub.new_unaltered >= 1
    AND sub.current_rate < sub.prior_rate;
$$;

COMMENT ON FUNCTION ops.detect_operational_anomalies() IS
  'FFS-867: Detects operational anomalies for proactive Tippy alerts. '
  'Returns stale requests, cat count spikes, duplicate intakes, and alteration regressions.';
