-- MIG_2994: Identifier cardinality monitoring for proactive data quality
-- FFS-898: Detect phones/emails appearing on too many people
--
-- Extends ops.detect_operational_anomalies() with identity resolution checks.
-- Also creates a standalone monitoring view for admin dashboard.

-- 1. Monitoring view: identifiers with suspicious cardinality
CREATE OR REPLACE VIEW ops.v_identifier_cardinality AS
SELECT
  pi.id_type,
  pi.id_value_norm,
  pi.id_value_raw,
  COUNT(DISTINCT pi.person_id) AS person_count,
  ARRAY_AGG(DISTINCT p.display_name ORDER BY p.display_name) AS person_names,
  ARRAY_AGG(DISTINCT pi.person_id) AS person_ids,
  COUNT(DISTINCT ca.account_id) FILTER (WHERE ca.account_id IS NOT NULL) AS clinic_account_count,
  MIN(pi.confidence) AS min_confidence,
  MAX(p.created_at) AS latest_person_created,
  EXISTS (
    SELECT 1 FROM sot.soft_blacklist sb
    WHERE sb.identifier_type = pi.id_type AND sb.identifier_norm = pi.id_value_norm
  ) AS is_blacklisted
FROM sot.person_identifiers pi
JOIN sot.people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
LEFT JOIN ops.clinic_accounts ca ON (
  (pi.id_type = 'email' AND ca.owner_email ILIKE pi.id_value_norm)
  OR (pi.id_type = 'phone' AND REGEXP_REPLACE(ca.owner_phone, '[^0-9]', '', 'g') = pi.id_value_norm)
) AND ca.merged_into_account_id IS NULL
WHERE pi.confidence >= 0.5
GROUP BY pi.id_type, pi.id_value_norm, pi.id_value_raw
HAVING COUNT(DISTINCT pi.person_id) > 1
ORDER BY COUNT(DISTINCT pi.person_id) DESC;

COMMENT ON VIEW ops.v_identifier_cardinality IS
  'FFS-898: Identifiers (phones/emails) shared by multiple active people. '
  'Excludes low-confidence (PetLink fabricated) and merged people. '
  'High cardinality suggests org phone absorption or missed merge.';

-- 2. Monitoring view: high-volume clinic accounts (likely caretakers/trappers, not residents)
CREATE OR REPLACE VIEW ops.v_high_volume_accounts AS
SELECT
  ca.account_id,
  ca.display_name,
  ca.account_type,
  ca.owner_email,
  ca.owner_phone,
  ca.appointment_count,
  ca.cat_count,
  ca.resolved_person_id,
  p.display_name AS resolved_person_name,
  ca.first_appointment_date,
  ca.last_appointment_date,
  COUNT(DISTINCT apt.place_id) AS distinct_places
FROM ops.clinic_accounts ca
LEFT JOIN sot.people p ON p.person_id = ca.resolved_person_id
LEFT JOIN ops.appointments apt ON apt.owner_account_id = ca.account_id
WHERE ca.merged_into_account_id IS NULL
  AND ca.account_type = 'resident'
  AND ca.cat_count >= 10
GROUP BY ca.account_id, ca.display_name, ca.account_type, ca.owner_email,
  ca.owner_phone, ca.appointment_count, ca.cat_count, ca.resolved_person_id,
  p.display_name, ca.first_appointment_date, ca.last_appointment_date
HAVING COUNT(DISTINCT apt.place_id) >= 3
ORDER BY ca.cat_count DESC;

COMMENT ON VIEW ops.v_high_volume_accounts IS
  'FFS-898: Resident-typed accounts with 10+ cats across 3+ places. '
  'Likely caretakers or trappers misclassified as residents.';

-- 3. Add configurable thresholds to app_config
INSERT INTO ops.app_config (key, value, description, category)
VALUES
  ('identity.phone_cardinality_warning', '5', 'Phone on N+ distinct people triggers warning', 'data_quality'),
  ('identity.phone_cardinality_critical', '10', 'Phone on N+ distinct people triggers critical', 'data_quality'),
  ('identity.email_cardinality_warning', '3', 'Email on N+ distinct people triggers warning', 'data_quality'),
  ('identity.email_cardinality_critical', '8', 'Email on N+ distinct people triggers critical', 'data_quality'),
  ('identity.resident_cat_count_warning', '10', 'Resident account with N+ cats may be misclassified', 'data_quality')
ON CONFLICT (key) DO NOTHING;

-- 4. Extend detect_operational_anomalies() to include cardinality checks
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
    AND sub.current_rate < sub.prior_rate

  UNION ALL

  -- 5. FFS-898: Phone numbers shared by too many people (org phone absorption)
  SELECT
    'shared_phone'::TEXT,
    'person'::TEXT,
    (ARRAY_AGG(pi.person_id))[1],  -- first person as anchor
    CASE WHEN COUNT(DISTINCT pi.person_id) >= 10 THEN 'critical'
         WHEN COUNT(DISTINCT pi.person_id) >= 5 THEN 'high'
         ELSE 'medium' END,
    format('Phone %s is shared by %s distinct people: %s — likely org/shared phone needing soft blacklist',
      pi.id_value_raw,
      COUNT(DISTINCT pi.person_id),
      LEFT(STRING_AGG(DISTINCT p.display_name, ', ' ORDER BY p.display_name), 200)
    ),
    jsonb_build_object(
      'phone', pi.id_value_raw,
      'phone_norm', pi.id_value_norm,
      'person_count', COUNT(DISTINCT pi.person_id),
      'person_names', ARRAY_AGG(DISTINCT p.display_name ORDER BY p.display_name),
      'person_ids', ARRAY_AGG(DISTINCT pi.person_id)
    )
  FROM sot.person_identifiers pi
  JOIN sot.people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
  WHERE pi.id_type = 'phone'
    AND pi.confidence >= 0.5
    AND NOT EXISTS (
      SELECT 1 FROM sot.soft_blacklist sb
      WHERE sb.identifier_type = 'phone' AND sb.identifier_norm = pi.id_value_norm
    )
  GROUP BY pi.id_value_norm, pi.id_value_raw
  HAVING COUNT(DISTINCT pi.person_id) >= 3

  UNION ALL

  -- 6. FFS-898: Emails shared by too many people
  SELECT
    'shared_email'::TEXT,
    'person'::TEXT,
    (ARRAY_AGG(pi.person_id))[1],
    CASE WHEN COUNT(DISTINCT pi.person_id) >= 8 THEN 'critical'
         WHEN COUNT(DISTINCT pi.person_id) >= 3 THEN 'high'
         ELSE 'medium' END,
    format('Email %s is shared by %s distinct people: %s — likely org email or missed merge',
      pi.id_value_raw,
      COUNT(DISTINCT pi.person_id),
      LEFT(STRING_AGG(DISTINCT p.display_name, ', ' ORDER BY p.display_name), 200)
    ),
    jsonb_build_object(
      'email', pi.id_value_raw,
      'email_norm', pi.id_value_norm,
      'person_count', COUNT(DISTINCT pi.person_id),
      'person_names', ARRAY_AGG(DISTINCT p.display_name ORDER BY p.display_name),
      'person_ids', ARRAY_AGG(DISTINCT pi.person_id)
    )
  FROM sot.person_identifiers pi
  JOIN sot.people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
  WHERE pi.id_type = 'email'
    AND pi.confidence >= 0.5
    AND NOT EXISTS (
      SELECT 1 FROM sot.soft_blacklist sb
      WHERE sb.identifier_type = 'email' AND sb.identifier_norm = pi.id_value_norm
    )
  GROUP BY pi.id_value_norm, pi.id_value_raw
  HAVING COUNT(DISTINCT pi.person_id) >= 3

  UNION ALL

  -- 7. FFS-898: Resident accounts with high cat count across many places (likely misclassified)
  SELECT
    'misclassified_resident'::TEXT,
    'person'::TEXT,
    ca.resolved_person_id,
    CASE WHEN ca.cat_count >= 30 THEN 'high' ELSE 'medium' END,
    format('Account "%s" classified as resident but has %s cats across %s places — likely caretaker or trapper',
      ca.display_name,
      ca.cat_count,
      (SELECT COUNT(DISTINCT apt.place_id) FROM ops.appointments apt WHERE apt.owner_account_id = ca.account_id)
    ),
    jsonb_build_object(
      'account_id', ca.account_id,
      'display_name', ca.display_name,
      'account_type', ca.account_type,
      'cat_count', ca.cat_count,
      'resolved_person_id', ca.resolved_person_id
    )
  FROM ops.clinic_accounts ca
  WHERE ca.merged_into_account_id IS NULL
    AND ca.account_type = 'resident'
    AND ca.cat_count >= 10
    AND ca.resolved_person_id IS NOT NULL
    AND (SELECT COUNT(DISTINCT apt.place_id) FROM ops.appointments apt WHERE apt.owner_account_id = ca.account_id) >= 3;
$$;

COMMENT ON FUNCTION ops.detect_operational_anomalies() IS
  'FFS-867 + FFS-898: Detects operational anomalies and identity quality issues. '
  'Checks: stale requests, cat spikes, duplicate intakes, alteration regressions, '
  'shared phones/emails (org absorption), misclassified resident accounts.';
