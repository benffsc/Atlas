-- MIG_623: Auto-Suggest Classification Trigger
--
-- Automatically computes classification suggestions when requests are created
-- or updated. Uses compute_classification_suggestion() from MIG_622.
--
-- Also provides a function to backfill suggestions for existing requests.

\echo ''
\echo '========================================================'
\echo 'MIG_623: Auto-Suggest Classification Trigger'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Create trigger function
-- ============================================================

\echo 'Creating auto_suggest_classification trigger function...'

CREATE OR REPLACE FUNCTION trapper.trigger_auto_suggest_classification()
RETURNS TRIGGER AS $$
DECLARE
  v_result RECORD;
  v_request_count INT;
  v_feeding_duration TEXT;
  v_kitten_age TEXT;
BEGIN
  -- Only compute if we have a place
  IF NEW.place_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Count other requests at the same place
  SELECT COUNT(*) INTO v_request_count
  FROM trapper.sot_requests
  WHERE place_id = NEW.place_id AND request_id != COALESCE(NEW.request_id, '00000000-0000-0000-0000-000000000000'::UUID);

  -- Map feeding_schedule to duration if available
  -- (This is a simplification - in practice we'd need more intake data)
  v_feeding_duration := NULL;
  IF NEW.is_being_fed THEN
    v_feeding_duration := 'few_months';  -- Default assumption
  END IF;

  -- Compute suggestion
  SELECT * INTO v_result
  FROM trapper.compute_classification_suggestion(
    NULL,  -- ownership_status not on requests directly
    NEW.estimated_cat_count,
    COALESCE(NEW.cat_count_semantic, 'legacy_total'),
    NEW.eartip_estimate,  -- Maps roughly to fixed_status
    v_feeding_duration,
    NEW.has_kittens,
    NULL,  -- kitten_age
    v_request_count + 1
  );

  -- Update the request with suggestion
  NEW.suggested_classification := v_result.classification;
  NEW.classification_confidence := v_result.confidence;
  NEW.classification_signals := v_result.signals;
  NEW.classification_disposition := 'pending';
  NEW.classification_suggested_at := NOW();

  -- Auto-apply if confidence >= 0.9 AND place has no classification yet
  IF v_result.confidence >= 0.90 THEN
    DECLARE
      v_place_classification TEXT;
    BEGIN
      SELECT colony_classification::TEXT INTO v_place_classification
      FROM trapper.places
      WHERE place_id = NEW.place_id;

      IF v_place_classification = 'unknown' OR v_place_classification IS NULL THEN
        -- Auto-apply to place
        PERFORM trapper.set_colony_classification(
          NEW.place_id,
          v_result.classification,
          'Auto-applied from intake (confidence: ' || ROUND(v_result.confidence * 100) || '%)',
          'system',
          CASE WHEN v_result.classification = 'individual_cats' THEN NEW.estimated_cat_count ELSE NULL END
        );

        NEW.classification_disposition := 'accepted';
        NEW.classification_reviewed_at := NOW();
        NEW.classification_reviewed_by := 'system';
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.trigger_auto_suggest_classification IS
'Trigger function that auto-computes classification suggestions on request insert/update.
Auto-applies to place if confidence >= 90% and place is unclassified.';

-- ============================================================
-- PART 2: Create trigger on sot_requests
-- ============================================================

\echo 'Creating trigger on sot_requests...'

-- Drop if exists
DROP TRIGGER IF EXISTS trg_auto_suggest_classification ON trapper.sot_requests;

-- Create trigger for INSERT only (not UPDATE to avoid loops)
CREATE TRIGGER trg_auto_suggest_classification
  BEFORE INSERT ON trapper.sot_requests
  FOR EACH ROW
  EXECUTE FUNCTION trapper.trigger_auto_suggest_classification();

-- ============================================================
-- PART 3: Create backfill function
-- ============================================================

\echo 'Creating backfill_classification_suggestions function...'

CREATE OR REPLACE FUNCTION trapper.backfill_classification_suggestions(
  p_limit INT DEFAULT 1000
)
RETURNS TABLE(
  requests_updated INT,
  places_auto_applied INT,
  classification_breakdown JSONB
) AS $$
DECLARE
  v_requests_updated INT := 0;
  v_places_applied INT := 0;
  v_breakdown JSONB := '{}';
  v_request RECORD;
  v_result RECORD;
  v_request_count INT;
  v_place_classification TEXT;
BEGIN
  -- Find requests without suggestions
  FOR v_request IN
    SELECT r.request_id, r.place_id, r.estimated_cat_count, r.cat_count_semantic,
           r.eartip_estimate, r.has_kittens, r.is_being_fed
    FROM trapper.sot_requests r
    WHERE r.suggested_classification IS NULL
      AND r.place_id IS NOT NULL
    LIMIT p_limit
  LOOP
    -- Count other requests at place
    SELECT COUNT(*) INTO v_request_count
    FROM trapper.sot_requests
    WHERE place_id = v_request.place_id AND request_id != v_request.request_id;

    -- Compute suggestion (casting types properly)
    SELECT * INTO v_result
    FROM trapper.compute_classification_suggestion(
      NULL::TEXT,  -- ownership_status (not stored on old requests)
      v_request.estimated_cat_count,
      COALESCE(v_request.cat_count_semantic::TEXT, 'legacy_total'),
      CASE WHEN v_request.eartip_estimate IS NOT NULL THEN 'some_fixed' ELSE NULL END,  -- fixed_status
      CASE WHEN v_request.is_being_fed THEN 'few_months' ELSE NULL END,  -- feeding_duration
      v_request.has_kittens,
      NULL::TEXT,  -- kitten_age
      v_request_count + 1
    );

    -- Update request
    UPDATE trapper.sot_requests
    SET suggested_classification = v_result.classification,
        classification_confidence = v_result.confidence,
        classification_signals = v_result.signals,
        classification_disposition = 'pending',
        classification_suggested_at = NOW()
    WHERE request_id = v_request.request_id;

    v_requests_updated := v_requests_updated + 1;

    -- Track breakdown
    v_breakdown := jsonb_set(
      v_breakdown,
      ARRAY[v_result.classification::TEXT],
      COALESCE(v_breakdown->v_result.classification::TEXT, '0')::INT + 1
    );

    -- Auto-apply if high confidence and place unclassified
    IF v_result.confidence >= 0.90 THEN
      SELECT colony_classification::TEXT INTO v_place_classification
      FROM trapper.places
      WHERE place_id = v_request.place_id;

      IF v_place_classification = 'unknown' OR v_place_classification IS NULL THEN
        PERFORM trapper.set_colony_classification(
          v_request.place_id,
          v_result.classification,
          'Auto-applied from backfill (confidence: ' || ROUND(v_result.confidence * 100) || '%)',
          'system',
          CASE WHEN v_result.classification = 'individual_cats' THEN v_request.estimated_cat_count ELSE NULL END
        );

        UPDATE trapper.sot_requests
        SET classification_disposition = 'accepted',
            classification_reviewed_at = NOW(),
            classification_reviewed_by = 'system'
        WHERE request_id = v_request.request_id;

        v_places_applied := v_places_applied + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_requests_updated, v_places_applied, v_breakdown;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.backfill_classification_suggestions IS
'Backfills classification suggestions for existing requests that don''t have them.
Auto-applies to places if confidence >= 90% and place is unclassified.
Run repeatedly until no more requests need processing.';

-- ============================================================
-- PART 4: Create function to refresh suggestion for a request
-- ============================================================

\echo 'Creating refresh_classification_suggestion function...'

CREATE OR REPLACE FUNCTION trapper.refresh_classification_suggestion(
  p_request_id UUID
)
RETURNS trapper.colony_classification AS $$
DECLARE
  v_request RECORD;
  v_result RECORD;
  v_request_count INT;
BEGIN
  -- Get request data
  SELECT * INTO v_request
  FROM trapper.sot_requests
  WHERE request_id = p_request_id;

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not found: %', p_request_id;
  END IF;

  -- Count other requests at place
  SELECT COUNT(*) INTO v_request_count
  FROM trapper.sot_requests
  WHERE place_id = v_request.place_id AND request_id != p_request_id;

  -- Compute suggestion
  SELECT * INTO v_result
  FROM trapper.compute_classification_suggestion(
    NULL,
    v_request.estimated_cat_count,
    COALESCE(v_request.cat_count_semantic, 'legacy_total'),
    v_request.eartip_estimate,
    CASE WHEN v_request.is_being_fed THEN 'few_months' ELSE NULL END,
    v_request.has_kittens,
    NULL,
    v_request_count + 1
  );

  -- Update request
  UPDATE trapper.sot_requests
  SET suggested_classification = v_result.classification,
      classification_confidence = v_result.confidence,
      classification_signals = v_result.signals,
      classification_suggested_at = NOW()
  WHERE request_id = p_request_id;

  RETURN v_result.classification;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.refresh_classification_suggestion IS
'Recomputes the classification suggestion for a specific request.
Useful after request data has been updated.';

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Verification:'

SELECT 'trigger_auto_suggest_classification function' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trigger_auto_suggest_classification')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'trg_auto_suggest_classification trigger' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_auto_suggest_classification')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'backfill_classification_suggestions function' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'backfill_classification_suggestions')
            THEN 'OK' ELSE 'MISSING' END AS status;

\echo ''
\echo '========================================================'
\echo 'MIG_623 Complete!'
\echo '========================================================'
\echo ''
\echo 'New capabilities:'
\echo '  1. Trigger auto-computes classification on request creation'
\echo '  2. Auto-applies to place if confidence >= 90%'
\echo '  3. backfill_classification_suggestions() for existing data'
\echo '  4. refresh_classification_suggestion() to recompute for a request'
\echo ''
\echo 'Usage:'
\echo '  -- Backfill existing requests (run repeatedly until done)'
\echo '  SELECT * FROM trapper.backfill_classification_suggestions(1000);'
\echo ''
\echo '  -- Check pending suggestions'
\echo '  SELECT * FROM trapper.v_requests_pending_classification LIMIT 20;'
\echo ''
