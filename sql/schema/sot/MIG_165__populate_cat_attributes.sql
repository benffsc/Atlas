-- MIG_165__populate_cat_attributes.sql
-- Populate missing cat attributes (color, breed, sex) from cat_info
-- Also extract weight into cat_vitals
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_165__populate_cat_attributes.sql

\echo ''
\echo 'MIG_165: Populate Cat Attributes'
\echo '================================='
\echo ''

-- ============================================================
-- 1. Check current state
-- ============================================================

\echo 'Current state:'
SELECT
    COUNT(*) as total_cats,
    COUNT(primary_color) FILTER (WHERE primary_color IS NOT NULL AND primary_color != '') as with_color,
    COUNT(breed) FILTER (WHERE breed IS NOT NULL AND breed != '') as with_breed,
    COUNT(sex) FILTER (WHERE sex IS NOT NULL AND sex != '') as with_sex
FROM trapper.sot_cats;

-- ============================================================
-- 2. Add secondary_color column if not exists
-- ============================================================

\echo ''
\echo 'Adding secondary_color column...'
ALTER TABLE trapper.sot_cats ADD COLUMN IF NOT EXISTS secondary_color TEXT;

-- ============================================================
-- 3. Create temp table with cat_info data matched to cats
-- ============================================================

\echo ''
\echo 'Matching cat_info to sot_cats via microchip...'

CREATE TEMP TABLE cat_attributes AS
SELECT DISTINCT ON (ci.cat_id)
    ci.cat_id,
    sr.payload->>'Primary Color' as primary_color,
    sr.payload->>'Secondary Color' as secondary_color,
    sr.payload->>'Breed' as breed,
    sr.payload->>'Sex' as sex,
    CASE
        WHEN sr.payload->>'Weight' ~ '^[0-9]+\.?[0-9]*$'
        THEN (sr.payload->>'Weight')::numeric(5,2)
        ELSE NULL
    END as weight_lbs,
    (sr.payload->>'Date')::date as recorded_date
FROM trapper.cat_identifiers ci
JOIN trapper.staged_records sr ON
    sr.source_table = 'cat_info'
    AND sr.payload->>'Microchip Number' = ci.id_value
WHERE ci.id_type = 'microchip'
ORDER BY ci.cat_id, (sr.payload->>'Date')::date DESC;

\echo 'Cats matched:'
SELECT COUNT(*) FROM cat_attributes;

-- ============================================================
-- 4. Update sot_cats with missing attributes
-- ============================================================

\echo ''
\echo 'Updating primary_color...'
UPDATE trapper.sot_cats c
SET primary_color = ca.primary_color
FROM cat_attributes ca
WHERE c.cat_id = ca.cat_id
  AND (c.primary_color IS NULL OR c.primary_color = '')
  AND ca.primary_color IS NOT NULL
  AND ca.primary_color != '';

\echo 'Updating secondary_color...'
UPDATE trapper.sot_cats c
SET secondary_color = ca.secondary_color
FROM cat_attributes ca
WHERE c.cat_id = ca.cat_id
  AND (c.secondary_color IS NULL OR c.secondary_color = '')
  AND ca.secondary_color IS NOT NULL
  AND ca.secondary_color != '';

\echo 'Updating breed...'
UPDATE trapper.sot_cats c
SET breed = ca.breed
FROM cat_attributes ca
WHERE c.cat_id = ca.cat_id
  AND (c.breed IS NULL OR c.breed = '')
  AND ca.breed IS NOT NULL
  AND ca.breed != '';

\echo 'Updating sex...'
UPDATE trapper.sot_cats c
SET sex = ca.sex
FROM cat_attributes ca
WHERE c.cat_id = ca.cat_id
  AND (c.sex IS NULL OR c.sex = '')
  AND ca.sex IS NOT NULL
  AND ca.sex != '';

-- ============================================================
-- 5. Extract weight into cat_vitals
-- ============================================================

\echo ''
\echo 'Extracting weight into cat_vitals...'

-- Update existing vitals with weight where missing
UPDATE trapper.cat_vitals cv
SET weight_lbs = ca.weight_lbs
FROM cat_attributes ca
WHERE cv.cat_id = ca.cat_id
  AND cv.weight_lbs IS NULL
  AND ca.weight_lbs IS NOT NULL;

-- Insert new vitals for cats with weight but no vital record
INSERT INTO trapper.cat_vitals (
    cat_id,
    recorded_at,
    weight_lbs,
    source_system,
    source_record_id
)
SELECT
    ca.cat_id,
    ca.recorded_date::timestamp with time zone,
    ca.weight_lbs,
    'clinichq',
    'cat_info'
FROM cat_attributes ca
WHERE ca.weight_lbs IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_vitals cv
    WHERE cv.cat_id = ca.cat_id
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- 6. Cleanup and verification
-- ============================================================

DROP TABLE cat_attributes;

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Final state:'
SELECT
    COUNT(*) as total_cats,
    COUNT(primary_color) FILTER (WHERE primary_color IS NOT NULL AND primary_color != '') as with_color,
    COUNT(secondary_color) FILTER (WHERE secondary_color IS NOT NULL AND secondary_color != '') as with_secondary,
    COUNT(breed) FILTER (WHERE breed IS NOT NULL AND breed != '') as with_breed,
    COUNT(sex) FILTER (WHERE sex IS NOT NULL AND sex != '') as with_sex
FROM trapper.sot_cats;

\echo ''
\echo 'Vitals with weight:'
SELECT COUNT(*) as vitals_with_weight
FROM trapper.cat_vitals
WHERE weight_lbs IS NOT NULL;

\echo ''
\echo 'Check the specific cat (981020025921941):'
SELECT c.display_name, c.primary_color, c.secondary_color, c.breed, c.sex,
       cv.weight_lbs, cv.recorded_at
FROM trapper.sot_cats c
JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id
LEFT JOIN trapper.cat_vitals cv ON cv.cat_id = c.cat_id
WHERE ci.id_value = '981020025921941';

SELECT 'MIG_165 Complete' AS status;
