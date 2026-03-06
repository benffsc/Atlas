-- MIG_2844: Fix merge integrity issues
--
-- Data audit found:
-- 1. 5 people with merged_into_person_id = person_id (invisible to all queries)
-- 2. Multi-hop place merge chains (A→B→C instead of A→C)
-- 3. 1 dangling person_cat FK referencing a merged cat
-- 4. No CHECK constraints preventing self-merges
--
-- Fixes FFS-236, FFS-237

BEGIN;

-- =============================================================================
-- 1a. Fix self-merged people (5 rows)
-- These have merged_into_person_id = person_id, making them invisible to all
-- queries that filter WHERE merged_into_person_id IS NULL.
-- Verified these are NOT intentional merges — they're data corruption.
-- =============================================================================

UPDATE sot.people
SET merged_into_person_id = NULL, updated_at = NOW()
WHERE merged_into_person_id = person_id;

-- =============================================================================
-- 1b. Flatten multi-hop merge chains across all entity tables
-- A→B→C should become A→C (point all losers directly to the final winner)
-- =============================================================================

-- Places
WITH RECURSIVE chains AS (
    SELECT place_id, merged_into_place_id, 1 AS depth
    FROM sot.places
    WHERE merged_into_place_id IS NOT NULL
    UNION ALL
    SELECT c.place_id, p.merged_into_place_id, c.depth + 1
    FROM chains c
    JOIN sot.places p ON p.place_id = c.merged_into_place_id
    WHERE p.merged_into_place_id IS NOT NULL AND c.depth < 10
),
final_targets AS (
    SELECT DISTINCT ON (place_id) place_id, merged_into_place_id
    FROM chains
    WHERE depth > 1
    ORDER BY place_id, depth DESC
)
UPDATE sot.places p
SET merged_into_place_id = ft.merged_into_place_id, updated_at = NOW()
FROM final_targets ft
WHERE p.place_id = ft.place_id;

-- People
WITH RECURSIVE chains AS (
    SELECT person_id, merged_into_person_id, 1 AS depth
    FROM sot.people
    WHERE merged_into_person_id IS NOT NULL
    UNION ALL
    SELECT c.person_id, p.merged_into_person_id, c.depth + 1
    FROM chains c
    JOIN sot.people p ON p.person_id = c.merged_into_person_id
    WHERE p.merged_into_person_id IS NOT NULL AND c.depth < 10
),
final_targets AS (
    SELECT DISTINCT ON (person_id) person_id, merged_into_person_id
    FROM chains
    WHERE depth > 1
    ORDER BY person_id, depth DESC
)
UPDATE sot.people p
SET merged_into_person_id = ft.merged_into_person_id, updated_at = NOW()
FROM final_targets ft
WHERE p.person_id = ft.person_id;

-- Cats
WITH RECURSIVE chains AS (
    SELECT cat_id, merged_into_cat_id, 1 AS depth
    FROM sot.cats
    WHERE merged_into_cat_id IS NOT NULL
    UNION ALL
    SELECT c.cat_id, ct.merged_into_cat_id, c.depth + 1
    FROM chains c
    JOIN sot.cats ct ON ct.cat_id = c.merged_into_cat_id
    WHERE ct.merged_into_cat_id IS NOT NULL AND c.depth < 10
),
final_targets AS (
    SELECT DISTINCT ON (cat_id) cat_id, merged_into_cat_id
    FROM chains
    WHERE depth > 1
    ORDER BY cat_id, depth DESC
)
UPDATE sot.cats ct
SET merged_into_cat_id = ft.merged_into_cat_id, updated_at = NOW()
FROM final_targets ft
WHERE ct.cat_id = ft.cat_id;

-- Addresses
WITH RECURSIVE chains AS (
    SELECT address_id, merged_into_address_id, 1 AS depth
    FROM sot.addresses
    WHERE merged_into_address_id IS NOT NULL
    UNION ALL
    SELECT c.address_id, a.merged_into_address_id, c.depth + 1
    FROM chains c
    JOIN sot.addresses a ON a.address_id = c.merged_into_address_id
    WHERE a.merged_into_address_id IS NOT NULL AND c.depth < 10
),
final_targets AS (
    SELECT DISTINCT ON (address_id) address_id, merged_into_address_id
    FROM chains
    WHERE depth > 1
    ORDER BY address_id, depth DESC
)
UPDATE sot.addresses a
SET merged_into_address_id = ft.merged_into_address_id, updated_at = NOW()
FROM final_targets ft
WHERE a.address_id = ft.address_id;

-- Requests
WITH RECURSIVE chains AS (
    SELECT request_id, merged_into_request_id, 1 AS depth
    FROM ops.requests
    WHERE merged_into_request_id IS NOT NULL
    UNION ALL
    SELECT c.request_id, r.merged_into_request_id, c.depth + 1
    FROM chains c
    JOIN ops.requests r ON r.request_id = c.merged_into_request_id
    WHERE r.merged_into_request_id IS NOT NULL AND c.depth < 10
),
final_targets AS (
    SELECT DISTINCT ON (request_id) request_id, merged_into_request_id
    FROM chains
    WHERE depth > 1
    ORDER BY request_id, depth DESC
)
UPDATE ops.requests r
SET merged_into_request_id = ft.merged_into_request_id, updated_at = NOW()
FROM final_targets ft
WHERE r.request_id = ft.request_id;

-- =============================================================================
-- 1c. Fix dangling person_cat FK referencing merged cats
-- Update to point at the merge winner instead
-- =============================================================================

UPDATE sot.person_cat pc
SET cat_id = c.merged_into_cat_id
FROM sot.cats c
WHERE pc.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NOT NULL;

-- Same for cat_place referencing merged cats
UPDATE sot.cat_place cp
SET cat_id = c.merged_into_cat_id
FROM sot.cats c
WHERE cp.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NOT NULL;

-- Same for person_place referencing merged places
UPDATE sot.person_place pp
SET place_id = p.merged_into_place_id
FROM sot.places p
WHERE pp.place_id = p.place_id
  AND p.merged_into_place_id IS NOT NULL;

-- =============================================================================
-- 1d. Add CHECK constraints preventing self-merges on all entity tables
-- =============================================================================

ALTER TABLE sot.people ADD CONSTRAINT chk_no_self_merge_person
    CHECK (merged_into_person_id IS NULL OR merged_into_person_id != person_id);

ALTER TABLE sot.cats ADD CONSTRAINT chk_no_self_merge_cat
    CHECK (merged_into_cat_id IS NULL OR merged_into_cat_id != cat_id);

ALTER TABLE sot.places ADD CONSTRAINT chk_no_self_merge_place
    CHECK (merged_into_place_id IS NULL OR merged_into_place_id != place_id);

ALTER TABLE sot.addresses ADD CONSTRAINT chk_no_self_merge_address
    CHECK (merged_into_address_id IS NULL OR merged_into_address_id != address_id);

ALTER TABLE ops.requests ADD CONSTRAINT chk_no_self_merge_request
    CHECK (merged_into_request_id IS NULL OR merged_into_request_id != request_id);

COMMIT;
