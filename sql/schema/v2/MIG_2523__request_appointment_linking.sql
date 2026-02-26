-- MIG_2523: Request-Appointment Linking
--
-- Problem: Requests are often created before clinic data arrives:
-- - Day 1: Request created via Web Intake for "123 Oak St"
-- - Day 5: Trapping happens, cats brought to clinic
-- - Day 5: ClinicHQ appointment created with same address
--
-- Solution:
-- 1. Link appointments to requests via place_id match
-- 2. Use get_place_family() for multi-unit/nearby place matching
-- 3. Queue fuzzy address matches for review
-- 4. Support person-based matching as fallback
--
-- Created: 2026-02-26

\echo ''
\echo '=============================================='
\echo '  MIG_2523: Request-Appointment Linking'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Pre-check: Current linking state
-- ============================================================================

\echo '1. Pre-check: Current appointment-request linking...'

SELECT
  'total_appointments' as metric,
  COUNT(*) as value
FROM ops.appointments
UNION ALL
SELECT 'appointments_with_request', COUNT(*)
FROM ops.appointments WHERE request_id IS NOT NULL
UNION ALL
SELECT 'appointments_without_request', COUNT(*)
FROM ops.appointments WHERE request_id IS NULL
UNION ALL
SELECT 'active_requests', COUNT(*)
FROM ops.requests WHERE status NOT IN ('completed', 'cancelled');

-- ============================================================================
-- 2. Create main linking function
-- ============================================================================

\echo ''
\echo '2. Creating link_appointments_to_requests() function...'

CREATE OR REPLACE FUNCTION ops.link_appointments_to_requests(
  p_batch_size INTEGER DEFAULT 1000,
  p_max_days_before INTEGER DEFAULT 7,
  p_max_months_after INTEGER DEFAULT 6
)
RETURNS TABLE(
  tier1_linked INTEGER,
  tier2_queued INTEGER,
  tier3_queued INTEGER
) AS $$
DECLARE
  v_tier1 INT := 0;
  v_tier2 INT := 0;
  v_tier3 INT := 0;
  v_record RECORD;
  v_place_family UUID[];
BEGIN
  -- =========================================================================
  -- TIER 1: Direct place_id match (auto-link)
  -- =========================================================================

  FOR v_record IN
    SELECT DISTINCT ON (a.appointment_id)
      a.appointment_id,
      r.request_id,
      'direct_place_match' as match_type
    FROM ops.appointments a
    JOIN ops.requests r ON (
      a.inferred_place_id = r.place_id
      AND r.place_id IS NOT NULL
    )
    WHERE a.request_id IS NULL
      AND r.status NOT IN ('completed', 'cancelled')
      AND a.appointment_date >= r.created_at - (p_max_days_before || ' days')::INTERVAL
      AND a.appointment_date <= r.created_at + (p_max_months_after || ' months')::INTERVAL
    ORDER BY a.appointment_id, ABS(EXTRACT(EPOCH FROM (a.appointment_date - r.created_at)))
    LIMIT p_batch_size
  LOOP
    UPDATE ops.appointments
    SET request_id = v_record.request_id
    WHERE appointment_id = v_record.appointment_id
      AND request_id IS NULL;

    IF FOUND THEN
      v_tier1 := v_tier1 + 1;
    END IF;
  END LOOP;

  -- =========================================================================
  -- TIER 1b: Place family match (co-located, parent/child places)
  -- =========================================================================

  FOR v_record IN
    SELECT DISTINCT ON (a.appointment_id)
      a.appointment_id,
      r.request_id,
      'place_family_match' as match_type
    FROM ops.appointments a
    CROSS JOIN LATERAL (
      SELECT sot.get_place_family(a.inferred_place_id) as family
    ) pf
    JOIN ops.requests r ON (
      r.place_id = ANY(pf.family)
      AND r.place_id IS NOT NULL
    )
    WHERE a.request_id IS NULL
      AND a.inferred_place_id IS NOT NULL
      AND r.status NOT IN ('completed', 'cancelled')
      AND a.appointment_date >= r.created_at - (p_max_days_before || ' days')::INTERVAL
      AND a.appointment_date <= r.created_at + (p_max_months_after || ' months')::INTERVAL
    ORDER BY a.appointment_id, ABS(EXTRACT(EPOCH FROM (a.appointment_date - r.created_at)))
    LIMIT p_batch_size
  LOOP
    UPDATE ops.appointments
    SET request_id = v_record.request_id
    WHERE appointment_id = v_record.appointment_id
      AND request_id IS NULL;

    IF FOUND THEN
      v_tier1 := v_tier1 + 1;
    END IF;
  END LOOP;

  -- =========================================================================
  -- TIER 2: Address fuzzy match (queue for review)
  -- Only if pg_trgm extension available
  -- =========================================================================

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    INSERT INTO ops.data_quality_review_queue (
      entity_type, entity_id, issue_type, suggested_action, details, created_at
    )
    SELECT DISTINCT ON (a.appointment_id)
      'appointment',
      a.appointment_id,
      'potential_request_match',
      'link_to_request',
      jsonb_build_object(
        'request_id', r.request_id,
        'match_type', 'address_similarity',
        'appointment_address', p_appt.formatted_address,
        'request_address', p_req.formatted_address,
        'similarity', similarity(
          COALESCE(p_appt.formatted_address, ''),
          COALESCE(p_req.formatted_address, '')
        )
      ),
      NOW()
    FROM ops.appointments a
    JOIN sot.places p_appt ON p_appt.place_id = a.inferred_place_id
      AND p_appt.merged_into_place_id IS NULL
    JOIN ops.requests r ON r.status NOT IN ('completed', 'cancelled')
    JOIN sot.places p_req ON p_req.place_id = r.place_id
      AND p_req.merged_into_place_id IS NULL
    WHERE a.request_id IS NULL
      AND a.inferred_place_id != r.place_id
      AND p_appt.formatted_address IS NOT NULL
      AND p_req.formatted_address IS NOT NULL
      AND similarity(
        COALESCE(p_appt.formatted_address, ''),
        COALESCE(p_req.formatted_address, '')
      ) > 0.75
      AND a.appointment_date >= r.created_at - (p_max_days_before || ' days')::INTERVAL
      AND a.appointment_date <= r.created_at + (p_max_months_after || ' months')::INTERVAL
    ORDER BY a.appointment_id,
      similarity(COALESCE(p_appt.formatted_address, ''), COALESCE(p_req.formatted_address, '')) DESC
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_tier2 = ROW_COUNT;
  END IF;

  -- =========================================================================
  -- TIER 3: Person match + proximity (queue for review)
  -- Requestor or site contact matches appointment person
  -- =========================================================================

  INSERT INTO ops.data_quality_review_queue (
    entity_type, entity_id, issue_type, suggested_action, details, created_at
  )
  SELECT DISTINCT ON (a.appointment_id)
    'appointment',
    a.appointment_id,
    'potential_request_match',
    'link_to_request',
    jsonb_build_object(
      'request_id', r.request_id,
      'match_type', 'person_match',
      'matched_person_id', CASE
        WHEN a.person_id = r.requester_person_id THEN r.requester_person_id
        WHEN a.person_id = r.site_contact_person_id THEN r.site_contact_person_id
      END,
      'match_role', CASE
        WHEN a.person_id = r.requester_person_id THEN 'requestor'
        WHEN a.person_id = r.site_contact_person_id THEN 'site_contact'
      END,
      'distance_km', COALESCE(
        ST_Distance(
          p_appt.location::geography,
          p_req.location::geography
        ) / 1000.0,
        -1
      )
    ),
    NOW()
  FROM ops.appointments a
  JOIN ops.requests r ON (
    a.person_id = r.requester_person_id
    OR a.person_id = r.site_contact_person_id
  )
  LEFT JOIN sot.places p_appt ON p_appt.place_id = a.inferred_place_id
  LEFT JOIN sot.places p_req ON p_req.place_id = r.place_id
  WHERE a.request_id IS NULL
    AND a.person_id IS NOT NULL
    AND r.status NOT IN ('completed', 'cancelled')
    AND a.appointment_date >= r.created_at - (p_max_days_before || ' days')::INTERVAL
    AND a.appointment_date <= r.created_at + (p_max_months_after || ' months')::INTERVAL
    -- Must be within 5km if both have locations
    AND (
      p_appt.location IS NULL
      OR p_req.location IS NULL
      OR ST_DWithin(
        p_appt.location::geography,
        p_req.location::geography,
        5000  -- 5km
      )
    )
    -- Exclude already processed in tier 1/2
    AND NOT EXISTS (
      SELECT 1 FROM ops.data_quality_review_queue q
      WHERE q.entity_type = 'appointment'
        AND q.entity_id = a.appointment_id
        AND q.issue_type = 'potential_request_match'
    )
  ORDER BY a.appointment_id, ABS(EXTRACT(EPOCH FROM (a.appointment_date - r.created_at)))
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_tier3 = ROW_COUNT;

  RETURN QUERY SELECT v_tier1, v_tier2, v_tier3;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.link_appointments_to_requests(INTEGER, INTEGER, INTEGER) IS
'Links appointments to requests in 3 tiers:
Tier 1: Direct/family place match - auto-links
Tier 2: Address fuzzy match - queues for review
Tier 3: Person + proximity match - queues for review
Parameters: batch_size, max_days_before request, max_months_after request';

-- ============================================================================
-- 3. Create helper function to approve queued matches
-- ============================================================================

\echo ''
\echo '3. Creating approve_appointment_request_match() function...'

CREATE OR REPLACE FUNCTION ops.approve_appointment_request_match(
  p_queue_id UUID,
  p_approved_by TEXT DEFAULT 'system'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_queue RECORD;
  v_request_id UUID;
BEGIN
  -- Get queue item
  SELECT * INTO v_queue
  FROM ops.data_quality_review_queue
  WHERE id = p_queue_id
    AND entity_type = 'appointment'
    AND issue_type = 'potential_request_match'
    AND resolved_at IS NULL;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  v_request_id := (v_queue.details->>'request_id')::UUID;

  -- Link appointment to request
  UPDATE ops.appointments
  SET request_id = v_request_id
  WHERE appointment_id = v_queue.entity_id
    AND request_id IS NULL;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Mark queue item as resolved
  UPDATE ops.data_quality_review_queue
  SET resolved_at = NOW(),
      resolved_by = p_approved_by,
      resolution = 'approved'
  WHERE id = p_queue_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. Run initial linking
-- ============================================================================

\echo ''
\echo '4. Running initial appointment-request linking...'

SELECT * FROM ops.link_appointments_to_requests(5000);

-- ============================================================================
-- 5. Post-check
-- ============================================================================

\echo ''
\echo '5. Post-check: Linking results...'

SELECT
  'appointments_with_request' as metric,
  COUNT(*) as value
FROM ops.appointments WHERE request_id IS NOT NULL
UNION ALL
SELECT 'appointments_without_request', COUNT(*)
FROM ops.appointments WHERE request_id IS NULL
UNION ALL
SELECT 'pending_review_queue', COUNT(*)
FROM ops.data_quality_review_queue
WHERE entity_type = 'appointment'
  AND issue_type = 'potential_request_match'
  AND resolved_at IS NULL;

\echo ''
\echo '=============================================='
\echo '  MIG_2523 Complete'
\echo '=============================================='
\echo ''
\echo 'Created: link_appointments_to_requests() function'
\echo 'Created: approve_appointment_request_match() function'
\echo 'Linked: Tier 1 (direct place match) appointments'
\echo 'Queued: Tier 2/3 matches for review'
\echo ''
\echo 'NEXT: Review queued matches via /admin/data-quality'
\echo ''
