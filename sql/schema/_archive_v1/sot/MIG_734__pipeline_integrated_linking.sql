\echo '=== MIG_734: Pipeline-Integrated Google Maps Linking ==='
\echo 'Integrates Google Maps entry linking into the data ingestion pipeline'
\echo ''

-- ============================================================================
-- PROBLEM:
-- Phase 6 (MIG_733) created batch linking functions, but Atlas needs:
-- 1. Automatic linking as data flows in (not just batch backfills)
-- 2. New place triggers to re-evaluate nearby unlinked entries
-- 3. Integration with run_all_entity_linking() chain
-- 4. AI enrichment for place type classification
--
-- SOLUTION:
-- 1. Add linked_at timestamp for tracking when links were made
-- 2. Create incremental linking function for pipeline use
-- 3. Add trigger on new place creation to update nearest_place
-- 4. Add place type classification columns for AI enrichment
-- 5. Create confidence calculation function
-- ============================================================================

-- ============================================================================
-- PART 1: Add linked_at timestamp to google_map_entries
-- ============================================================================

\echo 'Adding linked_at column...'

ALTER TABLE trapper.google_map_entries
  ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ;

COMMENT ON COLUMN trapper.google_map_entries.linked_at IS
  'When this entry was linked to a place (either by auto-linking or manually)';

-- Index for finding recently linked entries
CREATE INDEX IF NOT EXISTS idx_gme_linked_at
  ON trapper.google_map_entries(linked_at DESC)
  WHERE linked_at IS NOT NULL;

-- ============================================================================
-- PART 2: Add AI classification columns to places for type detection
-- ============================================================================

\echo 'Adding AI classification columns to places...'

ALTER TABLE trapper.places
  ADD COLUMN IF NOT EXISTS ai_classification JSONB,
  ADD COLUMN IF NOT EXISTS ai_classified_at TIMESTAMPTZ;

COMMENT ON COLUMN trapper.places.ai_classification IS
  'AI-extracted attributes about the place (type classification, property size, etc.)';
COMMENT ON COLUMN trapper.places.ai_classified_at IS
  'When AI classification was last run on this place';

CREATE INDEX IF NOT EXISTS idx_places_ai_classified
  ON trapper.places(ai_classified_at)
  WHERE ai_classified_at IS NOT NULL;

-- ============================================================================
-- PART 3: Spatial index for finding unlinked entries near new places
-- ============================================================================

\echo 'Creating spatial index for unlinked entries...'

-- This enables fast queries like "find all unlinked entries within 50m of a new place"
CREATE INDEX IF NOT EXISTS idx_gme_unlinked_location
  ON trapper.google_map_entries USING GIST (
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
  )
  WHERE linked_place_id IS NULL AND place_id IS NULL AND lat IS NOT NULL;

-- ============================================================================
-- PART 4: Confidence calculation function
-- ============================================================================

\echo 'Creating calculate_link_confidence function...'

CREATE OR REPLACE FUNCTION trapper.calculate_link_confidence(
  p_distance_m NUMERIC,
  p_ai_confidence TEXT,
  p_ai_same_place BOOLEAN,
  p_place_type TEXT,
  p_entry_date DATE
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_base_confidence NUMERIC := 0;
  v_recency_multiplier NUMERIC;
  v_type_multiplier NUMERIC := 1.0;
BEGIN
  -- Base confidence from distance
  v_base_confidence := CASE
    WHEN p_distance_m <= 10 THEN 0.90
    WHEN p_distance_m <= 15 THEN 0.80
    WHEN p_distance_m <= 25 THEN 0.70
    WHEN p_distance_m <= 50 THEN 0.50
    ELSE 0.30
  END;

  -- Boost from AI signals
  IF p_ai_confidence = 'high' AND p_ai_same_place THEN
    v_base_confidence := v_base_confidence + 0.15;
  ELSIF p_ai_confidence = 'medium' THEN
    v_base_confidence := v_base_confidence + 0.08;
  END IF;

  -- Adjust for place type (ranch/outdoor sites more forgiving on distance)
  v_type_multiplier := CASE
    WHEN p_place_type = 'ranch_property' THEN 1.15   -- Large property, distance less critical
    WHEN p_place_type = 'outdoor_site' THEN 1.10    -- Outdoor areas spread out
    WHEN p_place_type IN ('apartment_building', 'mobile_home_park') THEN 0.0  -- NEVER auto-link
    ELSE 1.0
  END;

  -- Recency decay for historical data
  v_recency_multiplier := CASE
    WHEN p_entry_date > CURRENT_DATE - 30 THEN 1.0
    WHEN p_entry_date > CURRENT_DATE - 90 THEN 0.9
    WHEN p_entry_date > CURRENT_DATE - 365 THEN 0.8
    ELSE 0.7  -- Historical data still valuable but lower weight
  END;

  RETURN LEAST(v_base_confidence * v_type_multiplier * v_recency_multiplier, 1.0);
END;
$$;

COMMENT ON FUNCTION trapper.calculate_link_confidence IS
  'Calculates confidence score for linking a Google Maps entry to a place, considering distance, AI signals, place type, and recency';

-- ============================================================================
-- PART 5: Incremental linking function for pipeline use
-- ============================================================================

\echo 'Creating link_google_entries_incremental function...'

CREATE OR REPLACE FUNCTION trapper.link_google_entries_incremental(
  p_limit INT DEFAULT 500
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_linked INT := 0;
  v_row RECORD;
  v_threshold NUMERIC;
  v_confidence NUMERIC;
BEGIN
  -- Process entries that:
  -- 1. Are not linked yet
  -- 2. Have nearest_place populated
  -- 3. Haven't been rejected/skipped
  -- 4. Not flagged for unit selection
  FOR v_row IN
    SELECT
      e.entry_id,
      e.nearest_place_id,
      e.nearest_place_distance_m,
      p.place_kind,
      e.ai_classification->'entity_links'->>'place_confidence' as ai_confidence,
      (e.ai_classification->'entity_links'->>'is_same_as_nearby_place')::boolean as ai_same,
      e.imported_at::date as entry_date
    FROM trapper.google_map_entries e
    JOIN trapper.places p ON p.place_id = e.nearest_place_id
    WHERE e.linked_place_id IS NULL
      AND e.place_id IS NULL
      AND e.nearest_place_id IS NOT NULL
      AND COALESCE(e.link_review_status, 'pending') NOT IN ('rejected', 'skipped')
      AND COALESCE(e.requires_unit_selection, FALSE) = FALSE
      AND NOT trapper.is_multi_unit_place(e.nearest_place_id)
    ORDER BY e.nearest_place_distance_m ASC
    LIMIT p_limit
  LOOP
    -- Get threshold for this place type
    v_threshold := CASE
      WHEN v_row.place_kind IN ('residential_house', 'single_family') THEN 15
      WHEN v_row.place_kind IN ('business', 'commercial') THEN 20
      WHEN v_row.place_kind IN ('outdoor_site', 'rural') THEN 30
      WHEN v_row.ai_confidence = 'high' AND v_row.ai_same = TRUE THEN 50  -- AI boost
      ELSE 10  -- Conservative for unknown
    END;

    -- Check if within threshold
    IF v_row.nearest_place_distance_m <= v_threshold THEN
      -- Calculate confidence
      v_confidence := trapper.calculate_link_confidence(
        v_row.nearest_place_distance_m,
        v_row.ai_confidence,
        v_row.ai_same,
        v_row.place_kind,
        v_row.entry_date
      );

      -- Only link if confidence >= 0.70
      IF v_confidence >= 0.70 THEN
        -- Link it
        UPDATE trapper.google_map_entries
        SET
          linked_place_id = v_row.nearest_place_id,
          link_confidence = v_confidence,
          link_method = CASE
            WHEN v_row.nearest_place_distance_m <= 10 THEN 'coordinate_exact'
            WHEN v_row.ai_confidence = 'high' THEN 'ai_entity_link'
            ELSE 'coordinate_tiered'
          END,
          linked_at = NOW()
        WHERE entry_id = v_row.entry_id;

        -- Audit
        INSERT INTO trapper.google_entry_link_audit
          (entry_id, action, place_id, link_method, confidence, performed_by, notes)
        VALUES
          (v_row.entry_id, 'linked', v_row.nearest_place_id, 'incremental',
           v_confidence, 'system:entity_linking',
           format('Distance: %sm, Place type: %s', ROUND(v_row.nearest_place_distance_m::numeric, 1), v_row.place_kind));

        v_linked := v_linked + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_linked;
END;
$$;

COMMENT ON FUNCTION trapper.link_google_entries_incremental IS
  'Incrementally links Google Maps entries to places. Called by run_all_entity_linking() after each processing job.';

-- ============================================================================
-- PART 6: Function to update nearest_place for entries near a specific location
-- ============================================================================

\echo 'Creating update_nearest_place_for_location function...'

CREATE OR REPLACE FUNCTION trapper.update_nearest_place_for_location(
  p_place_id UUID,
  p_radius_m INT DEFAULT 50
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated INT := 0;
  v_place_location geography;
BEGIN
  -- Get the place location
  SELECT p.location::geography INTO v_place_location
  FROM trapper.places p
  WHERE p.place_id = p_place_id;

  IF v_place_location IS NULL THEN
    RETURN 0;
  END IF;

  -- Update entries within radius if this place is closer than current nearest
  WITH updated AS (
    UPDATE trapper.google_map_entries e
    SET
      nearest_place_id = p_place_id,
      nearest_place_distance_m = ST_Distance(
        ST_SetSRID(ST_MakePoint(e.lng, e.lat), 4326)::geography,
        v_place_location
      )
    WHERE e.linked_place_id IS NULL
      AND e.place_id IS NULL
      AND e.lat IS NOT NULL
      AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(e.lng, e.lat), 4326)::geography,
        v_place_location,
        p_radius_m
      )
      AND (
        e.nearest_place_id IS NULL
        OR ST_Distance(
          ST_SetSRID(ST_MakePoint(e.lng, e.lat), 4326)::geography,
          v_place_location
        ) < e.nearest_place_distance_m
      )
    RETURNING entry_id
  )
  SELECT COUNT(*) INTO v_updated FROM updated;

  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION trapper.update_nearest_place_for_location IS
  'Updates nearest_place_id for Google Maps entries near a specific place location';

-- ============================================================================
-- PART 7: Trigger function for new place creation
-- ============================================================================

\echo 'Creating on_place_created_check_google_entries trigger function...'

CREATE OR REPLACE FUNCTION trapper.on_place_created_check_google_entries()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated INT := 0;
BEGIN
  -- Only for places with location
  IF NEW.location IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip multi-unit places (don't auto-update nearest for these)
  IF trapper.is_multi_unit_place(NEW.place_id) THEN
    RETURN NEW;
  END IF;

  -- Update nearest_place for entries within 50m
  SELECT trapper.update_nearest_place_for_location(NEW.place_id, 50) INTO v_updated;

  -- If entries were updated, queue incremental linking
  IF v_updated > 0 THEN
    -- Use processing_jobs queue if it exists
    BEGIN
      INSERT INTO trapper.processing_jobs (
        source_system,
        source_table,
        trigger_type,
        batch_id,
        priority,
        status
      ) VALUES (
        'google_maps',
        'linking',
        'new_place_proximity',
        NEW.place_id::TEXT,
        5,
        'pending'
      );
    EXCEPTION WHEN undefined_table THEN
      -- processing_jobs table doesn't exist, skip queueing
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trapper.on_place_created_check_google_entries IS
  'Trigger function: when a new place is created, update nearest_place for nearby Google Maps entries';

-- Create trigger (drop first if exists to avoid duplicates)
DROP TRIGGER IF EXISTS trg_place_created_check_google ON trapper.places;

CREATE TRIGGER trg_place_created_check_google
  AFTER INSERT ON trapper.places
  FOR EACH ROW
  EXECUTE FUNCTION trapper.on_place_created_check_google_entries();

-- ============================================================================
-- PART 8: Function to flag multi-unit candidates
-- ============================================================================

\echo 'Creating flag_multi_unit_candidates function...'

CREATE OR REPLACE FUNCTION trapper.flag_multi_unit_candidates()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_flagged INT := 0;
BEGIN
  WITH flagged AS (
    UPDATE trapper.google_map_entries e
    SET
      requires_unit_selection = TRUE,
      suggested_parent_place_id = COALESCE(p.parent_place_id, p.place_id),
      link_review_status = 'pending'
    FROM trapper.places p
    WHERE p.place_id = e.nearest_place_id
      AND e.linked_place_id IS NULL
      AND e.place_id IS NULL
      AND COALESCE(e.link_review_status, 'pending') = 'pending'
      AND e.requires_unit_selection = FALSE
      AND e.nearest_place_distance_m < 50
      AND trapper.is_multi_unit_place(p.place_id)
    RETURNING e.entry_id, p.place_id
  ),
  audit_insert AS (
    INSERT INTO trapper.google_entry_link_audit (entry_id, action, place_id, link_method, notes, performed_by)
    SELECT entry_id, 'flagged_multiunit', place_id, 'auto_flag', 'Near multi-unit place, requires unit selection', 'system:flag_multi_unit'
    FROM flagged
  )
  SELECT COUNT(*) INTO v_flagged FROM flagged;

  RETURN v_flagged;
END;
$$;

COMMENT ON FUNCTION trapper.flag_multi_unit_candidates IS
  'Flags Google Maps entries near multi-unit places as requiring unit selection';

-- ============================================================================
-- PART 9: Update existing entries with linked_at for entries already linked
-- ============================================================================

\echo 'Backfilling linked_at for existing linked entries...'

UPDATE trapper.google_map_entries
SET linked_at = COALESCE(link_reviewed_at, updated_at, imported_at)
WHERE linked_place_id IS NOT NULL
  AND linked_at IS NULL;

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=================================================='
\echo 'MIG_734 Complete!'
\echo '=================================================='
\echo ''
\echo 'Created:'
\echo '  - linked_at column on google_map_entries'
\echo '  - ai_classification, ai_classified_at columns on places'
\echo '  - Spatial index for unlinked entries'
\echo '  - calculate_link_confidence() function'
\echo '  - link_google_entries_incremental() function'
\echo '  - update_nearest_place_for_location() function'
\echo '  - on_place_created_check_google_entries() trigger'
\echo '  - flag_multi_unit_candidates() function'
\echo ''
\echo 'Next step: Run MIG_735 to add Google linking to run_all_entity_linking() chain'
\echo ''
