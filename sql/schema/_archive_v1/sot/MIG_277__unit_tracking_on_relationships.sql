\echo '=== MIG_243: Unit Number Tracking on Relationships ==='
\echo 'Track unit numbers on cat/person/request relationships, not places'

-- ============================================================
-- 1. Add unit_number to cat_place_relationships
-- ============================================================

\echo ''
\echo 'Adding unit_number to cat_place_relationships...'

ALTER TABLE trapper.cat_place_relationships
ADD COLUMN IF NOT EXISTS unit_number TEXT;

COMMENT ON COLUMN trapper.cat_place_relationships.unit_number IS
'Unit/apartment number where this cat was found (e.g., "4", "12B", "Suite 100")';

-- ============================================================
-- 2. Add unit_number to person_place_relationships
-- ============================================================

\echo 'Adding unit_number to person_place_relationships...'

ALTER TABLE trapper.person_place_relationships
ADD COLUMN IF NOT EXISTS unit_number TEXT;

COMMENT ON COLUMN trapper.person_place_relationships.unit_number IS
'Unit/apartment number where this person lives/works';

-- ============================================================
-- 3. Add unit_number to sot_requests
-- ============================================================

\echo 'Adding unit_number to sot_requests...'

ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS unit_number TEXT;

COMMENT ON COLUMN trapper.sot_requests.unit_number IS
'Unit/apartment number for this request (extracted from intake)';

-- ============================================================
-- 4. Add unit_number to web_intake_submissions
-- ============================================================

\echo 'Adding unit_number to web_intake_submissions...'

ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS unit_number TEXT;

COMMENT ON COLUMN trapper.web_intake_submissions.unit_number IS
'Unit/apartment number extracted from cats_address';

-- Populate from existing addresses
UPDATE trapper.web_intake_submissions
SET unit_number = trapper.extract_unit_number(cats_address)
WHERE unit_number IS NULL;

-- ============================================================
-- 5. Function to get base address (without unit)
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.get_base_address(p_address TEXT)
RETURNS TEXT AS $$
BEGIN
  IF p_address IS NULL THEN
    RETURN NULL;
  END IF;

  -- Remove unit patterns from address
  RETURN TRIM(REGEXP_REPLACE(
    REGEXP_REPLACE(
      p_address,
      '(?i)\s*(apt|apartment|unit|suite|ste|space|bldg|building|#)\s*\.?\s*#?\d+[A-Za-z]?',
      '',
      'gi'
    ),
    '\s+', ' ', 'g'  -- Normalize whitespace
  ));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.get_base_address IS
'Removes unit/apartment number from address, returning just the building address.
Example: "123 Main St Apt 4, City, CA" -> "123 Main St, City, CA"';

-- ============================================================
-- 6. Migrate unit numbers from places to relationships
-- ============================================================

\echo ''
\echo 'Migrating unit numbers to cat_place_relationships...'

-- For cats linked to places that have unit numbers, copy the unit to the relationship
UPDATE trapper.cat_place_relationships cpr
SET unit_number = p.unit_number
FROM trapper.places p
WHERE cpr.place_id = p.place_id
  AND p.unit_number IS NOT NULL
  AND cpr.unit_number IS NULL;

\echo 'Migrating unit numbers to person_place_relationships...'

UPDATE trapper.person_place_relationships ppr
SET unit_number = p.unit_number
FROM trapper.places p
WHERE ppr.place_id = p.place_id
  AND p.unit_number IS NOT NULL
  AND ppr.unit_number IS NULL;

\echo 'Migrating unit numbers to sot_requests...'

UPDATE trapper.sot_requests r
SET unit_number = p.unit_number
FROM trapper.places p
WHERE r.place_id = p.place_id
  AND p.unit_number IS NOT NULL
  AND r.unit_number IS NULL;

-- ============================================================
-- 7. View for place details with unit breakdown
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_place_units AS
SELECT
  p.place_id,
  p.formatted_address,
  p.display_name,
  COUNT(DISTINCT cpr.unit_number) FILTER (WHERE cpr.unit_number IS NOT NULL) as distinct_units,
  COUNT(DISTINCT cpr.cat_id) as total_cats,
  ARRAY_AGG(DISTINCT cpr.unit_number) FILTER (WHERE cpr.unit_number IS NOT NULL) as units_with_cats,
  STRING_AGG(DISTINCT cpr.unit_number, ', ' ORDER BY cpr.unit_number) FILTER (WHERE cpr.unit_number IS NOT NULL) as unit_list
FROM trapper.places p
LEFT JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL
GROUP BY p.place_id, p.formatted_address, p.display_name
ORDER BY COUNT(DISTINCT cpr.unit_number) DESC NULLS LAST;

COMMENT ON VIEW trapper.v_place_units IS
'Shows places with breakdown of units that have cat activity';

-- ============================================================
-- 8. Summary
-- ============================================================

\echo ''
\echo 'Unit migration summary:'
SELECT
  'cat_place_relationships' as table_name,
  COUNT(*) FILTER (WHERE unit_number IS NOT NULL) as with_unit
FROM trapper.cat_place_relationships
UNION ALL
SELECT
  'person_place_relationships',
  COUNT(*) FILTER (WHERE unit_number IS NOT NULL)
FROM trapper.person_place_relationships
UNION ALL
SELECT
  'sot_requests',
  COUNT(*) FILTER (WHERE unit_number IS NOT NULL)
FROM trapper.sot_requests
UNION ALL
SELECT
  'web_intake_submissions',
  COUNT(*) FILTER (WHERE unit_number IS NOT NULL)
FROM trapper.web_intake_submissions;

\echo ''
\echo 'MIG_243 complete!'
\echo ''
\echo 'Unit numbers are now tracked on:'
\echo '  - cat_place_relationships.unit_number'
\echo '  - person_place_relationships.unit_number'
\echo '  - sot_requests.unit_number'
\echo '  - web_intake_submissions.unit_number'
\echo ''
\echo 'New view: v_place_units - shows units with cat activity per place'
\echo ''
