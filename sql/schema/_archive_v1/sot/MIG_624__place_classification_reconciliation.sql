-- MIG_624: Place Classification Reconciliation
--
-- When multiple requests exist for the same place, this migration provides:
-- 1. Function to reconcile suggestions into a recommended classification
-- 2. View of places needing classification review
-- 3. Function to accept a suggestion and propagate to place

\echo ''
\echo '========================================================'
\echo 'MIG_624: Place Classification Reconciliation'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Create reconciliation function
-- ============================================================

\echo 'Creating reconcile_place_classification function...'

CREATE OR REPLACE FUNCTION trapper.reconcile_place_classification(
  p_place_id UUID
)
RETURNS TABLE(
  recommended_classification trapper.colony_classification,
  confidence NUMERIC,
  supporting_requests INT,
  conflicting_requests INT,
  needs_staff_review BOOLEAN,
  recommendation_reason TEXT
) AS $$
DECLARE
  v_suggestions RECORD;
  v_total_requests INT;
  v_best_classification trapper.colony_classification;
  v_best_count INT := 0;
  v_best_avg_confidence NUMERIC := 0;
  v_second_count INT := 0;
BEGIN
  -- Get suggestion statistics by classification type
  FOR v_suggestions IN
    SELECT
      suggested_classification,
      COUNT(*) AS request_count,
      AVG(classification_confidence) AS avg_confidence
    FROM trapper.sot_requests
    WHERE place_id = p_place_id
      AND suggested_classification IS NOT NULL
    GROUP BY suggested_classification
    ORDER BY COUNT(*) DESC, AVG(classification_confidence) DESC
  LOOP
    IF v_best_count = 0 THEN
      v_best_classification := v_suggestions.suggested_classification;
      v_best_count := v_suggestions.request_count;
      v_best_avg_confidence := v_suggestions.avg_confidence;
    ELSE
      v_second_count := v_suggestions.request_count;
      EXIT;  -- We only need top 2
    END IF;
  END LOOP;

  -- Get total request count
  SELECT COUNT(*) INTO v_total_requests
  FROM trapper.sot_requests
  WHERE place_id = p_place_id AND suggested_classification IS NOT NULL;

  -- If no suggestions, return unknown
  IF v_total_requests = 0 THEN
    RETURN QUERY SELECT
      'unknown'::trapper.colony_classification,
      0.0::NUMERIC,
      0,
      0,
      FALSE,
      'No classification suggestions available'::TEXT;
    RETURN;
  END IF;

  -- Determine if there's consensus
  RETURN QUERY SELECT
    v_best_classification,
    v_best_avg_confidence,
    v_best_count,
    v_second_count,
    -- Needs review if close vote or low confidence
    (v_second_count > 0 AND v_second_count >= v_best_count / 2) OR v_best_avg_confidence < 0.7,
    CASE
      WHEN v_second_count = 0 THEN
        'All ' || v_best_count || ' requests suggest ' || v_best_classification || ' (avg confidence: ' || ROUND(v_best_avg_confidence * 100) || '%)'
      WHEN v_second_count >= v_best_count / 2 THEN
        'Split vote: ' || v_best_count || ' for ' || v_best_classification || ', ' || v_second_count || ' for other - needs review'
      ELSE
        v_best_count || ' of ' || v_total_requests || ' requests suggest ' || v_best_classification
    END::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.reconcile_place_classification IS
'Analyzes all request suggestions for a place and returns a recommended classification.
Returns needs_staff_review=TRUE if suggestions are split or low confidence.';

-- ============================================================
-- PART 2: Create view of places needing classification
-- ============================================================

\echo 'Creating v_places_needing_classification view...'

CREATE OR REPLACE VIEW trapper.v_places_needing_classification AS
WITH place_suggestions AS (
  SELECT
    r.place_id,
    COUNT(*) AS total_suggestions,
    COUNT(DISTINCT r.suggested_classification) AS distinct_suggestions,
    MAX(r.classification_confidence) AS max_confidence,
    AVG(r.classification_confidence) AS avg_confidence,
    MODE() WITHIN GROUP (ORDER BY r.suggested_classification) AS most_common_suggestion,
    COUNT(*) FILTER (WHERE r.classification_disposition = 'pending') AS pending_count
  FROM trapper.sot_requests r
  WHERE r.suggested_classification IS NOT NULL
    AND r.place_id IS NOT NULL
  GROUP BY r.place_id
)
SELECT
  p.place_id,
  p.formatted_address,
  p.display_name AS place_name,
  p.colony_classification AS current_classification,
  ps.total_suggestions,
  ps.distinct_suggestions,
  ps.most_common_suggestion,
  ps.max_confidence,
  ps.avg_confidence,
  ps.pending_count,
  -- Priority score for review queue
  CASE
    WHEN p.colony_classification = 'unknown' AND ps.max_confidence >= 0.8 THEN 1  -- High confidence, unclassified
    WHEN p.colony_classification = 'unknown' AND ps.total_suggestions >= 3 THEN 2  -- Multiple suggestions
    WHEN p.colony_classification = 'unknown' THEN 3  -- Any unclassified
    WHEN ps.distinct_suggestions > 1 THEN 4  -- Conflicting suggestions
    ELSE 5
  END AS review_priority,
  -- Reconciliation result
  (SELECT recommended_classification FROM trapper.reconcile_place_classification(p.place_id)) AS recommended,
  (SELECT needs_staff_review FROM trapper.reconcile_place_classification(p.place_id)) AS needs_review,
  (SELECT recommendation_reason FROM trapper.reconcile_place_classification(p.place_id)) AS reason
FROM trapper.places p
JOIN place_suggestions ps ON ps.place_id = p.place_id
WHERE p.colony_classification = 'unknown'
   OR ps.distinct_suggestions > 1
   OR ps.pending_count > 0
ORDER BY review_priority, ps.max_confidence DESC;

COMMENT ON VIEW trapper.v_places_needing_classification IS
'Places that need classification review: unclassified with suggestions, or conflicting suggestions.
Ordered by priority (high-confidence unclassified first).';

-- ============================================================
-- PART 3: Create function to accept a suggestion
-- ============================================================

\echo 'Creating accept_classification_suggestion function...'

CREATE OR REPLACE FUNCTION trapper.accept_classification_suggestion(
  p_request_id UUID,
  p_reviewed_by TEXT DEFAULT 'staff'
)
RETURNS trapper.colony_classification AS $$
DECLARE
  v_request RECORD;
BEGIN
  -- Get request data
  SELECT * INTO v_request
  FROM trapper.sot_requests
  WHERE request_id = p_request_id;

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not found: %', p_request_id;
  END IF;

  IF v_request.suggested_classification IS NULL THEN
    RAISE EXCEPTION 'Request has no classification suggestion';
  END IF;

  -- Apply to place
  PERFORM trapper.set_colony_classification(
    v_request.place_id,
    v_request.suggested_classification,
    'Accepted from request ' || p_request_id || ' by ' || p_reviewed_by,
    p_reviewed_by,
    CASE
      WHEN v_request.suggested_classification = 'individual_cats' THEN v_request.estimated_cat_count
      ELSE NULL
    END
  );

  -- Update request disposition
  UPDATE trapper.sot_requests
  SET classification_disposition = 'accepted',
      classification_reviewed_at = NOW(),
      classification_reviewed_by = p_reviewed_by
  WHERE request_id = p_request_id;

  -- Also mark other pending requests at same place as processed
  UPDATE trapper.sot_requests
  SET classification_disposition = 'accepted',
      classification_reviewed_at = NOW(),
      classification_reviewed_by = p_reviewed_by
  WHERE place_id = v_request.place_id
    AND request_id != p_request_id
    AND classification_disposition = 'pending'
    AND suggested_classification = v_request.suggested_classification;

  RETURN v_request.suggested_classification;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.accept_classification_suggestion IS
'Accepts a classification suggestion from a request and applies it to the place.
Also marks other pending requests with same suggestion as accepted.';

-- ============================================================
-- PART 4: Create function to override a suggestion
-- ============================================================

\echo 'Creating override_classification_suggestion function...'

CREATE OR REPLACE FUNCTION trapper.override_classification_suggestion(
  p_request_id UUID,
  p_override_classification trapper.colony_classification,
  p_reason TEXT,
  p_reviewed_by TEXT DEFAULT 'staff',
  p_authoritative_count INT DEFAULT NULL
)
RETURNS trapper.colony_classification AS $$
DECLARE
  v_request RECORD;
BEGIN
  -- Get request data
  SELECT * INTO v_request
  FROM trapper.sot_requests
  WHERE request_id = p_request_id;

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not found: %', p_request_id;
  END IF;

  -- Apply override to place
  PERFORM trapper.set_colony_classification(
    v_request.place_id,
    p_override_classification,
    p_reason,
    p_reviewed_by,
    p_authoritative_count
  );

  -- Update request disposition
  UPDATE trapper.sot_requests
  SET classification_disposition = 'overridden',
      classification_reviewed_at = NOW(),
      classification_reviewed_by = p_reviewed_by
  WHERE request_id = p_request_id;

  -- Mark other pending requests as dismissed (override takes precedence)
  UPDATE trapper.sot_requests
  SET classification_disposition = 'dismissed',
      classification_reviewed_at = NOW(),
      classification_reviewed_by = p_reviewed_by
  WHERE place_id = v_request.place_id
    AND request_id != p_request_id
    AND classification_disposition = 'pending';

  RETURN p_override_classification;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.override_classification_suggestion IS
'Overrides a classification suggestion with a different classification.
Marks the source request as overridden and other pending requests as dismissed.';

-- ============================================================
-- PART 5: Create function to dismiss a suggestion
-- ============================================================

\echo 'Creating dismiss_classification_suggestion function...'

CREATE OR REPLACE FUNCTION trapper.dismiss_classification_suggestion(
  p_request_id UUID,
  p_reviewed_by TEXT DEFAULT 'staff'
)
RETURNS VOID AS $$
BEGIN
  UPDATE trapper.sot_requests
  SET classification_disposition = 'dismissed',
      classification_reviewed_at = NOW(),
      classification_reviewed_by = p_reviewed_by
  WHERE request_id = p_request_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.dismiss_classification_suggestion IS
'Dismisses a classification suggestion without applying it.';

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Verification:'

SELECT 'reconcile_place_classification function' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'reconcile_place_classification')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'v_places_needing_classification view' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'trapper' AND viewname = 'v_places_needing_classification')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'accept_classification_suggestion function' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'accept_classification_suggestion')
            THEN 'OK' ELSE 'MISSING' END AS status;

\echo ''
\echo '========================================================'
\echo 'MIG_624 Complete!'
\echo '========================================================'
\echo ''
\echo 'New capabilities:'
\echo '  1. reconcile_place_classification() - Analyzes all suggestions for a place'
\echo '  2. v_places_needing_classification - Review queue view'
\echo '  3. accept_classification_suggestion() - Accept and apply to place'
\echo '  4. override_classification_suggestion() - Apply different classification'
\echo '  5. dismiss_classification_suggestion() - Ignore suggestion'
\echo ''
\echo 'Usage:'
\echo '  -- Check places needing review'
\echo '  SELECT * FROM trapper.v_places_needing_classification LIMIT 20;'
\echo ''
\echo '  -- Accept a suggestion'
\echo '  SELECT trapper.accept_classification_suggestion(''request-uuid'', ''jane.doe'');'
\echo ''
