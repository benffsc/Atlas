-- ============================================================================
-- MIG_705: Fix Google Maps Import Upsert Logic
-- ============================================================================
-- Problem: The unique constraint is on (lat, lng, kml_name) but the UPDATE
-- was matching on rounded coordinates, causing INSERT failures when coords
-- differ slightly.
--
-- Solution: Use INSERT ... ON CONFLICT for proper upsert behavior
-- ============================================================================

\echo '=== MIG_705: Fix Google Maps Import Upsert Logic ==='

-- Drop and recreate the function with proper upsert handling
CREATE OR REPLACE FUNCTION trapper.process_google_maps_import(p_import_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_import RECORD;
  v_placemark JSONB;
  v_updated INT := 0;
  v_inserted INT := 0;
  v_not_matched INT := 0;
  v_icon_type TEXT;
  v_icon_color TEXT;
  v_style_id TEXT;
  v_entry_id UUID;
BEGIN
  -- Get import record
  SELECT * INTO v_import
  FROM trapper.staged_google_maps_imports
  WHERE import_id = p_import_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Import not found or not pending');
  END IF;

  -- Mark as processing
  UPDATE trapper.staged_google_maps_imports
  SET status = 'processing'
  WHERE import_id = p_import_id;

  -- Process each placemark
  FOR v_placemark IN SELECT * FROM jsonb_array_elements(v_import.placemarks)
  LOOP
    -- Parse style URL to extract icon type and color
    -- styleUrl looks like "#icon-503-009D57"
    IF v_placemark->>'styleUrl' IS NOT NULL THEN
      v_style_id := regexp_replace(v_placemark->>'styleUrl', '^#', '');
      v_icon_type := (regexp_matches(v_style_id, '(icon-\d+)', 'i'))[1];
      v_icon_color := (regexp_matches(v_style_id, 'icon-\d+-([A-F0-9]+)', 'i'))[1];
    ELSE
      v_style_id := NULL;
      v_icon_type := NULL;
      v_icon_color := NULL;
    END IF;

    -- Use INSERT ... ON CONFLICT for proper upsert
    -- First try exact coordinate match, then update if exists
    INSERT INTO trapper.google_map_entries (
      kml_name, original_content, lat, lng,
      icon_type, icon_color, icon_style_id, kml_folder, synced_at
    ) VALUES (
      v_placemark->>'name',
      v_placemark->>'description',
      (v_placemark->>'lat')::double precision,
      (v_placemark->>'lng')::double precision,
      LOWER(v_icon_type),
      UPPER(v_icon_color),
      LOWER(v_style_id),
      v_placemark->>'folder',
      NOW()
    )
    ON CONFLICT (lat, lng, kml_name) DO UPDATE SET
      icon_type = COALESCE(LOWER(v_icon_type), trapper.google_map_entries.icon_type),
      icon_color = COALESCE(UPPER(v_icon_color), trapper.google_map_entries.icon_color),
      icon_style_id = COALESCE(LOWER(v_style_id), trapper.google_map_entries.icon_style_id),
      kml_folder = COALESCE(v_placemark->>'folder', trapper.google_map_entries.kml_folder),
      original_content = COALESCE(v_placemark->>'description', trapper.google_map_entries.original_content),
      synced_at = NOW()
    RETURNING entry_id INTO v_entry_id;

    -- Count based on whether this was an insert or update
    -- xmax = 0 means this was a fresh insert, > 0 means it was an update
    IF v_entry_id IS NOT NULL THEN
      v_inserted := v_inserted + 1;
    ELSE
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  -- Derive icon meanings for all entries with icon data
  UPDATE trapper.google_map_entries
  SET icon_meaning = trapper.derive_icon_meaning(icon_type, icon_color)
  WHERE icon_type IS NOT NULL AND icon_meaning IS NULL;

  -- Mark as completed
  UPDATE trapper.staged_google_maps_imports
  SET
    status = 'completed',
    updated_count = v_updated,
    inserted_count = v_inserted,
    not_matched_count = v_not_matched,
    processed_at = NOW()
  WHERE import_id = p_import_id;

  RETURN jsonb_build_object(
    'success', true,
    'updated', v_updated,
    'inserted', v_inserted,
    'not_matched', v_not_matched
  );

EXCEPTION WHEN OTHERS THEN
  UPDATE trapper.staged_google_maps_imports
  SET status = 'failed', error_message = SQLERRM
  WHERE import_id = p_import_id;

  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

\echo '=== MIG_705 Complete ==='
