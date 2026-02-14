-- MIG_321: Unified Entity Media
--
-- Extends request_media table to support direct uploads to cats and places.
-- Makes request_id nullable and adds place_id and direct_cat_id columns.
--
-- This enables a unified media system where photos can be attached to:
-- - Requests (existing behavior)
-- - Cats (direct_cat_id - for photos uploaded directly to a cat profile)
-- - Places (place_id - for site/location photos)
--
-- Note: linked_cat_id remains for associating request photos with identified cats.
--       direct_cat_id is for photos uploaded directly to a cat's profile.
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_321__unified_entity_media.sql

\echo ''
\echo '=============================================='
\echo 'MIG_321: Unified Entity Media'
\echo '=============================================='
\echo ''

-- ============================================
-- 1. Make request_id nullable
-- ============================================

\echo 'Making request_id nullable...'

-- First drop any NOT NULL constraint on request_id
ALTER TABLE trapper.request_media
  ALTER COLUMN request_id DROP NOT NULL;

-- ============================================
-- 2. Add entity link columns
-- ============================================

\echo 'Adding entity link columns...'

-- Add place_id for place photos
ALTER TABLE trapper.request_media
  ADD COLUMN IF NOT EXISTS place_id UUID REFERENCES trapper.places(place_id) ON DELETE SET NULL;

-- Add direct_cat_id for photos uploaded directly to cats
-- (distinct from linked_cat_id which is for identifying cats in request photos)
ALTER TABLE trapper.request_media
  ADD COLUMN IF NOT EXISTS direct_cat_id UUID REFERENCES trapper.sot_cats(cat_id) ON DELETE SET NULL;

-- ============================================
-- 3. Add constraint ensuring at least one entity link
-- ============================================

\echo 'Adding entity constraint...'

-- Drop constraint if it exists (for idempotency)
ALTER TABLE trapper.request_media
  DROP CONSTRAINT IF EXISTS media_must_have_entity;

-- At least one entity must be linked
ALTER TABLE trapper.request_media
  ADD CONSTRAINT media_must_have_entity
  CHECK (request_id IS NOT NULL OR place_id IS NOT NULL OR direct_cat_id IS NOT NULL);

-- ============================================
-- 4. Add indexes for entity lookups
-- ============================================

\echo 'Creating indexes...'

CREATE INDEX IF NOT EXISTS idx_media_place
  ON trapper.request_media(place_id)
  WHERE place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_direct_cat
  ON trapper.request_media(direct_cat_id)
  WHERE direct_cat_id IS NOT NULL;

-- ============================================
-- 5. Add helper function to get media for any entity
-- ============================================

\echo 'Creating helper function...'

CREATE OR REPLACE FUNCTION trapper.get_entity_media(
  p_entity_type TEXT,
  p_entity_id UUID
)
RETURNS TABLE (
  media_id UUID,
  media_type TEXT,
  original_filename TEXT,
  storage_path TEXT,
  caption TEXT,
  cat_description TEXT,
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.media_id,
    m.media_type::TEXT,
    m.original_filename,
    m.storage_path,
    m.caption,
    m.cat_description,
    m.uploaded_by,
    m.uploaded_at
  FROM trapper.request_media m
  WHERE NOT m.is_archived
    AND (
      (p_entity_type = 'request' AND m.request_id = p_entity_id)
      OR (p_entity_type = 'place' AND m.place_id = p_entity_id)
      OR (p_entity_type = 'cat' AND (m.direct_cat_id = p_entity_id OR m.linked_cat_id = p_entity_id))
    )
  ORDER BY m.uploaded_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.get_entity_media IS
'Get all media for an entity (request, place, or cat). For cats, includes both direct uploads and linked photos from requests.';

-- ============================================
-- 6. Create view for cat media (combines direct and linked)
-- ============================================

\echo 'Creating cat media view...'

CREATE OR REPLACE VIEW trapper.v_cat_media AS
SELECT
  COALESCE(m.direct_cat_id, m.linked_cat_id) AS cat_id,
  m.media_id,
  m.media_type::TEXT,
  m.original_filename,
  m.storage_path,
  m.caption,
  m.cat_description,
  m.uploaded_by,
  m.uploaded_at,
  CASE
    WHEN m.direct_cat_id IS NOT NULL THEN 'direct'
    ELSE 'linked'
  END AS source_type,
  m.request_id AS source_request_id
FROM trapper.request_media m
WHERE NOT m.is_archived
  AND (m.direct_cat_id IS NOT NULL OR m.linked_cat_id IS NOT NULL);

COMMENT ON VIEW trapper.v_cat_media IS
'All media for cats, combining direct uploads (to cat profile) and linked photos (from requests).';

-- ============================================
-- 7. Summary
-- ============================================

\echo ''
\echo 'Schema changes applied:'

SELECT
  'request_media columns' AS info,
  COUNT(*) AS count
FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'request_media';

\echo ''
\echo 'New columns:'
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'trapper'
  AND table_name = 'request_media'
  AND column_name IN ('place_id', 'direct_cat_id', 'request_id')
ORDER BY column_name;

\echo ''
\echo '=============================================='
\echo 'MIG_321 Complete!'
\echo ''
\echo 'Changes:'
\echo '  - request_id is now nullable'
\echo '  - Added place_id for place photos'
\echo '  - Added direct_cat_id for cat profile photos'
\echo '  - Added constraint: at least one entity must be linked'
\echo '  - Added get_entity_media() function'
\echo '  - Added v_cat_media view'
\echo ''
\echo 'The media system now supports uploads to:'
\echo '  - Requests (existing)'
\echo '  - Places (new)'
\echo '  - Cats (new)'
\echo '=============================================='
\echo ''
