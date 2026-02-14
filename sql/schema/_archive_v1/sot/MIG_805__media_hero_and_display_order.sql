\echo '=== MIG_805: Media hero image and display order ==='
\echo 'Adds display_order and is_hero columns to request_media for gallery layouts.'

-- display_order for controlling gallery arrangement
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'request_media' AND column_name = 'display_order'
  ) THEN
    ALTER TABLE trapper.request_media ADD COLUMN display_order INT DEFAULT 0;
  END IF;
END $$;

-- is_hero for marking the main/cover photo
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'request_media' AND column_name = 'is_hero'
  ) THEN
    ALTER TABLE trapper.request_media ADD COLUMN is_hero BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- One hero per place
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_hero_place
  ON trapper.request_media(place_id)
  WHERE is_hero = TRUE AND place_id IS NOT NULL AND is_archived = FALSE;

-- One hero per request
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_hero_request
  ON trapper.request_media(request_id)
  WHERE is_hero = TRUE AND is_archived = FALSE;

COMMENT ON COLUMN trapper.request_media.display_order IS 'Controls order in gallery views (0 = default)';
COMMENT ON COLUMN trapper.request_media.is_hero IS 'Main/cover photo for the entity (one per place, one per request)';

\echo '=== MIG_805 complete ==='
