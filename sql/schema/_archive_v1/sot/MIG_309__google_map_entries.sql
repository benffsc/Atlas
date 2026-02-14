-- MIG_309: Google Map Entries - Unified KML Data with AI Summaries
--
-- Creates a unified table for all Google Maps KML data that provides:
--   1. AI-summarized notes for place detail context cards
--   2. Person context ("this person's location has this context")
--   3. Colony estimates for Beacon calculations
--   4. Orphaned entries for future matching
--
-- This consolidates matched records (from place_colony_estimates) and
-- unmatched records (from kml_pending_records) into one queryable system.
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_309__google_map_entries.sql

\echo ''
\echo '=============================================='
\echo 'MIG_309: Google Map Entries'
\echo '=============================================='
\echo ''

-- ============================================
-- 1. Create unified google_map_entries table
-- ============================================

\echo 'Creating google_map_entries table...'

CREATE TABLE IF NOT EXISTS trapper.google_map_entries (
    entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Original KML data
    kml_name TEXT,                      -- Placemark name from KML
    original_content TEXT,              -- Raw description/notes from KML
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    kml_folder TEXT,                    -- Folder path in KML

    -- Parsed data
    parsed_cat_count INTEGER,           -- Colony size mentioned
    parsed_altered_count INTEGER,       -- TNR count mentioned
    parsed_date DATE,                   -- Date mentioned in notes
    parsed_trapper TEXT,                -- Trapper name mentioned
    parsed_signals JSONB,               -- {has_kittens, has_feeders, etc.}

    -- AI Processing
    ai_summary TEXT,                    -- Professional summary preserving attribution
    ai_processed_at TIMESTAMPTZ,
    ai_confidence DOUBLE PRECISION,

    -- Place linking
    place_id UUID REFERENCES trapper.places(place_id),
    match_status TEXT NOT NULL DEFAULT 'unmatched'
        CHECK (match_status IN ('matched', 'uncertain', 'unmatched', 'manually_linked', 'no_match_possible')),
    match_distance_m DOUBLE PRECISION,  -- Distance when matched
    matched_at TIMESTAMPTZ,

    -- For uncertain/unmatched - track nearest for context
    nearest_place_id UUID REFERENCES trapper.places(place_id),
    nearest_place_distance_m DOUBLE PRECISION,

    -- Manual review
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,

    -- Provenance
    source_file TEXT DEFAULT 'FFSC Colonies and trapping assignments.kml',
    imported_at TIMESTAMPTZ DEFAULT NOW(),

    -- Deduplication
    UNIQUE (lat, lng, kml_name)
);

COMMENT ON TABLE trapper.google_map_entries IS
'Unified table for Google Maps KML data. Contains original content, AI summaries,
and place links. Shows as context cards on place/person detail pages.';

-- ============================================
-- 2. Indexes for efficient querying
-- ============================================

\echo 'Creating indexes...'

CREATE INDEX IF NOT EXISTS idx_gme_place_id
ON trapper.google_map_entries(place_id)
WHERE place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gme_match_status
ON trapper.google_map_entries(match_status);

CREATE INDEX IF NOT EXISTS idx_gme_needs_ai
ON trapper.google_map_entries(ai_processed_at)
WHERE ai_processed_at IS NULL AND original_content IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gme_coords
ON trapper.google_map_entries(lat, lng);

-- ============================================
-- 3. Migrate data from place_colony_estimates (matched records)
-- ============================================

\echo 'Migrating matched records from place_colony_estimates...'

INSERT INTO trapper.google_map_entries (
    kml_name,
    original_content,
    lat, lng,
    parsed_cat_count,
    parsed_altered_count,
    parsed_date,
    place_id,
    match_status,
    matched_at,
    imported_at
)
SELECT
    NULL, -- kml_name not stored in colony estimates
    pce.notes,
    ST_Y(p.location::geometry),
    ST_X(p.location::geometry),
    pce.total_cats,
    pce.altered_count,
    pce.observation_date,
    pce.place_id,
    'matched',
    pce.created_at,
    pce.created_at
FROM trapper.place_colony_estimates pce
JOIN trapper.places p ON p.place_id = pce.place_id
WHERE pce.source_type = 'legacy_mymaps'
  AND p.location IS NOT NULL
ON CONFLICT (lat, lng, kml_name) DO NOTHING;

-- ============================================
-- 4. Migrate data from kml_pending_records (unmatched records)
-- ============================================

\echo 'Migrating unmatched records from kml_pending_records...'

INSERT INTO trapper.google_map_entries (
    kml_name,
    original_content,
    lat, lng,
    kml_folder,
    parsed_cat_count,
    parsed_date,
    parsed_signals,
    ai_summary,
    ai_processed_at,
    ai_confidence,
    place_id,
    match_status,
    nearest_place_id,
    nearest_place_distance_m,
    reviewed_by,
    reviewed_at,
    review_notes,
    source_file,
    imported_at
)
SELECT
    kml_name,
    kml_description,
    lat, lng,
    kml_folder,
    parsed_cat_count,
    parsed_date,
    parsed_signals,
    ai_summary,
    ai_processed_at,
    ai_confidence,
    linked_place_id,  -- If manually linked, use that
    CASE
        WHEN linked_place_id IS NOT NULL THEN 'manually_linked'
        ELSE match_status
    END,
    nearest_place_id,
    nearest_place_distance_m,
    reviewed_by,
    reviewed_at,
    review_notes,
    source_file,
    imported_at
FROM trapper.kml_pending_records
ON CONFLICT (lat, lng, kml_name) DO NOTHING;

-- ============================================
-- 5. Create view for place context cards
-- ============================================

\echo 'Creating place context view...'

CREATE OR REPLACE VIEW trapper.v_place_google_map_context AS
SELECT
    gme.entry_id,
    gme.place_id,
    gme.kml_name,
    gme.original_content,
    gme.ai_summary,
    COALESCE(gme.ai_summary, gme.original_content) AS display_content,
    gme.ai_processed_at IS NOT NULL AS is_ai_summarized,
    gme.parsed_cat_count,
    gme.parsed_altered_count,
    gme.parsed_date,
    gme.parsed_trapper,
    gme.match_status,
    gme.matched_at,
    gme.imported_at,
    p.label AS place_name,
    p.formatted_address
FROM trapper.google_map_entries gme
JOIN trapper.places p ON p.place_id = gme.place_id
WHERE gme.place_id IS NOT NULL
ORDER BY gme.parsed_date DESC NULLS LAST, gme.imported_at DESC;

COMMENT ON VIEW trapper.v_place_google_map_context IS
'Google Map entries linked to places, for display as context cards on place detail pages.
Shows AI summary if available, otherwise original content.';

-- ============================================
-- 6. Create view for person context
-- ============================================

\echo 'Creating person context view...'

CREATE OR REPLACE VIEW trapper.v_person_place_google_context AS
SELECT
    ppr.person_id,
    ppr.place_id,
    ppr.relationship_type,
    p.label AS place_name,
    p.formatted_address,
    gme.entry_id,
    COALESCE(gme.ai_summary, LEFT(gme.original_content, 200)) AS context_preview,
    gme.parsed_cat_count,
    gme.ai_processed_at IS NOT NULL AS is_ai_summarized,
    gme.imported_at
FROM trapper.person_place_relationships ppr
JOIN trapper.places p ON p.place_id = ppr.place_id
JOIN trapper.google_map_entries gme ON gme.place_id = ppr.place_id
WHERE ppr.is_active = true
ORDER BY gme.imported_at DESC;

COMMENT ON VIEW trapper.v_person_place_google_context IS
'Google Map context for people via their place relationships.
Shows "this person''s location has this context" on person detail.';

-- ============================================
-- 7. Create view for review queue (unmatched entries)
-- ============================================

\echo 'Creating review queue view...'

CREATE OR REPLACE VIEW trapper.v_google_map_review_queue AS
SELECT
    gme.entry_id,
    gme.kml_name,
    LEFT(gme.original_content, 200) AS content_preview,
    gme.lat,
    gme.lng,
    gme.match_status,
    gme.nearest_place_distance_m,
    np.formatted_address AS nearest_place_address,
    np.label AS nearest_place_name,
    gme.parsed_cat_count,
    gme.ai_summary,
    gme.imported_at
FROM trapper.google_map_entries gme
LEFT JOIN trapper.places np ON np.place_id = gme.nearest_place_id
WHERE gme.match_status IN ('unmatched', 'uncertain')
  AND gme.place_id IS NULL
ORDER BY
    CASE gme.match_status
        WHEN 'uncertain' THEN 1  -- Review uncertain first (closer matches)
        WHEN 'unmatched' THEN 2
    END,
    gme.nearest_place_distance_m ASC NULLS LAST;

COMMENT ON VIEW trapper.v_google_map_review_queue IS
'Queue of Google Map entries needing manual review for place linking.';

-- ============================================
-- 8. Create function to link entry to place
-- ============================================

\echo 'Creating link function...'

CREATE OR REPLACE FUNCTION trapper.link_google_map_entry(
    p_entry_id UUID,
    p_place_id UUID,
    p_reviewed_by TEXT DEFAULT 'atlas_user',
    p_review_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_entry RECORD;
BEGIN
    -- Get the entry
    SELECT * INTO v_entry
    FROM trapper.google_map_entries
    WHERE entry_id = p_entry_id;

    IF v_entry IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Entry not found');
    END IF;

    IF v_entry.place_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Already linked to a place');
    END IF;

    -- Update the entry
    UPDATE trapper.google_map_entries
    SET
        place_id = p_place_id,
        match_status = 'manually_linked',
        matched_at = NOW(),
        reviewed_by = p_reviewed_by,
        reviewed_at = NOW(),
        review_notes = p_review_notes
    WHERE entry_id = p_entry_id;

    -- Also create a colony estimate if we have count data
    IF v_entry.parsed_cat_count IS NOT NULL THEN
        INSERT INTO trapper.place_colony_estimates (
            place_id,
            total_cats,
            altered_count,
            notes,
            observation_date,
            source_type,
            source_system,
            source_record_id,
            is_firsthand,
            created_by
        ) VALUES (
            p_place_id,
            v_entry.parsed_cat_count,
            v_entry.parsed_altered_count,
            CONCAT(
                'From Google Maps: ',
                COALESCE(v_entry.ai_summary, LEFT(v_entry.original_content, 300))
            ),
            COALESCE(v_entry.parsed_date, CURRENT_DATE),
            'legacy_mymaps',
            'legacy_kml',
            v_entry.entry_id::TEXT,
            FALSE,
            p_reviewed_by
        )
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'entry_id', p_entry_id,
        'place_id', p_place_id
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_google_map_entry IS
'Manually links a Google Map entry to a place, optionally creating a colony estimate.';

-- ============================================
-- 9. Create function for AI to update summaries
-- ============================================

\echo 'Creating AI summary function...'

CREATE OR REPLACE FUNCTION trapper.update_google_map_ai_summary(
    p_entry_id UUID,
    p_ai_summary TEXT,
    p_ai_confidence DOUBLE PRECISION DEFAULT 0.8
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE trapper.google_map_entries
    SET
        ai_summary = p_ai_summary,
        ai_processed_at = NOW(),
        ai_confidence = p_ai_confidence
    WHERE entry_id = p_entry_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.update_google_map_ai_summary IS
'Updates a Google Map entry with an AI-generated professional summary.';

-- ============================================
-- 10. Create function to match entry when place is created
-- ============================================

\echo 'Creating auto-match function...'

CREATE OR REPLACE FUNCTION trapper.try_match_google_map_entries_to_place(
    p_place_id UUID
)
RETURNS INTEGER AS $$
DECLARE
    v_place RECORD;
    v_matched INTEGER := 0;
BEGIN
    -- Get place location
    SELECT
        place_id,
        ST_Y(location::geometry) as lat,
        ST_X(location::geometry) as lng
    INTO v_place
    FROM trapper.places
    WHERE place_id = p_place_id
      AND location IS NOT NULL;

    IF v_place IS NULL THEN
        RETURN 0;
    END IF;

    -- Match any unmatched entries within 50m
    UPDATE trapper.google_map_entries
    SET
        place_id = p_place_id,
        match_status = 'matched',
        match_distance_m = (
            6371000 * acos(
                cos(radians(lat)) * cos(radians(v_place.lat)) *
                cos(radians(v_place.lng) - radians(lng)) +
                sin(radians(lat)) * sin(radians(v_place.lat))
            )
        ),
        matched_at = NOW()
    WHERE match_status IN ('unmatched', 'uncertain')
      AND place_id IS NULL
      AND (
          6371000 * acos(
              cos(radians(lat)) * cos(radians(v_place.lat)) *
              cos(radians(v_place.lng) - radians(lng)) +
              sin(radians(lat)) * sin(radians(v_place.lat))
          )
      ) <= 50;  -- 50 meter threshold

    GET DIAGNOSTICS v_matched = ROW_COUNT;
    RETURN v_matched;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.try_match_google_map_entries_to_place IS
'Attempts to match orphaned Google Map entries to a newly created place within 50m.
Call this when a new place is created to automatically link nearby historical data.';

-- ============================================
-- 11. Summary
-- ============================================

\echo ''
\echo '=============================================='
\echo 'MIG_309 Complete!'
\echo ''

SELECT
    match_status,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE ai_summary IS NOT NULL) as with_ai_summary,
    COUNT(*) FILTER (WHERE original_content IS NOT NULL) as with_content
FROM trapper.google_map_entries
GROUP BY match_status
ORDER BY match_status;

\echo ''
\echo 'Created:'
\echo '  - google_map_entries table (unified KML data)'
\echo '  - v_place_google_map_context view (place detail cards)'
\echo '  - v_person_place_google_context view (person context)'
\echo '  - v_google_map_review_queue view (review queue)'
\echo '  - link_google_map_entry() function'
\echo '  - update_google_map_ai_summary() function'
\echo '  - try_match_google_map_entries_to_place() function'
\echo ''
\echo 'Next steps:'
\echo '  1. Add API endpoint for place Google Map context'
\echo '  2. Add context card to place detail UI'
\echo '  3. Add context preview to person detail UI'
\echo '  4. Create AI summarization job for original_content'
\echo '=============================================='
\echo ''
