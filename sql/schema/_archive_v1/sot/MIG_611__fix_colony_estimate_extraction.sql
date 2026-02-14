-- MIG_611: Fix colony estimate extraction from trapper reports
--
-- Problem: The commit_trapper_report_item function expected `remaining_max`
-- but the AI extraction outputs `cats_remaining.max` (nested structure).
-- This caused total_cats to be NULL for trapper_report colony estimates.
--
-- Solution:
-- 1. Fix the function to extract from nested structure
-- 2. Backfill existing NULL records from source data
-- 3. Add fallback logic for robustness

\echo ''
\echo '=============================================='
\echo 'MIG_611: Fix Colony Estimate Extraction'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Backfill existing NULL total_cats from source items
-- ============================================================

\echo 'Backfilling NULL total_cats from trapper_report_items...'

-- Update place_colony_estimates where total_cats is NULL
-- by extracting from the linked trapper_report_items
UPDATE trapper.place_colony_estimates pce
SET total_cats = COALESCE(
  -- Try cats_remaining.max (nested structure from AI)
  (tri.extracted_data->'cats_remaining'->>'max')::INT,
  -- Try cats_remaining.min if max not available
  (tri.extracted_data->'cats_remaining'->>'min')::INT,
  -- Try flat remaining_max (old format)
  (tri.extracted_data->>'remaining_max')::INT,
  -- Try cats_seen as fallback
  (tri.extracted_data->>'cats_seen')::INT
)
FROM trapper.trapper_report_items tri
WHERE pce.source_type = 'trapper_report'
  AND pce.source_record_id = tri.item_id::TEXT
  AND pce.total_cats IS NULL
  AND (
    (tri.extracted_data->'cats_remaining'->>'max') IS NOT NULL
    OR (tri.extracted_data->'cats_remaining'->>'min') IS NOT NULL
    OR (tri.extracted_data->>'remaining_max') IS NOT NULL
    OR (tri.extracted_data->>'cats_seen') IS NOT NULL
  );

\echo 'Backfill complete.'

-- Show what was updated
SELECT
  pce.estimate_id,
  pce.total_cats,
  pce.source_type,
  tri.extracted_data->'cats_remaining' as cats_remaining_data
FROM trapper.place_colony_estimates pce
JOIN trapper.trapper_report_items tri ON tri.item_id::TEXT = pce.source_record_id
WHERE pce.source_type = 'trapper_report'
LIMIT 5;

-- ============================================================
-- 2. Update commit_trapper_report_item function
-- ============================================================

\echo ''
\echo 'Updating commit_trapper_report_item function...'

CREATE OR REPLACE FUNCTION trapper.commit_trapper_report_item(
  p_item_id UUID,
  p_committed_by TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item RECORD;
  v_data JSONB;
  v_entity_id UUID;
  v_result JSONB;
  v_old_values JSONB;
  v_edit_id UUID;
  v_total_cats INT;
BEGIN
  -- Get the item
  SELECT
    item_id,
    item_type,
    target_entity_id,
    final_entity_id,
    COALESCE(final_data, extracted_data) as data
  INTO v_item
  FROM trapper.trapper_report_items
  WHERE item_id = p_item_id;

  IF v_item IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Item not found'
    );
  END IF;

  v_data := v_item.data;
  v_entity_id := COALESCE(v_item.final_entity_id, v_item.target_entity_id);

  -- Handle each item type
  CASE v_item.item_type

    -- Request status update
    WHEN 'request_status' THEN
      -- Get old values for audit
      SELECT jsonb_build_object(
        'status', status::TEXT,
        'notes', notes
      ) INTO v_old_values
      FROM trapper.sot_requests WHERE request_id = v_entity_id;

      -- Update request
      UPDATE trapper.sot_requests
      SET
        status = COALESCE((v_data->>'status')::trapper.request_status, status),
        notes = CASE
          WHEN v_data->>'notes' IS NOT NULL
          THEN COALESCE(notes || E'\n\n', '') || v_data->>'notes'
          ELSE notes
        END,
        updated_at = NOW()
      WHERE request_id = v_entity_id;

      -- Log edit
      INSERT INTO trapper.entity_edits (
        entity_type, entity_id, edit_type,
        old_values, new_values, edited_by, edit_source
      ) VALUES (
        'request', v_entity_id, 'status_update',
        v_old_values, v_data, p_committed_by, 'trapper_report'
      )
      RETURNING edit_id INTO v_edit_id;

      v_result := jsonb_build_object(
        'success', true,
        'action', 'request_status_updated',
        'request_id', v_entity_id,
        'edit_id', v_edit_id
      );

    -- Add note to request
    WHEN 'request_note' THEN
      -- Get old values
      SELECT jsonb_build_object('notes', notes) INTO v_old_values
      FROM trapper.sot_requests WHERE request_id = v_entity_id;

      -- Append note
      UPDATE trapper.sot_requests
      SET
        notes = COALESCE(notes || E'\n\n', '') || v_data->>'note',
        updated_at = NOW()
      WHERE request_id = v_entity_id;

      -- Log edit
      INSERT INTO trapper.entity_edits (
        entity_type, entity_id, edit_type,
        old_values, new_values, edited_by, edit_source
      ) VALUES (
        'request', v_entity_id, 'note_added',
        v_old_values, v_data, p_committed_by, 'trapper_report'
      )
      RETURNING edit_id INTO v_edit_id;

      v_result := jsonb_build_object(
        'success', true,
        'action', 'request_note_added',
        'request_id', v_entity_id,
        'edit_id', v_edit_id
      );

    -- Add colony estimate
    WHEN 'colony_estimate' THEN
      -- Extract total_cats with multiple fallback options
      -- Priority: cats_remaining.max > cats_remaining.min > remaining_max > cats_seen
      v_total_cats := COALESCE(
        (v_data->'cats_remaining'->>'max')::INT,
        (v_data->'cats_remaining'->>'min')::INT,
        (v_data->>'remaining_max')::INT,
        (v_data->>'cats_seen')::INT
      );

      INSERT INTO trapper.place_colony_estimates (
        place_id,
        total_cats,
        total_cats_observed,
        eartip_count_observed,
        notes,
        source_type,
        observation_date,
        source_system,
        source_record_id,
        is_firsthand,
        created_by
      ) VALUES (
        v_entity_id,
        v_total_cats,
        (v_data->>'cats_seen')::INT,
        (v_data->>'eartips_seen')::INT,
        v_data->>'notes',
        'trapper_report',
        COALESCE((v_data->>'observation_date')::DATE, CURRENT_DATE),
        'trapper_report',
        p_item_id::TEXT,
        TRUE,
        p_committed_by
      );

      v_result := jsonb_build_object(
        'success', true,
        'action', 'colony_estimate_added',
        'place_id', v_entity_id,
        'total_cats', v_total_cats
      );

    -- Link two sites
    WHEN 'site_relationship' THEN
      INSERT INTO trapper.place_place_edges (
        place_id_a, place_id_b,
        relationship_type_id,
        direction,
        confidence,
        note,
        source_system
      )
      SELECT
        LEAST(v_entity_id, (v_data->>'related_place_id')::UUID),
        GREATEST(v_entity_id, (v_data->>'related_place_id')::UUID),
        rt.id,
        'bidirectional',
        0.90,
        v_data->>'note',
        'trapper_report'
      FROM trapper.relationship_types rt
      WHERE rt.domain = 'place_place' AND rt.code = 'same_colony_site'
      ON CONFLICT DO NOTHING;

      v_result := jsonb_build_object(
        'success', true,
        'action', 'site_relationship_created',
        'place_id_a', v_entity_id,
        'place_id_b', v_data->>'related_place_id'
      );

    -- Trapping progress update
    WHEN 'trapping_progress' THEN
      -- Get old values
      SELECT jsonb_build_object(
        'cats_trapped', cats_trapped,
        'estimated_cat_count', estimated_cat_count
      ) INTO v_old_values
      FROM trapper.sot_requests WHERE request_id = v_entity_id;

      -- Update request
      UPDATE trapper.sot_requests
      SET
        cats_trapped = COALESCE((v_data->>'cats_trapped')::INT, cats_trapped),
        estimated_cat_count = COALESCE((v_data->>'cats_remaining')::INT, estimated_cat_count),
        updated_at = NOW()
      WHERE request_id = v_entity_id;

      -- Log edit
      INSERT INTO trapper.entity_edits (
        entity_type, entity_id, edit_type,
        old_values, new_values, edited_by, edit_source
      ) VALUES (
        'request', v_entity_id, 'trapping_progress',
        v_old_values, v_data, p_committed_by, 'trapper_report'
      )
      RETURNING edit_id INTO v_edit_id;

      v_result := jsonb_build_object(
        'success', true,
        'action', 'trapping_progress_updated',
        'request_id', v_entity_id,
        'edit_id', v_edit_id
      );

    -- New site observation (creates site and observation)
    WHEN 'new_site_observation' THEN
      -- Create place first
      INSERT INTO trapper.places (
        display_name,
        formatted_address,
        place_kind,
        source_system
      ) VALUES (
        COALESCE(v_data->>'site_name', 'New Site'),
        v_data->>'address',
        'colony_site',
        'trapper_report'
      )
      RETURNING place_id INTO v_entity_id;

      -- Extract total_cats with same fallback logic
      v_total_cats := COALESCE(
        (v_data->'cats_remaining'->>'max')::INT,
        (v_data->'cats_remaining'->>'min')::INT,
        (v_data->>'remaining_max')::INT,
        (v_data->>'cats_seen')::INT
      );

      -- Add colony estimate
      INSERT INTO trapper.place_colony_estimates (
        place_id,
        total_cats,
        total_cats_observed,
        eartip_count_observed,
        notes,
        source_type,
        observation_date,
        source_system,
        source_record_id,
        is_firsthand,
        created_by
      ) VALUES (
        v_entity_id,
        v_total_cats,
        (v_data->>'cats_seen')::INT,
        (v_data->>'eartips_seen')::INT,
        v_data->>'notes',
        'trapper_report',
        COALESCE((v_data->>'observation_date')::DATE, CURRENT_DATE),
        'trapper_report',
        p_item_id::TEXT,
        TRUE,
        p_committed_by
      );

      -- Update item with created entity
      UPDATE trapper.trapper_report_items
      SET final_entity_id = v_entity_id
      WHERE item_id = p_item_id;

      v_result := jsonb_build_object(
        'success', true,
        'action', 'new_site_created',
        'place_id', v_entity_id,
        'total_cats', v_total_cats
      );

    ELSE
      v_result := jsonb_build_object(
        'success', false,
        'error', format('Unknown item type: %s', v_item.item_type)
      );

  END CASE;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION trapper.commit_trapper_report_item IS
'Commits an approved trapper report item to the appropriate entity.
Fixed in MIG_611 to handle nested cats_remaining.max structure from AI extraction.';

\echo ''
\echo '=== MIG_611 Complete ==='
\echo 'Fixed: colony estimate extraction now handles cats_remaining.max nested structure'
\echo 'Backfilled: existing NULL total_cats records updated from source data'
\echo ''
