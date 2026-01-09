-- MIG_020__cat_place_relationships.sql
-- Cat-to-Place Relationships (Links cats to locations)
--
-- Creates:
--   - trapper.cat_place_relationships: links cats to places with evidence
--
-- Purpose:
--   - Surface where cats live/were seen for maps and triage
--   - Support "home" (owner address) and "appointment_site" relationships
--   - Store evidence for audit trail
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_020__cat_place_relationships.sql

\echo '============================================'
\echo 'MIG_020: Cat-Place Relationships'
\echo '============================================'

-- ============================================
-- PART 1: cat_place_relationships Table
-- ============================================
\echo ''
\echo 'Creating cat_place_relationships table...'

CREATE TABLE IF NOT EXISTS trapper.cat_place_relationships (
    cat_place_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),
    place_id UUID NOT NULL REFERENCES trapper.places(place_id),

    -- Relationship details
    relationship_type TEXT NOT NULL,  -- 'home', 'appointment_site', 'trapped_at'
    confidence TEXT NOT NULL DEFAULT 'medium',  -- 'high', 'medium', 'low'

    -- Provenance
    source_system TEXT NOT NULL,
    source_table TEXT NOT NULL,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One relationship type per cat-place-source combo
    CONSTRAINT uq_cat_place_rel
        UNIQUE (cat_id, place_id, relationship_type, source_system, source_table)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_cat_place_rel_cat
    ON trapper.cat_place_relationships(cat_id);

CREATE INDEX IF NOT EXISTS idx_cat_place_rel_place
    ON trapper.cat_place_relationships(place_id);

CREATE INDEX IF NOT EXISTS idx_cat_place_rel_type
    ON trapper.cat_place_relationships(relationship_type);

CREATE INDEX IF NOT EXISTS idx_cat_place_rel_confidence
    ON trapper.cat_place_relationships(confidence);

COMMENT ON TABLE trapper.cat_place_relationships IS
'Links cats to places with relationship type and confidence.
Types: home (owner address), appointment_site, trapped_at.
Evidence stores the signals used to establish the link.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_020 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Table created:'
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'trapper'
  AND table_name = 'cat_place_relationships';

\echo ''
\echo 'Next steps:'
\echo '  1. Apply MIG_021 for linker function and views'
\echo '  2. Run: SELECT * FROM trapper.link_cats_to_places();'
\echo ''
