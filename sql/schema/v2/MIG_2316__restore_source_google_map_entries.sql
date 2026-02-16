-- MIG_2316: Restore source.google_map_entries Table
-- Date: 2026-02-16
--
-- Purpose: Restore the source-level google_map_entries table for the two-layer
--          architecture (source → ops). This table stores raw KML data and is
--          the source of truth for Google Maps entries.
--
-- Architecture:
--   source.google_map_entries  →  Raw KML data (source of truth)
--            ↓
--   ops.google_map_entries     →  Processed/derived data (linked to places)
--
-- Pin System:
--   Reference Pins: source.* entries with NO place_id/linked_place_id
--   Active Pins: source.* entries with linked_place_id → display as part of place
--
-- Linking Rules:
--   1. Exact coords: Link if coordinates match within ~10m
--   2. Name + coords + person: Link if entry title matches person at nearby place
--   3. No match: Display as reference pin, can link later when place created

\echo ''
\echo '=============================================='
\echo '  MIG_2316: Restore source.google_map_entries'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE SOURCE SCHEMA IF NOT EXISTS
-- ============================================================================

\echo '1. Creating source schema if not exists...'

CREATE SCHEMA IF NOT EXISTS source;

-- ============================================================================
-- 2. CREATE SOURCE.GOOGLE_MAP_ENTRIES TABLE
-- ============================================================================

\echo '2. Creating source.google_map_entries table...'

CREATE TABLE IF NOT EXISTS source.google_map_entries (
    entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ========================================================================
    -- Raw KML data (immutable - source of truth)
    -- ========================================================================
    kml_name TEXT,
    original_content TEXT,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    kml_folder TEXT,
    source_file TEXT,
    imported_at TIMESTAMPTZ DEFAULT NOW(),

    -- ========================================================================
    -- AI processing (can be updated)
    -- ========================================================================
    ai_summary TEXT,                    -- Professional summary preserving attribution
    ai_meaning TEXT,                    -- Semantic classification (colony_site, caretaker_contact, etc.)
    ai_classification JSONB,            -- Full AI classification result
    ai_processed_at TIMESTAMPTZ,
    ai_confidence DOUBLE PRECISION,
    ai_quantitative_parsed_at TIMESTAMPTZ,

    -- ========================================================================
    -- Parsed data (from AI or regex extraction)
    -- ========================================================================
    parsed_cat_count INTEGER,           -- Colony size mentioned
    parsed_altered_count INTEGER,       -- TNR count mentioned
    parsed_date DATE,                   -- Date mentioned in notes
    parsed_trapper TEXT,                -- Trapper name mentioned
    parsed_signals JSONB,               -- {has_kittens, has_feeders, etc.}

    -- ========================================================================
    -- Place linking (reference vs active)
    -- ========================================================================
    -- place_id: Direct link (legacy, from exact match)
    place_id UUID REFERENCES sot.places(place_id),
    -- linked_place_id: Explicit link (from tiered auto-linking or manual)
    linked_place_id UUID REFERENCES sot.places(place_id),
    -- nearest_place_id: For context when not linked
    nearest_place_id UUID REFERENCES sot.places(place_id),
    nearest_place_distance_m DOUBLE PRECISION,

    -- ========================================================================
    -- Match status (for reference pin → active pin transition)
    -- ========================================================================
    match_status TEXT NOT NULL DEFAULT 'unmatched'
        CHECK (match_status IN ('matched', 'uncertain', 'unmatched', 'manually_linked', 'no_match_possible')),
    matched_at TIMESTAMPTZ,
    match_distance_m DOUBLE PRECISION,

    -- ========================================================================
    -- UI display (icon styling)
    -- ========================================================================
    icon_type TEXT,
    icon_color TEXT,

    -- ========================================================================
    -- Multi-unit handling
    -- ========================================================================
    requires_unit_selection BOOLEAN DEFAULT FALSE,
    suggested_parent_place_id UUID REFERENCES sot.places(place_id),

    -- ========================================================================
    -- Review tracking
    -- ========================================================================
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,

    -- ========================================================================
    -- Timestamps
    -- ========================================================================
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    migrated_at TIMESTAMPTZ                 -- When migrated from V1
);

COMMENT ON TABLE source.google_map_entries IS
'Source-level table for raw Google Maps KML data.
This is the source of truth for all Google Maps entries.

Pin System:
- Reference Pins: Entries with NO place_id/linked_place_id (display as standalone)
- Active Pins: Entries with linked_place_id (display as part of place context)

Linking Rules:
1. Exact coords (~10m): Auto-link
2. Name + coords + person match: Auto-link
3. No match: Display as reference pin, can become active later';

-- ============================================================================
-- 3. CREATE INDEXES
-- ============================================================================

\echo '3. Creating indexes...'

CREATE INDEX IF NOT EXISTS idx_source_gme_place ON source.google_map_entries(place_id);
CREATE INDEX IF NOT EXISTS idx_source_gme_linked ON source.google_map_entries(linked_place_id);
CREATE INDEX IF NOT EXISTS idx_source_gme_nearest ON source.google_map_entries(nearest_place_id);
CREATE INDEX IF NOT EXISTS idx_source_gme_status ON source.google_map_entries(match_status);
CREATE INDEX IF NOT EXISTS idx_source_gme_imported ON source.google_map_entries(imported_at);
CREATE INDEX IF NOT EXISTS idx_source_gme_parsed_date ON source.google_map_entries(parsed_date);

-- Spatial index for coordinate-based queries
CREATE INDEX IF NOT EXISTS idx_source_gme_coords ON source.google_map_entries(lat, lng);

-- AI classification index
CREATE INDEX IF NOT EXISTS idx_source_gme_ai_meaning ON source.google_map_entries(ai_meaning);
CREATE INDEX IF NOT EXISTS idx_source_gme_ai_classification ON source.google_map_entries USING GIN (ai_classification);

-- ============================================================================
-- 4. CREATE UPDATE TRIGGER
-- ============================================================================

\echo '4. Creating updated_at trigger...'

CREATE OR REPLACE FUNCTION source.update_gme_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gme_update_timestamp ON source.google_map_entries;
CREATE TRIGGER trg_gme_update_timestamp
    BEFORE UPDATE ON source.google_map_entries
    FOR EACH ROW
    EXECUTE FUNCTION source.update_gme_timestamp();

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Table created:'
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'source' AND table_name = 'google_map_entries';

\echo ''
\echo 'Column count:'
SELECT COUNT(*) as column_count
FROM information_schema.columns
WHERE table_schema = 'source' AND table_name = 'google_map_entries';

\echo ''
\echo '=============================================='
\echo '  MIG_2316 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created source.google_map_entries table with:'
\echo '  - Raw KML data columns'
\echo '  - AI processing columns'
\echo '  - Parsed data columns'
\echo '  - Place linking columns'
\echo '  - Match status for reference → active transition'
\echo '  - UI display columns'
\echo '  - Multi-unit handling'
\echo ''
\echo 'Next: Run MIG_2317 to migrate data from ops.google_map_entries'
\echo ''
