-- MIG_3104: Fix road-level query dispatch in tippy_place_full_report
--
-- BUG: "Summer Creek Dr" (no house number) → wrapper calls _single first,
-- which picks 2327 (most cats) over 2408 (active request, 25+ cats reported).
-- tippy_road_summary correctly ranks by active requests first, but is never
-- reached because _single returns found=true.
--
-- ROOT CAUSE: Two issues:
-- 1. Wrapper tries _single before road_summary for road queries
-- 2. _single sorts by cat_count DESC, not by active requests
--
-- FIX 1: Wrapper goes straight to road_summary for road queries.
-- FIX 2: _single's ORDER BY prefers places with active requests.

-- ============================================================================
-- FIX 1: Wrapper — road queries go straight to road_summary
-- ============================================================================

CREATE OR REPLACE FUNCTION ops.tippy_place_full_report(p_address TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_has_house_number BOOLEAN;
  v_road_result JSONB;
  v_single_result JSONB;
BEGIN
  v_has_house_number := (p_address ~ '^\s*\d+' OR p_address ~ '(?i)^P\.?O\.?\s*Box');

  IF v_has_house_number THEN
    -- Specific address → single-place function
    RETURN ops.tippy_place_full_report_single(p_address);
  END IF;

  -- Road-level query → road summary first (ranks by active requests)
  v_road_result := ops.tippy_road_summary(p_address);
  IF (v_road_result->>'found')::boolean THEN
    RETURN v_road_result;
  END IF;

  -- Fallback: try single in case search term matches a display_name exactly
  v_single_result := ops.tippy_place_full_report_single(p_address);
  IF (v_single_result->>'found')::boolean THEN
    RETURN v_single_result;
  END IF;

  RETURN JSONB_BUILD_OBJECT(
    'found', false,
    'message', 'No place found matching "' || p_address || '"'
  );
END;
$$;

-- ============================================================================
-- FIX 2: _single ORDER BY — active requests before cat count
-- ============================================================================
-- This is a surgical fix: only the SELECT...INTO v_place_id query changes.
-- The rest of the 350-line function is untouched.
--
-- We use DO block + dynamic replacement to avoid rewriting the entire function.

DO $$
DECLARE
  v_src TEXT;
  v_old TEXT;
  v_new TEXT;
BEGIN
  -- Get current function source
  SELECT prosrc INTO v_src
  FROM pg_proc
  WHERE proname = 'tippy_place_full_report_single'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'ops');

  -- The old ORDER BY clause
  v_old := E'ORDER BY\n'
    || E'        CASE WHEN p.display_name ILIKE p_address THEN 0\n'
    || E'             WHEN p.display_name ILIKE p_address || ''%'' THEN 1\n'
    || E'             ELSE 2 END,\n'
    || E'        (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = p.place_id) DESC';

  -- New ORDER BY: active requests first, then cat count
  v_new := E'ORDER BY\n'
    || E'        CASE WHEN p.display_name ILIKE p_address THEN 0\n'
    || E'             WHEN p.display_name ILIKE p_address || ''%'' THEN 1\n'
    || E'             ELSE 2 END,\n'
    || E'        EXISTS (\n'
    || E'            SELECT 1 FROM ops.requests r\n'
    || E'            WHERE r.place_id = p.place_id\n'
    || E'              AND r.merged_into_request_id IS NULL\n'
    || E'              AND r.status NOT IN (''completed'', ''cancelled'')\n'
    || E'        ) DESC,\n'
    || E'        (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = p.place_id) DESC';

  -- Check that the old pattern exists
  IF v_src NOT LIKE '%' || v_old || '%' THEN
    RAISE NOTICE 'WARNING: Could not find expected ORDER BY pattern in tippy_place_full_report_single. Skipping _single fix. Manual review needed.';
    RETURN;
  END IF;

  -- Replace the ORDER BY
  v_src := REPLACE(v_src, v_old, v_new);

  -- Recreate the function
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION ops.tippy_place_full_report_single(p_address TEXT) RETURNS JSONB LANGUAGE plpgsql STABLE AS $fn$%s$fn$',
    v_src
  );

  RAISE NOTICE 'Successfully updated tippy_place_full_report_single ORDER BY to prefer active requests';
END;
$$;

-- ============================================================================
-- FIX 3: comprehensive_place_lookup — sort active requests first
-- ============================================================================
-- Same cat-count-first bias. place_search uses this and Sonnet reads
-- the first result as most important.

DO $$
DECLARE
  v_src TEXT;
  v_old TEXT;
  v_new TEXT;
BEGIN
  SELECT prosrc INTO v_src
  FROM pg_proc
  WHERE proname = 'comprehensive_place_lookup'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'ops');

  v_old := E'SELECT JSONB_AGG(place_data ORDER BY (place_data->>''cat_count'')::INT DESC)';
  v_new := E'SELECT JSONB_AGG(place_data ORDER BY (place_data->>''has_active_request'')::BOOLEAN DESC, (place_data->>''cat_count'')::INT DESC)';

  IF v_src NOT LIKE '%' || v_old || '%' THEN
    RAISE NOTICE 'WARNING: Could not find expected ORDER BY in comprehensive_place_lookup. Skipping. Manual review needed.';
    RETURN;
  END IF;

  v_src := REPLACE(v_src, v_old, v_new);

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION ops.comprehensive_place_lookup(p_search_term TEXT) RETURNS JSONB LANGUAGE plpgsql STABLE AS $fn$%s$fn$',
    v_src
  );

  RAISE NOTICE 'Successfully updated comprehensive_place_lookup ORDER BY to prefer active requests';
END;
$$;

-- ============================================================================
-- Verify
-- ============================================================================
-- Run these after applying:
--
-- SELECT (ops.tippy_place_full_report('Summer Creek Dr'))->>'mode';
-- Expected: 'road_summary'
--
-- SELECT (ops.tippy_place_full_report('Summer Creek Dr'))->'primary_place'->'place'->>'display_name';
-- Expected: '2408 Summer Creek Dr, Santa Rosa, CA 95404'
--
-- SELECT (ops.tippy_place_full_report('2408 Summer Creek Dr'))->'place'->>'display_name';
-- Expected: '2408 Summer Creek Dr, Santa Rosa, CA 95404'
--
-- SELECT (ops.tippy_place_full_report('2327 Summer Creek Dr'))->'place'->>'display_name';
-- Expected: '2327 Summer Creek Dr., Santa Rosa, CA 95404' (still works for specific addresses)
