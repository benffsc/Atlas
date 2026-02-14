-- MIG_213__atlas_stable_ids.sql
-- Implement stable Atlas IDs for Person, Cat, and Place entities
--
-- Purpose:
--   - Human-readable, stable identifiers for exports and partner communication
--   - Merge-stable: when records merge, canonical ID persists
--   - Cross-system linking: external systems can reference Atlas IDs
--
-- Format:
--   - People: ATL-P-000001
--   - Cats:   ATL-C-000001
--   - Places: ATL-L-000001 (L for Location)
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_213__atlas_stable_ids.sql

\echo ''
\echo 'MIG_213: Atlas Stable IDs'
\echo '========================='
\echo ''

-- ============================================================
-- 1. Create sequences for each entity type
-- ============================================================

\echo 'Creating sequences...'

CREATE SEQUENCE IF NOT EXISTS trapper.atlas_person_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS trapper.atlas_cat_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS trapper.atlas_place_seq START WITH 1;

-- ============================================================
-- 2. Create function to generate Atlas IDs
-- ============================================================

\echo 'Creating atlas_id generation function...'

CREATE OR REPLACE FUNCTION trapper.generate_atlas_id(
    p_entity_type TEXT
) RETURNS TEXT AS $$
DECLARE
    v_prefix TEXT;
    v_seq_name TEXT;
    v_seq_val BIGINT;
BEGIN
    -- Determine prefix and sequence based on entity type
    CASE p_entity_type
        WHEN 'person' THEN
            v_prefix := 'ATL-P-';
            v_seq_name := 'trapper.atlas_person_seq';
        WHEN 'cat' THEN
            v_prefix := 'ATL-C-';
            v_seq_name := 'trapper.atlas_cat_seq';
        WHEN 'place' THEN
            v_prefix := 'ATL-L-';
            v_seq_name := 'trapper.atlas_place_seq';
        ELSE
            RAISE EXCEPTION 'Unknown entity type: %', p_entity_type;
    END CASE;

    -- Get next sequence value
    EXECUTE 'SELECT nextval($1)' INTO v_seq_val USING v_seq_name;

    -- Return formatted ID (6 digits, zero-padded)
    RETURN v_prefix || LPAD(v_seq_val::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.generate_atlas_id IS
'Generates a stable, human-readable Atlas ID for entities.
Format: ATL-{P|C|L}-{6-digit sequence}
- P = Person, C = Cat, L = Location (Place)';

-- ============================================================
-- 3. Add atlas_id columns to entity tables
-- ============================================================

\echo ''
\echo 'Adding atlas_id columns...'

-- People
ALTER TABLE trapper.sot_people
ADD COLUMN IF NOT EXISTS atlas_id TEXT;

-- Cats
ALTER TABLE trapper.sot_cats
ADD COLUMN IF NOT EXISTS atlas_id TEXT;

-- Places
ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS atlas_id TEXT;

-- ============================================================
-- 4. Backfill existing records
-- ============================================================

\echo ''
\echo 'Backfilling atlas_ids for existing records...'

-- Backfill people (ordered by created_at for consistent IDs)
\echo 'Backfilling people...'
WITH ordered_people AS (
    SELECT person_id, ROW_NUMBER() OVER (ORDER BY created_at, person_id) as rn
    FROM trapper.sot_people
    WHERE atlas_id IS NULL
)
UPDATE trapper.sot_people p
SET atlas_id = 'ATL-P-' || LPAD(op.rn::TEXT, 6, '0')
FROM ordered_people op
WHERE p.person_id = op.person_id;

-- Update sequence to continue after backfill
SELECT setval('trapper.atlas_person_seq',
    COALESCE((SELECT MAX(SUBSTRING(atlas_id FROM 7)::BIGINT) FROM trapper.sot_people WHERE atlas_id IS NOT NULL), 0));

\echo 'People backfilled:'
SELECT COUNT(*) as people_with_atlas_id FROM trapper.sot_people WHERE atlas_id IS NOT NULL;

-- Backfill cats (ordered by created_at for consistent IDs)
\echo ''
\echo 'Backfilling cats...'
WITH ordered_cats AS (
    SELECT cat_id, ROW_NUMBER() OVER (ORDER BY created_at, cat_id) as rn
    FROM trapper.sot_cats
    WHERE atlas_id IS NULL
)
UPDATE trapper.sot_cats c
SET atlas_id = 'ATL-C-' || LPAD(oc.rn::TEXT, 6, '0')
FROM ordered_cats oc
WHERE c.cat_id = oc.cat_id;

-- Update sequence to continue after backfill
SELECT setval('trapper.atlas_cat_seq',
    COALESCE((SELECT MAX(SUBSTRING(atlas_id FROM 7)::BIGINT) FROM trapper.sot_cats WHERE atlas_id IS NOT NULL), 0));

\echo 'Cats backfilled:'
SELECT COUNT(*) as cats_with_atlas_id FROM trapper.sot_cats WHERE atlas_id IS NOT NULL;

-- Backfill places (ordered by created_at for consistent IDs)
\echo ''
\echo 'Backfilling places...'
WITH ordered_places AS (
    SELECT place_id, ROW_NUMBER() OVER (ORDER BY created_at, place_id) as rn
    FROM trapper.places
    WHERE atlas_id IS NULL
)
UPDATE trapper.places p
SET atlas_id = 'ATL-L-' || LPAD(op.rn::TEXT, 6, '0')
FROM ordered_places op
WHERE p.place_id = op.place_id;

-- Update sequence to continue after backfill
SELECT setval('trapper.atlas_place_seq',
    COALESCE((SELECT MAX(SUBSTRING(atlas_id FROM 7)::BIGINT) FROM trapper.places WHERE atlas_id IS NOT NULL), 0));

\echo 'Places backfilled:'
SELECT COUNT(*) as places_with_atlas_id FROM trapper.places WHERE atlas_id IS NOT NULL;

-- ============================================================
-- 5. Create unique indexes
-- ============================================================

\echo ''
\echo 'Creating unique indexes...'

CREATE UNIQUE INDEX IF NOT EXISTS idx_sot_people_atlas_id ON trapper.sot_people(atlas_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sot_cats_atlas_id ON trapper.sot_cats(atlas_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_places_atlas_id ON trapper.places(atlas_id);

-- ============================================================
-- 6. Create triggers for automatic ID generation
-- ============================================================

\echo ''
\echo 'Creating triggers for automatic ID generation...'

-- Person trigger
CREATE OR REPLACE FUNCTION trapper.trg_person_atlas_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.atlas_id IS NULL THEN
        NEW.atlas_id := trapper.generate_atlas_id('person');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_person_atlas_id ON trapper.sot_people;
CREATE TRIGGER trg_person_atlas_id
    BEFORE INSERT ON trapper.sot_people
    FOR EACH ROW
    EXECUTE FUNCTION trapper.trg_person_atlas_id();

-- Cat trigger
CREATE OR REPLACE FUNCTION trapper.trg_cat_atlas_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.atlas_id IS NULL THEN
        NEW.atlas_id := trapper.generate_atlas_id('cat');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cat_atlas_id ON trapper.sot_cats;
CREATE TRIGGER trg_cat_atlas_id
    BEFORE INSERT ON trapper.sot_cats
    FOR EACH ROW
    EXECUTE FUNCTION trapper.trg_cat_atlas_id();

-- Place trigger
CREATE OR REPLACE FUNCTION trapper.trg_place_atlas_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.atlas_id IS NULL THEN
        NEW.atlas_id := trapper.generate_atlas_id('place');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_place_atlas_id ON trapper.places;
CREATE TRIGGER trg_place_atlas_id
    BEFORE INSERT ON trapper.places
    FOR EACH ROW
    EXECUTE FUNCTION trapper.trg_place_atlas_id();

-- ============================================================
-- 7. Create lookup functions
-- ============================================================

\echo ''
\echo 'Creating lookup functions...'

-- Find person by Atlas ID
CREATE OR REPLACE FUNCTION trapper.find_person_by_atlas_id(p_atlas_id TEXT)
RETURNS UUID AS $$
    SELECT person_id FROM trapper.sot_people WHERE atlas_id = p_atlas_id;
$$ LANGUAGE SQL STABLE;

-- Find cat by Atlas ID
CREATE OR REPLACE FUNCTION trapper.find_cat_by_atlas_id(p_atlas_id TEXT)
RETURNS UUID AS $$
    SELECT cat_id FROM trapper.sot_cats WHERE atlas_id = p_atlas_id;
$$ LANGUAGE SQL STABLE;

-- Find place by Atlas ID
CREATE OR REPLACE FUNCTION trapper.find_place_by_atlas_id(p_atlas_id TEXT)
RETURNS UUID AS $$
    SELECT place_id FROM trapper.places WHERE atlas_id = p_atlas_id;
$$ LANGUAGE SQL STABLE;

-- Generic lookup that returns entity type and UUID
CREATE OR REPLACE FUNCTION trapper.resolve_atlas_id(p_atlas_id TEXT)
RETURNS TABLE (
    entity_type TEXT,
    entity_id UUID,
    display_name TEXT
) AS $$
BEGIN
    -- Parse the prefix to determine entity type
    IF p_atlas_id LIKE 'ATL-P-%' THEN
        RETURN QUERY
        SELECT 'person'::TEXT, person_id, sot_people.display_name
        FROM trapper.sot_people WHERE atlas_id = p_atlas_id;
    ELSIF p_atlas_id LIKE 'ATL-C-%' THEN
        RETURN QUERY
        SELECT 'cat'::TEXT, cat_id, sot_cats.display_name
        FROM trapper.sot_cats WHERE atlas_id = p_atlas_id;
    ELSIF p_atlas_id LIKE 'ATL-L-%' THEN
        RETURN QUERY
        SELECT 'place'::TEXT, place_id, places.display_name
        FROM trapper.places WHERE atlas_id = p_atlas_id;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.resolve_atlas_id IS
'Resolves an Atlas ID to its entity type, UUID, and display name.
Accepts: ATL-P-XXXXXX (person), ATL-C-XXXXXX (cat), ATL-L-XXXXXX (place)';

-- ============================================================
-- 8. Add atlas_id to identifier tables for external reference
-- ============================================================

\echo ''
\echo 'Adding atlas_id identifier type support...'

-- Add atlas_id to the identifier_type enum if not exists
ALTER TYPE trapper.identifier_type ADD VALUE IF NOT EXISTS 'atlas_id';

-- Allow atlas_id to be stored as an identifier (for external systems)
-- This lets us look up entities by atlas_id through the standard identifier lookup

INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system, source_table)
SELECT person_id, 'atlas_id', atlas_id, atlas_id, 'atlas', 'sot_people'
FROM trapper.sot_people
WHERE atlas_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi
    WHERE pi.person_id = sot_people.person_id
      AND pi.id_type = 'atlas_id'
  )
ON CONFLICT DO NOTHING;

\echo 'Person atlas_id identifiers added:'
SELECT COUNT(*) FROM trapper.person_identifiers WHERE id_type = 'atlas_id';

-- Add atlas_id to cat_identifiers
INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
SELECT cat_id, 'atlas_id', atlas_id, 'atlas', 'sot_cats'
FROM trapper.sot_cats
WHERE atlas_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_identifiers ci
    WHERE ci.cat_id = sot_cats.cat_id
      AND ci.id_type = 'atlas_id'
  )
ON CONFLICT DO NOTHING;

\echo 'Cat atlas_id identifiers added:'
SELECT COUNT(*) FROM trapper.cat_identifiers WHERE id_type = 'atlas_id';

-- ============================================================
-- 9. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'
\echo ''

\echo 'Atlas ID coverage:'
SELECT
    'People' as entity,
    COUNT(*) as total,
    COUNT(atlas_id) as with_atlas_id,
    MIN(atlas_id) as first_id,
    MAX(atlas_id) as last_id
FROM trapper.sot_people
UNION ALL
SELECT
    'Cats' as entity,
    COUNT(*) as total,
    COUNT(atlas_id) as with_atlas_id,
    MIN(atlas_id) as first_id,
    MAX(atlas_id) as last_id
FROM trapper.sot_cats
UNION ALL
SELECT
    'Places' as entity,
    COUNT(*) as total,
    COUNT(atlas_id) as with_atlas_id,
    MIN(atlas_id) as first_id,
    MAX(atlas_id) as last_id
FROM trapper.places;

\echo ''
\echo 'Sample Atlas IDs:'
SELECT 'Person' as type, atlas_id, display_name FROM trapper.sot_people ORDER BY atlas_id LIMIT 3;
SELECT 'Cat' as type, atlas_id, display_name FROM trapper.sot_cats ORDER BY atlas_id LIMIT 3;
SELECT 'Place' as type, atlas_id, display_name FROM trapper.places ORDER BY atlas_id LIMIT 3;

\echo ''
\echo 'Test resolve_atlas_id function:'
SELECT * FROM trapper.resolve_atlas_id('ATL-P-000001');
SELECT * FROM trapper.resolve_atlas_id('ATL-C-000001');
SELECT * FROM trapper.resolve_atlas_id('ATL-L-000001');

SELECT 'MIG_213 Complete' AS status;
