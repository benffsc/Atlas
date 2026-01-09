-- MIG_018__sot_cats_minimal.sql
-- Canonical Cats Layer (Minimal + Surfaceable)
--
-- Creates:
--   - trapper.sot_cats: canonical cat records
--   - trapper.cat_identifiers: unique identifiers (animal_id, microchip, etc.)
--   - trapper.person_cat_relationships: links cats to owners
--
-- Purpose:
--   - Surface ClinicHQ cats in DB/UI queries
--   - Link cats to people (owners) when identifier match exists
--   - Support future dedupe across sources (Shelterluv, PetLink)
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_018__sot_cats_minimal.sql

\echo '============================================'
\echo 'MIG_018: Canonical Cats (Minimal Layer)'
\echo '============================================'

-- ============================================
-- PART 1: sot_cats Table
-- ============================================
\echo ''
\echo 'Creating sot_cats table...'

CREATE TABLE IF NOT EXISTS trapper.sot_cats (
    cat_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name TEXT,
    sex TEXT,
    altered_status TEXT,
    birth_year INT,
    breed TEXT,
    primary_color TEXT,
    notes TEXT,

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE trapper.sot_cats IS
'Source of Truth for cats. Links to identifiers and owner relationships.
Initial scope: ClinicHQ cats. Future: Shelterluv, PetLink.';

-- ============================================
-- PART 2: cat_identifiers Table
-- ============================================
\echo 'Creating cat_identifiers table...'

CREATE TABLE IF NOT EXISTS trapper.cat_identifiers (
    cat_identifier_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),

    -- Identifier type and value
    id_type TEXT NOT NULL,  -- clinichq_animal_id, petlink_pet_id, shelterluv_animal_id, microchip
    id_value TEXT NOT NULL,

    -- Provenance
    source_system TEXT NOT NULL,
    source_table TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Each identifier type+value is globally unique
    CONSTRAINT uq_cat_identifier UNIQUE (id_type, id_value)
);

CREATE INDEX IF NOT EXISTS idx_cat_identifiers_cat
    ON trapper.cat_identifiers(cat_id);

CREATE INDEX IF NOT EXISTS idx_cat_identifiers_value
    ON trapper.cat_identifiers(id_value);

CREATE INDEX IF NOT EXISTS idx_cat_identifiers_type_value
    ON trapper.cat_identifiers(id_type, id_value);

COMMENT ON TABLE trapper.cat_identifiers IS
'Unique identifiers for cats. UNIQUE constraint on (id_type, id_value) ensures
same identifier always points to same cat.
Types: clinichq_animal_id, shelterluv_animal_id, petlink_pet_id, microchip';

-- ============================================
-- PART 3: person_cat_relationships Table
-- ============================================
\echo 'Creating person_cat_relationships table...'

CREATE TABLE IF NOT EXISTS trapper.person_cat_relationships (
    person_cat_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),
    cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),

    -- Relationship details
    relationship_type TEXT NOT NULL DEFAULT 'owner',
    confidence TEXT NOT NULL DEFAULT 'high',

    -- Provenance
    source_system TEXT NOT NULL,
    source_table TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One relationship type per person-cat-source combo
    CONSTRAINT uq_person_cat_rel
        UNIQUE (person_id, cat_id, relationship_type, source_system, source_table)
);

CREATE INDEX IF NOT EXISTS idx_person_cat_rel_person
    ON trapper.person_cat_relationships(person_id);

CREATE INDEX IF NOT EXISTS idx_person_cat_rel_cat
    ON trapper.person_cat_relationships(cat_id);

COMMENT ON TABLE trapper.person_cat_relationships IS
'Links people to cats with relationship type (owner, caretaker, etc.).
Confidence tracks how the link was established.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_018 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Tables created:'
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'trapper'
  AND table_name IN ('sot_cats', 'cat_identifiers', 'person_cat_relationships')
ORDER BY table_name;

\echo ''
\echo 'Next steps:'
\echo '  1. Apply MIG_019 to create upsert function'
\echo '  2. Run: SELECT * FROM trapper.upsert_cats_from_clinichq();'
\echo '  3. Check: SELECT COUNT(*) FROM trapper.sot_cats;'
\echo ''
