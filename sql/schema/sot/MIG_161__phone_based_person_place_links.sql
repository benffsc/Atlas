-- MIG_161__phone_based_person_place_links.sql
-- Add person-place relationships for people matched via phone
--
-- Problem:
--   MIG_160 matched 5,819 people via email, but 1,434 more can be matched via phone
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_161__phone_based_person_place_links.sql

\echo ''
\echo 'MIG_161: Phone-Based Person-Place Links'
\echo '========================================'
\echo ''

-- ============================================================
-- 1. Check current state
-- ============================================================

\echo 'Current state:'
SELECT
    (SELECT COUNT(*) FROM trapper.sot_people) as total_people,
    (SELECT COUNT(DISTINCT person_id) FROM trapper.person_place_relationships) as people_with_place;

-- ============================================================
-- 2. Find unlinked people who can be matched via phone
-- ============================================================

\echo ''
\echo 'Finding unlinked people with phone matches...'

CREATE TEMP TABLE phone_person_address AS
SELECT DISTINCT
    pi.person_id,
    sr.payload->>'Owner Address' as raw_address,
    LOWER(TRIM(REGEXP_REPLACE(sr.payload->>'Owner Address', '\s+', ' ', 'g'))) as norm_address
FROM trapper.sot_people p
LEFT JOIN trapper.person_place_relationships ppr ON ppr.person_id = p.person_id
JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id AND pi.id_type = 'phone'
JOIN trapper.staged_records sr ON sr.source_table = 'owner_info'
    AND (
        REGEXP_REPLACE(pi.id_value_norm, '[^0-9]', '', 'g') = REGEXP_REPLACE(COALESCE(sr.payload->>'Owner Phone', ''), '[^0-9]', '', 'g')
        OR REGEXP_REPLACE(pi.id_value_norm, '[^0-9]', '', 'g') = REGEXP_REPLACE(COALESCE(sr.payload->>'Owner Cell Phone', ''), '[^0-9]', '', 'g')
    )
WHERE ppr.person_id IS NULL  -- Only unlinked people
  AND LENGTH(REGEXP_REPLACE(pi.id_value_norm, '[^0-9]', '', 'g')) >= 10
  AND sr.payload->>'Owner Address' IS NOT NULL
  AND TRIM(sr.payload->>'Owner Address') != '';

CREATE INDEX idx_ppa_norm ON phone_person_address(norm_address);

\echo 'People matched via phone:'
SELECT COUNT(DISTINCT person_id) as phone_matched FROM phone_person_address;

-- ============================================================
-- 3. Match to places
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

\echo 'Matching to places...'

CREATE TEMP TABLE phone_place_match AS
SELECT DISTINCT
    ppa.person_id,
    pn.place_id,
    ppa.raw_address
FROM phone_person_address ppa
JOIN place_norm pn ON pn.norm_addr = ppa.norm_address;

\echo 'People matched to places:'
SELECT COUNT(DISTINCT person_id) as matched_to_place FROM phone_place_match;

-- ============================================================
-- 4. Insert person_place_relationships
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
    'owner'::trapper.person_place_role,
    0.85,  -- Slightly lower confidence for phone match vs email
    'clinichq',
    'owner_info'
FROM phone_place_match ppm;

\echo 'New relationships created:'
SELECT COUNT(*) as new_links FROM trapper.person_place_relationships WHERE confidence = 0.85;

-- ============================================================
-- 5. Update sot_people.primary_address_id where missing
-- ============================================================

\echo ''
\echo 'Updating primary_address_id on people...'

UPDATE trapper.sot_people sp
SET primary_address_id = sa.address_id
FROM (
    SELECT DISTINCT ON (ppr.person_id) ppr.person_id, pl.formatted_address
    FROM trapper.person_place_relationships ppr
    JOIN trapper.places pl ON pl.place_id = ppr.place_id
    WHERE ppr.confidence = 0.85  -- Only the new phone-matched ones
    ORDER BY ppr.person_id, ppr.confidence DESC, ppr.created_at
) sub
JOIN trapper.sot_addresses sa ON sa.formatted_address = sub.formatted_address
WHERE sp.person_id = sub.person_id
  AND sp.primary_address_id IS NULL;

\echo 'People with primary_address_id updated:'
SELECT COUNT(*) FROM trapper.sot_people WHERE primary_address_id IS NOT NULL;

-- ============================================================
-- 6. Cleanup and verification
-- ============================================================

DROP TABLE phone_person_address;
DROP TABLE place_norm;
DROP TABLE phone_place_match;

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Final state:'
SELECT
    (SELECT COUNT(*) FROM trapper.sot_people) as total_people,
    (SELECT COUNT(DISTINCT person_id) FROM trapper.person_place_relationships) as people_with_place,
    (SELECT COUNT(*) FROM trapper.sot_people WHERE primary_address_id IS NOT NULL) as people_with_primary_addr;

\echo ''
\echo 'Breakdown by match method:'
SELECT
    CASE WHEN confidence = 0.9 THEN 'email' ELSE 'phone' END as match_method,
    COUNT(DISTINCT person_id) as people_count
FROM trapper.person_place_relationships
GROUP BY confidence
ORDER BY confidence DESC;

SELECT 'MIG_161 Complete' AS status;
