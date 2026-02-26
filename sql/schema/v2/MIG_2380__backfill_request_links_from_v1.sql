-- MIG_2380: Backfill V2 Request Links from V1 Data
--
-- Problem: V2 migration lost place_id and requester_person_id links for 245 of 276 airtable requests
-- V1: 276 requests with 100% place_id, 99.6% requester_person_id
-- V2: 276 requests with 11% place_id, 12% requester_person_id
--
-- Solution: Match V1 places/people to V2 by address/name and update V2 requests
--
-- This migration requires a temporary table populated from V1 data.
-- Run the export script first: scripts/migrations/export_v1_request_links.sh

-- ============================================================================
-- Step 1: Create temp table for V1 data import
-- ============================================================================

CREATE TEMP TABLE v1_request_links (
    request_id UUID PRIMARY KEY,
    source_record_id TEXT,
    v1_place_id UUID,
    v1_address TEXT,
    v1_requester_person_id UUID,
    v1_requester_name TEXT,
    v1_requester_email TEXT,
    v1_requester_phone TEXT
);

-- ============================================================================
-- Step 2: Import V1 data (populated by export script)
-- ============================================================================

\echo 'Importing V1 request links from /tmp/v1_request_links.csv...'
\copy v1_request_links FROM '/tmp/v1_request_links.csv' WITH (FORMAT csv, HEADER true);

\echo ''
SELECT 'V1 records imported' as step, COUNT(*) as count FROM v1_request_links;

-- ============================================================================
-- Step 3: Match V1 places to V2 places by normalized address
-- ============================================================================

CREATE TEMP TABLE v1_v2_place_matches AS
SELECT DISTINCT ON (v1.request_id)
    v1.request_id,
    v1.v1_place_id,
    v1.v1_address,
    p2.place_id as v2_place_id,
    p2.formatted_address as v2_address,
    -- Match confidence
    CASE
        WHEN LOWER(REPLACE(v1.v1_address, ' ', '')) = LOWER(REPLACE(p2.formatted_address, ' ', '')) THEN 1.0
        WHEN v1.v1_address ILIKE '%' || SPLIT_PART(p2.formatted_address, ',', 1) || '%' THEN 0.8
        ELSE 0.6
    END as match_confidence
FROM v1_request_links v1
LEFT JOIN sot.places p2 ON (
    -- Exact normalized match
    LOWER(REPLACE(v1.v1_address, ' ', '')) = LOWER(REPLACE(p2.formatted_address, ' ', ''))
    OR
    -- Street address match (first part before comma)
    LOWER(SPLIT_PART(v1.v1_address, ',', 1)) = LOWER(SPLIT_PART(p2.formatted_address, ',', 1))
    OR
    -- Fuzzy match on street number + name
    v1.v1_address ILIKE SPLIT_PART(p2.formatted_address, ',', 1) || '%'
)
WHERE v1.v1_address IS NOT NULL
  AND p2.merged_into_place_id IS NULL
ORDER BY v1.request_id, match_confidence DESC;

\echo ''
SELECT 'Place matches found' as step, COUNT(*) as count FROM v1_v2_place_matches WHERE v2_place_id IS NOT NULL;
SELECT 'Place matches missing' as step, COUNT(*) as count FROM v1_v2_place_matches WHERE v2_place_id IS NULL;

-- ============================================================================
-- Step 4: Match V1 people to V2 people by email, phone, or name
-- ============================================================================

CREATE TEMP TABLE v1_v2_person_matches AS
SELECT DISTINCT ON (v1.request_id)
    v1.request_id,
    v1.v1_requester_person_id,
    v1.v1_requester_name,
    v1.v1_requester_email,
    p2.person_id as v2_person_id,
    p2.display_name as v2_display_name,
    -- Match method
    CASE
        WHEN pi_email.person_id IS NOT NULL THEN 'email'
        WHEN pi_phone.person_id IS NOT NULL THEN 'phone'
        WHEN p2.display_name ILIKE v1.v1_requester_name THEN 'name_exact'
        ELSE 'name_fuzzy'
    END as match_method
FROM v1_request_links v1
LEFT JOIN sot.person_identifiers pi_email ON (
    pi_email.id_type = 'email'
    AND pi_email.confidence >= 0.5
    AND LOWER(pi_email.id_value_norm) = LOWER(v1.v1_requester_email)
)
LEFT JOIN sot.person_identifiers pi_phone ON (
    pi_phone.id_type = 'phone'
    AND pi_phone.confidence >= 0.5
    AND pi_phone.id_value_norm = v1.v1_requester_phone
)
LEFT JOIN sot.people p2 ON (
    -- Match by email
    p2.person_id = pi_email.person_id
    OR
    -- Match by phone
    p2.person_id = pi_phone.person_id
    OR
    -- Match by exact name
    (p2.display_name ILIKE v1.v1_requester_name AND p2.merged_into_person_id IS NULL)
)
WHERE v1.v1_requester_name IS NOT NULL
  AND p2.merged_into_person_id IS NULL
ORDER BY v1.request_id,
    CASE
        WHEN pi_email.person_id IS NOT NULL THEN 1
        WHEN pi_phone.person_id IS NOT NULL THEN 2
        ELSE 3
    END;

\echo ''
SELECT 'Person matches found' as step, COUNT(*) as count FROM v1_v2_person_matches WHERE v2_person_id IS NOT NULL;
SELECT 'Person matches missing' as step, COUNT(*) as count FROM v1_v2_person_matches WHERE v2_person_id IS NULL;

-- ============================================================================
-- Step 5: Update V2 requests with matched place_id
-- ============================================================================

\echo ''
\echo '=== Updating V2 requests with place_id ==='

UPDATE ops.requests r
SET
    place_id = pm.v2_place_id,
    updated_at = NOW()
FROM v1_v2_place_matches pm
WHERE r.request_id = pm.request_id
  AND pm.v2_place_id IS NOT NULL
  AND r.place_id IS NULL;

SELECT 'Requests updated with place_id' as step, COUNT(*) as count
FROM ops.requests r
JOIN v1_v2_place_matches pm ON r.request_id = pm.request_id
WHERE r.place_id = pm.v2_place_id;

-- ============================================================================
-- Step 6: Update V2 requests with matched requester_person_id
-- ============================================================================

\echo ''
\echo '=== Updating V2 requests with requester_person_id ==='

UPDATE ops.requests r
SET
    requester_person_id = pm.v2_person_id,
    updated_at = NOW()
FROM v1_v2_person_matches pm
WHERE r.request_id = pm.request_id
  AND pm.v2_person_id IS NOT NULL
  AND r.requester_person_id IS NULL;

SELECT 'Requests updated with requester_person_id' as step, COUNT(*) as count
FROM ops.requests r
JOIN v1_v2_person_matches pm ON r.request_id = pm.request_id
WHERE r.requester_person_id = pm.v2_person_id;

-- ============================================================================
-- Step 7: Final stats
-- ============================================================================

\echo ''
\echo '=== Final Request Link Status ==='

SELECT
    source_system,
    COUNT(*) as total,
    COUNT(place_id) as with_place,
    COUNT(requester_person_id) as with_requester,
    ROUND(COUNT(place_id)::numeric / COUNT(*) * 100, 1) as place_pct,
    ROUND(COUNT(requester_person_id)::numeric / COUNT(*) * 100, 1) as requester_pct
FROM ops.requests
GROUP BY source_system
ORDER BY total DESC;

-- ============================================================================
-- Step 8: Log unmatched for manual review
-- ============================================================================

\echo ''
\echo '=== Requests still missing place_id (need manual review) ==='

SELECT
    r.request_id,
    r.summary,
    v1.v1_address
FROM ops.requests r
JOIN v1_request_links v1 ON v1.request_id = r.request_id
WHERE r.place_id IS NULL
  AND v1.v1_address IS NOT NULL
ORDER BY r.created_at DESC
LIMIT 20;
