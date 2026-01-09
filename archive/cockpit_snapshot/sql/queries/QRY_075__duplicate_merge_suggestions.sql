-- QRY_075__duplicate_merge_suggestions.sql
-- Find potential duplicate requests for manual merge review
--
-- Matches on:
--   1) Spatial proximity (places within 50 meters of each other)
--   2) Address text similarity (trigram similarity > 0.4)
--   3) Primary contact name match
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/queries/QRY_075__duplicate_merge_suggestions.sql

\pset pager off
\echo '=============================================='
\echo 'DUPLICATE MERGE SUGGESTIONS'
\echo '=============================================='

-- ============================================
-- 1) REQUESTS ALREADY MARKED AS DUPLICATES
-- ============================================
\echo ''
\echo '--- 1) Already Marked as Duplicate (archive_reason = duplicate) ---'

SELECT
    r.case_number,
    r.status::text,
    r.archive_reason,
    r.merged_into_case_number,
    p.display_name AS place_name,
    per.first_name || ' ' || per.last_name AS contact_name
FROM trapper.requests r
LEFT JOIN trapper.places p ON p.id = COALESCE(r.primary_place_id, r.place_id)
LEFT JOIN trapper.people per ON per.id = COALESCE(r.primary_contact_person_id, r.person_id)
WHERE r.archive_reason = 'duplicate'
ORDER BY r.case_number;

-- ============================================
-- 2) SPATIAL PROXIMITY MATCHES (within 50m)
-- ============================================
\echo ''
\echo '--- 2) Potential Duplicates: Places within 50 meters ---'

WITH request_places AS (
    SELECT
        r.id AS request_id,
        r.case_number,
        r.status::text AS status,
        r.archive_reason,
        r.created_at,
        p.id AS place_id,
        p.display_name AS place_name,
        a.location,
        a.raw_address,
        per.first_name,
        per.last_name
    FROM trapper.requests r
    JOIN trapper.places p ON p.id = COALESCE(r.primary_place_id, r.place_id)
    JOIN trapper.addresses a ON a.id = COALESCE(p.primary_address_id, p.address_id)
    LEFT JOIN trapper.people per ON per.id = COALESCE(r.primary_contact_person_id, r.person_id)
    WHERE a.location IS NOT NULL
      AND r.archive_reason IS NULL  -- Only non-archived requests
)
SELECT DISTINCT ON (LEAST(rp1.case_number, rp2.case_number), GREATEST(rp1.case_number, rp2.case_number))
    rp1.case_number AS case_a,
    rp2.case_number AS case_b,
    rp1.status AS status_a,
    rp2.status AS status_b,
    ROUND(ST_Distance(rp1.location::geography, rp2.location::geography)::numeric, 1) AS distance_m,
    rp1.place_name AS place_a,
    rp2.place_name AS place_b,
    COALESCE(rp1.first_name || ' ' || rp1.last_name, '') AS contact_a,
    COALESCE(rp2.first_name || ' ' || rp2.last_name, '') AS contact_b
FROM request_places rp1
JOIN request_places rp2 ON rp1.request_id < rp2.request_id
WHERE ST_DWithin(rp1.location::geography, rp2.location::geography, 50)  -- 50 meters
ORDER BY LEAST(rp1.case_number, rp2.case_number), GREATEST(rp1.case_number, rp2.case_number), distance_m
LIMIT 50;

-- ============================================
-- 3) ADDRESS TEXT SIMILARITY (trigram)
-- ============================================
\echo ''
\echo '--- 3) Potential Duplicates: Similar Street Names (trigram > 0.6) ---'

-- Note: Requires pg_trgm extension (usually already enabled)
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Extract just street portion (before city/state) for better matching
WITH request_addresses AS (
    SELECT
        r.id AS request_id,
        r.case_number,
        r.status::text AS status,
        r.archive_reason,
        a.raw_address,
        -- Extract street only (before first comma, which is usually city)
        lower(regexp_replace(split_part(a.raw_address, ',', 1), '[^a-z0-9 ]', '', 'gi')) AS street_normalized,
        per.first_name,
        per.last_name
    FROM trapper.requests r
    JOIN trapper.places p ON p.id = COALESCE(r.primary_place_id, r.place_id)
    JOIN trapper.addresses a ON a.id = COALESCE(p.primary_address_id, p.address_id)
    LEFT JOIN trapper.people per ON per.id = COALESCE(r.primary_contact_person_id, r.person_id)
    WHERE a.raw_address IS NOT NULL
      AND a.raw_address != ''
      AND r.archive_reason IS NULL
)
SELECT DISTINCT ON (LEAST(ra1.case_number, ra2.case_number), GREATEST(ra1.case_number, ra2.case_number))
    ra1.case_number AS case_a,
    ra2.case_number AS case_b,
    ra1.status AS status_a,
    ra2.status AS status_b,
    ROUND(similarity(ra1.street_normalized, ra2.street_normalized)::numeric, 2) AS street_similarity,
    LEFT(ra1.raw_address, 50) AS addr_a,
    LEFT(ra2.raw_address, 50) AS addr_b,
    COALESCE(ra1.first_name || ' ' || ra1.last_name, '') AS contact_a,
    COALESCE(ra2.first_name || ' ' || ra2.last_name, '') AS contact_b
FROM request_addresses ra1
JOIN request_addresses ra2 ON ra1.request_id < ra2.request_id
WHERE similarity(ra1.street_normalized, ra2.street_normalized) > 0.6  -- Higher threshold for street-only
ORDER BY LEAST(ra1.case_number, ra2.case_number), GREATEST(ra1.case_number, ra2.case_number), street_similarity DESC
LIMIT 50;

-- ============================================
-- 4) SAME CONTACT PERSON, DIFFERENT REQUESTS
-- ============================================
\echo ''
\echo '--- 4) Same Contact Person, Multiple Active Requests ---'

WITH contact_requests AS (
    SELECT
        per.id AS person_id,
        per.first_name,
        per.last_name,
        per.email,
        per.phone,
        r.case_number,
        r.status::text AS status,
        r.archive_reason,
        p.display_name AS place_name
    FROM trapper.requests r
    JOIN trapper.people per ON per.id = COALESCE(r.primary_contact_person_id, r.person_id)
    LEFT JOIN trapper.places p ON p.id = COALESCE(r.primary_place_id, r.place_id)
    WHERE r.archive_reason IS NULL
      AND r.status NOT IN ('closed', 'resolved')
)
SELECT
    cr.first_name || ' ' || cr.last_name AS contact_name,
    cr.email,
    cr.phone,
    COUNT(*) AS active_request_count,
    string_agg(cr.case_number || ' (' || cr.status || ')', ', ' ORDER BY cr.case_number) AS cases,
    string_agg(DISTINCT LEFT(cr.place_name, 30), '; ' ORDER BY LEFT(cr.place_name, 30)) AS places
FROM contact_requests cr
GROUP BY cr.person_id, cr.first_name, cr.last_name, cr.email, cr.phone
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 30;

-- ============================================
-- 5) EXACT SAME PLACE, MULTIPLE REQUESTS
-- ============================================
\echo ''
\echo '--- 5) Same Place (place_id), Multiple Active Requests ---'

SELECT
    p.display_name AS place_name,
    a.raw_address,
    COUNT(*) AS request_count,
    string_agg(r.case_number || ' (' || r.status::text || ')', ', ' ORDER BY r.case_number) AS cases
FROM trapper.requests r
JOIN trapper.places p ON p.id = COALESCE(r.primary_place_id, r.place_id)
LEFT JOIN trapper.addresses a ON a.id = COALESCE(p.primary_address_id, p.address_id)
WHERE r.archive_reason IS NULL
  AND r.status NOT IN ('closed', 'resolved')
GROUP BY p.id, p.display_name, a.raw_address
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 30;

-- ============================================
-- 6) SUMMARY STATS
-- ============================================
\echo ''
\echo '--- 6) Duplicate Detection Summary ---'

SELECT
    'Total requests' AS metric,
    COUNT(*)::text AS value
FROM trapper.requests
UNION ALL
SELECT
    'Already marked duplicate',
    COUNT(*)::text
FROM trapper.requests
WHERE archive_reason = 'duplicate'
UNION ALL
SELECT
    'Active (non-archived, non-closed)',
    COUNT(*)::text
FROM trapper.requests
WHERE archive_reason IS NULL
  AND status NOT IN ('closed', 'resolved')
UNION ALL
SELECT
    'With geocoded place',
    COUNT(*)::text
FROM trapper.requests r
JOIN trapper.places p ON p.id = COALESCE(r.primary_place_id, r.place_id)
JOIN trapper.addresses a ON a.id = COALESCE(p.primary_address_id, p.address_id)
WHERE a.location IS NOT NULL;

\echo ''
\echo '=============================================='
\echo 'DUPLICATE MERGE SUGGESTIONS COMPLETE'
\echo '=============================================='
