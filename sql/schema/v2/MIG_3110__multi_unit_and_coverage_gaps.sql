-- MIG_3110: Fix multi-unit address selection + coverage gap view
--
-- BUG: "240 Burt St" → _single picks bare skeleton record (0 cats) over
-- "240 Burt St, Santa Rosa, CA 95407" (7 cats) because exact ILIKE match
-- gets priority 0 regardless of cat count. Skeleton records with 0 cats
-- should never win over real addresses.
--
-- FIX: Add cat_count > 0 as a tiebreaker within the name-match priority.
-- Places with cats always rank above empty skeleton records.
--
-- Also creates ops.v_coverage_gaps for "what don't we know?" questions.
--
-- Addresses: FFS-1393, FFS-1405

-- ============================================================================
-- 1. Fix _single ORDER BY — don't let skeleton records win
-- ============================================================================

DO $$
DECLARE
  v_src TEXT;
  v_old TEXT;
  v_new TEXT;
BEGIN
  SELECT prosrc INTO v_src
  FROM pg_proc
  WHERE proname = 'tippy_place_full_report_single'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'ops');

  v_old := E'ORDER BY\n'
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

  -- New: exact match only gets priority 0 if the place has cats or active request.
  -- Empty skeleton records ("240 Burt St" with 0 cats) get demoted to priority 1
  -- so the cat_count tiebreaker picks the real address instead.
  v_new := E'ORDER BY\n'
    || E'        CASE WHEN p.display_name ILIKE p_address\n'
    || E'              AND (EXISTS (SELECT 1 FROM sot.cat_place cp2 WHERE cp2.place_id = p.place_id)\n'
    || E'                   OR EXISTS (SELECT 1 FROM ops.requests r2 WHERE r2.place_id = p.place_id AND r2.merged_into_request_id IS NULL AND r2.status NOT IN (''completed'',''cancelled'')))\n'
    || E'             THEN 0\n'
    || E'             WHEN p.display_name ILIKE p_address || ''%'' THEN 1\n'
    || E'             WHEN p.display_name ILIKE p_address THEN 1\n'
    || E'             ELSE 2 END,\n'
    || E'        EXISTS (\n'
    || E'            SELECT 1 FROM ops.requests r\n'
    || E'            WHERE r.place_id = p.place_id\n'
    || E'              AND r.merged_into_request_id IS NULL\n'
    || E'              AND r.status NOT IN (''completed'', ''cancelled'')\n'
    || E'        ) DESC,\n'
    || E'        (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = p.place_id) DESC,\n'
    || E'        LENGTH(p.display_name) DESC';

  IF v_src NOT LIKE '%' || v_old || '%' THEN
    RAISE NOTICE 'WARNING: Could not find expected ORDER BY in _single. Skipping.';
    RETURN;
  END IF;

  v_src := REPLACE(v_src, v_old, v_new);

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION ops.tippy_place_full_report_single(p_address TEXT) RETURNS JSONB LANGUAGE plpgsql STABLE AS $fn$%s$fn$',
    v_src
  );

  RAISE NOTICE 'Updated _single: longer display_name tiebreaker prevents skeleton records from winning';
END;
$$;

-- ============================================================================
-- 2. Coverage gap view (FFS-1405)
-- ============================================================================

CREATE OR REPLACE VIEW ops.v_coverage_gaps AS
SELECT
  a.city,
  COUNT(DISTINCT p.place_id)::INT AS total_places,
  COUNT(DISTINCT p.place_id) FILTER (
    WHERE EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.place_id = p.place_id)
  )::INT AS places_with_cats,
  COUNT(DISTINCT p.place_id) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM ops.requests r
      WHERE r.place_id = p.place_id AND r.merged_into_request_id IS NULL
    )
  )::INT AS places_with_requests,
  ROUND(
    COUNT(DISTINCT p.place_id) FILTER (
      WHERE EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.place_id = p.place_id)
    )::NUMERIC / NULLIF(COUNT(DISTINCT p.place_id), 0) * 100, 1
  ) AS cat_coverage_pct,
  (SELECT MAX(ap.appointment_date)
   FROM ops.appointments ap
   JOIN sot.places p2 ON p2.place_id = ap.place_id
   JOIN sot.addresses a2 ON a2.address_id = p2.sot_address_id AND a2.city = a.city
  )::DATE AS last_activity_date,
  -- Gap score: more places + lower coverage = higher score (more underserved)
  ROUND(
    COUNT(DISTINCT p.place_id)::NUMERIC *
    (1 - COUNT(DISTINCT p.place_id) FILTER (
      WHERE EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.place_id = p.place_id)
    )::NUMERIC / NULLIF(COUNT(DISTINCT p.place_id), 0))
  , 1) AS gap_score,
  'Coverage = places where we have cat data / total known places. Our data reflects what we have DISCOVERED, not what EXISTS. Low coverage means we have not been there, not that there are no cats.' AS methodology
FROM sot.places p
JOIN sot.addresses a ON a.address_id = p.sot_address_id
WHERE p.merged_into_place_id IS NULL
  AND a.city IS NOT NULL
GROUP BY a.city
HAVING COUNT(DISTINCT p.place_id) >= 5;

COMMENT ON VIEW ops.v_coverage_gaps IS
  'City-level coverage analysis. gap_score = places × (1 - coverage_ratio). '
  'Higher score = more underserved. Methodology column explains what coverage means.';

-- ============================================================================
-- Verify
-- ============================================================================
-- SELECT (ops.tippy_place_full_report('240 Burt St'))->'place'->>'display_name';
-- Expected: '240 Burt St, Santa Rosa, CA 95407' (not bare '240 Burt St')
--
-- SELECT * FROM ops.v_coverage_gaps ORDER BY gap_score DESC LIMIT 10;
