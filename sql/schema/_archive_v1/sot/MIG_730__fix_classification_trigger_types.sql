\echo '=== MIG_730: Fix classification trigger type casts ==='

-- The trigger passes eartip_estimate enum without casting to TEXT

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
  v_feeding_duration := NULL;
  IF NEW.is_being_fed THEN
    v_feeding_duration := 'few_months';  -- Default assumption
  END IF;

  -- Compute suggestion (cast enum types to TEXT)
  SELECT * INTO v_result
  FROM trapper.compute_classification_suggestion(
    NULL::TEXT,  -- ownership_status not on requests directly
    NEW.estimated_cat_count,
    COALESCE(NEW.cat_count_semantic::TEXT, 'legacy_total'),
    NEW.eartip_estimate::TEXT,  -- Cast enum to TEXT
    v_feeding_duration,
    NEW.has_kittens,
    NULL::TEXT,  -- kitten_age
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

-- Also fix refresh_classification_suggestion which has the same issue
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

  -- Compute suggestion (cast enum types to TEXT)
  SELECT * INTO v_result
  FROM trapper.compute_classification_suggestion(
    NULL::TEXT,
    v_request.estimated_cat_count,
    COALESCE(v_request.cat_count_semantic::TEXT, 'legacy_total'),
    v_request.eartip_estimate::TEXT,  -- Cast enum to TEXT
    CASE WHEN v_request.is_being_fed THEN 'few_months' ELSE NULL END,
    v_request.has_kittens,
    NULL::TEXT,
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

\echo 'Fixed trigger_auto_suggest_classification and refresh_classification_suggestion type casts'
