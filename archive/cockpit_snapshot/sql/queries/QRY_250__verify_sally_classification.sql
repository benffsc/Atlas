-- QRY_250__verify_sally_classification.sql
-- MEGA_005 E1: Verify Sally Gronski is classified as ACTIVE (not historical-only)
--
-- Run after applying MIG_250:
--   psql "$DATABASE_URL" -f sql/queries/QRY_250__verify_sally_classification.sql

\echo ''
\echo '=== MEGA_005 Verification: Sally Gronski Classification ==='
\echo ''

-- Test 1: Find Sally in classification view
\echo '1. Sally in v_hist_owner_classification:'
SELECT
    display_name,
    owner_email,
    phone_normalized,
    last_appt_date,
    total_appts,
    months_since_last_appt,
    classification,
    classification_reason,
    is_promotable
FROM trapper.v_hist_owner_classification
WHERE display_name ILIKE '%sally%gronski%'
   OR display_name ILIKE '%gronski%sally%'
ORDER BY last_appt_date DESC NULLS LAST
LIMIT 5;

\echo ''
\echo '2. Sally in unified search (should show hist_owner_class):'
SELECT
    entity_type,
    display_label,
    hist_owner_class,
    relevant_date::date AS appt_date,
    phone_text,
    email_text
FROM trapper.v_search_unified_v2
WHERE search_text ILIKE '%sally%gronski%'
   OR search_text ILIKE '%gronski%sally%'
ORDER BY relevant_date DESC NULLS LAST
LIMIT 5;

\echo ''
\echo '3. All hist_owner classifications distribution:'
SELECT
    classification,
    COUNT(*) AS count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM trapper.v_hist_owner_classification
GROUP BY classification
ORDER BY count DESC;

\echo ''
\echo '4. Active owners with recent appointments (sample):'
SELECT
    display_name,
    last_appt_date,
    total_appts,
    classification
FROM trapper.v_hist_owner_classification
WHERE classification = 'active'
ORDER BY last_appt_date DESC
LIMIT 10;

\echo ''
\echo '=== Expected results ==='
\echo '- Sally should have classification = "active" (if she has 2025 appointments)'
\echo '- hist_owner_class in search should be "active"'
\echo '- is_promotable should be TRUE'
\echo ''
