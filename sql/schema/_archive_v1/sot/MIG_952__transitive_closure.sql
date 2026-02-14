\echo ''
\echo '=============================================='
\echo 'MIG_952: Identity Graph Transitive Closure'
\echo '=============================================='
\echo ''
\echo 'Creates functions for traversing identity graph relationships.'
\echo 'Enables finding all related entities and canonical resolutions.'
\echo ''

-- ============================================================================
-- PART 1: Get identity cluster function
-- ============================================================================

\echo '1. Creating get_identity_cluster function...'

CREATE OR REPLACE FUNCTION trapper.get_identity_cluster(
    p_entity_type TEXT,
    p_entity_id UUID
)
RETURNS TABLE (
    entity_id UUID,
    distance INT,
    path UUID[],
    edge_types TEXT[]
) AS $$
WITH RECURSIVE cluster AS (
    -- Start with the given entity
    SELECT
        p_entity_id AS entity_id,
        0 AS distance,
        ARRAY[p_entity_id] AS path,
        ARRAY[]::TEXT[] AS edge_types

    UNION ALL

    -- Follow edges in both directions
    SELECT
        CASE
            WHEN e.source_id = c.entity_id THEN e.target_id
            ELSE e.source_id
        END AS entity_id,
        c.distance + 1,
        c.path || CASE
            WHEN e.source_id = c.entity_id THEN e.target_id
            ELSE e.source_id
        END,
        c.edge_types || e.edge_type
    FROM cluster c
    JOIN trapper.identity_edges e ON
        e.entity_type = p_entity_type
        AND (e.source_id = c.entity_id OR e.target_id = c.entity_id)
    WHERE c.distance < 10  -- Safety limit to prevent infinite loops
      AND NOT (
          CASE
              WHEN e.source_id = c.entity_id THEN e.target_id
              ELSE e.source_id
          END
      ) = ANY(c.path)  -- Prevent cycles
)
SELECT DISTINCT ON (cluster.entity_id)
    cluster.entity_id,
    cluster.distance,
    cluster.path,
    cluster.edge_types
FROM cluster
ORDER BY cluster.entity_id, cluster.distance;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION trapper.get_identity_cluster(TEXT, UUID) IS
'Returns all entities connected to the given entity in the identity graph.
Traverses merged_into, same_as, related_to, and household_member edges.
Distance indicates how many hops away from the starting entity.
Path shows the traversal route.';

-- ============================================================================
-- PART 2: Get canonical entity function
-- ============================================================================

\echo '2. Creating get_canonical_entity function...'

CREATE OR REPLACE FUNCTION trapper.get_canonical_entity(
    p_entity_type TEXT,
    p_entity_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_canonical UUID;
BEGIN
    -- Follow merged_into chain to find the canonical (unmerged) entity
    WITH RECURSIVE chain AS (
        SELECT
            p_entity_id AS current_id,
            0 AS depth
        UNION ALL
        SELECT
            e.target_id AS current_id,
            c.depth + 1
        FROM chain c
        JOIN trapper.identity_edges e ON
            e.entity_type = p_entity_type
            AND e.source_id = c.current_id
            AND e.edge_type = 'merged_into'
        WHERE c.depth < 10  -- Safety limit
    )
    SELECT current_id INTO v_canonical
    FROM chain
    ORDER BY depth DESC
    LIMIT 1;

    -- Verify the canonical entity is not itself merged
    IF p_entity_type = 'person' THEN
        SELECT COALESCE(merged_into_person_id, person_id)
        INTO v_canonical
        FROM trapper.sot_people
        WHERE person_id = v_canonical;
    ELSIF p_entity_type = 'place' THEN
        SELECT COALESCE(merged_into_place_id, place_id)
        INTO v_canonical
        FROM trapper.places
        WHERE place_id = v_canonical;
    END IF;

    RETURN v_canonical;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.get_canonical_entity(TEXT, UUID) IS
'Returns the canonical (unmerged) entity for a given entity ID.
Follows the merged_into chain to find the final destination.';

-- ============================================================================
-- PART 3: Get all merged aliases function
-- ============================================================================

\echo '3. Creating get_merged_aliases function...'

CREATE OR REPLACE FUNCTION trapper.get_merged_aliases(
    p_entity_type TEXT,
    p_canonical_id UUID
)
RETURNS TABLE (
    alias_id UUID,
    merged_at TIMESTAMPTZ,
    merge_depth INT
) AS $$
WITH RECURSIVE aliases AS (
    -- Start with entities directly merged into the canonical
    SELECT
        e.source_id AS alias_id,
        e.created_at AS merged_at,
        1 AS merge_depth
    FROM trapper.identity_edges e
    WHERE e.entity_type = p_entity_type
      AND e.target_id = p_canonical_id
      AND e.edge_type = 'merged_into'

    UNION ALL

    -- Find entities merged into those aliases (transitive)
    SELECT
        e.source_id AS alias_id,
        e.created_at AS merged_at,
        a.merge_depth + 1
    FROM aliases a
    JOIN trapper.identity_edges e ON
        e.entity_type = p_entity_type
        AND e.target_id = a.alias_id
        AND e.edge_type = 'merged_into'
    WHERE a.merge_depth < 10  -- Safety limit
)
SELECT DISTINCT ON (aliases.alias_id)
    aliases.alias_id,
    aliases.merged_at,
    aliases.merge_depth
FROM aliases
ORDER BY aliases.alias_id, aliases.merge_depth;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION trapper.get_merged_aliases(TEXT, UUID) IS
'Returns all entity IDs that have been merged into the given canonical entity.
Includes transitive merges (entities merged into entities that were later merged).';

-- ============================================================================
-- PART 4: Get household members function
-- ============================================================================

\echo '4. Creating get_household_members function...'

CREATE OR REPLACE FUNCTION trapper.get_household_members_for_person(
    p_person_id UUID
)
RETURNS TABLE (
    member_id UUID,
    member_name TEXT,
    relationship_confidence NUMERIC
) AS $$
SELECT
    CASE
        WHEN e.source_id = p_person_id THEN e.target_id
        ELSE e.source_id
    END AS member_id,
    sp.display_name AS member_name,
    e.confidence AS relationship_confidence
FROM trapper.identity_edges e
JOIN trapper.sot_people sp ON sp.person_id = CASE
    WHEN e.source_id = p_person_id THEN e.target_id
    ELSE e.source_id
END
WHERE e.entity_type = 'person'
  AND e.edge_type = 'household_member'
  AND (e.source_id = p_person_id OR e.target_id = p_person_id)
  AND sp.merged_into_person_id IS NULL  -- Only active people
ORDER BY sp.display_name;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION trapper.get_household_members_for_person(UUID) IS
'Returns all other people in the same household as the given person.
Based on household_member edges in the identity graph.';

-- ============================================================================
-- PART 5: Identity graph summary view
-- ============================================================================

\echo '5. Creating detailed identity graph views...'

-- Person identity clusters (for UI)
CREATE OR REPLACE VIEW trapper.v_person_identity_summary AS
SELECT
    sp.person_id,
    sp.display_name,
    sp.merged_into_person_id,
    (SELECT COUNT(*) FROM trapper.get_merged_aliases('person', sp.person_id)) AS alias_count,
    (SELECT COUNT(*) FROM trapper.get_household_members_for_person(sp.person_id)) AS household_size,
    CASE
        WHEN sp.merged_into_person_id IS NOT NULL THEN 'merged'
        WHEN EXISTS (SELECT 1 FROM trapper.identity_edges e WHERE e.entity_type = 'person' AND e.target_id = sp.person_id AND e.edge_type = 'merged_into') THEN 'canonical_with_aliases'
        ELSE 'standalone'
    END AS identity_status
FROM trapper.sot_people sp
WHERE sp.merged_into_person_id IS NULL;

COMMENT ON VIEW trapper.v_person_identity_summary IS 'Summary of person identity status: merged, canonical with aliases, or standalone';

-- Place identity clusters
CREATE OR REPLACE VIEW trapper.v_place_identity_summary AS
SELECT
    p.place_id,
    p.display_name,
    p.merged_into_place_id,
    (SELECT COUNT(*) FROM trapper.get_merged_aliases('place', p.place_id)) AS alias_count,
    CASE
        WHEN p.merged_into_place_id IS NOT NULL THEN 'merged'
        WHEN EXISTS (SELECT 1 FROM trapper.identity_edges e WHERE e.entity_type = 'place' AND e.target_id = p.place_id AND e.edge_type = 'merged_into') THEN 'canonical_with_aliases'
        ELSE 'standalone'
    END AS identity_status
FROM trapper.places p
WHERE p.merged_into_place_id IS NULL;

COMMENT ON VIEW trapper.v_place_identity_summary IS 'Summary of place identity status: merged, canonical with aliases, or standalone';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Testing get_canonical_entity with a merged person...'

SELECT
    e.source_id AS merged_person,
    e.target_id AS merged_into,
    trapper.get_canonical_entity('person', e.source_id) AS canonical_result
FROM trapper.identity_edges e
WHERE e.entity_type = 'person' AND e.edge_type = 'merged_into'
LIMIT 3;

\echo ''
\echo 'Testing get_merged_aliases for a canonical person with aliases...'

SELECT target_id AS canonical, COUNT(*) AS alias_count
FROM trapper.identity_edges
WHERE entity_type = 'person' AND edge_type = 'merged_into'
GROUP BY target_id
ORDER BY alias_count DESC
LIMIT 3;

\echo ''
\echo 'Identity summary stats...'

SELECT identity_status, COUNT(*) AS count
FROM trapper.v_person_identity_summary
GROUP BY identity_status;

SELECT identity_status, COUNT(*) AS count
FROM trapper.v_place_identity_summary
GROUP BY identity_status;

\echo ''
\echo '=============================================='
\echo 'MIG_952 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created functions:'
\echo '  - get_identity_cluster(entity_type, entity_id) - Find all connected entities'
\echo '  - get_canonical_entity(entity_type, entity_id) - Find the canonical unmerged entity'
\echo '  - get_merged_aliases(entity_type, canonical_id) - Find all entities merged into canonical'
\echo '  - get_household_members_for_person(person_id) - Find household members'
\echo ''
\echo 'Created views:'
\echo '  - v_person_identity_summary - Person identity status'
\echo '  - v_place_identity_summary - Place identity status'
\echo ''
