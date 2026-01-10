-- MIG_024__relationship_graph_scaffold.sql
-- Relationship Graph Scaffold + Suggested Links
--
-- Creates:
--   - trapper.relationship_types: Admin-extensible lookup table for relationship types
--   - trapper.person_person_edges: Manual person↔person relationships
--   - trapper.place_place_edges: Manual place↔place relationships
--   - trapper.cat_cat_edges: Manual cat↔cat relationships
--   - trapper.relationship_suggestions: Review workflow for suggested links
--   - Rollup views for UI
--   - Helper functions for adding/promoting/rejecting relationships
--
-- Purpose:
--   - Extensible relationship graph without hardcoded ENUMs
--   - Manual confirmation workflow for suggested links
--   - Clean UI: single "Relationships" tab per entity
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_024__relationship_graph_scaffold.sql

\echo '============================================'
\echo 'MIG_024: Relationship Graph Scaffold'
\echo '============================================'

-- ============================================
-- PART 1: Relationship Types Registry
-- ============================================
\echo ''
\echo 'Creating relationship_types registry...'

CREATE TABLE IF NOT EXISTS trapper.relationship_types (
    id SERIAL PRIMARY KEY,
    domain TEXT NOT NULL,  -- person_person, person_place, place_place, cat_person, cat_cat, cat_place
    code TEXT NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    is_symmetric BOOLEAN NOT NULL DEFAULT false,  -- If true, A→B implies B→A
    inverse_code TEXT,  -- For asymmetric: parent→child means inverse is child
    exclusive_group TEXT,  -- e.g., 'housing_status' for owner/tenant exclusivity (advisory only)
    active BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_relationship_type_domain_code UNIQUE (domain, code)
);

CREATE INDEX IF NOT EXISTS idx_relationship_types_domain ON trapper.relationship_types(domain);
CREATE INDEX IF NOT EXISTS idx_relationship_types_active ON trapper.relationship_types(active) WHERE active = true;

COMMENT ON TABLE trapper.relationship_types IS
'Admin-extensible registry of relationship types.
Use domain to filter by relationship category.
is_symmetric: true means A→B implies B→A (e.g., siblings).
inverse_code: for asymmetric types (e.g., parent/child).
exclusive_group: advisory grouping for mutually exclusive types.';

-- ============================================
-- PART 2: Seed Starter Relationship Types
-- ============================================
\echo 'Seeding starter relationship types...'

INSERT INTO trapper.relationship_types (domain, code, label, description, is_symmetric, inverse_code, exclusive_group, sort_order)
VALUES
    -- Person↔Person relationships
    ('person_person', 'spouse', 'Spouse', 'Married partner', true, NULL, 'marital', 10),
    ('person_person', 'partner', 'Partner', 'Domestic partner', true, NULL, 'marital', 11),
    ('person_person', 'parent', 'Parent', 'Parent of', false, 'child', 'family', 20),
    ('person_person', 'child', 'Child', 'Child of', false, 'parent', 'family', 21),
    ('person_person', 'sibling', 'Sibling', 'Brother or sister', true, NULL, 'family', 22),
    ('person_person', 'grandparent', 'Grandparent', 'Grandparent of', false, 'grandchild', 'family', 23),
    ('person_person', 'grandchild', 'Grandchild', 'Grandchild of', false, 'grandparent', 'family', 24),
    ('person_person', 'relative', 'Relative', 'Other family member', true, NULL, 'family', 25),
    ('person_person', 'household_member', 'Household Member', 'Lives in same household', true, NULL, 'household', 30),
    ('person_person', 'roommate', 'Roommate', 'Shares housing', true, NULL, 'household', 31),
    ('person_person', 'neighbor', 'Neighbor', 'Lives nearby', true, NULL, 'proximity', 40),
    ('person_person', 'former_neighbor', 'Former Neighbor', 'Previously lived nearby', true, NULL, 'proximity', 41),
    ('person_person', 'co_trapper', 'Co-Trapper', 'Traps cats together', true, NULL, 'tnr', 50),
    ('person_person', 'emergency_contact', 'Emergency Contact', 'Emergency contact for', false, NULL, NULL, 60),
    ('person_person', 'caregiver', 'Caregiver', 'Provides care for', false, NULL, NULL, 61),

    -- Person↔Place relationships (for reference, maps to existing person_place_relationships)
    ('person_place', 'homeowner', 'Homeowner', 'Owns the property', false, NULL, 'housing_tenure', 10),
    ('person_place', 'tenant', 'Tenant', 'Rents the property', false, NULL, 'housing_tenure', 11),
    ('person_place', 'resident', 'Resident', 'Lives at location', false, NULL, 'housing_tenure', 12),
    ('person_place', 'former_resident', 'Former Resident', 'Previously lived here', false, NULL, NULL, 13),
    ('person_place', 'employee', 'Employee', 'Works at location', false, NULL, 'employment', 20),
    ('person_place', 'manager', 'Manager', 'Manages location', false, NULL, 'employment', 21),
    ('person_place', 'former_employee', 'Former Employee', 'Previously worked here', false, NULL, NULL, 22),
    ('person_place', 'feeder', 'Cat Feeder', 'Feeds cats at location', false, NULL, 'tnr', 30),
    ('person_place', 'trapper', 'Trapper', 'Traps cats at location', false, NULL, 'tnr', 31),
    ('person_place', 'requester', 'Requester', 'Requested TNR at location', false, NULL, 'tnr', 32),

    -- Place↔Place relationships
    ('place_place', 'part_of', 'Part Of', 'Unit is part of building/complex', false, 'contains', 'structure', 10),
    ('place_place', 'contains', 'Contains', 'Building/complex contains unit', false, 'part_of', 'structure', 11),
    ('place_place', 'adjacent_to', 'Adjacent To', 'Shares property boundary', true, NULL, 'proximity', 20),
    ('place_place', 'nearby_cluster', 'Nearby Cluster', 'Part of geographic cluster', true, NULL, 'proximity', 21),
    ('place_place', 'same_colony_site', 'Same Colony Site', 'Both serve same cat colony', true, NULL, 'colony', 30),

    -- Cat↔Cat relationships
    ('cat_cat', 'littermate', 'Littermate', 'From same litter', true, NULL, 'family', 10),
    ('cat_cat', 'parent', 'Parent', 'Parent of', false, 'offspring', 'family', 11),
    ('cat_cat', 'offspring', 'Offspring', 'Offspring of', false, 'parent', 'family', 12),
    ('cat_cat', 'bonded_pair', 'Bonded Pair', 'Bonded companions', true, NULL, 'social', 20),
    ('cat_cat', 'same_colony', 'Same Colony', 'Part of same colony', true, NULL, 'colony', 30),
    ('cat_cat', 'same_colony_candidate', 'Same Colony Candidate', 'Possibly same colony (needs review)', true, NULL, 'colony', 31),
    ('cat_cat', 'littermates_candidate', 'Littermates Candidate', 'Possibly from same litter (needs review)', true, NULL, 'family', 32),

    -- Cat↔Person relationships (for reference, maps to existing person_cat_relationships)
    ('cat_person', 'owner', 'Owner', 'Legal owner of cat', false, NULL, 'ownership', 10),
    ('cat_person', 'caretaker', 'Caretaker', 'Provides daily care', false, NULL, 'care', 20),
    ('cat_person', 'feeder', 'Feeder', 'Regularly feeds cat', false, NULL, 'care', 21),
    ('cat_person', 'trapper', 'Trapper', 'Trapped the cat', false, NULL, 'tnr', 30),
    ('cat_person', 'foster', 'Foster', 'Fostering the cat', false, NULL, 'care', 40),
    ('cat_person', 'adopter', 'Adopter', 'Adopted the cat', false, NULL, 'ownership', 41),

    -- Cat↔Place relationships (for reference, maps to existing cat_place_relationships)
    ('cat_place', 'home', 'Home', 'Cat''s home location', false, NULL, 'residence', 10),
    ('cat_place', 'colony_site', 'Colony Site', 'Cat''s colony location', false, NULL, 'residence', 11),
    ('cat_place', 'trapped_at', 'Trapped At', 'Where cat was trapped', false, NULL, 'tnr', 20),
    ('cat_place', 'seen_at', 'Seen At', 'Observed at location', false, NULL, 'sighting', 30)
ON CONFLICT (domain, code) DO NOTHING;

-- ============================================
-- PART 3: Manual Person↔Person Edges Table
-- ============================================
\echo 'Creating person_person_edges table...'

CREATE TABLE IF NOT EXISTS trapper.person_person_edges (
    edge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id_a UUID NOT NULL REFERENCES trapper.sot_people(person_id),
    person_id_b UUID NOT NULL REFERENCES trapper.sot_people(person_id),
    relationship_type_id INT NOT NULL REFERENCES trapper.relationship_types(id),
    direction TEXT NOT NULL DEFAULT 'a_to_b',  -- a_to_b, b_to_a, bidirectional
    confidence NUMERIC(3,2) DEFAULT 0.9,
    note TEXT,
    source TEXT NOT NULL DEFAULT 'manual',  -- manual, import, derived
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_person_edge_different CHECK (person_id_a <> person_id_b),
    CONSTRAINT uq_person_person_edge UNIQUE (person_id_a, person_id_b, relationship_type_id)
);

CREATE INDEX IF NOT EXISTS idx_person_person_edges_a ON trapper.person_person_edges(person_id_a);
CREATE INDEX IF NOT EXISTS idx_person_person_edges_b ON trapper.person_person_edges(person_id_b);
CREATE INDEX IF NOT EXISTS idx_person_person_edges_type ON trapper.person_person_edges(relationship_type_id);

COMMENT ON TABLE trapper.person_person_edges IS
'Manual person↔person relationships using extensible type registry.
direction: a_to_b (A is X of B), b_to_a (B is X of A), bidirectional.
For symmetric types, only one edge is stored.';

-- ============================================
-- PART 4: Manual Place↔Place Edges Table
-- ============================================
\echo 'Creating place_place_edges table...'

CREATE TABLE IF NOT EXISTS trapper.place_place_edges (
    edge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id_a UUID NOT NULL REFERENCES trapper.places(place_id),
    place_id_b UUID NOT NULL REFERENCES trapper.places(place_id),
    relationship_type_id INT NOT NULL REFERENCES trapper.relationship_types(id),
    direction TEXT NOT NULL DEFAULT 'a_to_b',
    confidence NUMERIC(3,2) DEFAULT 0.9,
    note TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_place_edge_different CHECK (place_id_a <> place_id_b),
    CONSTRAINT uq_place_place_edge UNIQUE (place_id_a, place_id_b, relationship_type_id)
);

CREATE INDEX IF NOT EXISTS idx_place_place_edges_a ON trapper.place_place_edges(place_id_a);
CREATE INDEX IF NOT EXISTS idx_place_place_edges_b ON trapper.place_place_edges(place_id_b);
CREATE INDEX IF NOT EXISTS idx_place_place_edges_type ON trapper.place_place_edges(relationship_type_id);

COMMENT ON TABLE trapper.place_place_edges IS
'Manual place↔place relationships (e.g., unit→building, nearby cluster).';

-- ============================================
-- PART 5: Manual Cat↔Cat Edges Table
-- ============================================
\echo 'Creating cat_cat_edges table...'

CREATE TABLE IF NOT EXISTS trapper.cat_cat_edges (
    edge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id_a UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),
    cat_id_b UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),
    relationship_type_id INT NOT NULL REFERENCES trapper.relationship_types(id),
    direction TEXT NOT NULL DEFAULT 'a_to_b',
    confidence NUMERIC(3,2) DEFAULT 0.9,
    note TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_cat_edge_different CHECK (cat_id_a <> cat_id_b),
    CONSTRAINT uq_cat_cat_edge UNIQUE (cat_id_a, cat_id_b, relationship_type_id)
);

CREATE INDEX IF NOT EXISTS idx_cat_cat_edges_a ON trapper.cat_cat_edges(cat_id_a);
CREATE INDEX IF NOT EXISTS idx_cat_cat_edges_b ON trapper.cat_cat_edges(cat_id_b);
CREATE INDEX IF NOT EXISTS idx_cat_cat_edges_type ON trapper.cat_cat_edges(relationship_type_id);

COMMENT ON TABLE trapper.cat_cat_edges IS
'Manual cat↔cat relationships (e.g., littermates, same colony, bonded pair).';

-- ============================================
-- PART 6: Relationship Suggestions Table
-- ============================================
\echo 'Creating relationship_suggestions table...'

CREATE TABLE IF NOT EXISTS trapper.relationship_suggestions (
    suggestion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain TEXT NOT NULL,  -- person_person, place_place, cat_cat, etc.
    entity_kind_a TEXT NOT NULL,  -- person, place, cat
    entity_id_a UUID NOT NULL,
    entity_kind_b TEXT NOT NULL,
    entity_id_b UUID NOT NULL,
    relationship_type_id INT REFERENCES trapper.relationship_types(id),  -- Nullable: may suggest without specific type
    suggested_type_code TEXT,  -- Alternative: suggest by code before confirming
    score NUMERIC(4,2) NOT NULL DEFAULT 0.5,  -- 0-1 confidence score
    reasons JSONB NOT NULL DEFAULT '{}',  -- Why this was suggested
    status TEXT NOT NULL DEFAULT 'new',  -- new, accepted, rejected, expired
    decided_at TIMESTAMPTZ,
    decided_by TEXT,
    decision_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,  -- Optional: auto-expire old suggestions

    CONSTRAINT chk_suggestion_status CHECK (status IN ('new', 'accepted', 'rejected', 'expired')),
    CONSTRAINT chk_suggestion_different CHECK (entity_id_a <> entity_id_b)
);

CREATE INDEX IF NOT EXISTS idx_suggestions_status ON trapper.relationship_suggestions(status) WHERE status = 'new';
CREATE INDEX IF NOT EXISTS idx_suggestions_domain ON trapper.relationship_suggestions(domain);
CREATE INDEX IF NOT EXISTS idx_suggestions_entity_a ON trapper.relationship_suggestions(entity_kind_a, entity_id_a);
CREATE INDEX IF NOT EXISTS idx_suggestions_entity_b ON trapper.relationship_suggestions(entity_kind_b, entity_id_b);

COMMENT ON TABLE trapper.relationship_suggestions IS
'Suggested relationships for manual review.
Score: confidence level (0-1).
Reasons: JSONB with evidence (e.g., distance_m, shared_address, co-occurrence).
Status: new (pending review), accepted (promoted to edge), rejected, expired.';

-- ============================================
-- PART 7: Nearby People Candidates View
-- ============================================
\echo 'Creating v_person_nearby_people_candidates view...'

CREATE OR REPLACE VIEW trapper.v_person_nearby_people_candidates AS
WITH person_places AS (
    -- Get each person's place(s) with location
    SELECT DISTINCT
        ppr.person_id,
        p.place_id,
        p.location,
        p.display_name AS place_name,
        p.place_kind
    FROM trapper.person_place_relationships ppr
    JOIN trapper.places p ON p.place_id = ppr.place_id
    WHERE p.is_address_backed = true
      AND p.location IS NOT NULL
),
person_pairs AS (
    -- Find pairs of people at nearby places
    SELECT
        pp1.person_id AS person_id,
        pp2.person_id AS candidate_person_id,
        pp1.place_id AS person_place_id,
        pp2.place_id AS candidate_place_id,
        pp1.place_name AS person_place_name,
        pp2.place_name AS candidate_place_name,
        CASE
            WHEN pp1.place_id = pp2.place_id THEN 0
            ELSE ST_Distance(pp1.location::geography, pp2.location::geography)
        END AS distance_m
    FROM person_places pp1
    JOIN person_places pp2 ON pp1.person_id < pp2.person_id  -- Avoid duplicates
    WHERE pp1.place_id = pp2.place_id  -- Same place
       OR ST_DWithin(pp1.location::geography, pp2.location::geography, 200)  -- Within 200m
)
SELECT
    pp.person_id,
    p1.display_name AS person_name,
    pp.candidate_person_id,
    p2.display_name AS candidate_name,
    pp.distance_m,
    pp.person_place_name,
    pp.candidate_place_name,
    CASE
        WHEN pp.distance_m = 0 THEN 1.0  -- Same address = highest score
        WHEN pp.distance_m <= 50 THEN 0.8
        WHEN pp.distance_m <= 100 THEN 0.6
        WHEN pp.distance_m <= 150 THEN 0.4
        ELSE 0.2
    END::NUMERIC(3,2) AS score,
    jsonb_build_object(
        'distance_m', ROUND(pp.distance_m::numeric, 1),
        'same_address', pp.person_place_id = pp.candidate_place_id,
        'person_place', pp.person_place_name,
        'candidate_place', pp.candidate_place_name
    ) AS reasons
FROM person_pairs pp
JOIN trapper.sot_people p1 ON p1.person_id = pp.person_id
JOIN trapper.sot_people p2 ON p2.person_id = pp.candidate_person_id
WHERE p1.merged_into_person_id IS NULL  -- Only canonical people
  AND p2.merged_into_person_id IS NULL
  -- Exclude already-connected pairs (existing person_relationships)
  AND NOT EXISTS (
      SELECT 1 FROM trapper.person_relationships pr
      WHERE (pr.person_a_id = pp.person_id AND pr.person_b_id = pp.candidate_person_id)
         OR (pr.person_a_id = pp.candidate_person_id AND pr.person_b_id = pp.person_id)
  )
  -- Exclude already-connected pairs (new edges)
  AND NOT EXISTS (
      SELECT 1 FROM trapper.person_person_edges ppe
      WHERE (ppe.person_id_a = pp.person_id AND ppe.person_id_b = pp.candidate_person_id)
         OR (ppe.person_id_a = pp.candidate_person_id AND ppe.person_id_b = pp.person_id)
  )
ORDER BY score DESC, distance_m ASC;

COMMENT ON VIEW trapper.v_person_nearby_people_candidates IS
'Suggested nearby people based on address-backed places and geospatial distance.
Score: 1.0 for same address, decreasing with distance.
Excludes already-connected pairs.';

-- ============================================
-- PART 8: Person Relationships Rollup View
-- ============================================
\echo 'Creating v_person_relationships_rollup view...'

CREATE OR REPLACE VIEW trapper.v_person_relationships_rollup AS
-- Manual edges (new system)
SELECT
    ppe.person_id_a AS person_id,
    ppe.person_id_b AS related_entity_id,
    'person' AS related_entity_type,
    p2.display_name AS related_entity_name,
    rt.code AS relationship_type,
    rt.label AS relationship_label,
    ppe.direction,
    ppe.confidence,
    ppe.note,
    ppe.source,
    ppe.created_at
FROM trapper.person_person_edges ppe
JOIN trapper.relationship_types rt ON rt.id = ppe.relationship_type_id
JOIN trapper.sot_people p2 ON p2.person_id = ppe.person_id_b

UNION ALL

-- Reverse direction for manual edges (for symmetric lookup)
SELECT
    ppe.person_id_b AS person_id,
    ppe.person_id_a AS related_entity_id,
    'person' AS related_entity_type,
    p1.display_name AS related_entity_name,
    COALESCE(rt.inverse_code, rt.code) AS relationship_type,
    COALESCE(rti.label, rt.label) AS relationship_label,
    CASE ppe.direction WHEN 'a_to_b' THEN 'b_to_a' WHEN 'b_to_a' THEN 'a_to_b' ELSE ppe.direction END,
    ppe.confidence,
    ppe.note,
    ppe.source,
    ppe.created_at
FROM trapper.person_person_edges ppe
JOIN trapper.relationship_types rt ON rt.id = ppe.relationship_type_id
LEFT JOIN trapper.relationship_types rti ON rti.domain = 'person_person' AND rti.code = rt.inverse_code
JOIN trapper.sot_people p1 ON p1.person_id = ppe.person_id_a

UNION ALL

-- Existing person_place_relationships
SELECT
    ppr.person_id,
    ppr.place_id AS related_entity_id,
    'place' AS related_entity_type,
    pl.display_name AS related_entity_name,
    ppr.role::TEXT AS relationship_type,
    ppr.role::TEXT AS relationship_label,
    'a_to_b' AS direction,
    ppr.confidence,
    ppr.note,
    COALESCE(ppr.created_by, 'derived') AS source,
    ppr.created_at
FROM trapper.person_place_relationships ppr
JOIN trapper.places pl ON pl.place_id = ppr.place_id

UNION ALL

-- Existing person_cat_relationships (via person_cat)
SELECT
    pcr.person_id,
    pcr.cat_id AS related_entity_id,
    'cat' AS related_entity_type,
    c.display_name AS related_entity_name,
    pcr.relationship_type,
    pcr.relationship_type AS relationship_label,
    'a_to_b' AS direction,
    CASE pcr.confidence WHEN 'high' THEN 0.9 WHEN 'medium' THEN 0.7 ELSE 0.5 END::NUMERIC(3,2),
    NULL AS note,
    pcr.source_system AS source,
    pcr.created_at
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id;

COMMENT ON VIEW trapper.v_person_relationships_rollup IS
'Combined view of all person relationships for UI.
Includes: manual edges, person-place, person-cat relationships.';

-- ============================================
-- PART 9: Place Relationships Rollup View
-- ============================================
\echo 'Creating v_place_relationships_rollup view...'

CREATE OR REPLACE VIEW trapper.v_place_relationships_rollup AS
-- Manual place-place edges
SELECT
    ppe.place_id_a AS place_id,
    ppe.place_id_b AS related_entity_id,
    'place' AS related_entity_type,
    p2.display_name AS related_entity_name,
    rt.code AS relationship_type,
    rt.label AS relationship_label,
    ppe.direction,
    ppe.confidence,
    ppe.note,
    ppe.source,
    ppe.created_at
FROM trapper.place_place_edges ppe
JOIN trapper.relationship_types rt ON rt.id = ppe.relationship_type_id
JOIN trapper.places p2 ON p2.place_id = ppe.place_id_b

UNION ALL

-- Reverse for symmetric lookup
SELECT
    ppe.place_id_b AS place_id,
    ppe.place_id_a AS related_entity_id,
    'place' AS related_entity_type,
    p1.display_name AS related_entity_name,
    COALESCE(rt.inverse_code, rt.code) AS relationship_type,
    COALESCE(rti.label, rt.label) AS relationship_label,
    CASE ppe.direction WHEN 'a_to_b' THEN 'b_to_a' WHEN 'b_to_a' THEN 'a_to_b' ELSE ppe.direction END,
    ppe.confidence,
    ppe.note,
    ppe.source,
    ppe.created_at
FROM trapper.place_place_edges ppe
JOIN trapper.relationship_types rt ON rt.id = ppe.relationship_type_id
LEFT JOIN trapper.relationship_types rti ON rti.domain = 'place_place' AND rti.code = rt.inverse_code
JOIN trapper.places p1 ON p1.place_id = ppe.place_id_a

UNION ALL

-- People at place (via person_place_relationships)
SELECT
    ppr.place_id,
    ppr.person_id AS related_entity_id,
    'person' AS related_entity_type,
    p.display_name AS related_entity_name,
    ppr.role::TEXT AS relationship_type,
    ppr.role::TEXT AS relationship_label,
    'b_to_a' AS direction,  -- Place has person
    ppr.confidence,
    ppr.note,
    COALESCE(ppr.created_by, 'derived') AS source,
    ppr.created_at
FROM trapper.person_place_relationships ppr
JOIN trapper.sot_people p ON p.person_id = ppr.person_id

UNION ALL

-- Cats at place (via cat_place_relationships)
SELECT
    cpr.place_id,
    cpr.cat_id AS related_entity_id,
    'cat' AS related_entity_type,
    c.display_name AS related_entity_name,
    cpr.relationship_type,
    cpr.relationship_type AS relationship_label,
    'b_to_a' AS direction,  -- Place has cat
    CASE cpr.confidence WHEN 'high' THEN 0.9 WHEN 'medium' THEN 0.7 ELSE 0.5 END::NUMERIC(3,2),
    NULL AS note,
    cpr.source_system AS source,
    cpr.created_at
FROM trapper.cat_place_relationships cpr
JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id;

COMMENT ON VIEW trapper.v_place_relationships_rollup IS
'Combined view of all place relationships for UI.
Includes: manual edges, people at place, cats at place.';

-- ============================================
-- PART 10: Cat Relationships Rollup View
-- ============================================
\echo 'Creating v_cat_relationships_rollup view...'

CREATE OR REPLACE VIEW trapper.v_cat_relationships_rollup AS
-- Manual cat-cat edges
SELECT
    cce.cat_id_a AS cat_id,
    cce.cat_id_b AS related_entity_id,
    'cat' AS related_entity_type,
    c2.display_name AS related_entity_name,
    rt.code AS relationship_type,
    rt.label AS relationship_label,
    cce.direction,
    cce.confidence,
    cce.note,
    cce.source,
    cce.created_at
FROM trapper.cat_cat_edges cce
JOIN trapper.relationship_types rt ON rt.id = cce.relationship_type_id
JOIN trapper.sot_cats c2 ON c2.cat_id = cce.cat_id_b

UNION ALL

-- Reverse for symmetric lookup
SELECT
    cce.cat_id_b AS cat_id,
    cce.cat_id_a AS related_entity_id,
    'cat' AS related_entity_type,
    c1.display_name AS related_entity_name,
    COALESCE(rt.inverse_code, rt.code) AS relationship_type,
    COALESCE(rti.label, rt.label) AS relationship_label,
    CASE cce.direction WHEN 'a_to_b' THEN 'b_to_a' WHEN 'b_to_a' THEN 'a_to_b' ELSE cce.direction END,
    cce.confidence,
    cce.note,
    cce.source,
    cce.created_at
FROM trapper.cat_cat_edges cce
JOIN trapper.relationship_types rt ON rt.id = cce.relationship_type_id
LEFT JOIN trapper.relationship_types rti ON rti.domain = 'cat_cat' AND rti.code = rt.inverse_code
JOIN trapper.sot_cats c1 ON c1.cat_id = cce.cat_id_a

UNION ALL

-- Cat-person relationships
SELECT
    pcr.cat_id,
    pcr.person_id AS related_entity_id,
    'person' AS related_entity_type,
    p.display_name AS related_entity_name,
    pcr.relationship_type,
    pcr.relationship_type AS relationship_label,
    'a_to_b' AS direction,
    CASE pcr.confidence WHEN 'high' THEN 0.9 WHEN 'medium' THEN 0.7 ELSE 0.5 END::NUMERIC(3,2),
    NULL AS note,
    pcr.source_system AS source,
    pcr.created_at
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_people p ON p.person_id = pcr.person_id

UNION ALL

-- Cat-place relationships
SELECT
    cpr.cat_id,
    cpr.place_id AS related_entity_id,
    'place' AS related_entity_type,
    pl.display_name AS related_entity_name,
    cpr.relationship_type,
    cpr.relationship_type AS relationship_label,
    'a_to_b' AS direction,
    CASE cpr.confidence WHEN 'high' THEN 0.9 WHEN 'medium' THEN 0.7 ELSE 0.5 END::NUMERIC(3,2),
    NULL AS note,
    cpr.source_system AS source,
    cpr.created_at
FROM trapper.cat_place_relationships cpr
JOIN trapper.places pl ON pl.place_id = cpr.place_id;

COMMENT ON VIEW trapper.v_cat_relationships_rollup IS
'Combined view of all cat relationships for UI.
Includes: manual edges, cat-person, cat-place relationships.';

-- ============================================
-- PART 11: Helper Functions
-- ============================================
\echo 'Creating helper functions...'

-- Add person-person relationship
CREATE OR REPLACE FUNCTION trapper.add_person_person_relationship(
    p_person_id_a UUID,
    p_person_id_b UUID,
    p_type_code TEXT,
    p_note TEXT DEFAULT NULL,
    p_created_by TEXT DEFAULT 'manual'
)
RETURNS UUID AS $$
DECLARE
    v_type_id INT;
    v_is_symmetric BOOLEAN;
    v_edge_id UUID;
    v_ordered_a UUID;
    v_ordered_b UUID;
BEGIN
    -- Get type info
    SELECT id, is_symmetric INTO v_type_id, v_is_symmetric
    FROM trapper.relationship_types
    WHERE domain = 'person_person' AND code = p_type_code AND active = true;

    IF v_type_id IS NULL THEN
        RAISE EXCEPTION 'Unknown relationship type: %', p_type_code;
    END IF;

    -- For symmetric types, order the IDs to prevent duplicates
    IF v_is_symmetric THEN
        IF p_person_id_a < p_person_id_b THEN
            v_ordered_a := p_person_id_a;
            v_ordered_b := p_person_id_b;
        ELSE
            v_ordered_a := p_person_id_b;
            v_ordered_b := p_person_id_a;
        END IF;
    ELSE
        v_ordered_a := p_person_id_a;
        v_ordered_b := p_person_id_b;
    END IF;

    INSERT INTO trapper.person_person_edges (
        person_id_a, person_id_b, relationship_type_id, direction, note, created_by
    ) VALUES (
        v_ordered_a, v_ordered_b, v_type_id,
        CASE WHEN v_is_symmetric THEN 'bidirectional' ELSE 'a_to_b' END,
        p_note, p_created_by
    )
    ON CONFLICT (person_id_a, person_id_b, relationship_type_id) DO NOTHING
    RETURNING edge_id INTO v_edge_id;

    RETURN v_edge_id;
END;
$$ LANGUAGE plpgsql;

-- Add place-place relationship
CREATE OR REPLACE FUNCTION trapper.add_place_place_relationship(
    p_place_id_a UUID,
    p_place_id_b UUID,
    p_type_code TEXT,
    p_note TEXT DEFAULT NULL,
    p_created_by TEXT DEFAULT 'manual'
)
RETURNS UUID AS $$
DECLARE
    v_type_id INT;
    v_is_symmetric BOOLEAN;
    v_edge_id UUID;
    v_ordered_a UUID;
    v_ordered_b UUID;
BEGIN
    SELECT id, is_symmetric INTO v_type_id, v_is_symmetric
    FROM trapper.relationship_types
    WHERE domain = 'place_place' AND code = p_type_code AND active = true;

    IF v_type_id IS NULL THEN
        RAISE EXCEPTION 'Unknown relationship type: %', p_type_code;
    END IF;

    IF v_is_symmetric AND p_place_id_a > p_place_id_b THEN
        v_ordered_a := p_place_id_b;
        v_ordered_b := p_place_id_a;
    ELSE
        v_ordered_a := p_place_id_a;
        v_ordered_b := p_place_id_b;
    END IF;

    INSERT INTO trapper.place_place_edges (
        place_id_a, place_id_b, relationship_type_id, direction, note, created_by
    ) VALUES (
        v_ordered_a, v_ordered_b, v_type_id,
        CASE WHEN v_is_symmetric THEN 'bidirectional' ELSE 'a_to_b' END,
        p_note, p_created_by
    )
    ON CONFLICT (place_id_a, place_id_b, relationship_type_id) DO NOTHING
    RETURNING edge_id INTO v_edge_id;

    RETURN v_edge_id;
END;
$$ LANGUAGE plpgsql;

-- Add cat-cat relationship
CREATE OR REPLACE FUNCTION trapper.add_cat_cat_relationship(
    p_cat_id_a UUID,
    p_cat_id_b UUID,
    p_type_code TEXT,
    p_note TEXT DEFAULT NULL,
    p_created_by TEXT DEFAULT 'manual'
)
RETURNS UUID AS $$
DECLARE
    v_type_id INT;
    v_is_symmetric BOOLEAN;
    v_edge_id UUID;
    v_ordered_a UUID;
    v_ordered_b UUID;
BEGIN
    SELECT id, is_symmetric INTO v_type_id, v_is_symmetric
    FROM trapper.relationship_types
    WHERE domain = 'cat_cat' AND code = p_type_code AND active = true;

    IF v_type_id IS NULL THEN
        RAISE EXCEPTION 'Unknown relationship type: %', p_type_code;
    END IF;

    IF v_is_symmetric AND p_cat_id_a > p_cat_id_b THEN
        v_ordered_a := p_cat_id_b;
        v_ordered_b := p_cat_id_a;
    ELSE
        v_ordered_a := p_cat_id_a;
        v_ordered_b := p_cat_id_b;
    END IF;

    INSERT INTO trapper.cat_cat_edges (
        cat_id_a, cat_id_b, relationship_type_id, direction, note, created_by
    ) VALUES (
        v_ordered_a, v_ordered_b, v_type_id,
        CASE WHEN v_is_symmetric THEN 'bidirectional' ELSE 'a_to_b' END,
        p_note, p_created_by
    )
    ON CONFLICT (cat_id_a, cat_id_b, relationship_type_id) DO NOTHING
    RETURNING edge_id INTO v_edge_id;

    RETURN v_edge_id;
END;
$$ LANGUAGE plpgsql;

-- Promote suggestion to edge
CREATE OR REPLACE FUNCTION trapper.promote_relationship_suggestion(
    p_suggestion_id UUID,
    p_type_code TEXT,
    p_note TEXT DEFAULT NULL,
    p_decided_by TEXT DEFAULT 'manual'
)
RETURNS UUID AS $$
DECLARE
    v_suggestion RECORD;
    v_edge_id UUID;
BEGIN
    SELECT * INTO v_suggestion
    FROM trapper.relationship_suggestions
    WHERE suggestion_id = p_suggestion_id AND status = 'new';

    IF v_suggestion IS NULL THEN
        RAISE EXCEPTION 'Suggestion not found or already processed: %', p_suggestion_id;
    END IF;

    -- Create the appropriate edge based on domain
    CASE v_suggestion.domain
        WHEN 'person_person' THEN
            SELECT trapper.add_person_person_relationship(
                v_suggestion.entity_id_a, v_suggestion.entity_id_b,
                p_type_code, p_note, p_decided_by
            ) INTO v_edge_id;
        WHEN 'place_place' THEN
            SELECT trapper.add_place_place_relationship(
                v_suggestion.entity_id_a, v_suggestion.entity_id_b,
                p_type_code, p_note, p_decided_by
            ) INTO v_edge_id;
        WHEN 'cat_cat' THEN
            SELECT trapper.add_cat_cat_relationship(
                v_suggestion.entity_id_a, v_suggestion.entity_id_b,
                p_type_code, p_note, p_decided_by
            ) INTO v_edge_id;
        ELSE
            RAISE EXCEPTION 'Unsupported domain for promotion: %', v_suggestion.domain;
    END CASE;

    -- Update suggestion status
    UPDATE trapper.relationship_suggestions
    SET status = 'accepted',
        decided_at = NOW(),
        decided_by = p_decided_by,
        decision_note = p_note
    WHERE suggestion_id = p_suggestion_id;

    RETURN v_edge_id;
END;
$$ LANGUAGE plpgsql;

-- Reject suggestion
CREATE OR REPLACE FUNCTION trapper.reject_relationship_suggestion(
    p_suggestion_id UUID,
    p_note TEXT DEFAULT NULL,
    p_decided_by TEXT DEFAULT 'manual'
)
RETURNS VOID AS $$
BEGIN
    UPDATE trapper.relationship_suggestions
    SET status = 'rejected',
        decided_at = NOW(),
        decided_by = p_decided_by,
        decision_note = p_note
    WHERE suggestion_id = p_suggestion_id AND status = 'new';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Suggestion not found or already processed: %', p_suggestion_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_024 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Relationship types seeded:'
SELECT domain, COUNT(*) AS count
FROM trapper.relationship_types
GROUP BY domain
ORDER BY domain;

\echo ''
\echo 'Tables created:'
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'trapper'
  AND table_name IN ('relationship_types', 'person_person_edges', 'place_place_edges',
                     'cat_cat_edges', 'relationship_suggestions')
ORDER BY table_name;

\echo ''
\echo 'Views created:'
SELECT table_name FROM information_schema.views
WHERE table_schema = 'trapper'
  AND table_name IN ('v_person_nearby_people_candidates', 'v_person_relationships_rollup',
                     'v_place_relationships_rollup', 'v_cat_relationships_rollup')
ORDER BY table_name;

\echo ''
\echo 'Functions created:'
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name IN ('add_person_person_relationship', 'add_place_place_relationship',
                       'add_cat_cat_relationship', 'promote_relationship_suggestion',
                       'reject_relationship_suggestion')
ORDER BY routine_name;

\echo ''
\echo 'Nearby people candidates (sample):'
SELECT person_name, candidate_name, distance_m, score
FROM trapper.v_person_nearby_people_candidates
LIMIT 5;

\echo ''
\echo 'Next steps:'
\echo '  1. Add manual relationships: SELECT trapper.add_person_person_relationship(id_a, id_b, ''neighbor'');'
\echo '  2. View rollups: SELECT * FROM trapper.v_person_relationships_rollup WHERE person_id = ...;'
\echo '  3. Run queries: psql "$DATABASE_URL" -f sql/queries/QRY_031__relationships_summary.sql'
\echo ''
