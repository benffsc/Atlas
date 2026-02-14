-- MIG_520: Request Redirect Linking with Beacon-Safe Attribution Windows
--
-- Purpose: Enable redirecting requests when field conditions change
-- (e.g., cats reported under Nancy are actually at Kris's address)
--
-- Key Design: Non-overlapping attribution windows to prevent double-counting
--   - Redirected requests: window_end = redirect_at (NO 3-month buffer)
--   - Child requests: window_start = parent's redirect_at (NO 6-month lookback)
--   - This creates clean handoffs with zero overlap

\echo ''
\echo '=============================================='
\echo 'MIG_520: Request Redirect Linking'
\echo '=============================================='
\echo ''

-- 1. Add redirect columns to sot_requests
\echo 'Adding redirect columns to sot_requests...'

ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS redirected_to_request_id UUID REFERENCES trapper.sot_requests(request_id),
ADD COLUMN IF NOT EXISTS redirected_from_request_id UUID REFERENCES trapper.sot_requests(request_id),
ADD COLUMN IF NOT EXISTS redirect_reason TEXT,
ADD COLUMN IF NOT EXISTS redirect_at TIMESTAMPTZ;

-- 2. Add indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_sot_requests_redirected_to
  ON trapper.sot_requests(redirected_to_request_id)
  WHERE redirected_to_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sot_requests_redirected_from
  ON trapper.sot_requests(redirected_from_request_id)
  WHERE redirected_from_request_id IS NOT NULL;

-- 3. Add 'redirected' to request_status enum if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'redirected'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'request_status' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper'))
  ) THEN
    ALTER TYPE trapper.request_status ADD VALUE 'redirected';
  END IF;
END $$;

\echo 'Redirect columns and status added.'

-- 4. Update v_request_alteration_stats to handle redirects with non-overlapping windows
\echo 'Updating v_request_alteration_stats for Beacon-safe redirect handling...'

DROP VIEW IF EXISTS trapper.v_place_alteration_history CASCADE;
DROP VIEW IF EXISTS trapper.v_request_alteration_stats CASCADE;

CREATE OR REPLACE VIEW trapper.v_request_alteration_stats AS
WITH request_windows AS (
  SELECT
    r.request_id,
    r.place_id,
    r.requester_person_id,
    r.source_system,
    r.source_record_id,
    r.status,
    r.summary,
    r.estimated_cat_count,
    r.resolved_at,
    r.last_activity_at,
    r.redirected_to_request_id,
    r.redirected_from_request_id,
    r.redirect_at,
    COALESCE(r.source_created_at, r.created_at) AS effective_request_date,

    -- WINDOW START: Depends on whether this is a child of a redirect
    CASE
      -- Child of redirect: Start where parent ended (no overlap)
      WHEN r.redirected_from_request_id IS NOT NULL THEN (
        SELECT COALESCE(parent.redirect_at, parent.resolved_at, NOW())
        FROM trapper.sot_requests parent
        WHERE parent.request_id = r.redirected_from_request_id
      )
      -- Normal: 6 months before request date
      ELSE COALESCE(r.source_created_at, r.created_at) - INTERVAL '6 months'
    END AS window_start,

    -- WINDOW END: Depends on request status
    CASE
      -- REDIRECTED: Window ends at redirect time (NO buffer - prevents overlap)
      WHEN r.status = 'redirected' AND r.redirect_at IS NOT NULL
        THEN r.redirect_at

      -- Legacy requests (source_created_at before May 2025): Fixed 6-month window
      WHEN COALESCE(r.source_created_at, r.created_at) < '2025-05-01'::timestamptz
        THEN COALESCE(r.source_created_at, r.created_at) + INTERVAL '6 months'

      -- Resolved requests (completed/cancelled): resolved_at + 3 months buffer
      WHEN r.resolved_at IS NOT NULL
        THEN r.resolved_at + INTERVAL '3 months'

      -- Active requests with recent activity: last_activity_at + 6 months
      WHEN r.last_activity_at IS NOT NULL AND r.last_activity_at > NOW() - INTERVAL '1 year'
        THEN GREATEST(
          r.last_activity_at + INTERVAL '6 months',
          NOW() + INTERVAL '3 months'
        )

      -- Active requests without activity tracking: NOW + 6 months (rolling)
      ELSE NOW() + INTERVAL '6 months'
    END AS window_end,

    -- Flag for UI to show window type
    CASE
      WHEN r.status = 'redirected'
        THEN 'redirected_closed'
      WHEN r.redirected_from_request_id IS NOT NULL
        THEN 'redirect_child'
      WHEN COALESCE(r.source_created_at, r.created_at) < '2025-05-01'::timestamptz
        THEN 'legacy_fixed'
      WHEN r.resolved_at IS NOT NULL
        THEN 'resolved_with_buffer'
      ELSE 'active_rolling'
    END AS window_type

  FROM trapper.sot_requests r
  WHERE r.status != 'cancelled'
    OR r.resolution_notes LIKE 'Upgraded to Atlas request%'
),

-- Find cats with clinic procedures in the window
cat_procedures_in_window AS (
  SELECT DISTINCT
    cp.cat_id,
    cp.procedure_date,
    cp.is_spay,
    cp.is_neuter,
    c.sex,
    c.display_name AS cat_name,
    ci.id_value AS microchip
  FROM trapper.cat_procedures cp
  JOIN trapper.sot_cats c ON c.cat_id = cp.cat_id
  LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
  WHERE (cp.is_spay = TRUE OR cp.is_neuter = TRUE)
),

-- Match cats to requests via place OR requester
matched_cats AS (
  SELECT DISTINCT
    rw.request_id,
    c.cat_id,
    c.display_name AS cat_name,
    c.sex,
    ci.id_value AS microchip,
    cpw.procedure_date,
    cpw.is_spay,
    cpw.is_neuter,
    rw.effective_request_date,
    CASE
      WHEN rcl.link_id IS NOT NULL THEN 'explicit_link'
      WHEN cpr.cat_place_id IS NOT NULL AND pcr.person_cat_id IS NOT NULL THEN 'place_and_requester'
      WHEN cpr.cat_place_id IS NOT NULL THEN 'place_match'
      WHEN pcr.person_cat_id IS NOT NULL THEN 'requester_match'
      ELSE 'unknown'
    END AS match_reason,
    CASE
      WHEN rcl.link_id IS NOT NULL THEN 1.0
      WHEN cpr.cat_place_id IS NOT NULL AND pcr.person_cat_id IS NOT NULL THEN 0.95
      WHEN cpr.cat_place_id IS NOT NULL THEN 0.85
      WHEN pcr.person_cat_id IS NOT NULL THEN 0.80
      ELSE 0.70
    END AS match_confidence
  FROM request_windows rw
  LEFT JOIN trapper.request_cat_links rcl ON rcl.request_id = rw.request_id
  LEFT JOIN trapper.cat_place_relationships cpr ON cpr.place_id = rw.place_id
  LEFT JOIN trapper.person_cat_relationships pcr ON pcr.person_id = rw.requester_person_id
  JOIN trapper.sot_cats c ON c.cat_id = COALESCE(rcl.cat_id, cpr.cat_id, pcr.cat_id)
  LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
  LEFT JOIN cat_procedures_in_window cpw ON cpw.cat_id = c.cat_id
  WHERE rcl.link_id IS NOT NULL
     OR cpr.cat_place_id IS NOT NULL
     OR pcr.person_cat_id IS NOT NULL
),

-- Filter to cats with procedures in the window
cats_with_procedures AS (
  SELECT *
  FROM matched_cats mc
  WHERE mc.procedure_date IS NOT NULL
    AND mc.procedure_date >= (
      SELECT window_start FROM request_windows WHERE request_id = mc.request_id
    )
    AND mc.procedure_date <= (
      SELECT window_end FROM request_windows WHERE request_id = mc.request_id
    )
),

-- Aggregate stats per request
aggregated_stats AS (
  SELECT
    rw.request_id,
    COUNT(DISTINCT cwp.cat_id) AS cats_caught,
    COUNT(DISTINCT CASE
      WHEN cwp.procedure_date > rw.effective_request_date
      THEN cwp.cat_id
    END) AS cats_altered,
    COUNT(DISTINCT CASE
      WHEN cwp.procedure_date < rw.effective_request_date
      THEN cwp.cat_id
    END) AS already_altered_before,
    COUNT(DISTINCT CASE WHEN cwp.sex = 'male' OR cwp.sex = 'Male' THEN cwp.cat_id END) AS males,
    COUNT(DISTINCT CASE WHEN cwp.sex = 'female' OR cwp.sex = 'Female' THEN cwp.cat_id END) AS females,
    AVG(cwp.match_confidence) AS avg_match_confidence
  FROM request_windows rw
  LEFT JOIN cats_with_procedures cwp ON cwp.request_id = rw.request_id
  GROUP BY rw.request_id
),

-- Build linked cats JSON array
linked_cats_json AS (
  SELECT
    cwp.request_id,
    jsonb_agg(DISTINCT jsonb_build_object(
      'cat_id', cwp.cat_id,
      'cat_name', cwp.cat_name,
      'microchip', cwp.microchip,
      'sex', cwp.sex,
      'match_reason', cwp.match_reason,
      'confidence', cwp.match_confidence,
      'procedure_date', cwp.procedure_date,
      'is_spay', cwp.is_spay,
      'is_neuter', cwp.is_neuter,
      'altered_after_request', cwp.procedure_date > cwp.effective_request_date
    )) FILTER (WHERE cwp.cat_id IS NOT NULL) AS linked_cats
  FROM cats_with_procedures cwp
  GROUP BY cwp.request_id
)

SELECT
  rw.request_id,
  rw.source_system,
  rw.source_record_id,
  rw.status,
  rw.summary,
  rw.estimated_cat_count,
  rw.effective_request_date,
  rw.window_start,
  rw.window_end,
  rw.window_type,
  -- Redirect info for UI
  rw.redirected_to_request_id,
  rw.redirected_from_request_id,
  rw.redirect_at,
  COALESCE(ast.cats_caught, 0) AS cats_caught,
  COALESCE(ast.cats_altered, 0) AS cats_altered,
  COALESCE(ast.already_altered_before, 0) AS already_altered_before,
  COALESCE(ast.males, 0) AS males,
  COALESCE(ast.females, 0) AS females,
  CASE
    WHEN COALESCE(ast.cats_caught, 0) - COALESCE(ast.already_altered_before, 0) > 0
    THEN ROUND(
      100.0 * COALESCE(ast.cats_altered, 0)::NUMERIC /
      (COALESCE(ast.cats_caught, 0) - COALESCE(ast.already_altered_before, 0)),
      1
    )
    ELSE NULL
  END AS alteration_rate_pct,
  COALESCE(ast.avg_match_confidence, 0) AS avg_match_confidence,
  COALESCE(lcj.linked_cats, '[]'::jsonb) AS linked_cats,
  rw.source_system = 'airtable' AS is_legacy_request,
  CASE
    WHEN rw.source_system != 'airtable' THEN FALSE
    WHEN rw.status = 'cancelled' AND rw.summary IS NULL THEN FALSE
    ELSE TRUE
  END AS can_upgrade,
  p.display_name AS place_name,
  p.formatted_address AS place_address,
  per.display_name AS requester_name
FROM request_windows rw
LEFT JOIN aggregated_stats ast ON ast.request_id = rw.request_id
LEFT JOIN linked_cats_json lcj ON lcj.request_id = rw.request_id
LEFT JOIN trapper.places p ON p.place_id = rw.place_id
LEFT JOIN trapper.sot_people per ON per.person_id = rw.requester_person_id;

-- 5. Recreate v_place_alteration_history (depends on v_request_alteration_stats)
\echo 'Recreating v_place_alteration_history...'

CREATE OR REPLACE VIEW trapper.v_place_alteration_history AS
WITH request_stats AS (
  SELECT
    r.place_id,
    r.request_id,
    vas.effective_request_date,
    vas.cats_caught,
    vas.cats_altered,
    vas.already_altered_before,
    vas.males,
    vas.females,
    vas.alteration_rate_pct,
    EXTRACT(YEAR FROM vas.effective_request_date) AS request_year
  FROM trapper.sot_requests r
  JOIN trapper.v_request_alteration_stats vas ON vas.request_id = r.request_id
  WHERE r.place_id IS NOT NULL
    AND r.status NOT IN ('cancelled')  -- Include 'redirected' in stats
),
yearly_stats AS (
  SELECT
    place_id,
    request_year::INTEGER,
    COUNT(DISTINCT request_id) AS requests,
    SUM(cats_caught) AS caught,
    SUM(cats_altered) AS altered
  FROM request_stats
  GROUP BY place_id, request_year
)
SELECT
  p.place_id,
  p.display_name AS place_name,
  p.formatted_address,
  p.service_zone,
  COUNT(DISTINCT rs.request_id) AS total_requests,
  COALESCE(SUM(rs.cats_caught), 0) AS total_cats_caught,
  COALESCE(SUM(rs.cats_altered), 0) AS total_cats_altered,
  COALESCE(SUM(rs.already_altered_before), 0) AS total_already_altered,
  COALESCE(SUM(rs.males), 0) AS total_males,
  COALESCE(SUM(rs.females), 0) AS total_females,
  CASE
    WHEN COALESCE(SUM(rs.cats_caught), 0) - COALESCE(SUM(rs.already_altered_before), 0) > 0
    THEN ROUND(
      100.0 * COALESCE(SUM(rs.cats_altered), 0)::NUMERIC /
      (COALESCE(SUM(rs.cats_caught), 0) - COALESCE(SUM(rs.already_altered_before), 0)),
      1
    )
    ELSE NULL
  END AS place_alteration_rate_pct,
  MIN(rs.effective_request_date) AS first_request_date,
  MAX(rs.effective_request_date) AS latest_request_date,
  (
    SELECT jsonb_object_agg(
      ys.request_year::TEXT,
      jsonb_build_object(
        'requests', ys.requests,
        'caught', ys.caught,
        'altered', ys.altered
      )
    )
    FROM yearly_stats ys
    WHERE ys.place_id = p.place_id
  ) AS yearly_breakdown
FROM trapper.places p
LEFT JOIN request_stats rs ON rs.place_id = p.place_id
GROUP BY p.place_id, p.display_name, p.formatted_address, p.service_zone
HAVING COUNT(DISTINCT rs.request_id) > 0;

-- 6. Create redirect_request function
\echo 'Creating redirect_request function...'

CREATE OR REPLACE FUNCTION trapper.redirect_request(
  p_original_request_id UUID,
  p_redirect_reason TEXT,
  p_new_address TEXT DEFAULT NULL,
  p_new_place_id UUID DEFAULT NULL,
  p_new_requester_name TEXT DEFAULT NULL,
  p_new_requester_phone TEXT DEFAULT NULL,
  p_new_requester_email TEXT DEFAULT NULL,
  p_summary TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_estimated_cat_count INT DEFAULT NULL,
  p_created_by TEXT DEFAULT 'redirect_workflow'
)
RETURNS TABLE(
  original_request_id UUID,
  new_request_id UUID,
  redirect_status TEXT
) AS $$
DECLARE
  v_new_request_id UUID;
  v_original RECORD;
  v_redirect_at TIMESTAMPTZ := NOW();
BEGIN
  -- Get original request details
  SELECT * INTO v_original
  FROM trapper.sot_requests
  WHERE request_id = p_original_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original request % not found', p_original_request_id;
  END IF;

  IF v_original.status = 'redirected' THEN
    RAISE EXCEPTION 'Request % has already been redirected', p_original_request_id;
  END IF;

  -- Create the new request using find_or_create_request
  v_new_request_id := trapper.find_or_create_request(
    p_source_system := 'atlas_ui',
    p_source_record_id := 'redirect_from_' || p_original_request_id::TEXT || '_' || EXTRACT(EPOCH FROM v_redirect_at)::TEXT,
    p_source_created_at := v_redirect_at,
    p_place_id := p_new_place_id,
    p_raw_address := p_new_address,
    p_requester_email := p_new_requester_email,
    p_requester_phone := p_new_requester_phone,
    p_requester_name := p_new_requester_name,
    p_summary := COALESCE(p_summary, 'Redirected: ' || COALESCE(v_original.summary, 'Request')),
    p_notes := COALESCE(p_notes, '') || E'\n\nRedirected from request ' || p_original_request_id::TEXT ||
               CASE WHEN p_redirect_reason IS NOT NULL THEN E'\nReason: ' || p_redirect_reason ELSE '' END,
    p_estimated_cat_count := COALESCE(p_estimated_cat_count, v_original.estimated_cat_count),
    p_has_kittens := v_original.has_kittens,
    p_status := 'new',
    p_priority := v_original.priority::TEXT,
    p_created_by := p_created_by
  );

  -- Link the new request back to original
  UPDATE trapper.sot_requests
  SET redirected_from_request_id = p_original_request_id
  WHERE request_id = v_new_request_id;

  -- Close original request as redirected
  UPDATE trapper.sot_requests
  SET
    status = 'redirected'::trapper.request_status,
    redirected_to_request_id = v_new_request_id,
    redirect_reason = p_redirect_reason,
    redirect_at = v_redirect_at,
    resolved_at = v_redirect_at,
    resolution_notes = 'Redirected to request ' || v_new_request_id::TEXT ||
                      CASE WHEN p_redirect_reason IS NOT NULL THEN ': ' || p_redirect_reason ELSE '' END,
    updated_at = NOW()
  WHERE request_id = p_original_request_id;

  -- Log the redirect in entity_edits
  INSERT INTO trapper.entity_edits (
    entity_type, entity_id, field_name, old_value, new_value,
    edit_reason, edit_source, edited_by
  ) VALUES (
    'request', p_original_request_id, 'status',
    v_original.status::TEXT, 'redirected',
    'Redirected to new request: ' || p_redirect_reason,
    'redirect_workflow', p_created_by
  );

  RETURN QUERY SELECT p_original_request_id, v_new_request_id, 'success'::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.redirect_request IS
'Redirects a request when field conditions change (e.g., cats are actually at different address).
Creates a new request and links them together. The original request window ends immediately
at redirect time (no buffer) and the new request window starts at redirect time (no lookback
into original territory) to prevent double-counting in Beacon stats.';

-- 7. Create view for redirect chains (useful for UI)
\echo 'Creating v_request_redirect_chain view...'

CREATE OR REPLACE VIEW trapper.v_request_redirect_chain AS
WITH RECURSIVE redirect_chain AS (
  -- Base case: requests with no parent (start of chain or standalone)
  SELECT
    r.request_id,
    r.request_id AS root_request_id,
    r.redirected_from_request_id,
    r.redirected_to_request_id,
    r.redirect_reason,
    r.redirect_at,
    r.status,
    r.summary,
    1 AS chain_depth,
    ARRAY[r.request_id] AS chain_path
  FROM trapper.sot_requests r
  WHERE r.redirected_from_request_id IS NULL

  UNION ALL

  -- Recursive case: follow redirects
  SELECT
    r.request_id,
    rc.root_request_id,
    r.redirected_from_request_id,
    r.redirected_to_request_id,
    r.redirect_reason,
    r.redirect_at,
    r.status,
    r.summary,
    rc.chain_depth + 1,
    rc.chain_path || r.request_id
  FROM trapper.sot_requests r
  JOIN redirect_chain rc ON r.redirected_from_request_id = rc.request_id
  WHERE NOT r.request_id = ANY(rc.chain_path)  -- Prevent cycles
)
SELECT * FROM redirect_chain;

\echo ''
\echo '=============================================='
\echo 'MIG_520 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  - Added redirect columns: redirected_to_request_id, redirected_from_request_id,'
\echo '    redirect_reason, redirect_at'
\echo '  - Added "redirected" status to request_status enum'
\echo '  - Updated v_request_alteration_stats with Beacon-safe window logic:'
\echo '    * Redirected requests: window ends at redirect_at (no buffer)'
\echo '    * Child requests: window starts at parent redirect_at (no overlap)'
\echo '  - Created redirect_request() function for atomic redirect workflow'
\echo '  - Created v_request_redirect_chain view for UI navigation'
\echo ''
