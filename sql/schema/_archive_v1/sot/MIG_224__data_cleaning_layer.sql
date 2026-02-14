-- MIG_224: Data Cleaning Layer
--
-- Comprehensive data quality fixes:
-- 1. Fix procedure is_spay/is_neuter based on cat sex (billing errors)
-- 2. Auto-link cats to places via person relationships
-- 3. Create person-place relationships from requests
-- 4. Update sot_cats.sex from appointment data
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_224__data_cleaning_layer.sql

\echo ''
\echo '=============================================='
\echo 'MIG_224: Data Cleaning Layer'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Fix procedure is_spay/is_neuter based on cat sex
--    Male cats cannot be spayed, females cannot be neutered
-- ============================================================

\echo 'Step 1: Fix procedures based on cat sex (billing error correction)...'

-- Fix males marked as spay → should be neuter
UPDATE trapper.cat_procedures cp
SET
  procedure_type = 'neuter',
  is_spay = FALSE,
  is_neuter = TRUE
FROM trapper.sot_cats c
WHERE cp.cat_id = c.cat_id
  AND cp.is_spay = TRUE
  AND LOWER(c.sex) = 'male';

-- Fix females marked as neuter → should be spay
UPDATE trapper.cat_procedures cp
SET
  procedure_type = 'spay',
  is_spay = TRUE,
  is_neuter = FALSE
FROM trapper.sot_cats c
WHERE cp.cat_id = c.cat_id
  AND cp.is_neuter = TRUE
  AND LOWER(c.sex) = 'female';

\echo '  Fixed procedures based on cat sex'

-- ============================================================
-- 2. Create person-place relationships from requests
--    When a person is the requester, they live at that place
-- ============================================================

\echo ''
\echo 'Step 2: Create person-place relationships from requests...'

INSERT INTO trapper.person_place_relationships (
  person_id, place_id, role, confidence, source_system, source_table
)
SELECT DISTINCT
  r.requester_person_id,
  r.place_id,
  'requester'::trapper.person_place_role,
  0.9,  -- high confidence
  'auto_link',
  'mig224_request_requester'
FROM trapper.sot_requests r
WHERE r.requester_person_id IS NOT NULL
  AND r.place_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_place_relationships ppr
    WHERE ppr.person_id = r.requester_person_id
      AND ppr.place_id = r.place_id
  )
ON CONFLICT DO NOTHING;

\echo '  Created person-place relationships from requests'

-- ============================================================
-- 3. Auto-link cats to places via appointments + person
--    appointment.person_id → person_place → cat_place
-- ============================================================

\echo ''
\echo 'Step 3: Auto-link cats to places via person relationships...'

INSERT INTO trapper.cat_place_relationships (
  cat_id, place_id, relationship_type, confidence, source_system, source_table
)
SELECT DISTINCT
  a.cat_id,
  ppr.place_id,
  'appointment_site',
  'high',
  'auto_link',
  'mig224_person_place_link'
FROM trapper.sot_appointments a
JOIN trapper.person_place_relationships ppr ON ppr.person_id = a.person_id
WHERE a.cat_id IS NOT NULL
  AND ppr.place_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_place_relationships cpr
    WHERE cpr.cat_id = a.cat_id
      AND cpr.place_id = ppr.place_id
  )
ON CONFLICT DO NOTHING;

\echo '  Linked cats to places via person relationships'

-- ============================================================
-- 4. Update sot_cats.sex from appointment service_type
--    If service = spay and sex not set → female
--    If service = neuter and sex not set → male
-- ============================================================

\echo ''
\echo 'Step 4: Infer cat sex from service type...'

UPDATE trapper.sot_cats c
SET sex = 'Female'
FROM trapper.sot_appointments a
WHERE a.cat_id = c.cat_id
  AND (c.sex IS NULL OR c.sex = '')
  AND a.service_type ILIKE '%spay%';

UPDATE trapper.sot_cats c
SET sex = 'Male'
FROM trapper.sot_appointments a
WHERE a.cat_id = c.cat_id
  AND (c.sex IS NULL OR c.sex = '')
  AND a.service_type ILIKE '%neuter%';

\echo '  Inferred sex from service types'

-- ============================================================
-- 5. Update sot_cats.altered_status from procedures
-- ============================================================

\echo ''
\echo 'Step 5: Update altered_status from procedures...'

UPDATE trapper.sot_cats c
SET altered_status = 'spayed'
WHERE c.altered_status IS DISTINCT FROM 'spayed'
  AND EXISTS (
    SELECT 1 FROM trapper.cat_procedures cp
    WHERE cp.cat_id = c.cat_id AND cp.is_spay = TRUE
  );

UPDATE trapper.sot_cats c
SET altered_status = 'neutered'
WHERE c.altered_status IS DISTINCT FROM 'neutered'
  AND EXISTS (
    SELECT 1 FROM trapper.cat_procedures cp
    WHERE cp.cat_id = c.cat_id AND cp.is_neuter = TRUE
  );

\echo '  Updated altered_status from procedures'

-- ============================================================
-- 6. VERIFICATION
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Procedure breakdown by type:'
SELECT procedure_type, COUNT(*) as cnt
FROM trapper.cat_procedures
GROUP BY procedure_type
ORDER BY cnt DESC;

\echo ''
\echo 'Remaining service/sex mismatches (should be 0):'
SELECT COUNT(*) as mismatches
FROM trapper.cat_procedures cp
JOIN trapper.sot_cats c ON c.cat_id = cp.cat_id
WHERE (cp.is_spay = TRUE AND LOWER(c.sex) = 'male')
   OR (cp.is_neuter = TRUE AND LOWER(c.sex) = 'female');

\echo ''
\echo 'Person-place relationships:'
SELECT COUNT(*) as total FROM trapper.person_place_relationships;

\echo ''
\echo 'Cat-place relationships:'
SELECT COUNT(*) as total FROM trapper.cat_place_relationships;

\echo ''
\echo 'MIG_224 complete!'
\echo ''
\echo 'Data cleaning applied:'
\echo '  1. Fixed is_spay/is_neuter based on cat sex (billing error correction)'
\echo '  2. Created person-place relationships from requests'
\echo '  3. Auto-linked cats to places via person relationships'
\echo '  4. Inferred cat sex from service types'
\echo '  5. Updated altered_status from procedures'
\echo ''

SELECT 'MIG_224 Complete' AS status;
