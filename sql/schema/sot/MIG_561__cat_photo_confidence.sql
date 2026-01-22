-- ============================================================================
-- MIG_561: Cat Photo Confidence and Grouping
-- ============================================================================
-- Enhances request_media for multi-cat photo workflows:
-- 1. Confidence level when identifying cats in photos
-- 2. Photo grouping (same unknown cat before identification)
-- ============================================================================

\echo '=== MIG_561: Cat Photo Confidence and Grouping ==='

BEGIN;

-- ============================================================================
-- 1. ADD CONFIDENCE COLUMN
-- ============================================================================
-- Tracks how certain we are that a photo shows a specific cat

ALTER TABLE trapper.request_media
ADD COLUMN IF NOT EXISTS cat_identification_confidence TEXT
  CHECK (cat_identification_confidence IN ('confirmed', 'likely', 'uncertain', 'unidentified'))
  DEFAULT 'unidentified';

COMMENT ON COLUMN trapper.request_media.cat_identification_confidence IS
'Confidence level when linking photo to cat: confirmed (verified match), likely (probably same cat), uncertain (might be), unidentified (cat not yet identified)';

-- ============================================================================
-- 2. ADD PHOTO GROUP COLUMN
-- ============================================================================
-- Links photos to a media_collection representing "same unknown cat"
-- Uses existing media_collections table but with direct FK for simpler queries

ALTER TABLE trapper.request_media
ADD COLUMN IF NOT EXISTS photo_group_id UUID
  REFERENCES trapper.media_collections(collection_id) ON DELETE SET NULL;

COMMENT ON COLUMN trapper.request_media.photo_group_id IS
'Groups photos of the same unknown cat before identification. References media_collections.';

CREATE INDEX IF NOT EXISTS idx_media_photo_group
  ON trapper.request_media(photo_group_id) WHERE photo_group_id IS NOT NULL;

-- ============================================================================
-- 3. VIEW: REQUEST PHOTO GROUPS
-- ============================================================================
-- Aggregates photos by group for easy querying

CREATE OR REPLACE VIEW trapper.v_request_photo_groups AS
SELECT
  mc.collection_id,
  mc.request_id,
  mc.name AS group_name,
  mc.description AS group_description,
  mc.created_by,
  mc.created_at,
  COUNT(rm.media_id) AS photo_count,
  ARRAY_AGG(rm.media_id ORDER BY rm.uploaded_at) FILTER (WHERE rm.media_id IS NOT NULL) AS media_ids,
  ARRAY_AGG(rm.storage_path ORDER BY rm.uploaded_at) FILTER (WHERE rm.storage_path IS NOT NULL) AS storage_paths,
  MAX(rm.cat_description) AS cat_description,
  MAX(rm.cat_identification_confidence) AS max_confidence,
  -- If any photo is linked to a cat, show that
  (ARRAY_AGG(rm.linked_cat_id ORDER BY rm.uploaded_at) FILTER (WHERE rm.linked_cat_id IS NOT NULL))[1] AS linked_cat_id
FROM trapper.media_collections mc
LEFT JOIN trapper.request_media rm
  ON rm.photo_group_id = mc.collection_id
  AND NOT COALESCE(rm.is_archived, FALSE)
GROUP BY mc.collection_id, mc.request_id, mc.name, mc.description, mc.created_by, mc.created_at;

COMMENT ON VIEW trapper.v_request_photo_groups IS
'Aggregated view of photo groups with counts, paths, and cat linkage';

-- ============================================================================
-- 4. FUNCTION: CREATE PHOTO GROUP
-- ============================================================================
-- Creates a new photo group and optionally assigns media to it

CREATE OR REPLACE FUNCTION trapper.create_photo_group(
  p_request_id UUID,
  p_group_name TEXT,
  p_created_by TEXT,
  p_media_ids UUID[] DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_collection_id UUID;
BEGIN
  -- Create the collection
  INSERT INTO trapper.media_collections (
    request_id, name, description, created_by
  ) VALUES (
    p_request_id, p_group_name, p_description, p_created_by
  )
  RETURNING collection_id INTO v_collection_id;

  -- Assign media if provided
  IF p_media_ids IS NOT NULL AND array_length(p_media_ids, 1) > 0 THEN
    UPDATE trapper.request_media
    SET photo_group_id = v_collection_id
    WHERE media_id = ANY(p_media_ids)
      AND request_id = p_request_id;
  END IF;

  RETURN v_collection_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_photo_group IS
'Creates a photo group (media_collection) and optionally assigns media to it';

-- ============================================================================
-- 5. FUNCTION: ASSIGN PHOTOS TO GROUP
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.assign_photos_to_group(
  p_collection_id UUID,
  p_media_ids UUID[]
)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE trapper.request_media
  SET photo_group_id = p_collection_id
  WHERE media_id = ANY(p_media_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6. FUNCTION: IDENTIFY GROUP (link to cat)
-- ============================================================================
-- Links all photos in a group to a cat with confidence level

CREATE OR REPLACE FUNCTION trapper.identify_photo_group(
  p_collection_id UUID,
  p_cat_id UUID,
  p_confidence TEXT DEFAULT 'confirmed',
  p_identified_by TEXT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Validate confidence
  IF p_confidence NOT IN ('confirmed', 'likely', 'uncertain') THEN
    RAISE EXCEPTION 'Invalid confidence level: %. Must be confirmed, likely, or uncertain.', p_confidence;
  END IF;

  -- Update all photos in the group
  UPDATE trapper.request_media
  SET
    linked_cat_id = p_cat_id,
    cat_identification_confidence = p_confidence
  WHERE photo_group_id = p_collection_id
    AND NOT COALESCE(is_archived, FALSE);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.identify_photo_group IS
'Links all photos in a group to a cat record with specified confidence level';

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo 'New columns added:'
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'trapper'
  AND table_name = 'request_media'
  AND column_name IN ('cat_identification_confidence', 'photo_group_id');

\echo ''
\echo 'View created:'
SELECT viewname FROM pg_views WHERE schemaname = 'trapper' AND viewname = 'v_request_photo_groups';

\echo ''
\echo 'Functions created:'
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name IN ('create_photo_group', 'assign_photos_to_group', 'identify_photo_group');

\echo ''
\echo '=== MIG_561 Complete ==='
