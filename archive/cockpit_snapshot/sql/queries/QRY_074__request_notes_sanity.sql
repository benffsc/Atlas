-- QRY_074__request_notes_sanity.sql
-- Sanity checks for request_notes after Airtable ingest
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/queries/QRY_074__request_notes_sanity.sql

\pset pager off
\echo '=============================================='
\echo 'REQUEST NOTES SANITY CHECKS'
\echo '=============================================='

-- ============================================
-- 1) TOTAL COUNT
-- ============================================
\echo ''
\echo '--- 1) Total Notes Count ---'

SELECT COUNT(*) AS total_notes FROM trapper.request_notes;

-- ============================================
-- 2) COUNT BY NOTE_KIND
-- ============================================
\echo ''
\echo '--- 2) Notes by Kind ---'

SELECT note_kind, COUNT(*) AS count
FROM trapper.request_notes
GROUP BY note_kind
ORDER BY count DESC;

-- ============================================
-- 3) COUNT BY SOURCE_SYSTEM
-- ============================================
\echo ''
\echo '--- 3) Notes by Source System ---'

SELECT COALESCE(source_system, '(null)') AS source_system, COUNT(*) AS count
FROM trapper.request_notes
GROUP BY source_system
ORDER BY count DESC;

-- ============================================
-- 4) NOTES PER REQUEST (top 20)
-- ============================================
\echo ''
\echo '--- 4) Notes per Request (top 20 by note count) ---'

SELECT r.case_number, COUNT(n.id) AS note_count
FROM trapper.requests r
LEFT JOIN trapper.request_notes n ON n.request_id = r.id
GROUP BY r.id, r.case_number
HAVING COUNT(n.id) > 0
ORDER BY note_count DESC
LIMIT 20;

-- ============================================
-- 5) SAMPLE NOTES PREVIEW
-- ============================================
\echo ''
\echo '--- 5) Sample Notes (first 10, body truncated to 120 chars) ---'

SELECT
    r.case_number,
    n.note_kind,
    LEFT(n.note_body, 120) AS note_preview,
    n.created_at::date AS created
FROM trapper.request_notes n
JOIN trapper.requests r ON r.id = n.request_id
ORDER BY n.created_at DESC
LIMIT 10;

-- ============================================
-- 6) NOTE_KEY COVERAGE (idempotency check)
-- ============================================
\echo ''
\echo '--- 6) Note Key Coverage ---'

SELECT
    'with_note_key' AS metric,
    COUNT(*) FILTER (WHERE note_key IS NOT NULL) AS count
FROM trapper.request_notes
UNION ALL
SELECT
    'without_note_key',
    COUNT(*) FILTER (WHERE note_key IS NULL)
FROM trapper.request_notes;

-- ============================================
-- 7) DUPLICATE NOTE_KEY CHECK (should be 0)
-- ============================================
\echo ''
\echo '--- 7) Duplicate Note Keys (should be 0) ---'

SELECT note_key, COUNT(*) AS dupes
FROM trapper.request_notes
WHERE note_key IS NOT NULL
GROUP BY note_key
HAVING COUNT(*) > 1
LIMIT 10;

-- ============================================
-- 8) SPOT CHECK: JOIN TO REQUESTS BY CASE_NUMBER
-- ============================================
\echo ''
\echo '--- 8) Spot Check: Notes with Request Details ---'

SELECT
    r.case_number,
    r.status::text AS request_status,
    n.note_kind,
    LEFT(n.note_body, 80) AS note_preview
FROM trapper.requests r
JOIN trapper.request_notes n ON n.request_id = r.id
WHERE n.note_kind = 'case_info'
ORDER BY r.case_number
LIMIT 5;

-- ============================================
-- 9) PEOPLE PHONE COVERAGE
-- ============================================
\echo ''
\echo '--- 9) People Phone Coverage ---'

SELECT
    'total_people' AS metric,
    COUNT(*) AS count
FROM trapper.people
UNION ALL
SELECT
    'with_phone',
    COUNT(*) FILTER (WHERE phone IS NOT NULL AND phone != '')
FROM trapper.people
UNION ALL
SELECT
    'with_phone_normalized',
    COUNT(*) FILTER (WHERE phone_normalized IS NOT NULL AND phone_normalized != '')
FROM trapper.people;

-- ============================================
-- 10) SAMPLE PEOPLE WITH PHONES
-- ============================================
\echo ''
\echo '--- 10) Sample People with Phones ---'

SELECT first_name, last_name, phone, phone_normalized
FROM trapper.people
WHERE phone IS NOT NULL AND phone != ''
LIMIT 10;

\echo ''
\echo '=============================================='
\echo 'REQUEST NOTES SANITY COMPLETE'
\echo '=============================================='
