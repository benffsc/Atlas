-- MIG_160__rebuild_person_place_relationships.sql
-- Rebuild person-place relationships from source data
--
-- Problem:
--   MIG_157 cleared person_place_relationships when cleaning up bad person data
--   but never rebuilt them. Result: 0 person-place links despite having addresses.
--
-- Solution:
--   1. Match people to their addresses via email in staged_records
--   2. Match addresses to places (via formatted_address)
--   3. Create person_place_relationships
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_160__rebuild_person_place_relationships.sql

\echo ''
\echo 'MIG_160: Rebuild Person-Place Relationships'
\echo '============================================'
\echo ''

-- ============================================================
-- 1. Check current state
-- ============================================================

\echo 'Current state:'
SELECT
    (SELECT COUNT(*) FROM trapper.sot_people) as total_people,
    (SELECT COUNT(DISTINCT person_id) FROM trapper.person_place_relationships) as people_with_place,
    (SELECT COUNT(*) FROM trapper.places) as total_places;

-- ============================================================
-- 2. Create temp table matching people to addresses via email
-- ============================================================

\echo ''
\echo 'Matching people to addresses via email...'

CREATE TEMP TABLE person_address_match AS
SELECT DISTINCT
    pi.person_id,
    sr.payload->>'Owner Address' as raw_address,
    LOWER(TRIM(REGEXP_REPLACE(sr.payload->>'Owner Address', '\s+', ' ', 'g'))) as norm_address
FROM trapper.person_identifiers pi
JOIN trapper.staged_records sr ON
    pi.id_type = 'email'
    AND LOWER(pi.id_value_norm) = LOWER(sr.payload->>'Owner Email')
WHERE sr.source_table = 'owner_info'
  AND sr.payload->>'Owner Address' IS NOT NULL
  AND TRIM(sr.payload->>'Owner Address') != '';

\echo 'People matched via email:'
SELECT COUNT(DISTINCT person_id) as people_via_email FROM person_address_match;

-- Create index on temp table for faster joining
CREATE INDEX idx_pam_norm ON person_address_match(norm_address);

-- ============================================================
-- 3. Prepare places with normalized addresses for matching
-- ============================================================

\echo ''
\echo 'Preparing normalized place addresses...'

CREATE TEMP TABLE place_norm AS
SELECT
    place_id,
    LOWER(TRIM(REGEXP_REPLACE(formatted_address, '\s+', ' ', 'g'))) as norm_addr
FROM trapper.places
WHERE formatted_address IS NOT NULL;

CREATE INDEX idx_pn_norm ON place_norm(norm_addr);

-- ============================================================
-- 4. Match addresses to places
-- ============================================================

\echo ''
\echo 'Matching addresses to places...'

CREATE TEMP TABLE person_place_match AS
SELECT DISTINCT
    pam.person_id,
    pn.place_id,
    pam.raw_address
FROM person_address_match pam
JOIN place_norm pn ON pn.norm_addr = pam.norm_address;

\echo 'People matched to existing places:'
SELECT COUNT(DISTINCT person_id) as people_matched FROM person_place_match;

\echo ''
\echo 'Sample unmatched addresses (top 10):'
SELECT pam.raw_address, COUNT(*) as person_count
FROM person_address_match pam
LEFT JOIN person_place_match ppm ON pam.person_id = ppm.person_id
WHERE ppm.person_id IS NULL
GROUP BY pam.raw_address
ORDER BY person_count DESC
LIMIT 10;

-- ============================================================
-- 5. Insert person_place_relationships
-- ============================================================

\echo ''
\echo 'Inserting person-place relationships...'

INSERT INTO trapper.person_place_relationships (
    person_id,
    place_id,
    role,
    confidence,
    source_system,
    source_table
)
SELECT DISTINCT
    ppm.person_id,
    ppm.place_id,
    'owner'::trapper.person_place_role,  -- From owner_info data
    0.9,  -- High confidence - direct address match
    'clinichq',
    'owner_info'
FROM person_place_match ppm;

\echo 'Person-place relationships created:'
SELECT COUNT(*) as links_created FROM trapper.person_place_relationships;

-- ============================================================
-- 6. Update sot_people.primary_address_id where missing
-- ============================================================

\echo ''
\echo 'Updating primary_address_id on people...'

-- primary_address_id references sot_addresses, not places
-- Match via formatted_address
UPDATE trapper.sot_people sp
SET primary_address_id = sa.address_id
FROM (
    SELECT DISTINCT ON (ppr.person_id) ppr.person_id, pl.formatted_address
    FROM trapper.person_place_relationships ppr
    JOIN trapper.places pl ON pl.place_id = ppr.place_id
    ORDER BY ppr.person_id, ppr.confidence DESC, ppr.created_at
) sub
JOIN trapper.sot_addresses sa ON sa.formatted_address = sub.formatted_address
WHERE sp.person_id = sub.person_id
  AND sp.primary_address_id IS NULL;

\echo 'People with primary_address_id:'
SELECT COUNT(*) FROM trapper.sot_people WHERE primary_address_id IS NOT NULL;

-- ============================================================
-- 7. Cleanup and verification
-- ============================================================

DROP TABLE person_address_match;
DROP TABLE place_norm;
DROP TABLE person_place_match;

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Final state:'
SELECT
    (SELECT COUNT(*) FROM trapper.sot_people) as total_people,
    (SELECT COUNT(DISTINCT person_id) FROM trapper.person_place_relationships) as people_with_place,
    (SELECT COUNT(*) FROM trapper.sot_people WHERE primary_address_id IS NOT NULL) as people_with_primary_addr;

\echo ''
\echo 'Sample of person-place links:'
SELECT
    p.display_name as person_name,
    pl.display_name as place_name
FROM trapper.person_place_relationships ppr
JOIN trapper.sot_people p ON p.person_id = ppr.person_id
JOIN trapper.places pl ON pl.place_id = ppr.place_id
LIMIT 10;

SELECT 'MIG_160 Complete' AS status;
