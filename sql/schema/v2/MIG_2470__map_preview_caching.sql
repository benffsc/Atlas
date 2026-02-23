-- MIG_2470: Map Preview Caching
--
-- Adds columns to cache map preview URLs for requests.
-- Enables faster page loads and rolling refresh via cron.
--
-- Created: 2026-02-23

\echo ''
\echo '=============================================='
\echo '  MIG_2470: Map Preview Caching'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. ADD COLUMNS TO ops.requests
-- ============================================================================

\echo '1. Adding map preview columns to ops.requests...'

ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS map_preview_url TEXT,
ADD COLUMN IF NOT EXISTS map_preview_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN ops.requests.map_preview_url IS 'Cached Google Static Maps URL for this request location';
COMMENT ON COLUMN ops.requests.map_preview_updated_at IS 'When the map preview was last generated';

-- ============================================================================
-- 2. CREATE INDEX FOR STALE PREVIEW LOOKUP
-- ============================================================================

\echo '2. Creating index for map preview refresh queue...'

CREATE INDEX IF NOT EXISTS idx_requests_map_preview_stale
ON ops.requests (request_id)
WHERE map_preview_url IS NULL
   OR map_preview_updated_at IS NULL
   OR map_preview_updated_at < NOW() - INTERVAL '7 days';

-- ============================================================================
-- 3. CREATE FUNCTION TO GET MAP PREVIEW QUEUE
-- ============================================================================

\echo '3. Creating ops.get_map_preview_queue() function...'

CREATE OR REPLACE FUNCTION ops.get_map_preview_queue(
    p_limit INT DEFAULT 50,
    p_max_age_hours INT DEFAULT 168  -- 7 days default
)
RETURNS TABLE (
    request_id UUID,
    place_id UUID,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    summary TEXT,
    current_preview_url TEXT,
    preview_age_hours DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.request_id,
        r.place_id,
        ST_Y(p.location::geometry) as latitude,
        ST_X(p.location::geometry) as longitude,
        r.summary,
        r.map_preview_url as current_preview_url,
        (EXTRACT(EPOCH FROM (NOW() - r.map_preview_updated_at)) / 3600)::DOUBLE PRECISION as preview_age_hours
    FROM ops.requests r
    JOIN sot.places p ON r.place_id = p.place_id
    WHERE p.location IS NOT NULL
      AND r.status NOT IN ('completed', 'cancelled')
      AND (
          r.map_preview_url IS NULL
          OR r.map_preview_updated_at IS NULL
          OR r.map_preview_updated_at < NOW() - (p_max_age_hours || ' hours')::INTERVAL
      )
    ORDER BY
        -- Prioritize: no preview > stale preview
        CASE WHEN r.map_preview_url IS NULL THEN 0 ELSE 1 END,
        -- Then by status (active requests first)
        CASE r.status
            WHEN 'in_progress' THEN 1
            WHEN 'scheduled' THEN 2
            WHEN 'triaged' THEN 3
            WHEN 'new' THEN 4
            WHEN 'on_hold' THEN 5
            ELSE 6
        END,
        r.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.get_map_preview_queue IS
'Returns requests needing map preview generation/refresh. Prioritizes active requests without previews.';

-- ============================================================================
-- 4. CREATE FUNCTION TO RECORD MAP PREVIEW
-- ============================================================================

\echo '4. Creating ops.record_map_preview() function...'

CREATE OR REPLACE FUNCTION ops.record_map_preview(
    p_request_id UUID,
    p_map_url TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE ops.requests
    SET map_preview_url = p_map_url,
        map_preview_updated_at = NOW()
    WHERE request_id = p_request_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.record_map_preview IS
'Records a generated map preview URL for a request.';

-- ============================================================================
-- 5. GRANT PERMISSIONS
-- ============================================================================

\echo '5. Granting permissions...'

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT EXECUTE ON FUNCTION ops.get_map_preview_queue TO service_role;
        GRANT EXECUTE ON FUNCTION ops.record_map_preview TO service_role;
    END IF;
END $$;

-- ============================================================================
-- 6. VERIFICATION
-- ============================================================================

\echo ''
\echo '6. Verification...'

-- Check columns exist
DO $$
BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'ops' AND table_name = 'requests'
        AND column_name = 'map_preview_url'
    ), 'map_preview_url column not found';

    ASSERT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'ops' AND table_name = 'requests'
        AND column_name = 'map_preview_updated_at'
    ), 'map_preview_updated_at column not found';

    RAISE NOTICE 'Columns verified';
END $$;

-- Show queue stats
\echo ''
\echo 'Map preview queue status:'
SELECT
    COUNT(*) FILTER (WHERE map_preview_url IS NULL) as no_preview,
    COUNT(*) FILTER (WHERE map_preview_url IS NOT NULL AND map_preview_updated_at < NOW() - INTERVAL '7 days') as stale_preview,
    COUNT(*) FILTER (WHERE map_preview_url IS NOT NULL AND map_preview_updated_at >= NOW() - INTERVAL '7 days') as fresh_preview
FROM ops.requests r
JOIN sot.places p ON r.place_id = p.place_id
WHERE p.location IS NOT NULL
  AND r.status NOT IN ('completed', 'cancelled');

\echo ''
\echo '=============================================='
\echo '  MIG_2470 COMPLETE'
\echo '=============================================='
\echo ''
