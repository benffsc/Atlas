-- QRY_072__search_seed_examples.sql
-- Example searches using the unified search view
--
-- Prerequisites: Run MIG_072__create_v_search_unified.sql first
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   source .env && psql "$DATABASE_URL" -f sql/queries/QRY_072__search_seed_examples.sql

\pset pager off
\echo '=============================================='
\echo 'UNIFIED SEARCH EXAMPLES'
\echo '=============================================='

-- ============================================
-- 0) VIEW SUMMARY (row counts by entity type)
-- ============================================
\echo ''
\echo '--- 0) Entity counts in v_search_unified ---'

SELECT entity_type, COUNT(*) AS rows
FROM trapper.v_search_unified
GROUP BY entity_type
ORDER BY entity_type;

-- ============================================
-- 1) SEARCH BY PERSON NAME
-- ============================================
\echo ''
\echo '--- 1) Search by person name (fuzzy ILIKE) ---'
\echo 'Query: name_text ILIKE ''%smith%'''

SELECT entity_type, entity_id, display_label, status
FROM trapper.v_search_unified
WHERE name_text ILIKE '%smith%'
ORDER BY relevant_date DESC
LIMIT 10;

-- Alternative: Using PostgreSQL similarity() for typo-tolerance
\echo ''
\echo 'Query: similarity(name_text, ''johnson'') > 0.3'

SELECT entity_type, entity_id, display_label,
       similarity(name_text, 'johnson') AS sim_score
FROM trapper.v_search_unified
WHERE name_text IS NOT NULL
  AND similarity(name_text, 'johnson') > 0.3
ORDER BY sim_score DESC
LIMIT 5;

-- ============================================
-- 2) SEARCH BY PHONE OR EMAIL
-- ============================================
\echo ''
\echo '--- 2) Search by phone/email ---'
\echo 'Query: phone_text ILIKE ''%707%'' (area code search)'

SELECT entity_type, entity_id, display_label, phone_text, email_text
FROM trapper.v_search_unified
WHERE phone_text ILIKE '%707%'
   OR phone_text ILIKE '%555%'
LIMIT 10;

\echo ''
\echo 'Query: email_text ILIKE ''%gmail%'''

SELECT entity_type, entity_id, display_label, email_text
FROM trapper.v_search_unified
WHERE email_text ILIKE '%gmail%'
LIMIT 10;

-- ============================================
-- 3) SEARCH BY ADDRESS TEXT FRAGMENT
-- ============================================
\echo ''
\echo '--- 3) Search by address fragment ---'
\echo 'Query: address_text ILIKE ''%sebastopol%'''

SELECT entity_type, entity_id, display_label, address_text
FROM trapper.v_search_unified
WHERE address_text ILIKE '%sebastopol%'
LIMIT 10;

\echo ''
\echo 'Query: search_text ILIKE ''%trail%'' (finds messy locations)'

SELECT entity_type, entity_id, display_label, address_text
FROM trapper.v_search_unified
WHERE search_text ILIKE '%trail%'
LIMIT 10;

-- ============================================
-- 4) SEARCH BY CITY OR ZIP
-- ============================================
\echo ''
\echo '--- 4) Search by city or postal code ---'
\echo 'Query: city = ''Sebastopol'' (exact match from JSONB extraction)'

SELECT entity_type, entity_id, display_label, city, postal_code
FROM trapper.v_search_unified
WHERE city = 'Sebastopol'
LIMIT 10;

\echo ''
\echo 'Query: postal_code LIKE ''954%'' (zip prefix)'

SELECT entity_type, entity_id, display_label, city, postal_code
FROM trapper.v_search_unified
WHERE postal_code LIKE '954%'
LIMIT 10;

\echo ''
\echo 'Query: city ILIKE ''%rosa%'' (fuzzy city search)'

SELECT entity_type, entity_id, display_label, city, postal_code
FROM trapper.v_search_unified
WHERE city ILIKE '%rosa%'
LIMIT 10;

-- ============================================
-- 5) SEARCH BY DATE WINDOW
-- ============================================
\echo ''
\echo '--- 5) Search by date window ---'
\echo 'Query: relevant_date between 2026-01-01 and 2026-01-31'

SELECT entity_type, entity_id, display_label,
       relevant_date::date AS date, status
FROM trapper.v_search_unified
WHERE relevant_date >= '2026-01-01'
  AND relevant_date < '2026-02-01'
ORDER BY relevant_date
LIMIT 15;

\echo ''
\echo 'Query: clinichq appointments in next 14 days'

SELECT entity_type, entity_id, display_label,
       relevant_date::date AS appt_date, status
FROM trapper.v_search_unified
WHERE entity_type = 'clinichq_appt'
  AND relevant_date >= CURRENT_DATE
  AND relevant_date < CURRENT_DATE + INTERVAL '14 days'
ORDER BY relevant_date
LIMIT 15;

-- ============================================
-- BONUS: COMBINED SEARCH (multi-field)
-- ============================================
\echo ''
\echo '--- BONUS: Combined multi-field search ---'
\echo 'Query: Full-text across all fields for "cat"'

SELECT entity_type, entity_id, display_label, status
FROM trapper.v_search_unified
WHERE search_text ILIKE '%cat%'
ORDER BY relevant_date DESC NULLS LAST
LIMIT 15;

-- ============================================
-- EXPLAIN ANALYZE EXAMPLE
-- ============================================
\echo ''
\echo '--- EXPLAIN ANALYZE: address search performance ---'

EXPLAIN ANALYZE
SELECT entity_type, entity_id, display_label
FROM trapper.v_search_unified
WHERE address_text ILIKE '%sebastopol%'
LIMIT 10;

\echo ''
\echo '=============================================='
\echo 'SEARCH EXAMPLES COMPLETE'
\echo '=============================================='
