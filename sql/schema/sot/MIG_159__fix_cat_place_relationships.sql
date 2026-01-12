-- MIG_159__fix_cat_place_relationships.sql
-- Rebuild cat-place relationships from appointments (not person addresses)
--
-- Problem:
--   1. cat_place_relationships were created before MIG_157 cleanup
--   2. They linked cats via bad person data (e.g., "939 Sunset Ave. FFSC")
--   3. This caused 1,273 cats to be linked to FFSC's address incorrectly
--   4. person_place_relationships was cleared but never rebuilt
--
-- Solution:
--   1. Clear stale cat_place_relationships
--   2. Rebuild cat-place links from appointments (which have correct place_ids)
--   3. This is more direct and accurate than person addresses
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_159__fix_cat_place_relationships.sql

\echo ''
\echo 'MIG_159: Fix Cat-Place Relationships'
\echo '====================================='
\echo ''

-- ============================================================
-- 1. Backup current cat_place_relationships
-- ============================================================

\echo 'Backing up current cat_place_relationships...'

DROP TABLE IF EXISTS trapper.backup_cat_place_relationships_mig159;
CREATE TABLE trapper.backup_cat_place_relationships_mig159 AS
SELECT * FROM trapper.cat_place_relationships;

\echo 'Backed up rows:'
SELECT COUNT(*) as backed_up FROM trapper.backup_cat_place_relationships_mig159;

-- ============================================================
-- 2. Clear stale cat_place_relationships
-- ============================================================

\echo ''
\echo 'Clearing stale cat_place_relationships...'

DELETE FROM trapper.cat_place_relationships;

\echo 'Cleared.'

-- ============================================================
-- 3. Rebuild cat-place links from appointments
-- ============================================================

\echo ''
\echo 'Rebuilding cat-place links from appointments...'

-- Link cats to places where they had appointments
INSERT INTO trapper.cat_place_relationships (
    cat_id,
    place_id,
    relationship_type,
    confidence,
    source_system,
    source_table,
    evidence
)
SELECT DISTINCT
    a.cat_id,
    a.place_id,
    'appointment_site',  -- More accurate than 'home'
    'high',
    'clinichq',
    'appointment_info',
    jsonb_build_object(
        'link_method', 'appointment_place',
        'appointment_count', COUNT(*) OVER (PARTITION BY a.cat_id, a.place_id),
        'first_appt', MIN(a.appointment_date) OVER (PARTITION BY a.cat_id, a.place_id),
        'last_appt', MAX(a.appointment_date) OVER (PARTITION BY a.cat_id, a.place_id),
        'linked_at', NOW()::text
    )
FROM trapper.sot_appointments a
WHERE a.cat_id IS NOT NULL
  AND a.place_id IS NOT NULL;

\echo 'Cat-place links from appointments:'
SELECT COUNT(*) as links_created FROM trapper.cat_place_relationships;

-- ============================================================
-- 4. Update places.has_cat_activity flag
-- ============================================================

\echo ''
\echo 'Updating place activity flags...'

-- Clear old flags first
UPDATE trapper.places SET has_cat_activity = FALSE;

-- Set flag where cats are linked
UPDATE trapper.places p
SET
    has_cat_activity = TRUE,
    last_activity_at = COALESCE(
        (SELECT MAX(a.appointment_date) FROM trapper.sot_appointments a WHERE a.place_id = p.place_id),
        last_activity_at,
        NOW()
    ),
    updated_at = NOW()
WHERE EXISTS (
    SELECT 1 FROM trapper.cat_place_relationships cpr
    WHERE cpr.place_id = p.place_id
);

\echo 'Places with cat activity:'
SELECT COUNT(*) FROM trapper.places WHERE has_cat_activity = TRUE;

-- ============================================================
-- 5. Clean up invalid places (no street address)
-- ============================================================

\echo ''
\echo 'Identifying invalid places (no street address)...'

SELECT place_id, display_name, formatted_address
FROM trapper.places
WHERE formatted_address ~ '^,\s*[A-Za-z]'  -- Starts with comma
   OR LENGTH(TRIM(SPLIT_PART(formatted_address, ',', 1))) < 3;

-- Don't delete - just flag for review
-- Future: Add to review queue

-- ============================================================
-- 6. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Cat-place relationship stats:'
SELECT
    relationship_type,
    confidence,
    COUNT(*) as link_count,
    COUNT(DISTINCT cat_id) as unique_cats,
    COUNT(DISTINCT place_id) as unique_places
FROM trapper.cat_place_relationships
GROUP BY relationship_type, confidence;

\echo ''
\echo 'Top 10 places by cat count (should be realistic now):'
SELECT
    p.display_name,
    COUNT(DISTINCT cpr.cat_id) as cat_count,
    COUNT(DISTINCT a.appointment_id) as appt_count
FROM trapper.places p
LEFT JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
LEFT JOIN trapper.sot_appointments a ON a.place_id = p.place_id
GROUP BY p.place_id, p.display_name
ORDER BY cat_count DESC
LIMIT 10;

\echo ''
\echo 'Check 939 Sunset Ave specifically (should have ~1 cat):'
SELECT
    p.display_name,
    COUNT(DISTINCT cpr.cat_id) as cat_count
FROM trapper.places p
LEFT JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
WHERE p.formatted_address ILIKE '%939 Sunset%'
GROUP BY p.place_id, p.display_name;

\echo ''
\echo 'Comparison to backup:'
SELECT
    (SELECT COUNT(DISTINCT cat_id) FROM trapper.backup_cat_place_relationships_mig159) as old_cats_linked,
    (SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_place_relationships) as new_cats_linked,
    (SELECT COUNT(DISTINCT place_id) FROM trapper.backup_cat_place_relationships_mig159) as old_places_used,
    (SELECT COUNT(DISTINCT place_id) FROM trapper.cat_place_relationships) as new_places_used;

SELECT 'MIG_159 Complete' AS status;
