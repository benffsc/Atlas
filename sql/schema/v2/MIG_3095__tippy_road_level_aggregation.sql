-- MIG_3095: Road-level multi-place aggregation for Tippy (FFS-1308)
--
-- When someone asks "tell me about Pozzan Road in Healdsburg",
-- tippy_place_full_report('Pozzan Road Healdsburg') returns found:false
-- because it only matches a single specific address.
--
-- This migration adds a wrapper that:
-- 1. Detects road-level queries (no house number)
-- 2. Returns ALL matching places ranked by operational significance
-- 3. Calls the full report for the most significant place
-- 4. Returns brief summaries for the rest

\echo ''
\echo '=============================================='
\echo '  MIG_3095: Tippy Road-Level Aggregation'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Create ops.tippy_road_summary() — multi-place aggregation
-- ============================================================================

\echo '1. Creating ops.tippy_road_summary()...'

CREATE OR REPLACE FUNCTION ops.tippy_road_summary(p_search TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_places JSONB;
  v_primary_report JSONB;
  v_other_places JSONB;
  v_count INT;
  v_normalized TEXT;
  v_search_words TEXT[];
BEGIN
  -- Normalize common road suffixes (PG uses \m \M for word boundaries)
  v_normalized := p_search;
  v_normalized := regexp_replace(v_normalized, '\mRoad\M', 'Rd', 'gi');
  v_normalized := regexp_replace(v_normalized, '\mStreet\M', 'St', 'gi');
  v_normalized := regexp_replace(v_normalized, '\mAvenue\M', 'Ave', 'gi');
  v_normalized := regexp_replace(v_normalized, '\mDrive\M', 'Dr', 'gi');
  v_normalized := regexp_replace(v_normalized, '\mLane\M', 'Ln', 'gi');
  v_normalized := regexp_replace(v_normalized, '\mBoulevard\M', 'Blvd', 'gi');
  v_normalized := regexp_replace(v_normalized, '\mCourt\M', 'Ct', 'gi');
  v_normalized := regexp_replace(v_normalized, '\mCircle\M', 'Cir', 'gi');
  v_normalized := regexp_replace(v_normalized, '\mHighway\M', 'Hwy', 'gi');

  -- Split into words for multi-word matching
  v_search_words := regexp_split_to_array(trim(v_normalized), '\s+');

  WITH matched AS (
    SELECT
      p.place_id,
      COALESCE(a.display_address, p.formatted_address, p.display_name) AS address,
      p.display_name,
      a.city,
      COALESCE((
        SELECT COUNT(DISTINCT cp.cat_id)
        FROM sot.cat_place cp
        JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
        WHERE cp.place_id = p.place_id
          AND COALESCE(cp.presence_status, 'unknown') != 'departed'
      ), 0) AS cat_count,
      (SELECT COUNT(*) FROM ops.requests r
       WHERE r.place_id = p.place_id AND r.merged_into_request_id IS NULL) AS total_requests,
      (SELECT COUNT(*) FROM ops.requests r
       WHERE r.place_id = p.place_id AND r.merged_into_request_id IS NULL
         AND r.status IN ('new', 'triaged', 'scheduled', 'in_progress', 'paused')) AS active_requests,
      (SELECT r.status FROM ops.requests r
       WHERE r.place_id = p.place_id AND r.merged_into_request_id IS NULL
       ORDER BY r.created_at DESC LIMIT 1) AS latest_request_status,
      (SELECT STRING_AGG(DISTINCT pe.display_name, ', ')
       FROM sot.person_place pp
       JOIN sot.people pe ON pe.person_id = pp.person_id AND pe.merged_into_person_id IS NULL
       WHERE pp.place_id = p.place_id) AS people_names,
      p.last_activity_at,
      EXISTS (
        SELECT 1 FROM ops.request_trapper_assignments rta
        JOIN ops.requests r ON r.request_id = rta.request_id
        WHERE r.place_id = p.place_id AND rta.status = 'active'
      ) AS has_trapper,
      COALESCE((SELECT has_any_disease FROM ops.v_place_disease_summary ds
        WHERE ds.place_id = p.place_id), FALSE) AS has_disease
    FROM sot.places p
    LEFT JOIN sot.addresses a ON a.address_id = COALESCE(p.sot_address_id, p.address_id)
    WHERE p.merged_into_place_id IS NULL
      -- Every search word must appear somewhere in the address
      AND (
        SELECT bool_and(
          p.formatted_address ILIKE '%' || w || '%'
          OR COALESCE(p.display_name, '') ILIKE '%' || w || '%'
          OR COALESCE(a.display_address, '') ILIKE '%' || w || '%'
        )
        FROM unnest(v_search_words) AS w
      )
    ORDER BY
      (SELECT COUNT(*) FROM ops.requests r
       WHERE r.place_id = p.place_id AND r.merged_into_request_id IS NULL
         AND r.status IN ('new', 'triaged', 'scheduled', 'in_progress', 'paused')) DESC,
      CASE WHEN EXISTS (
        SELECT 1 FROM ops.request_trapper_assignments rta
        JOIN ops.requests r ON r.request_id = rta.request_id
        WHERE r.place_id = p.place_id AND rta.status = 'active'
      ) THEN 0 ELSE 1 END,
      COALESCE((
        SELECT COUNT(DISTINCT cp.cat_id)
        FROM sot.cat_place cp
        JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
        WHERE cp.place_id = p.place_id
          AND COALESCE(cp.presence_status, 'unknown') != 'departed'
      ), 0) DESC,
      p.last_activity_at DESC NULLS LAST
    LIMIT 20
  )
  SELECT
    JSONB_AGG(JSONB_BUILD_OBJECT(
      'place_id', m.place_id,
      'address', m.address,
      'city', m.city,
      'cat_count', m.cat_count,
      'total_requests', m.total_requests,
      'active_requests', m.active_requests,
      'latest_request_status', m.latest_request_status,
      'people', m.people_names,
      'has_trapper', m.has_trapper,
      'has_disease', m.has_disease,
      'last_activity_at', m.last_activity_at
    )),
    COUNT(*)::INT
  INTO v_places, v_count
  FROM matched m;

  IF v_count = 0 OR v_places IS NULL THEN
    RETURN JSONB_BUILD_OBJECT(
      'found', FALSE,
      'mode', 'road_summary',
      'message', 'No places found matching "' || p_search || '" (normalized: "' || v_normalized || '")'
    );
  END IF;

  -- Single result → call the full report directly
  IF v_count = 1 THEN
    RETURN ops.tippy_place_full_report_single(v_places->0->>'address');
  END IF;

  -- Multiple results → full report on #1, summaries for rest
  v_primary_report := ops.tippy_place_full_report_single(v_places->0->>'address');

  SELECT JSONB_AGG(v_places->i)
  INTO v_other_places
  FROM generate_series(1, v_count - 1) AS i;

  RETURN JSONB_BUILD_OBJECT(
    'found', TRUE,
    'mode', 'road_summary',
    'total_places', v_count,
    'search_term', p_search,
    'normalized_search', v_normalized,
    'primary_place', v_primary_report,
    'other_places', COALESCE(v_other_places, '[]'::JSONB),
    'ranking_note', 'Primary place selected by: active requests > trapper assigned > cat count > recency'
  );
END;
$$;

COMMENT ON FUNCTION ops.tippy_road_summary IS
  'Multi-place aggregation for road/area queries. Returns full report for most '
  'operationally significant place + summaries for rest. Ranked by: active requests > '
  'trapper > cat count > recency. MIG_3095/FFS-1308.';

-- ============================================================================
-- 2. Enhance tippy_place_full_report to detect road-level queries
-- ============================================================================

\echo '2. Wrapping tippy_place_full_report with road detection...'

-- Save the original as _single so we can call it directly
-- (only if _single doesn't already exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tippy_place_full_report_single'
                 AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'ops')) THEN
    -- Rename original to _single
    ALTER FUNCTION ops.tippy_place_full_report(text) RENAME TO tippy_place_full_report_single;
  END IF;
END $$;

-- Create new wrapper that detects road-level queries
CREATE OR REPLACE FUNCTION ops.tippy_place_full_report(p_address TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_has_house_number BOOLEAN;
  v_single_result JSONB;
BEGIN
  -- Detect if this looks like a specific address (has house number) or a road query
  -- House numbers: start with digits, or "PO Box", etc.
  v_has_house_number := (p_address ~ '^\s*\d+' OR p_address ~ '(?i)^P\.?O\.?\s*Box');

  IF v_has_house_number THEN
    -- Specific address → use original single-place function
    RETURN ops.tippy_place_full_report_single(p_address);
  END IF;

  -- Road-level query → try single first (might match a display_name)
  v_single_result := ops.tippy_place_full_report_single(p_address);

  -- If single found a match, return it
  IF (v_single_result->>'found')::boolean THEN
    RETURN v_single_result;
  END IF;

  -- Single didn't find anything → try road summary
  RETURN ops.tippy_road_summary(p_address);
END;
$$;

COMMENT ON FUNCTION ops.tippy_place_full_report(text) IS
  'Smart wrapper: routes specific addresses to single-place report, '
  'road/area queries to multi-place aggregation. MIG_3095/FFS-1308.';

\echo ''
\echo '✓ MIG_3095 complete — road-level aggregation for Tippy'
\echo ''
\echo '  Test: SELECT ops.tippy_place_full_report(''Pozzan Road Healdsburg'')::jsonb->>''mode'';'
\echo '  Expected: road_summary'
\echo ''
\echo '  Test: SELECT ops.tippy_place_full_report(''15760 Pozzan'')::jsonb->>''found'';'
\echo '  Expected: true (single-place mode)'
\echo ''
