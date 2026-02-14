-- MIG_530: Request Handoff System
--
-- Purpose: Enable handing off requests when responsibility transfers to a new caretaker
-- (e.g., Nancy hands off colony care to Chris Anderson at a new address)
--
-- This is distinct from REDIRECT (address was wrong) - HANDOFF is legitimate succession
-- of responsibility to a new person at a new location.
--
-- Reuses the redirect infrastructure (linking columns, timestamps) with semantic distinction
-- via transfer_type column and 'handed_off' status.

\echo ''
\echo '=============================================='
\echo 'MIG_530: Request Handoff System'
\echo '=============================================='
\echo ''

-- 1. Add transfer_type column to distinguish redirect vs handoff
\echo 'Adding transfer_type column...'

ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS transfer_type TEXT
  CHECK (transfer_type IN ('redirect', 'handoff'));

COMMENT ON COLUMN trapper.sot_requests.transfer_type IS
'Distinguishes redirect (address was wrong) from handoff (legitimate succession to new caretaker)';

-- 2. Add 'handed_off' to request_status enum
\echo 'Adding handed_off status...'

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'handed_off'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'request_status' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper'))
  ) THEN
    ALTER TYPE trapper.request_status ADD VALUE 'handed_off';
  END IF;
END $$;

-- 3. Backfill transfer_type for existing redirects
\echo 'Backfilling transfer_type for existing redirects...'

UPDATE trapper.sot_requests
SET transfer_type = 'redirect'
WHERE status = 'redirected'
  AND transfer_type IS NULL;

-- 4. Create handoff_request function
\echo 'Creating handoff_request function...'

CREATE OR REPLACE FUNCTION trapper.handoff_request(
  p_original_request_id UUID,
  p_handoff_reason TEXT,
  p_new_address TEXT,
  p_new_requester_name TEXT,
  p_new_requester_phone TEXT DEFAULT NULL,
  p_new_requester_email TEXT DEFAULT NULL,
  p_summary TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_estimated_cat_count INT DEFAULT NULL,
  p_created_by TEXT DEFAULT 'handoff_workflow'
)
RETURNS TABLE(
  original_request_id UUID,
  new_request_id UUID,
  handoff_status TEXT
) AS $$
DECLARE
  v_new_request_id UUID;
  v_original RECORD;
  v_handoff_at TIMESTAMPTZ := NOW();
  v_original_address TEXT;
BEGIN
  -- Get original request details
  SELECT r.*, p.formatted_address AS place_address
  INTO v_original
  FROM trapper.sot_requests r
  LEFT JOIN trapper.places p ON p.place_id = r.place_id
  WHERE r.request_id = p_original_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original request % not found', p_original_request_id;
  END IF;

  IF v_original.status IN ('redirected', 'handed_off', 'cancelled') THEN
    RAISE EXCEPTION 'Request % has already been closed (status: %)',
      p_original_request_id, v_original.status;
  END IF;

  v_original_address := COALESCE(v_original.place_address, 'unknown address');

  -- Create new request at new location with new requester
  v_new_request_id := trapper.find_or_create_request(
    p_source_system := 'atlas_ui',
    p_source_record_id := 'handoff_from_' || p_original_request_id::TEXT || '_' || EXTRACT(EPOCH FROM v_handoff_at)::TEXT,
    p_source_created_at := v_handoff_at,
    p_raw_address := p_new_address,
    p_requester_email := p_new_requester_email,
    p_requester_phone := p_new_requester_phone,
    p_requester_name := p_new_requester_name,
    p_summary := COALESCE(p_summary, 'Continuation: ' || COALESCE(v_original.summary, 'Colony care')),
    p_notes := COALESCE(p_notes, '') ||
      E'\n\n--- Handoff History ---' ||
      E'\nContinued from: ' || v_original_address ||
      E'\nHandoff reason: ' || p_handoff_reason ||
      E'\nOriginal request: ' || p_original_request_id::TEXT,
    p_estimated_cat_count := COALESCE(p_estimated_cat_count, v_original.estimated_cat_count),
    p_has_kittens := v_original.has_kittens,
    p_status := 'new',
    p_priority := v_original.priority::TEXT,
    p_created_by := p_created_by
  );

  -- Link new request back to original (use same columns as redirect)
  UPDATE trapper.sot_requests
  SET
    redirected_from_request_id = p_original_request_id,
    transfer_type = 'handoff'
  WHERE request_id = v_new_request_id;

  -- Close original as handed_off
  UPDATE trapper.sot_requests
  SET
    status = 'handed_off'::trapper.request_status,
    redirected_to_request_id = v_new_request_id,
    redirect_reason = p_handoff_reason,  -- Reuse column for handoff reason
    redirect_at = v_handoff_at,
    transfer_type = 'handoff',
    resolved_at = v_handoff_at,
    resolution_notes = 'Handed off to ' || p_new_requester_name || ' at ' || p_new_address ||
                       E'\nReason: ' || p_handoff_reason,
    updated_at = NOW()
  WHERE request_id = p_original_request_id;

  -- Audit log
  INSERT INTO trapper.entity_edits (
    entity_type, entity_id, edit_type, field_name,
    old_value, new_value, reason, edit_source, edited_by
  ) VALUES (
    'request', p_original_request_id, 'field_update', 'status',
    to_jsonb(v_original.status::TEXT), '"handed_off"',
    'Handed off to ' || p_new_requester_name || ': ' || p_handoff_reason,
    'api', p_created_by
  );

  RETURN QUERY SELECT p_original_request_id, v_new_request_id, 'success'::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.handoff_request IS
'Hands off a request to a new caretaker at a new location.

Unlike redirect (which implies the original address was wrong), handoff represents
a legitimate succession of responsibility - the original caretaker transfers
colony care to a new person at their location.

The original request is closed with status "handed_off" and a new request is
created for the new caretaker. Both requests are linked together, and attribution
windows are non-overlapping to prevent double-counting in Beacon stats.

Example: Nancy at 565 Richardson hands off to Chris Anderson at 1457 Richardson Ct';

-- 5. Update v_request_alteration_stats to handle handed_off status
\echo 'Updating v_request_alteration_stats for handoff support...'

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
    r.transfer_type,
    COALESCE(r.source_created_at, r.created_at) AS effective_request_date,

    -- WINDOW START: Depends on whether this is a child of a redirect/handoff
    CASE
      -- Child of redirect/handoff: Start where parent ended (no overlap)
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
      -- REDIRECTED or HANDED_OFF: Window ends at transfer time (NO buffer - prevents overlap)
      WHEN r.status IN ('redirected', 'handed_off') AND r.redirect_at IS NOT NULL
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
      WHEN r.status = 'handed_off'
        THEN 'handoff_closed'
      WHEN r.redirected_from_request_id IS NOT NULL AND r.transfer_type = 'handoff'
        THEN 'handoff_child'
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
  rw.transfer_type,
  -- Redirect/handoff info for UI
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

-- 6. Recreate v_place_alteration_history (depends on v_request_alteration_stats)
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
    AND r.status NOT IN ('cancelled')  -- Include 'redirected' and 'handed_off' in stats
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

\echo ''
\echo '=============================================='
\echo 'MIG_530 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  - Added transfer_type column to distinguish redirect vs handoff'
\echo '  - Added "handed_off" status to request_status enum'
\echo '  - Created handoff_request() function for transferring responsibility'
\echo '  - Updated v_request_alteration_stats with handoff support:'
\echo '    * handed_off requests: window ends at transfer time (no buffer)'
\echo '    * handoff child requests: window starts at parent transfer time'
\echo '  - Recreated v_place_alteration_history'
\echo ''
\echo 'Usage:'
\echo '  SELECT * FROM trapper.handoff_request('
\echo '    p_original_request_id := ''<request-id>'','
\echo '    p_handoff_reason := ''Nancy moving, Chris taking over'','
\echo '    p_new_address := ''1457 Richardson Ct, Santa Rosa, CA'','
\echo '    p_new_requester_name := ''Chris Anderson'','
\echo '    p_new_requester_phone := ''7075551234'''
\echo '  );'
\echo ''
