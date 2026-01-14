-- MIG_195: Safe Cat Auto-Linking by Place
-- Provides functions to safely link cats to requests based on place
--
-- Safety principles:
-- 1. Only link cats that are at the same place as the request
-- 2. Don't create duplicate links
-- 3. Provide suggestion function for review before auto-linking
-- 4. Track who linked and when

\echo '=============================================='
\echo 'MIG_195: Safe Cat Auto-Linking by Place'
\echo '=============================================='

-- ============================================
-- PART 1: Function to get linkable cats for a request
-- ============================================

\echo 'Creating get_linkable_cats_for_request function...'

CREATE OR REPLACE FUNCTION trapper.get_linkable_cats_for_request(p_request_id UUID)
RETURNS TABLE (
  cat_id UUID,
  cat_name TEXT,
  is_eartipped BOOLEAN,
  sex TEXT,
  place_name TEXT,
  already_linked BOOLEAN,
  suggested_purpose TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.cat_id,
    c.name,
    c.is_eartipped,
    c.sex::TEXT,
    pl.display_name,
    EXISTS(
      SELECT 1 FROM trapper.request_cat_links rcl
      WHERE rcl.request_id = p_request_id AND rcl.cat_id = c.cat_id
    ) AS already_linked,
    -- Suggest purpose based on ear-tip status
    CASE
      WHEN c.is_eartipped = TRUE THEN 'wellness'
      ELSE 'tnr_target'
    END AS suggested_purpose
  FROM trapper.sot_requests r
  JOIN trapper.cat_place_relationships cpr ON cpr.place_id = r.place_id
  JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
  LEFT JOIN trapper.places pl ON pl.place_id = cpr.place_id
  WHERE r.request_id = p_request_id
    AND c.merged_into_cat_id IS NULL
  ORDER BY c.is_eartipped NULLS LAST, c.name;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.get_linkable_cats_for_request IS
'Returns cats at the same place as the request that could be linked.
Shows if already linked and suggests purpose based on ear-tip status.';

-- ============================================
-- PART 2: Function to auto-link all cats at place
-- ============================================

\echo 'Creating auto_link_cats_to_request function...'

CREATE OR REPLACE FUNCTION trapper.auto_link_cats_to_request(
  p_request_id UUID,
  p_linked_by TEXT DEFAULT 'system',
  p_link_eartipped_as TEXT DEFAULT 'wellness', -- wellness, documentation
  p_link_unfixed_as TEXT DEFAULT 'tnr_target'  -- tnr_target
) RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  v_cat RECORD;
BEGIN
  FOR v_cat IN
    SELECT * FROM trapper.get_linkable_cats_for_request(p_request_id)
    WHERE already_linked = FALSE
  LOOP
    INSERT INTO trapper.request_cat_links (
      request_id, cat_id, link_purpose, linked_by
    ) VALUES (
      p_request_id,
      v_cat.cat_id,
      CASE
        WHEN v_cat.is_eartipped = TRUE THEN p_link_eartipped_as::trapper.cat_link_purpose
        ELSE p_link_unfixed_as::trapper.cat_link_purpose
      END,
      p_linked_by
    )
    ON CONFLICT (request_id, cat_id) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.auto_link_cats_to_request IS
'Auto-links all cats at the request location to the request.
Ear-tipped cats default to wellness purpose, unfixed to tnr_target.
Returns count of cats linked.';

-- ============================================
-- PART 3: View for requests with linkable cats
-- ============================================

\echo 'Creating view for requests with unlinkned cats...'

CREATE OR REPLACE VIEW trapper.v_requests_with_unlinked_cats AS
SELECT
  r.request_id,
  r.summary,
  r.status::TEXT,
  r.request_purpose::TEXT,
  p.display_name AS place_name,
  p.formatted_address,
  -- Count of cats at this place
  (SELECT COUNT(*)
   FROM trapper.cat_place_relationships cpr
   JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
   WHERE cpr.place_id = r.place_id
     AND c.merged_into_cat_id IS NULL) AS cats_at_place,
  -- Count already linked
  (SELECT COUNT(*)
   FROM trapper.request_cat_links rcl
   WHERE rcl.request_id = r.request_id) AS cats_linked,
  -- Count unlinked
  (SELECT COUNT(*)
   FROM trapper.cat_place_relationships cpr
   JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
   WHERE cpr.place_id = r.place_id
     AND c.merged_into_cat_id IS NULL
     AND NOT EXISTS(
       SELECT 1 FROM trapper.request_cat_links rcl
       WHERE rcl.request_id = r.request_id AND rcl.cat_id = c.cat_id
     )) AS cats_unlinked
FROM trapper.sot_requests r
JOIN trapper.places p ON p.place_id = r.place_id
WHERE r.place_id IS NOT NULL
  AND EXISTS(
    SELECT 1 FROM trapper.cat_place_relationships cpr
    WHERE cpr.place_id = r.place_id
  )
ORDER BY r.created_at DESC;

-- ============================================
-- PART 4: Batch auto-link for all requests at a place
-- ============================================

\echo 'Creating batch auto-link function...'

CREATE OR REPLACE FUNCTION trapper.batch_auto_link_cats_at_place(
  p_place_id UUID,
  p_linked_by TEXT DEFAULT 'system'
) RETURNS TABLE (
  request_id UUID,
  request_summary TEXT,
  cats_linked INTEGER
) AS $$
DECLARE
  v_request RECORD;
  v_linked INTEGER;
BEGIN
  FOR v_request IN
    SELECT r.request_id, r.summary
    FROM trapper.sot_requests r
    WHERE r.place_id = p_place_id
      AND r.status NOT IN ('completed', 'cancelled')
  LOOP
    v_linked := trapper.auto_link_cats_to_request(v_request.request_id, p_linked_by);
    IF v_linked > 0 THEN
      request_id := v_request.request_id;
      request_summary := v_request.summary;
      cats_linked := v_linked;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 5: Safe linking with date constraint
-- ============================================

\echo 'Creating date-aware auto-link function...'

-- Only link cats that were at the place before or during the request
CREATE OR REPLACE FUNCTION trapper.safe_auto_link_cats_with_dates(
  p_request_id UUID,
  p_linked_by TEXT DEFAULT 'system'
) RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  v_request_date TIMESTAMPTZ;
  v_cat RECORD;
BEGIN
  -- Get request creation date
  SELECT created_at INTO v_request_date
  FROM trapper.sot_requests
  WHERE request_id = p_request_id;

  FOR v_cat IN
    SELECT
      c.cat_id,
      c.is_eartipped,
      cpr.first_seen_at
    FROM trapper.sot_requests r
    JOIN trapper.cat_place_relationships cpr ON cpr.place_id = r.place_id
    JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
    WHERE r.request_id = p_request_id
      AND c.merged_into_cat_id IS NULL
      -- Only cats that were at the place before or within 30 days of request
      AND (cpr.first_seen_at IS NULL OR cpr.first_seen_at <= v_request_date + INTERVAL '30 days')
      -- Not already linked
      AND NOT EXISTS(
        SELECT 1 FROM trapper.request_cat_links rcl
        WHERE rcl.request_id = p_request_id AND rcl.cat_id = c.cat_id
      )
  LOOP
    INSERT INTO trapper.request_cat_links (
      request_id, cat_id, link_purpose, linked_by,
      link_notes
    ) VALUES (
      p_request_id,
      v_cat.cat_id,
      CASE
        WHEN v_cat.is_eartipped = TRUE THEN 'wellness'::trapper.cat_link_purpose
        ELSE 'tnr_target'::trapper.cat_link_purpose
      END,
      p_linked_by,
      'Auto-linked by place (date-aware)'
    )
    ON CONFLICT (request_id, cat_id) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

\echo ''
\echo 'MIG_195 complete!'
\echo ''
\echo 'Created:'
\echo '  - Function: trapper.get_linkable_cats_for_request(request_id)'
\echo '    Returns cats at same place that could be linked'
\echo ''
\echo '  - Function: trapper.auto_link_cats_to_request(request_id, linked_by)'
\echo '    Auto-links all cats at place to request'
\echo ''
\echo '  - Function: trapper.safe_auto_link_cats_with_dates(request_id, linked_by)'
\echo '    Date-aware auto-linking (only cats seen before/during request)'
\echo ''
\echo '  - Function: trapper.batch_auto_link_cats_at_place(place_id, linked_by)'
\echo '    Auto-link cats to all active requests at a place'
\echo ''
\echo '  - View: trapper.v_requests_with_unlinked_cats'
\echo '    Shows requests that have unlinked cats at their place'
\echo ''
\echo 'Usage:'
\echo '  -- See what cats can be linked to a request:'
\echo '  SELECT * FROM trapper.get_linkable_cats_for_request(request_id);'
\echo ''
\echo '  -- Auto-link all cats at place to request:'
\echo '  SELECT trapper.auto_link_cats_to_request(request_id, ''your_name'');'
\echo ''
\echo '  -- Find requests with unlinked cats:'
\echo '  SELECT * FROM trapper.v_requests_with_unlinked_cats WHERE cats_unlinked > 0;'
