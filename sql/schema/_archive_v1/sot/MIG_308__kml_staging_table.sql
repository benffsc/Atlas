-- MIG_308: KML Staging Table for Unmatched Records
--
-- Creates a staging table to preserve Google Maps KML data that couldn't
-- be confidently matched to existing places. This preserves valuable
-- qualitative data (notes, descriptions) for:
--   1. Manual review and linking
--   2. Future AI summarization
--   3. Beacon map visualization
--
-- The mission contract principle: Every entity is real and distinct.
-- We don't create places from coordinates alone (would pollute data),
-- but we preserve the qualitative context for future use.
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_308__kml_staging_table.sql

\echo ''
\echo '=============================================='
\echo 'MIG_308: KML Staging Table'
\echo '=============================================='
\echo ''

-- ============================================
-- 1. Create staging table for unmatched KML records
-- ============================================

\echo 'Creating kml_pending_records table...'

CREATE TABLE IF NOT EXISTS trapper.kml_pending_records (
    pending_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Original KML data
    kml_name TEXT,                    -- Placemark name from KML
    kml_description TEXT,             -- Rich qualitative description
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    kml_folder TEXT,                  -- Folder path in KML (e.g., "Santa Rosa/West Side")

    -- Parsed data (extracted from description)
    parsed_cat_count INTEGER,         -- If mentioned in description
    parsed_altered_count INTEGER,     -- If mentioned
    parsed_date DATE,                 -- If date mentioned
    parsed_signals JSONB,             -- {has_kittens, has_feeders, etc.}

    -- Matching status
    match_status TEXT NOT NULL DEFAULT 'unmatched'
        CHECK (match_status IN ('unmatched', 'uncertain', 'matched', 'no_match_possible', 'manually_linked')),
    nearest_place_id UUID REFERENCES trapper.places(place_id),
    nearest_place_distance_m DOUBLE PRECISION,  -- Distance to nearest place

    -- AI processing
    ai_summary TEXT,                  -- Claude summary of qualitative content
    ai_processed_at TIMESTAMPTZ,
    ai_confidence DOUBLE PRECISION,   -- How confident AI is in summary

    -- Manual review
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    linked_place_id UUID REFERENCES trapper.places(place_id),  -- If manually linked

    -- Provenance
    source_file TEXT,
    source_folder TEXT,
    imported_at TIMESTAMPTZ DEFAULT NOW(),

    -- Don't import same record twice
    UNIQUE (lat, lng, kml_name)
);

COMMENT ON TABLE trapper.kml_pending_records IS
'Staging table for Google Maps KML data that could not be confidently matched to existing places.
Preserves qualitative notes and coordinates for manual review, AI summarization, and Beacon visualization.';

-- ============================================
-- 2. Add indexes for efficient querying
-- ============================================

\echo 'Creating indexes...'

CREATE INDEX IF NOT EXISTS idx_kml_pending_status
ON trapper.kml_pending_records(match_status);

CREATE INDEX IF NOT EXISTS idx_kml_pending_coords
ON trapper.kml_pending_records(lat, lng);

CREATE INDEX IF NOT EXISTS idx_kml_pending_nearest_place
ON trapper.kml_pending_records(nearest_place_id)
WHERE nearest_place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kml_pending_linked_place
ON trapper.kml_pending_records(linked_place_id)
WHERE linked_place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kml_pending_unprocessed
ON trapper.kml_pending_records(ai_processed_at)
WHERE ai_processed_at IS NULL AND match_status != 'no_match_possible';

-- ============================================
-- 3. Create view for review queue
-- ============================================

\echo 'Creating review queue view...'

CREATE OR REPLACE VIEW trapper.v_kml_review_queue AS
SELECT
    kr.pending_id,
    kr.kml_name,
    LEFT(kr.kml_description, 200) AS description_preview,
    kr.lat,
    kr.lng,
    kr.match_status,
    kr.nearest_place_distance_m,
    p.formatted_address AS nearest_place_address,
    kr.parsed_cat_count,
    kr.ai_summary,
    kr.imported_at
FROM trapper.kml_pending_records kr
LEFT JOIN trapper.places p ON p.place_id = kr.nearest_place_id
WHERE kr.match_status IN ('unmatched', 'uncertain')
  AND kr.linked_place_id IS NULL
ORDER BY
    CASE kr.match_status
        WHEN 'uncertain' THEN 1  -- Review uncertain first
        WHEN 'unmatched' THEN 2
    END,
    kr.nearest_place_distance_m ASC NULLS LAST;

COMMENT ON VIEW trapper.v_kml_review_queue IS
'Queue of KML records needing manual review for place linking. Ordered by review priority.';

-- ============================================
-- 4. Create function to link pending record to place
-- ============================================

\echo 'Creating link function...'

CREATE OR REPLACE FUNCTION trapper.link_kml_to_place(
    p_pending_id UUID,
    p_place_id UUID,
    p_reviewed_by TEXT DEFAULT 'atlas_user',
    p_review_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_pending RECORD;
    v_estimate_id UUID;
BEGIN
    -- Get the pending record
    SELECT * INTO v_pending
    FROM trapper.kml_pending_records
    WHERE pending_id = p_pending_id;

    IF v_pending IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pending record not found');
    END IF;

    IF v_pending.linked_place_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Already linked to a place');
    END IF;

    -- Update the pending record
    UPDATE trapper.kml_pending_records
    SET
        match_status = 'manually_linked',
        linked_place_id = p_place_id,
        reviewed_by = p_reviewed_by,
        reviewed_at = NOW(),
        review_notes = p_review_notes
    WHERE pending_id = p_pending_id;

    -- Create colony estimate from the KML data
    INSERT INTO trapper.place_colony_estimates (
        place_id,
        total_cats,
        notes,
        observation_date,
        source_type,
        source_system,
        source_record_id,
        is_firsthand,
        created_by
    ) VALUES (
        p_place_id,
        v_pending.parsed_cat_count,
        CONCAT(
            'Historical Google Maps note: ',
            COALESCE(v_pending.kml_description, v_pending.kml_name),
            CASE WHEN v_pending.ai_summary IS NOT NULL
                 THEN E'\n\nAI Summary: ' || v_pending.ai_summary
                 ELSE ''
            END
        ),
        COALESCE(v_pending.parsed_date, CURRENT_DATE),
        'legacy_mymaps',
        'legacy_kml',
        v_pending.pending_id::TEXT,
        FALSE,  -- Not firsthand, it's historical data
        p_reviewed_by
    )
    RETURNING estimate_id INTO v_estimate_id;

    RETURN jsonb_build_object(
        'success', true,
        'pending_id', p_pending_id,
        'place_id', p_place_id,
        'estimate_id', v_estimate_id
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_kml_to_place IS
'Manually links a pending KML record to a place, creating a colony estimate with the qualitative data.';

-- ============================================
-- 5. Create function for AI to process pending records
-- ============================================

\echo 'Creating AI processing function...'

CREATE OR REPLACE FUNCTION trapper.update_kml_ai_summary(
    p_pending_id UUID,
    p_ai_summary TEXT,
    p_ai_confidence DOUBLE PRECISION DEFAULT 0.7
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE trapper.kml_pending_records
    SET
        ai_summary = p_ai_summary,
        ai_processed_at = NOW(),
        ai_confidence = p_ai_confidence
    WHERE pending_id = p_pending_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.update_kml_ai_summary IS
'Updates a pending KML record with an AI-generated summary of the qualitative content.';

-- ============================================
-- 6. Summary
-- ============================================

\echo ''
\echo '=============================================='
\echo 'MIG_308 Complete!'
\echo ''
\echo 'Created:'
\echo '  - kml_pending_records table (staging for unmatched KML data)'
\echo '  - v_kml_review_queue view (for manual review)'
\echo '  - link_kml_to_place() function (manual linking)'
\echo '  - update_kml_ai_summary() function (AI processing)'
\echo ''
\echo 'Next steps:'
\echo '  1. Update mymaps_kml_import.mjs to insert unmatched records here'
\echo '  2. Create API endpoint for manual review UI'
\echo '  3. Create AI summarization job for qualitative content'
\echo '=============================================='
\echo ''
