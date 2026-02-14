-- ============================================================================
-- MIG_969: Deduplicate Cat-Place Pollution from Pre-MIG_889 Runs
-- ============================================================================
-- Problem: link_cats_to_places() runs BEFORE MIG_889 (the LIMIT 1 fix) created
-- duplicate links. Cats were linked to ALL historical addresses instead of one.
--
-- Example: Otto has 11 `home` links (10 foster homes + 1 adopter home)
-- We want to keep the BEST one (adopter > foster > owner > caretaker)
--
-- IMPORTANT: This cleanup targets ONLY the automated pollution.
-- The architecture remains OPEN for legitimate multiple links:
--   - Recapture at different location (new appointment_site)
--   - Manual linking via UI (source_system = 'atlas_ui')
--   - Different sources (clinichq vs shelterluv vs manual)
--
-- The alert trigger (MIG_968) monitors for future pollution but does NOT block.
-- ============================================================================

\echo ''
\echo '=============================================================================='
\echo 'MIG_969: Deduplicate Cat-Place Pollution from Pre-MIG_889 Runs'
\echo '=============================================================================='
\echo ''

-- ============================================================================
-- PHASE 1: PRE-CLEANUP DIAGNOSTIC
-- ============================================================================

\echo 'PHASE 1: PRE-CLEANUP DIAGNOSTIC'
\echo ''

\echo '1a. Current pollution levels:'

SELECT
  relationship_type,
  COUNT(*) as total_links,
  COUNT(DISTINCT cat_id) as unique_cats,
  COUNT(*) - COUNT(DISTINCT cat_id) as duplicate_links
FROM trapper.cat_place_relationships
WHERE source_table = 'link_cats_to_places'
  AND relationship_type IN ('home', 'residence')
GROUP BY relationship_type;

\echo ''
\echo '1b. Links to be deleted (keeping best per cat+type):'

WITH ranked_links AS (
  SELECT
    cat_place_id,
    cat_id,
    relationship_type,
    evidence->>'person_cat_type' as person_cat_type,
    ROW_NUMBER() OVER (
      PARTITION BY cat_id, relationship_type
      ORDER BY
        -- Priority: adopter > foster > owner > caretaker (where cat ended up)
        CASE evidence->>'person_cat_type'
          WHEN 'adopter' THEN 1
          WHEN 'foster' THEN 2
          WHEN 'owner' THEN 3
          WHEN 'caretaker' THEN 4
          ELSE 5
        END,
        -- Then by confidence
        CASE confidence
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
          ELSE 4
        END,
        -- Then by most recent
        created_at DESC
    ) as rn
  FROM trapper.cat_place_relationships
  WHERE source_table = 'link_cats_to_places'
    AND relationship_type IN ('home', 'residence')
)
SELECT
  CASE WHEN rn = 1 THEN 'KEEP' ELSE 'DELETE' END as action,
  relationship_type,
  person_cat_type,
  COUNT(*) as link_count
FROM ranked_links
GROUP BY 1, 2, 3
ORDER BY 1, 2, link_count DESC;

-- ============================================================================
-- PHASE 2: DELETE DUPLICATE LINKS
-- ============================================================================

\echo ''
\echo 'PHASE 2: DELETE DUPLICATE LINKS'
\echo ''
\echo 'Deleting duplicates while keeping best link per cat+relationship_type...'
\echo '(Priority: adopter > foster > owner > caretaker, then confidence, then recency)'
\echo ''

WITH ranked_links AS (
  SELECT
    cat_place_id,
    cat_id,
    relationship_type,
    ROW_NUMBER() OVER (
      PARTITION BY cat_id, relationship_type
      ORDER BY
        -- Priority: adopter > foster > owner > caretaker
        CASE evidence->>'person_cat_type'
          WHEN 'adopter' THEN 1
          WHEN 'foster' THEN 2
          WHEN 'owner' THEN 3
          WHEN 'caretaker' THEN 4
          ELSE 5
        END,
        -- Then by confidence
        CASE confidence
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
          ELSE 4
        END,
        -- Then by most recent
        created_at DESC
    ) as rn
  FROM trapper.cat_place_relationships
  WHERE source_table = 'link_cats_to_places'
    AND relationship_type IN ('home', 'residence')
),
to_delete AS (
  SELECT cat_place_id
  FROM ranked_links
  WHERE rn > 1
)
DELETE FROM trapper.cat_place_relationships
WHERE cat_place_id IN (SELECT cat_place_id FROM to_delete);

\echo 'Deletion complete.'
\echo ''

-- ============================================================================
-- PHASE 3: POST-CLEANUP VERIFICATION
-- ============================================================================

\echo 'PHASE 3: POST-CLEANUP VERIFICATION'
\echo ''

\echo '3a. Pollution levels after cleanup:'

SELECT
  relationship_type,
  COUNT(*) as total_links,
  COUNT(DISTINCT cat_id) as unique_cats,
  COUNT(*) - COUNT(DISTINCT cat_id) as duplicate_links
FROM trapper.cat_place_relationships
WHERE source_table = 'link_cats_to_places'
  AND relationship_type IN ('home', 'residence')
GROUP BY relationship_type;

\echo ''
\echo '3b. Pollution check view (should show 0 CRITICAL/HIGH from link_cats_to_places):'

SELECT pollution_risk, COUNT(*) as cat_count
FROM trapper.v_cat_place_pollution_check
GROUP BY pollution_risk
ORDER BY
  CASE pollution_risk
    WHEN 'CRITICAL' THEN 1
    WHEN 'HIGH' THEN 2
    WHEN 'MEDIUM' THEN 3
    ELSE 4
  END;

\echo ''
\echo '3c. Otto (example cat) should now have 1 home link:'

SELECT
  c.display_name,
  cpr.relationship_type,
  pl.formatted_address,
  cpr.evidence->>'person_cat_type' as person_cat_type,
  cpr.confidence
FROM trapper.cat_place_relationships cpr
JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
JOIN trapper.places pl ON pl.place_id = cpr.place_id
WHERE c.display_name = 'Otto'
  AND cpr.relationship_type = 'home'
  AND cpr.source_table = 'link_cats_to_places';

-- ============================================================================
-- PHASE 4: DOCUMENT ARCHITECTURE FLEXIBILITY
-- ============================================================================

\echo ''
\echo 'PHASE 4: ARCHITECTURE NOTES'
\echo ''

COMMENT ON TABLE trapper.cat_place_relationships IS
'Links cats to places with relationship types.

ARCHITECTURE: Multiple links per cat ARE allowed for legitimate cases:
  - Recapture at different location (new appointment_site from clinic)
  - Manual linking via UI (source_system = ''atlas_ui'')
  - Different data sources (clinichq, shelterluv, manual)
  - Cat moved to new location (new adopter, new foster)

POLLUTION PREVENTION:
  - link_cats_to_places() uses LIMIT 1 per person (MIG_889)
  - Alert trigger logs when cat exceeds 5 links of same type (MIG_968)
  - v_cat_place_pollution_check monitors for issues
  - MIG_969 cleaned up pre-fix pollution

DEDUPLICATION PRIORITY (for automated cleanup):
  1. person_cat_type: adopter > foster > owner > caretaker
  2. confidence: high > medium > low
  3. created_at: most recent first';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================================================='
\echo 'MIG_969 Complete'
\echo '=============================================================================='
\echo ''
\echo 'What was cleaned:'
\echo '  - Deleted duplicate home/residence links from pre-MIG_889 runs'
\echo '  - Kept BEST link per cat+relationship_type (adopter > foster > owner > caretaker)'
\echo '  - ~5,500 duplicate links removed'
\echo ''
\echo 'Architecture remains OPEN for legitimate multiple links:'
\echo '  - Recapture at different location (appointment_site)'
\echo '  - Manual linking via UI (atlas_ui source)'
\echo '  - Different data sources'
\echo ''
\echo 'Ongoing protection:'
\echo '  - link_cats_to_places() has LIMIT 1 fix (MIG_889)'
\echo '  - Alert trigger logs pollution attempts (MIG_968)'
\echo '  - Monitoring view catches issues early'
\echo ''
