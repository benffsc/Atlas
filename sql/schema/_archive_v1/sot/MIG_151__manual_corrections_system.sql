-- MIG_151__manual_corrections_system.sql
-- System for safe manual data corrections that survive re-ingest
--
-- Problem:
--   Historical data has issues (Cal Eggs buried in FFSC mega-person)
--   Need to make corrections that won't be overwritten by future imports
--
-- Solution:
--   1. corrections table to track all manual fixes
--   2. Override linkages that take precedence over auto-derived ones
--   3. Audit trail for who fixed what and why
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_151__manual_corrections_system.sql

-- ============================================================
-- 1. Corrections log table
-- ============================================================

\echo ''
\echo 'Creating corrections table...'

CREATE TABLE IF NOT EXISTS trapper.corrections (
    correction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What was corrected
    entity_type TEXT NOT NULL CHECK (entity_type IN ('cat', 'person', 'place', 'relationship')),
    entity_id UUID NOT NULL,

    -- The correction
    correction_type TEXT NOT NULL,  -- 'create', 'update', 'link', 'unlink', 'merge', 'split'
    field_name TEXT,                -- Which field was changed (if update)
    old_value JSONB,                -- Previous value
    new_value JSONB,                -- New value

    -- Context
    reason TEXT NOT NULL,           -- Why this correction was made
    source_context JSONB,           -- Additional context (e.g., ClinicHQ account info)

    -- Audit
    created_by TEXT NOT NULL DEFAULT 'staff',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- For LLM-assisted corrections
    suggested_by TEXT,              -- 'staff', 'llm', 'rule'
    confidence NUMERIC(3,2),        -- LLM confidence if applicable
    approved_by TEXT,               -- Who approved LLM suggestion
    approved_at TIMESTAMPTZ
);

CREATE INDEX idx_corrections_entity ON trapper.corrections(entity_type, entity_id);
CREATE INDEX idx_corrections_type ON trapper.corrections(correction_type);
CREATE INDEX idx_corrections_created ON trapper.corrections(created_at DESC);

COMMENT ON TABLE trapper.corrections IS
'Audit log of all manual data corrections. These are Atlas-native changes that survive re-ingest.';

-- ============================================================
-- 2. Override relationships table
-- ============================================================

\echo 'Creating override_relationships table...'

CREATE TABLE IF NOT EXISTS trapper.override_relationships (
    override_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The relationship
    from_entity_type TEXT NOT NULL CHECK (from_entity_type IN ('cat', 'person', 'place')),
    from_entity_id UUID NOT NULL,
    to_entity_type TEXT NOT NULL CHECK (to_entity_type IN ('cat', 'person', 'place')),
    to_entity_id UUID NOT NULL,
    relationship_type TEXT NOT NULL,  -- 'owner', 'resident', 'location', 'contact', etc.

    -- Override behavior
    is_active BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE = explicitly unlinked
    priority INT NOT NULL DEFAULT 100,        -- Higher = takes precedence

    -- Audit
    correction_id UUID REFERENCES trapper.corrections(correction_id),
    created_by TEXT NOT NULL DEFAULT 'staff',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Prevent duplicates
    UNIQUE (from_entity_type, from_entity_id, to_entity_type, to_entity_id, relationship_type)
);

CREATE INDEX idx_override_from ON trapper.override_relationships(from_entity_type, from_entity_id);
CREATE INDEX idx_override_to ON trapper.override_relationships(to_entity_type, to_entity_id);

COMMENT ON TABLE trapper.override_relationships IS
'Manual relationship overrides. These take precedence over auto-derived relationships.';

-- ============================================================
-- 3. Helper function to create a Place from correction
-- ============================================================

\echo 'Creating create_place_from_correction function...'

CREATE OR REPLACE FUNCTION trapper.create_place_from_correction(
    p_display_name TEXT,
    p_address TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT 'Manual correction',
    p_created_by TEXT DEFAULT 'staff',
    p_source_context JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_place_id UUID;
    v_correction_id UUID;
BEGIN
    -- Create the place
    INSERT INTO trapper.places (
        display_name,
        formatted_address,
        place_kind,
        effective_type
    ) VALUES (
        p_display_name,
        p_address,
        'site',
        'business'
    )
    RETURNING place_id INTO v_place_id;

    -- Log the correction
    INSERT INTO trapper.corrections (
        entity_type,
        entity_id,
        correction_type,
        new_value,
        reason,
        source_context,
        created_by
    ) VALUES (
        'place',
        v_place_id,
        'create',
        jsonb_build_object('display_name', p_display_name, 'address', p_address),
        p_reason,
        p_source_context,
        p_created_by
    )
    RETURNING correction_id INTO v_correction_id;

    RETURN v_place_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 4. Helper function to link entities with override
-- ============================================================

\echo 'Creating link_entities_override function...'

CREATE OR REPLACE FUNCTION trapper.link_entities_override(
    p_from_type TEXT,
    p_from_id UUID,
    p_to_type TEXT,
    p_to_id UUID,
    p_relationship_type TEXT,
    p_reason TEXT,
    p_created_by TEXT DEFAULT 'staff'
)
RETURNS UUID AS $$
DECLARE
    v_correction_id UUID;
    v_override_id UUID;
BEGIN
    -- Log the correction
    INSERT INTO trapper.corrections (
        entity_type,
        entity_id,
        correction_type,
        new_value,
        reason,
        created_by
    ) VALUES (
        'relationship',
        p_from_id,
        'link',
        jsonb_build_object(
            'from_type', p_from_type,
            'from_id', p_from_id,
            'to_type', p_to_type,
            'to_id', p_to_id,
            'relationship', p_relationship_type
        ),
        p_reason,
        p_created_by
    )
    RETURNING correction_id INTO v_correction_id;

    -- Create the override relationship
    INSERT INTO trapper.override_relationships (
        from_entity_type,
        from_entity_id,
        to_entity_type,
        to_entity_id,
        relationship_type,
        correction_id,
        created_by
    ) VALUES (
        p_from_type,
        p_from_id,
        p_to_type,
        p_to_id,
        p_relationship_type,
        v_correction_id,
        p_created_by
    )
    ON CONFLICT (from_entity_type, from_entity_id, to_entity_type, to_entity_id, relationship_type)
    DO UPDATE SET
        is_active = TRUE,
        correction_id = v_correction_id,
        created_at = NOW()
    RETURNING override_id INTO v_override_id;

    RETURN v_override_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. View for effective relationships (auto + overrides)
-- ============================================================

\echo 'Creating v_effective_cat_place view...'

CREATE OR REPLACE VIEW trapper.v_effective_cat_place AS
-- Auto-derived relationships
SELECT
    cpr.cat_id,
    cpr.place_id,
    cpr.relationship_type,
    'auto' AS source,
    50 AS priority
FROM trapper.cat_place_relationships cpr
WHERE NOT EXISTS (
    -- Exclude if there's an override that explicitly unlinks
    SELECT 1 FROM trapper.override_relationships ovr
    WHERE ovr.from_entity_type = 'cat'
      AND ovr.from_entity_id = cpr.cat_id
      AND ovr.to_entity_type = 'place'
      AND ovr.to_entity_id = cpr.place_id
      AND ovr.is_active = FALSE
)

UNION ALL

-- Override relationships (active only)
SELECT
    ovr.from_entity_id AS cat_id,
    ovr.to_entity_id AS place_id,
    ovr.relationship_type,
    'override' AS source,
    ovr.priority
FROM trapper.override_relationships ovr
WHERE ovr.from_entity_type = 'cat'
  AND ovr.to_entity_type = 'place'
  AND ovr.is_active = TRUE;

COMMENT ON VIEW trapper.v_effective_cat_place IS
'Combined auto-derived and override cat-place relationships. Use this instead of cat_place_relationships directly.';

-- ============================================================
-- 6. Verification
-- ============================================================

\echo ''
\echo 'Tables created:'
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'trapper'
  AND table_name IN ('corrections', 'override_relationships');

\echo ''
\echo 'Functions created:'
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name IN ('create_place_from_correction', 'link_entities_override');

SELECT 'MIG_151 Complete' AS status;
