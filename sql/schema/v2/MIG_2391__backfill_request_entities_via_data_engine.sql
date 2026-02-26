-- MIG_2391: Backfill Request Entities via Data Engine
--
-- Problem: V1→V2 migration lost entity links on requests because:
-- 1. V2 migration mapping tables (v2_migration.person_id_map) no longer exist
-- 2. Original MIG_2012 used LEFT JOIN which left NULLs where mapping failed
-- 3. ~57 airtable requests have place_id but no requester_person_id
-- 4. ~9 atlas_ui requests have no links at all (no source data to recover)
--
-- Solution:
-- 1. Re-read V1 requester data (email, phone, name, address)
-- 2. Run through sot.find_or_create_person() (Data Engine)
-- 3. Update V2 requests with proper person_id
--
-- For places, we already have place_id from our earlier backfill (MIG_2380).
-- This migration focuses on missing requester_person_id.
--
-- Prerequisites:
-- - MIG_2390 applied (fixed data_engine column name)
-- - V1 database accessible via DATABASE_URL_EAST
--
-- Created: 2026-02-19

\echo ''
\echo '=============================================='
\echo '  MIG_2391: Backfill Request Entities'
\echo '=============================================='
\echo ''

-- ============================================================================
-- Step 1: Create temp table for V1 requester data
-- ============================================================================

\echo 'Step 1: Creating temp table for V1 data...'

CREATE TEMP TABLE v1_request_requesters (
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
-- Step 2: Import V1 requester data
-- Uses the existing /tmp/v1_request_links.csv from MIG_2380
-- ============================================================================

\echo 'Step 2: Importing V1 requester data...'

\copy v1_request_requesters FROM '/tmp/v1_request_links.csv' WITH (FORMAT csv, HEADER true);

\echo ''
SELECT 'V1 requesters imported' as step, COUNT(*) as count FROM v1_request_requesters;

-- ============================================================================
-- Step 3: Find requests missing requester_person_id
-- ============================================================================

\echo ''
\echo 'Step 3: Finding requests with missing requesters...'

CREATE TEMP TABLE requests_needing_requester AS
SELECT
    r.request_id,
    r.source_system,
    v1.v1_requester_name,
    v1.v1_requester_email,
    v1.v1_requester_phone,
    v1.v1_address,
    -- Parse first/last name
    SPLIT_PART(v1.v1_requester_name, ' ', 1) as first_name,
    CASE WHEN POSITION(' ' IN v1.v1_requester_name) > 0
         THEN SUBSTRING(v1.v1_requester_name FROM POSITION(' ' IN v1.v1_requester_name) + 1)
         ELSE NULL
    END as last_name
FROM ops.requests r
JOIN v1_request_requesters v1 ON v1.request_id = r.request_id
WHERE r.requester_person_id IS NULL
  AND (v1.v1_requester_email IS NOT NULL OR v1.v1_requester_phone IS NOT NULL);

\echo ''
SELECT 'Requests needing requester resolution' as step, COUNT(*) as count FROM requests_needing_requester;

-- ============================================================================
-- Step 4: Resolve identities through Data Engine
-- ============================================================================

\echo ''
\echo 'Step 4: Resolving identities through Data Engine...'

CREATE TEMP TABLE resolved_requesters AS
SELECT
    rnr.request_id,
    rnr.source_system,
    rnr.v1_requester_email,
    rnr.v1_requester_phone,
    rnr.v1_requester_name,
    de.decision_type,
    de.resolved_person_id,
    de.reason
FROM requests_needing_requester rnr
CROSS JOIN LATERAL (
    SELECT *
    FROM sot.data_engine_resolve_identity(
        rnr.v1_requester_email,
        rnr.v1_requester_phone,
        rnr.first_name,
        rnr.last_name,
        rnr.v1_address,
        rnr.source_system
    )
) de;

-- Show results
\echo ''
\echo 'Identity resolution results:'
SELECT
    decision_type,
    COUNT(*) as count
FROM resolved_requesters
GROUP BY 1
ORDER BY 2 DESC;

-- ============================================================================
-- Step 5: Update requests with resolved person_ids
-- ============================================================================

\echo ''
\echo 'Step 5: Updating requests with resolved person IDs...'

UPDATE ops.requests r
SET
    requester_person_id = rr.resolved_person_id,
    updated_at = NOW()
FROM resolved_requesters rr
WHERE r.request_id = rr.request_id
  AND rr.resolved_person_id IS NOT NULL
  AND r.requester_person_id IS NULL;

\echo ''
SELECT 'Requests updated with requester_person_id' as step, COUNT(*) as count
FROM ops.requests r
JOIN resolved_requesters rr ON r.request_id = rr.request_id
WHERE r.requester_person_id = rr.resolved_person_id;

-- ============================================================================
-- Step 6: Final verification
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
-- Step 7: Log rejected cases for review
-- ============================================================================

\echo ''
\echo '=== Rejected Cases (for manual review) ==='

SELECT
    request_id,
    v1_requester_name,
    v1_requester_email,
    v1_requester_phone,
    reason
FROM resolved_requesters
WHERE decision_type = 'rejected'
ORDER BY v1_requester_name
LIMIT 20;

\echo ''
\echo 'MIG_2391 complete!'
\echo ''
