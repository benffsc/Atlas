-- QRY_251__mega006_verification.sql
-- MEGA_006 Acceptance Tests: Recency buckets + Entity kind classification
--
-- Run after applying MIG_251:
--   psql "$DATABASE_URL" -f sql/queries/QRY_251__mega006_verification.sql

\echo ''
\echo '=== MEGA_006 Verification Tests ==='
\echo ''

-- ============================================================
-- TEST 1: Sally test - should show ACTIVE (not historical-only)
-- ============================================================
\echo 'TEST 1: Sally Gronski should be ACTIVE'
SELECT
    display_name,
    recency_bucket,
    owner_entity_kind,
    last_appt_date,
    total_appts,
    is_promotable_to_person,
    is_demotable
FROM trapper.v_hist_owner_classification
WHERE display_name ILIKE '%sally%gronski%'
   OR display_name ILIKE '%gronski%sally%'
ORDER BY last_appt_date DESC NULLS LAST
LIMIT 5;

\echo ''
\echo 'EXPECTED: recency_bucket = "active", owner_entity_kind = "person_like", is_demotable = false'
\echo ''

-- ============================================================
-- TEST 2: Anytime Fitness - should show place_like
-- ============================================================
\echo 'TEST 2: "Anytime Fitness" should be PLACE_LIKE'
SELECT
    display_name,
    recency_bucket,
    owner_entity_kind,
    entity_kind_reason,
    last_appt_date,
    is_promotable_to_place
FROM trapper.v_hist_owner_classification
WHERE display_name ILIKE '%anytime%fitness%'
   OR display_name ILIKE '%fitness%'
ORDER BY last_appt_date DESC NULLS LAST
LIMIT 10;

\echo ''
\echo 'EXPECTED: owner_entity_kind = "place_like", is_promotable_to_place = true'
\echo ''

-- ============================================================
-- TEST 3: Road/Intersection - should show place_like
-- ============================================================
\echo 'TEST 3: Road/intersection patterns should be PLACE_LIKE'
SELECT
    display_name,
    owner_address,
    recency_bucket,
    owner_entity_kind,
    entity_kind_reason
FROM trapper.v_hist_owner_classification
WHERE display_name ~* '(Joe Rodota|Sebastopol Rd|Merced Ave|\d+\s+\w+\s+(Rd|St|Ave))'
   OR display_name ~* '(Road|Street|Avenue|Blvd)$'
ORDER BY last_appt_date DESC NULLS LAST
LIMIT 10;

\echo ''
\echo 'EXPECTED: owner_entity_kind = "place_like"'
\echo ''

-- ============================================================
-- TEST 4: School District - should show place_like
-- ============================================================
\echo 'TEST 4: School District should be PLACE_LIKE'
SELECT
    display_name,
    recency_bucket,
    owner_entity_kind,
    entity_kind_reason,
    is_promotable_to_place
FROM trapper.v_hist_owner_classification
WHERE display_name ILIKE '%school%district%'
   OR display_name ILIKE '%school%'
   OR display_name ILIKE '%district%'
ORDER BY last_appt_date DESC NULLS LAST
LIMIT 10;

\echo ''
\echo 'EXPECTED: owner_entity_kind = "place_like"'
\echo ''

-- ============================================================
-- TEST 5: Recency bucket distribution
-- ============================================================
\echo 'TEST 5: Recency bucket distribution'
SELECT
    recency_bucket,
    COUNT(*) AS count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM trapper.v_hist_owner_classification
GROUP BY recency_bucket
ORDER BY
    CASE recency_bucket
        WHEN 'active' THEN 1
        WHEN 'resurgence' THEN 2
        WHEN 'fade' THEN 3
        WHEN 'archival' THEN 4
    END;

\echo ''
\echo 'EXPECTED: active ≤24mo, resurgence 24-36mo, fade 36-48mo, archival >48mo'
\echo ''

-- ============================================================
-- TEST 6: Entity kind distribution
-- ============================================================
\echo 'TEST 6: Entity kind distribution'
SELECT
    owner_entity_kind,
    COUNT(*) AS count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM trapper.v_hist_owner_classification
GROUP BY owner_entity_kind
ORDER BY count DESC;

\echo ''

-- ============================================================
-- TEST 7: Place-like candidates for review
-- ============================================================
\echo 'TEST 7: Top 20 place_like candidates (review queue)'
SELECT
    display_name,
    owner_address,
    recency_bucket,
    entity_kind_reason,
    total_appts
FROM trapper.v_place_like_candidates
LIMIT 20;

\echo ''

-- ============================================================
-- TEST 8: Demotability protection
-- ============================================================
\echo 'TEST 8: ACTIVE and RESURGENCE should NOT be demotable'
SELECT
    recency_bucket,
    is_demotable,
    COUNT(*) AS count
FROM trapper.v_hist_owner_classification
GROUP BY recency_bucket, is_demotable
ORDER BY recency_bucket, is_demotable;

\echo ''
\echo 'EXPECTED: active and resurgence have is_demotable = false'
\echo ''

-- ============================================================
-- TEST 9: Unified search shows recency + entity kind
-- ============================================================
\echo 'TEST 9: Unified search includes recency and entity kind'
SELECT
    entity_type,
    display_label,
    hist_owner_recency,
    hist_owner_entity_kind
FROM trapper.v_search_unified_v2
WHERE entity_type = 'hist_owner'
  AND hist_owner_recency IS NOT NULL
ORDER BY relevant_date DESC NULLS LAST
LIMIT 10;

\echo ''
\echo '=== All MEGA_006 tests complete ==='
\echo ''
\echo 'Summary of expected results:'
\echo '  1. Sally = active, person_like, not demotable'
\echo '  2. Anytime Fitness = place_like'
\echo '  3. Road patterns = place_like'
\echo '  4. School District = place_like'
\echo '  5. Recency buckets: active/resurgence/fade/archival'
\echo '  6. Entity kinds: person_like/place_like/colony_like/unknown'
\echo '  7. Place candidates available for review'
\echo '  8. Active/Resurgence protected from demotion'
\echo '  9. Search view includes new fields'
\echo ''
