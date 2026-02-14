-- ============================================================================
-- MIG_704: Google Maps Staging Table
-- ============================================================================
-- Purpose: Stage Google Maps KMZ/KML uploads for processing through the
-- centralized ingest pipeline, ensuring consistency with other data sources.
--
-- Pattern: Upload → Stage → Enqueue → Process → Update google_map_entries
-- ============================================================================

\echo '=== MIG_704: Google Maps Staging Table ==='

-- ============================================================================
-- 1. Staging Table for Raw Uploads
-- ============================================================================
\echo 'Creating staging table...'

CREATE TABLE IF NOT EXISTS trapper.staged_google_maps_imports (
  import_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Raw upload info
  filename TEXT NOT NULL,
  file_content BYTEA, -- Raw KMZ/KML bytes (for reprocessing)
  upload_method TEXT DEFAULT 'web_ui', -- 'web_ui', 'cli', 'api'

  -- Parsed placemarks (extracted from KML)
  placemarks JSONB, -- Array of {name, description, lat, lng, styleUrl, folder}
  placemark_count INT,

  -- Processing status
  status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
  error_message TEXT,

  -- Results
  updated_count INT,
  inserted_count INT,
  not_matched_count INT,

  -- Audit
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staged_gmaps_status ON trapper.staged_google_maps_imports(status);
CREATE INDEX IF NOT EXISTS idx_staged_gmaps_uploaded_at ON trapper.staged_google_maps_imports(uploaded_at DESC);

COMMENT ON TABLE trapper.staged_google_maps_imports IS
'Staging table for Google Maps KMZ/KML imports. Follows centralized ingest pattern.';

-- ============================================================================
-- 2. Processing Function
-- ============================================================================
\echo 'Creating processing function...'

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
  v_result JSONB;
BEGIN
  -- Get import record
  SELECT * INTO v_import
  FROM trapper.staged_google_maps_imports
  WHERE import_id = p_import_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Import not found or not pending');
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

    -- Try to update existing entry by coordinates
    UPDATE trapper.google_map_entries
    SET
      icon_type = LOWER(v_icon_type),
      icon_color = UPPER(v_icon_color),
      icon_style_id = LOWER(v_style_id),
      kml_folder = COALESCE(v_placemark->>'folder', kml_folder),
      kml_name = COALESCE(v_placemark->>'name', kml_name),
      synced_at = NOW()
    WHERE
      ROUND(lat::numeric, 5) = ROUND((v_placemark->>'lat')::numeric, 5)
      AND ROUND(lng::numeric, 5) = ROUND((v_placemark->>'lng')::numeric, 5)
    RETURNING 1 INTO v_result;

    IF FOUND THEN
      v_updated := v_updated + 1;
    ELSE
      -- Try to insert new entry
      BEGIN
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
        );
        v_inserted := v_inserted + 1;
      EXCEPTION WHEN OTHERS THEN
        v_not_matched := v_not_matched + 1;
      END;
    END IF;
  END LOOP;

  -- Derive icon meanings for updated entries
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

  RETURN jsonb_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_google_maps_import(UUID) IS
'Process a staged Google Maps import, updating google_map_entries with icon data.';

-- ============================================================================
-- 3. View for Import History
-- ============================================================================
\echo 'Creating import history view...'

CREATE OR REPLACE VIEW trapper.v_google_maps_import_history AS
SELECT
  import_id,
  filename,
  upload_method,
  placemark_count,
  status,
  updated_count,
  inserted_count,
  not_matched_count,
  error_message,
  uploaded_by,
  uploaded_at,
  processed_at,
  EXTRACT(EPOCH FROM (processed_at - uploaded_at))::int as processing_seconds
FROM trapper.staged_google_maps_imports
ORDER BY uploaded_at DESC;

COMMENT ON VIEW trapper.v_google_maps_import_history IS
'History of Google Maps KMZ/KML imports with processing results.';

-- ============================================================================
-- Summary
-- ============================================================================
\echo ''
\echo '=== MIG_704 Complete ==='
\echo 'Created:'
\echo '  - staged_google_maps_imports table'
\echo '  - process_google_maps_import() function'
\echo '  - v_google_maps_import_history view'
\echo ''
\echo 'Ingest Flow:'
\echo '  1. Upload KMZ → Parse → Stage placemarks in staged_google_maps_imports'
\echo '  2. Call process_google_maps_import(import_id) to process'
\echo '  3. Updates google_map_entries with icon data'
