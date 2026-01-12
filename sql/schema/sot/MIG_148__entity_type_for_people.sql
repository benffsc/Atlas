-- MIG_148__entity_type_for_people.sql
-- Add entity_type to distinguish people from sites/businesses
--
-- Problem:
--   sot_people contains both actual people and sites/businesses
--   (e.g., "Cal Eggs FFSC", "Chevron Todd Rd FFSC")
--   Staff can't easily distinguish or filter.
--
-- Solution:
--   Add entity_type column with auto-detection for obvious patterns.
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_148__entity_type_for_people.sql

-- ============================================================
-- 1. Add entity_type column
-- ============================================================

\echo ''
\echo 'Adding entity_type to sot_people...'

ALTER TABLE trapper.sot_people
ADD COLUMN IF NOT EXISTS entity_type TEXT DEFAULT 'person';

COMMENT ON COLUMN trapper.sot_people.entity_type IS
'Type of entity: person, business, site, unknown. Helps distinguish actual people from location-based accounts.';

-- ============================================================
-- 2. Auto-classify obvious patterns
-- ============================================================

\echo 'Auto-classifying FFSC entries as sites...'

-- Mark obvious FFSC entries as sites
UPDATE trapper.sot_people
SET entity_type = 'site', updated_at = NOW()
WHERE display_name ILIKE '% FFSC'
   OR display_name ILIKE '%FFSC %'
   OR display_name ILIKE 'FFSC,%';

\echo 'Auto-classifying duplicate first=last name patterns...'

-- Mark patterns where first name = last name as unknown (likely site or address)
-- These need manual review
UPDATE trapper.sot_people
SET entity_type = 'unknown', updated_at = NOW()
WHERE display_name ~ '^(.+) \1$'  -- Pattern like "Cal Eggs FFSC Cal Eggs FFSC"
  AND entity_type = 'person';

-- ============================================================
-- 3. Verification
-- ============================================================

\echo ''
\echo 'Entity type distribution:'
SELECT
    entity_type,
    COUNT(*) as count
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
GROUP BY entity_type
ORDER BY count DESC;

\echo ''
\echo 'Sample sites:'
SELECT display_name, entity_type
FROM trapper.sot_people
WHERE entity_type = 'site'
LIMIT 10;

\echo ''
\echo 'Sample unknown (need review):'
SELECT display_name, entity_type
FROM trapper.sot_people
WHERE entity_type = 'unknown'
LIMIT 10;

SELECT 'MIG_148 Complete' AS status;
