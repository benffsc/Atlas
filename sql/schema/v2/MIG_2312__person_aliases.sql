-- MIG_2312: Add person_aliases table and norm_name_key function to V2
--
-- Purpose: Track historical names for people (name changes, AKAs)
-- Used by: /api/people/[id] route for displaying aliases and preserving old names

-- ============================================================
-- PART 1: Name Normalization Function
-- ============================================================

CREATE OR REPLACE FUNCTION sot.norm_name_key(p_name TEXT)
RETURNS TEXT AS $$
DECLARE
    v_result TEXT;
BEGIN
    IF p_name IS NULL OR TRIM(p_name) = '' THEN
        RETURN NULL;
    END IF;

    -- Start with unaccent + lowercase
    v_result := LOWER(unaccent(TRIM(p_name)));

    -- Remove punctuation except spaces and hyphens
    v_result := REGEXP_REPLACE(v_result, '[^a-z0-9\s\-]', '', 'g');

    -- Normalize multiple spaces/hyphens to single space
    v_result := REGEXP_REPLACE(v_result, '[\s\-]+', ' ', 'g');

    -- Trim again
    v_result := TRIM(v_result);

    IF v_result = '' THEN
        RETURN NULL;
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION sot.norm_name_key IS
'Creates a normalized key from a name for deduplication.
Lowercases, removes accents, strips punctuation, normalizes whitespace.';

-- ============================================================
-- PART 2: Person Aliases Table
-- ============================================================

CREATE TABLE IF NOT EXISTS sot.person_aliases (
    alias_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES sot.people(person_id),
    name_raw TEXT NOT NULL,
    name_key TEXT NOT NULL,
    source_system TEXT,
    source_table TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Each person can have the same name key only once
    UNIQUE(person_id, name_key)
);

CREATE INDEX IF NOT EXISTS idx_person_aliases_person_id
    ON sot.person_aliases(person_id);

CREATE INDEX IF NOT EXISTS idx_person_aliases_name_key
    ON sot.person_aliases(name_key);

-- Trigram index for fuzzy search
CREATE INDEX IF NOT EXISTS idx_person_aliases_name_raw_trgm
    ON sot.person_aliases USING gin (name_raw gin_trgm_ops);

COMMENT ON TABLE sot.person_aliases IS
'Historical/alternate names for people. Used to track name changes and AKAs.
When display_name changes, old name is preserved here for search and audit.';

-- ============================================================
-- VERIFICATION
-- ============================================================

DO $$
BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'sot' AND table_name = 'person_aliases'
    ), 'person_aliases table not created';

    ASSERT EXISTS (
        SELECT 1 FROM information_schema.routines
        WHERE routine_schema = 'sot' AND routine_name = 'norm_name_key'
    ), 'norm_name_key function not created';

    RAISE NOTICE 'MIG_2312: person_aliases table and norm_name_key function created';
END;
$$;
