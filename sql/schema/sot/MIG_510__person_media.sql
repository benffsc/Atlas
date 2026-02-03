-- MIG_510: Person Media Support
--
-- Extends request_media table to support direct uploads to people.
-- Adds person_id column and updates the entity constraint.
-- Completes the unified media system: request, cat, place, person.
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_510__person_media.sql

\echo ''
\echo '=============================================='
\echo 'MIG_510: Person Media Support'
\echo '=============================================='
\echo ''

-- ============================================
-- 1. Add person_id column
-- ============================================

\echo 'Adding person_id column...'

ALTER TABLE trapper.request_media
  ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES trapper.sot_people(person_id) ON DELETE SET NULL;

-- ============================================
-- 2. Update entity constraint
-- ============================================

\echo 'Updating entity constraint...'

ALTER TABLE trapper.request_media
  DROP CONSTRAINT IF EXISTS media_must_have_entity;

ALTER TABLE trapper.request_media
  ADD CONSTRAINT media_must_have_entity
  CHECK (request_id IS NOT NULL OR place_id IS NOT NULL OR direct_cat_id IS NOT NULL OR person_id IS NOT NULL);

-- ============================================
-- 3. Add index for person lookups
-- ============================================

\echo 'Creating person media index...'

CREATE INDEX IF NOT EXISTS idx_media_person
  ON trapper.request_media(person_id)
  WHERE person_id IS NOT NULL;

-- ============================================
-- 4. Update get_entity_media() to support person
-- ============================================

\echo 'Updating get_entity_media function...'

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
      OR (p_entity_type = 'person' AND m.person_id = p_entity_id)
    )
  ORDER BY m.uploaded_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.get_entity_media IS
'Get all media for an entity (request, place, cat, or person). For cats, includes both direct uploads and linked photos from requests.';

-- ============================================
-- 5. Summary
-- ============================================

\echo ''
\echo '=============================================='
\echo 'MIG_510 Complete!'
\echo ''
\echo 'Changes:'
\echo '  - Added person_id column to request_media'
\echo '  - Updated entity constraint to include person_id'
\echo '  - Added idx_media_person index'
\echo '  - Updated get_entity_media() to support person type'
\echo ''
\echo 'The media system now supports uploads to:'
\echo '  - Requests (existing)'
\echo '  - Places (existing)'
\echo '  - Cats (existing)'
\echo '  - People (new)'
\echo '=============================================='
\echo ''
