-- MIG_014__relationships.sql
-- Person-to-Person and Person-to-Place Relationships
--
-- Creates:
--   - trapper.person_relationship_type enum
--   - trapper.person_place_role enum
--   - trapper.person_relationships: person-to-person links
--   - trapper.person_place_relationships: person-to-place links
--   - Views for relationship exploration
--
-- Purpose:
--   - Model family/household relationships
--   - Track person roles at places (requester, resident, contact)
--   - Maintain provenance via staged_record_id
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_014__relationships.sql

\echo '============================================'
\echo 'MIG_014: Relationships (Person-Person, Person-Place)'
\echo '============================================'

-- ============================================
-- PART 1: Person Relationship Type Enum
-- ============================================
\echo ''
\echo 'Creating person_relationship_type enum...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'person_relationship_type') THEN
        CREATE TYPE trapper.person_relationship_type AS ENUM (
            'spouse',
            'partner',
            'parent',
            'child',
            'sibling',
            'grandparent',
            'grandchild',
            'relative',
            'roommate',
            'neighbor',
            'caregiver',
            'emergency_contact',
            'other'
        );
    END IF;
END$$;

-- ============================================
-- PART 2: Person-Place Role Enum
-- ============================================
\echo 'Creating person_place_role enum...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'person_place_role') THEN
        CREATE TYPE trapper.person_place_role AS ENUM (
            'resident',
            'owner',
            'tenant',
            'manager',
            'requester',
            'contact',
            'emergency_contact',
            'former_resident',
            'visitor',
            'employee',
            'other'
        );
    END IF;
END$$;

-- ============================================
-- PART 3: person_relationships Table
-- ============================================
\echo 'Creating person_relationships table...'

CREATE TABLE IF NOT EXISTS trapper.person_relationships (
    relationship_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The pair (always stored as person_a < person_b for consistency)
    person_a_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),
    person_b_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),

    -- Relationship type (from A's perspective to B)
    relationship_type trapper.person_relationship_type NOT NULL,

    -- Optional: reverse type (from B's perspective to A)
    -- e.g., if A is parent of B, then B is child of A
    reverse_type trapper.person_relationship_type,

    -- Provenance
    source_system TEXT,
    source_table TEXT,
    source_row_id TEXT,
    staged_record_id UUID,

    -- Confidence and notes
    confidence NUMERIC(3,2) DEFAULT 0.8,
    note TEXT,

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,

    -- One relationship per pair per type
    CONSTRAINT uq_person_relationship_pair_type
        UNIQUE (person_a_id, person_b_id, relationship_type),
    CONSTRAINT chk_person_relationship_order
        CHECK (person_a_id < person_b_id),
    CONSTRAINT chk_person_relationship_different
        CHECK (person_a_id <> person_b_id)
);

CREATE INDEX IF NOT EXISTS idx_person_relationships_a
    ON trapper.person_relationships(person_a_id);

CREATE INDEX IF NOT EXISTS idx_person_relationships_b
    ON trapper.person_relationships(person_b_id);

COMMENT ON TABLE trapper.person_relationships IS
'Person-to-person relationships (family, household, etc).
Pairs stored with person_a_id < person_b_id for consistency.
relationship_type is from A to B perspective.';

-- ============================================
-- PART 4: person_place_relationships Table
-- ============================================
\echo 'Creating person_place_relationships table...'

CREATE TABLE IF NOT EXISTS trapper.person_place_relationships (
    relationship_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),
    place_id UUID NOT NULL REFERENCES trapper.places(place_id),

    -- Role
    role trapper.person_place_role NOT NULL,

    -- Provenance
    source_system TEXT,
    source_table TEXT,
    source_row_id TEXT,
    staged_record_id UUID,

    -- Temporal (optional: when did this role apply?)
    valid_from DATE,
    valid_to DATE,

    -- Confidence and notes
    confidence NUMERIC(3,2) DEFAULT 0.8,
    note TEXT,

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,

    -- One role per person-place pair
    CONSTRAINT uq_person_place_role
        UNIQUE (person_id, place_id, role)
);

CREATE INDEX IF NOT EXISTS idx_person_place_relationships_person
    ON trapper.person_place_relationships(person_id);

CREATE INDEX IF NOT EXISTS idx_person_place_relationships_place
    ON trapper.person_place_relationships(place_id);

COMMENT ON TABLE trapper.person_place_relationships IS
'Person-to-place relationships (resident, owner, requester, etc).
Supports temporal validity (valid_from/valid_to).
Provenance via staged_record_id for evidence tracing.';

-- ============================================
-- PART 5: View - Person Relationships (Bidirectional)
-- ============================================
\echo 'Creating v_person_relationships view...'

CREATE OR REPLACE VIEW trapper.v_person_relationships AS
SELECT
    pr.relationship_id,
    pr.person_a_id AS from_person_id,
    pa.display_name AS from_person_name,
    pr.person_b_id AS to_person_id,
    pb.display_name AS to_person_name,
    pr.relationship_type,
    pr.reverse_type,
    pr.confidence,
    pr.note,
    pr.created_at
FROM trapper.person_relationships pr
JOIN trapper.sot_people pa ON pa.person_id = pr.person_a_id
JOIN trapper.sot_people pb ON pb.person_id = pr.person_b_id;

COMMENT ON VIEW trapper.v_person_relationships IS
'Person-to-person relationships with display names.';

-- ============================================
-- PART 6: View - Person-Place Relationships
-- ============================================
\echo 'Creating v_person_place_relationships view...'

CREATE OR REPLACE VIEW trapper.v_person_place_relationships AS
SELECT
    ppr.relationship_id,
    ppr.person_id,
    p.display_name AS person_name,
    ppr.place_id,
    pl.display_name AS place_name,
    pl.effective_type AS place_type,
    ppr.role,
    ppr.valid_from,
    ppr.valid_to,
    ppr.confidence,
    ppr.note,
    ppr.created_at
FROM trapper.person_place_relationships ppr
JOIN trapper.sot_people p ON p.person_id = ppr.person_id
JOIN trapper.places pl ON pl.place_id = ppr.place_id;

COMMENT ON VIEW trapper.v_person_place_relationships IS
'Person-to-place relationships with display names.';

-- ============================================
-- PART 7: Derive Person-Place from Staged Records
-- ============================================
\echo 'Creating derive_person_place_relationships function...'

CREATE OR REPLACE FUNCTION trapper.derive_person_place_relationships(
    p_source_table TEXT DEFAULT NULL
)
RETURNS INT AS $$
DECLARE
    v_count INT := 0;
BEGIN
    -- Derive requester role from staged records that link both person and address
    INSERT INTO trapper.person_place_relationships (
        person_id, place_id, role,
        source_system, source_table, source_row_id, staged_record_id,
        confidence, created_by
    )
    SELECT DISTINCT
        srpl.person_id,
        pl.place_id,
        'requester'::trapper.person_place_role,
        sr.source_system,
        sr.source_table,
        sr.source_row_id,
        sr.id,
        0.9,
        'derive_person_place'
    FROM trapper.staged_record_person_link srpl
    JOIN trapper.staged_records sr ON sr.id = srpl.staged_record_id
    JOIN trapper.staged_record_address_link sral ON sral.staged_record_id = sr.id
    JOIN trapper.places pl ON pl.sot_address_id = sral.address_id
    WHERE (p_source_table IS NULL OR sr.source_table = p_source_table)
    ON CONFLICT (person_id, place_id, role) DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.derive_person_place_relationships IS
'Derives person-place relationships from staged records.
Links people to places via their shared staged record links.
Currently derives "requester" role for records that have both person and address links.';

-- ============================================
-- PART 8: View - People at Place
-- ============================================
\echo 'Creating v_people_at_place view...'

CREATE OR REPLACE VIEW trapper.v_people_at_place AS
SELECT
    pl.place_id,
    pl.display_name AS place_name,
    pl.effective_type AS place_type,
    p.person_id,
    p.display_name AS person_name,
    ppr.role,
    ppr.confidence,
    ppr.valid_from,
    ppr.valid_to
FROM trapper.places pl
JOIN trapper.person_place_relationships ppr ON ppr.place_id = pl.place_id
JOIN trapper.sot_people p ON p.person_id = ppr.person_id
WHERE p.merged_into_person_id IS NULL  -- Only canonical people
ORDER BY pl.display_name, ppr.role, p.display_name;

COMMENT ON VIEW trapper.v_people_at_place IS
'All canonical people associated with each place.';

-- ============================================
-- PART 9: View - Places for Person
-- ============================================
\echo 'Creating v_places_for_person view...'

CREATE OR REPLACE VIEW trapper.v_places_for_person AS
SELECT
    p.person_id,
    p.display_name AS person_name,
    pl.place_id,
    pl.display_name AS place_name,
    pl.effective_type AS place_type,
    ppr.role,
    ppr.confidence,
    ppr.valid_from,
    ppr.valid_to
FROM trapper.sot_people p
JOIN trapper.person_place_relationships ppr ON ppr.person_id = p.person_id
JOIN trapper.places pl ON pl.place_id = ppr.place_id
WHERE p.merged_into_person_id IS NULL  -- Only canonical people
ORDER BY p.display_name, ppr.role, pl.display_name;

COMMENT ON VIEW trapper.v_places_for_person IS
'All places associated with each canonical person.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_014 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Tables created:'
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'trapper'
  AND table_name IN ('person_relationships', 'person_place_relationships')
ORDER BY table_name;

\echo ''
\echo 'Next steps:'
\echo '  1. Derive relationships: SELECT trapper.derive_person_place_relationships(''trapping_requests'');'
\echo '  2. View people at places: SELECT * FROM trapper.v_people_at_place LIMIT 20;'
\echo '  3. View places for person: SELECT * FROM trapper.v_places_for_person LIMIT 20;'
\echo ''
