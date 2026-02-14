\echo '=== MIG_825: Staff Map Points — Annotations & atlas_ui support ==='
\echo 'Adds atlas_ui data source and place_origin for staff-created places.'
\echo 'Creates map_annotations table for lightweight operational map notes.'
\echo ''

-- ============================================================================
-- A. Add atlas_ui to data_source enum
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'trapper.data_source'::regtype
      AND enumlabel = 'atlas_ui'
  ) THEN
    ALTER TYPE trapper.data_source ADD VALUE 'atlas_ui';
  END IF;
END $$;

\echo 'Added atlas_ui to data_source enum'

-- ============================================================================
-- B. Add atlas_ui to place_origin check constraint
-- ============================================================================

ALTER TABLE trapper.places DROP CONSTRAINT IF EXISTS places_place_origin_check;
ALTER TABLE trapper.places ADD CONSTRAINT places_place_origin_check
  CHECK (place_origin = ANY (ARRAY[
    'geocoded', 'manual', 'atlas', 'auto_parent', 'google_maps', 'atlas_ui'
  ]));

\echo 'Updated place_origin check constraint'

-- ============================================================================
-- C. Create map_annotations table
--
-- Lightweight operational map notes for staff. NOT places — separate system.
-- Used for: colony sightings, trap locations, hazards, feeding sites, general notes.
-- Optional photo (Supabase URL) and expiry (auto-hides after date).
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.map_annotations (
    annotation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location GEOGRAPHY(Point, 4326) NOT NULL,
    label TEXT NOT NULL CHECK (length(label) > 0 AND length(label) <= 100),
    note TEXT CHECK (note IS NULL OR length(note) <= 2000),
    photo_url TEXT,
    annotation_type TEXT NOT NULL DEFAULT 'general'
        CHECK (annotation_type IN (
          'general', 'colony_sighting', 'trap_location',
          'hazard', 'feeding_site', 'other'
        )),
    created_by TEXT NOT NULL DEFAULT 'staff',
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spatial index for map viewport queries
CREATE INDEX IF NOT EXISTS idx_map_annotations_location
  ON trapper.map_annotations USING GIST (location);

-- Partial index for active annotations (most queries filter on this)
CREATE INDEX IF NOT EXISTS idx_map_annotations_active
  ON trapper.map_annotations (is_active) WHERE is_active = TRUE;

COMMENT ON TABLE trapper.map_annotations IS
  'Lightweight operational map notes placed by staff. NOT places — separate system. '
  'Used for colony sightings, trap locations, hazards, feeding sites, general notes. '
  'Optional photo (Supabase URL) and expiry (auto-hides after date).';

\echo 'Created map_annotations table'

-- ============================================================================
-- D. Updated_at trigger (reuse existing function)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_map_annotations_updated_at'
      AND tgrelid = 'trapper.map_annotations'::regclass
  ) THEN
    CREATE TRIGGER set_map_annotations_updated_at
      BEFORE UPDATE ON trapper.map_annotations
      FOR EACH ROW EXECUTE FUNCTION trapper.staff_update_timestamp();
  END IF;
END $$;

\echo 'Created updated_at trigger'

-- ============================================================================
-- Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='

\echo 'data_source enum values:'
SELECT enumlabel FROM pg_enum
WHERE enumtypid = 'trapper.data_source'::regtype
ORDER BY enumsortorder;

\echo ''
\echo 'place_origin constraint:'
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'trapper.places'::regclass
  AND conname = 'places_place_origin_check';

\echo ''
\echo 'map_annotations table:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'map_annotations'
ORDER BY ordinal_position;

\echo ''
\echo '=== MIG_825 Complete ==='
