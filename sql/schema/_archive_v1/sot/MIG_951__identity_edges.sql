\echo ''
\echo '=============================================='
\echo 'MIG_951: Identity Edges Table'
\echo '=============================================='
\echo ''
\echo 'Creates identity_edges table for tracking merge relationships.'
\echo 'Enables graph traversal, audit trail, and potential undo operations.'
\echo ''

-- ============================================================================
-- PART 1: Create identity_edges table
-- ============================================================================

\echo '1. Creating identity_edges table...'

CREATE TABLE IF NOT EXISTS trapper.identity_edges (
    edge_id SERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'place', 'cat')),
    source_id UUID NOT NULL,
    target_id UUID NOT NULL,
    edge_type TEXT NOT NULL CHECK (edge_type IN ('merged_into', 'same_as', 'related_to', 'household_member')),
    confidence NUMERIC(5,4) DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT,
    metadata JSONB,
    -- Prevent duplicate edges
    CONSTRAINT uq_identity_edge UNIQUE (entity_type, source_id, target_id, edge_type)
);

COMMENT ON TABLE trapper.identity_edges IS 'Graph of identity relationships between entities. Tracks merges, same-as links, and related entities for audit and traversal.';
COMMENT ON COLUMN trapper.identity_edges.entity_type IS 'Type of entity: person, place, or cat';
COMMENT ON COLUMN trapper.identity_edges.source_id IS 'Source entity ID (the one being merged/linked FROM)';
COMMENT ON COLUMN trapper.identity_edges.target_id IS 'Target entity ID (the one being merged/linked TO)';
COMMENT ON COLUMN trapper.identity_edges.edge_type IS 'Type of relationship: merged_into (soft delete), same_as (equivalence), related_to (association), household_member (shared address)';
COMMENT ON COLUMN trapper.identity_edges.confidence IS 'Confidence score for the relationship (1.0 = certain, <1.0 = probabilistic)';
COMMENT ON COLUMN trapper.identity_edges.metadata IS 'Additional context: source system, merge reason, F-S scores, etc.';

-- ============================================================================
-- PART 2: Create indexes
-- ============================================================================

\echo '2. Creating indexes...'

CREATE INDEX IF NOT EXISTS idx_identity_edges_source
    ON trapper.identity_edges(entity_type, source_id);

CREATE INDEX IF NOT EXISTS idx_identity_edges_target
    ON trapper.identity_edges(entity_type, target_id);

CREATE INDEX IF NOT EXISTS idx_identity_edges_type
    ON trapper.identity_edges(edge_type);

CREATE INDEX IF NOT EXISTS idx_identity_edges_created
    ON trapper.identity_edges(created_at DESC);

-- ============================================================================
-- PART 3: Backfill from existing merged_into fields
-- ============================================================================

\echo '3. Backfilling from existing merge relationships...'

-- Backfill person merges
INSERT INTO trapper.identity_edges (entity_type, source_id, target_id, edge_type, confidence, created_by, metadata)
SELECT
    'person',
    person_id,
    merged_into_person_id,
    'merged_into',
    1.0,
    'MIG_951_backfill',
    jsonb_build_object(
        'source', 'backfill',
        'original_merged_at', merged_at,
        'backfill_date', NOW()
    )
FROM trapper.sot_people
WHERE merged_into_person_id IS NOT NULL
ON CONFLICT (entity_type, source_id, target_id, edge_type) DO NOTHING;

SELECT 'Person edges created' AS status, COUNT(*) AS count
FROM trapper.identity_edges WHERE entity_type = 'person';

-- Backfill place merges
INSERT INTO trapper.identity_edges (entity_type, source_id, target_id, edge_type, confidence, created_by, metadata)
SELECT
    'place',
    place_id,
    merged_into_place_id,
    'merged_into',
    1.0,
    'MIG_951_backfill',
    jsonb_build_object(
        'source', 'backfill',
        'backfill_date', NOW()
    )
FROM trapper.places
WHERE merged_into_place_id IS NOT NULL
ON CONFLICT (entity_type, source_id, target_id, edge_type) DO NOTHING;

SELECT 'Place edges created' AS status, COUNT(*) AS count
FROM trapper.identity_edges WHERE entity_type = 'place';

-- Backfill household relationships (if households table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'household_members') THEN
        INSERT INTO trapper.identity_edges (entity_type, source_id, target_id, edge_type, confidence, created_by, metadata)
        SELECT DISTINCT
            'person',
            hm1.person_id,
            hm2.person_id,
            'household_member',
            0.5,  -- Lower confidence - related but not same person
            'MIG_951_backfill',
            jsonb_build_object(
                'source', 'household_backfill',
                'household_id', hm1.household_id,
                'backfill_date', NOW()
            )
        FROM trapper.household_members hm1
        JOIN trapper.household_members hm2 ON hm1.household_id = hm2.household_id
        WHERE hm1.person_id < hm2.person_id  -- Only one direction to avoid duplicates
        ON CONFLICT (entity_type, source_id, target_id, edge_type) DO NOTHING;

        RAISE NOTICE 'Household relationships backfilled';
    ELSE
        RAISE NOTICE 'No household_members table found, skipping household backfill';
    END IF;
END $$;

-- ============================================================================
-- PART 4: Create triggers for future merges
-- ============================================================================

\echo '4. Creating merge recording triggers...'

-- Trigger function to record person merges
CREATE OR REPLACE FUNCTION trapper.record_person_merge_edge()
RETURNS TRIGGER AS $$
BEGIN
    -- Only record when merged_into_person_id is newly set
    IF NEW.merged_into_person_id IS NOT NULL AND OLD.merged_into_person_id IS NULL THEN
        INSERT INTO trapper.identity_edges (
            entity_type, source_id, target_id, edge_type, confidence, created_by, metadata
        ) VALUES (
            'person',
            NEW.person_id,
            NEW.merged_into_person_id,
            'merged_into',
            1.0,
            COALESCE(current_setting('app.current_user', true), 'system'),
            jsonb_build_object('merged_at', NOW(), 'trigger', 'trg_record_person_merge')
        )
        ON CONFLICT (entity_type, source_id, target_id, edge_type) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to record place merges
CREATE OR REPLACE FUNCTION trapper.record_place_merge_edge()
RETURNS TRIGGER AS $$
BEGIN
    -- Only record when merged_into_place_id is newly set
    IF NEW.merged_into_place_id IS NOT NULL AND OLD.merged_into_place_id IS NULL THEN
        INSERT INTO trapper.identity_edges (
            entity_type, source_id, target_id, edge_type, confidence, created_by, metadata
        ) VALUES (
            'place',
            NEW.place_id,
            NEW.merged_into_place_id,
            'merged_into',
            1.0,
            COALESCE(current_setting('app.current_user', true), 'system'),
            jsonb_build_object('merged_at', NOW(), 'trigger', 'trg_record_place_merge')
        )
        ON CONFLICT (entity_type, source_id, target_id, edge_type) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers (drop first to be idempotent)
DROP TRIGGER IF EXISTS trg_record_person_merge ON trapper.sot_people;
CREATE TRIGGER trg_record_person_merge
    AFTER UPDATE ON trapper.sot_people
    FOR EACH ROW
    EXECUTE FUNCTION trapper.record_person_merge_edge();

DROP TRIGGER IF EXISTS trg_record_place_merge ON trapper.places;
CREATE TRIGGER trg_record_place_merge
    AFTER UPDATE ON trapper.places
    FOR EACH ROW
    EXECUTE FUNCTION trapper.record_place_merge_edge();

-- ============================================================================
-- PART 5: Create helper views
-- ============================================================================

\echo '5. Creating helper views...'

-- Summary view for identity graph statistics
CREATE OR REPLACE VIEW trapper.v_identity_graph_stats AS
SELECT
    entity_type,
    edge_type,
    COUNT(*) AS edge_count,
    AVG(confidence) AS avg_confidence,
    MIN(created_at) AS earliest_edge,
    MAX(created_at) AS latest_edge
FROM trapper.identity_edges
GROUP BY entity_type, edge_type
ORDER BY entity_type, edge_type;

COMMENT ON VIEW trapper.v_identity_graph_stats IS 'Statistics on identity graph edges by entity type and edge type';

-- View to find all entities in a merge chain (for debugging)
CREATE OR REPLACE VIEW trapper.v_merge_chains AS
WITH RECURSIVE chain AS (
    -- Start with entities that have been merged into something
    SELECT
        e.entity_type,
        e.source_id AS original_id,
        e.target_id AS current_id,
        1 AS depth,
        ARRAY[e.source_id] AS path
    FROM trapper.identity_edges e
    WHERE e.edge_type = 'merged_into'

    UNION ALL

    -- Follow the chain
    SELECT
        c.entity_type,
        c.original_id,
        e.target_id AS current_id,
        c.depth + 1,
        c.path || e.source_id
    FROM chain c
    JOIN trapper.identity_edges e ON
        e.entity_type = c.entity_type
        AND e.source_id = c.current_id
        AND e.edge_type = 'merged_into'
    WHERE c.depth < 10  -- Safety limit
      AND NOT e.target_id = ANY(c.path)  -- Prevent cycles
)
SELECT
    entity_type,
    original_id,
    current_id AS canonical_id,
    depth AS chain_length,
    path AS merge_path
FROM chain
WHERE depth = (
    SELECT MAX(depth) FROM chain c2
    WHERE c2.entity_type = chain.entity_type
      AND c2.original_id = chain.original_id
);

COMMENT ON VIEW trapper.v_merge_chains IS 'Shows the full merge chain for each entity, ending at the canonical (unmerged) entity';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

SELECT * FROM trapper.v_identity_graph_stats;

\echo ''
\echo '=============================================='
\echo 'MIG_951 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - identity_edges table with indexes'
\echo '  - Backfilled from sot_people.merged_into_person_id'
\echo '  - Backfilled from places.merged_into_place_id'
\echo '  - Triggers for automatic edge recording'
\echo '  - v_identity_graph_stats view'
\echo '  - v_merge_chains view'
\echo ''
