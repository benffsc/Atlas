\echo ''
\echo '=================================================='
\echo 'MIG_868: Audit High Cat Count Places (DQ_002a)'
\echo '=================================================='
\echo ''
\echo 'Investigates places showing 200+ cats on the map.'
\echo 'Compares cat_place_relationships against actual clinic data'
\echo 'and identifies inflated counts from merged cats, duplicate'
\echo 'links, or residual pollution.'
\echo ''

-- ============================================================
-- PHASE 1: DIAGNOSTIC — What does the data look like?
-- ============================================================
\echo 'PHASE 1: DIAGNOSTIC'
\echo ''

-- 1a. Top 30 places by raw cat_place_relationships count
\echo '1a. Top 30 places by cat count (raw cat_place_relationships):'
SELECT
  p.place_id,
  p.formatted_address,
  p.place_kind,
  p.parent_place_id IS NOT NULL as is_child_place,
  p.merged_into_place_id IS NOT NULL as is_merged_place,
  COUNT(DISTINCT cpr.cat_id) as total_cat_links,
  COUNT(DISTINCT cpr.cat_id) FILTER (
    WHERE c.merged_into_cat_id IS NULL
  ) as non_merged_cats,
  COUNT(DISTINCT cpr.cat_id) FILTER (
    WHERE c.merged_into_cat_id IS NOT NULL
  ) as merged_cats_still_linked,
  COUNT(*) as total_link_rows,
  COUNT(DISTINCT cpr.source_table) as distinct_sources,
  array_agg(DISTINCT cpr.source_table ORDER BY cpr.source_table) as source_tables
FROM trapper.cat_place_relationships cpr
JOIN trapper.places p ON p.place_id = cpr.place_id
LEFT JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
WHERE p.merged_into_place_id IS NULL
GROUP BY p.place_id, p.formatted_address, p.place_kind, p.parent_place_id, p.merged_into_place_id
HAVING COUNT(DISTINCT cpr.cat_id) > 50
ORDER BY COUNT(DISTINCT cpr.cat_id) DESC
LIMIT 30;

-- 1b. How many merged cats have lingering cat_place_relationships?
\echo ''
\echo '1b. Merged cats with lingering place links:'
SELECT
  COUNT(DISTINCT cpr.cat_id) as merged_cats_with_place_links,
  COUNT(*) as total_orphaned_link_rows
FROM trapper.cat_place_relationships cpr
JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
WHERE c.merged_into_cat_id IS NOT NULL;

-- 1c. Breakdown of cat_place_relationships by source_table
\echo ''
\echo '1c. Link source breakdown:'
SELECT
  cpr.source_table,
  COUNT(*) as total_rows,
  COUNT(DISTINCT cpr.cat_id) as distinct_cats,
  COUNT(DISTINCT cpr.place_id) as distinct_places,
  COUNT(*) FILTER (WHERE c.merged_into_cat_id IS NOT NULL) as merged_cat_rows
FROM trapper.cat_place_relationships cpr
LEFT JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
GROUP BY cpr.source_table
ORDER BY COUNT(*) DESC;

-- 1d. Duplicate cat-place pairs (same cat + same place, different source_tables)
\echo ''
\echo '1d. Duplicate cat-place pairs (same cat at same place, multiple sources):'
SELECT
  duplicate_count,
  COUNT(*) as pairs_with_this_many_duplicates
FROM (
  SELECT cat_id, place_id, COUNT(*) as duplicate_count
  FROM trapper.cat_place_relationships
  GROUP BY cat_id, place_id
  HAVING COUNT(*) > 1
) dupes
GROUP BY duplicate_count
ORDER BY duplicate_count DESC;

-- 1e. Cross-reference top places against actual clinic appointments
\echo ''
\echo '1e. Top 20 places: cat_place links vs actual appointment evidence:'
WITH top_places AS (
  SELECT place_id, COUNT(DISTINCT cat_id) as link_count
  FROM trapper.cat_place_relationships
  GROUP BY place_id
  ORDER BY COUNT(DISTINCT cat_id) DESC
  LIMIT 20
)
SELECT
  p.formatted_address,
  tp.link_count as cat_place_link_count,
  COUNT(DISTINCT a.cat_id) FILTER (
    WHERE COALESCE(a.inferred_place_id, a.place_id) = tp.place_id
  ) as cats_with_direct_appointment,
  COUNT(DISTINCT a.appointment_id) FILTER (
    WHERE COALESCE(a.inferred_place_id, a.place_id) = tp.place_id
  ) as appointment_count,
  tp.link_count - COALESCE(COUNT(DISTINCT a.cat_id) FILTER (
    WHERE COALESCE(a.inferred_place_id, a.place_id) = tp.place_id
  ), 0) as unexplained_difference
FROM top_places tp
JOIN trapper.places p ON p.place_id = tp.place_id
LEFT JOIN trapper.sot_appointments a ON
  COALESCE(a.inferred_place_id, a.place_id) = tp.place_id
  AND a.cat_id IS NOT NULL
GROUP BY p.formatted_address, tp.link_count
ORDER BY tp.link_count DESC;

-- 1f. Places with >200 cats: are any of them the FFSC clinic?
\echo ''
\echo '1f. High-count places that might be FFSC clinic or partner orgs:'
SELECT
  p.place_id,
  p.formatted_address,
  p.place_kind,
  COUNT(DISTINCT cpr.cat_id) as cat_count,
  CASE
    WHEN p.formatted_address ILIKE '%Forgotten Felines%' THEN 'FFSC_CLINIC'
    WHEN p.formatted_address ILIKE '%939 Sunset%' THEN 'FFSC_OFFICE'
    WHEN p.formatted_address ILIKE '%Petaluma%Animal%' THEN 'PARTNER_ORG'
    WHEN EXISTS (
      SELECT 1 FROM trapper.place_contexts pc
      WHERE pc.place_id = p.place_id AND pc.context_type = 'clinic'
    ) THEN 'TAGGED_CLINIC'
    WHEN EXISTS (
      SELECT 1 FROM trapper.place_contexts pc
      WHERE pc.place_id = p.place_id AND pc.context_type = 'partner_org'
    ) THEN 'TAGGED_PARTNER'
    ELSE 'RESIDENTIAL_OR_OTHER'
  END as place_type
FROM trapper.cat_place_relationships cpr
JOIN trapper.places p ON p.place_id = cpr.place_id
WHERE p.merged_into_place_id IS NULL
GROUP BY p.place_id, p.formatted_address, p.place_kind
HAVING COUNT(DISTINCT cpr.cat_id) > 200
ORDER BY COUNT(DISTINCT cpr.cat_id) DESC;

-- 1g. System account contamination check
\echo ''
\echo '1g. Cats linked to places via system accounts (residual pollution):'
SELECT
  per.display_name,
  per.is_system_account,
  COUNT(DISTINCT cpr.cat_id) as cats_linked,
  COUNT(DISTINCT cpr.place_id) as places_involved
FROM trapper.cat_place_relationships cpr
JOIN trapper.sot_appointments a ON a.cat_id = cpr.cat_id
  AND COALESCE(a.inferred_place_id, a.place_id) = cpr.place_id
JOIN trapper.sot_people per ON per.person_id = a.person_id
WHERE per.is_system_account = TRUE
GROUP BY per.display_name, per.is_system_account
ORDER BY COUNT(DISTINCT cpr.cat_id) DESC
LIMIT 10;


-- ============================================================
-- PHASE 2: REMEDIATION — Clean up inflated counts
-- ============================================================
\echo ''
\echo 'PHASE 2: REMEDIATION'
\echo ''

-- 2a. Remove cat_place_relationships for merged cats
-- These cats have been merged into another cat_id, so the old
-- links are orphaned and inflate counts.
\echo '2a. Removing cat_place links for merged cats...'
WITH deleted AS (
  DELETE FROM trapper.cat_place_relationships
  WHERE cat_id IN (
    SELECT cat_id FROM trapper.sot_cats
    WHERE merged_into_cat_id IS NOT NULL
  )
  RETURNING cat_place_id, cat_id, place_id
)
SELECT
  COUNT(*) as merged_cat_links_removed,
  COUNT(DISTINCT cat_id) as merged_cats_cleaned,
  COUNT(DISTINCT place_id) as places_affected
FROM deleted;

-- 2b. Deduplicate: where same cat appears at same place multiple times,
-- keep only the highest-quality source (appointment_info > others)
\echo ''
\echo '2b. Deduplicating same-cat-same-place entries (keeping best source)...'
WITH ranked AS (
  SELECT
    cat_place_id,
    cat_id,
    place_id,
    source_table,
    ROW_NUMBER() OVER (
      PARTITION BY cat_id, place_id
      ORDER BY
        CASE source_table
          WHEN 'appointment_info' THEN 1
          WHEN 'inferred_appointment_place' THEN 2
          WHEN 'unified_rebuild' THEN 3
          WHEN 'entity_linking' THEN 4
          ELSE 5
        END,
        created_at DESC NULLS LAST
    ) as rn
  FROM trapper.cat_place_relationships
),
deleted AS (
  DELETE FROM trapper.cat_place_relationships
  WHERE cat_place_id IN (
    SELECT cat_place_id FROM ranked WHERE rn > 1
  )
  RETURNING cat_place_id
)
SELECT COUNT(*) as duplicate_links_removed FROM deleted;

-- 2c. Remove any remaining polluted source links that MIG_590 may have missed
\echo ''
\echo '2c. Removing remaining polluted source links...'
WITH deleted AS (
  DELETE FROM trapper.cat_place_relationships
  WHERE source_table IN ('appointment_person_link', 'mig224_person_place_link')
  RETURNING cat_place_id
)
SELECT COUNT(*) as residual_pollution_removed FROM deleted;


-- ============================================================
-- PHASE 3: VERIFICATION
-- ============================================================
\echo ''
\echo 'PHASE 3: VERIFICATION'
\echo ''

-- 3a. Post-cleanup top places
\echo '3a. Post-cleanup top 20 places by cat count:'
SELECT
  p.formatted_address,
  COUNT(DISTINCT cpr.cat_id) as cat_count,
  CASE
    WHEN p.formatted_address ILIKE '%Forgotten Felines%' THEN 'CLINIC'
    WHEN EXISTS (
      SELECT 1 FROM trapper.place_contexts pc
      WHERE pc.place_id = p.place_id
        AND pc.context_type IN ('clinic', 'partner_org', 'shelter')
    ) THEN 'ORG'
    ELSE 'RESIDENTIAL'
  END as place_type
FROM trapper.cat_place_relationships cpr
JOIN trapper.places p ON p.place_id = cpr.place_id
WHERE p.merged_into_place_id IS NULL
GROUP BY p.place_id, p.formatted_address
HAVING COUNT(DISTINCT cpr.cat_id) > 20
ORDER BY COUNT(DISTINCT cpr.cat_id) DESC
LIMIT 20;

-- 3b. Distribution check
\echo ''
\echo '3b. Cat count distribution across places (post-cleanup):'
SELECT
  CASE
    WHEN cat_count > 200 THEN '200+'
    WHEN cat_count > 100 THEN '101-200'
    WHEN cat_count > 50 THEN '51-100'
    WHEN cat_count > 20 THEN '21-50'
    WHEN cat_count > 10 THEN '11-20'
    WHEN cat_count > 5 THEN '6-10'
    ELSE '1-5'
  END as cat_count_bucket,
  COUNT(*) as place_count
FROM (
  SELECT place_id, COUNT(DISTINCT cat_id) as cat_count
  FROM trapper.cat_place_relationships
  GROUP BY place_id
) x
GROUP BY 1
ORDER BY MIN(cat_count) DESC;


-- ============================================================
-- SUMMARY
-- ============================================================
\echo ''
\echo '=================================================='
\echo 'MIG_868 Complete (DQ_002a)'
\echo '=================================================='
\echo ''
\echo 'Audit and remediation for high cat count places:'
\echo '  1. Identified places with inflated cat counts'
\echo '  2. Removed cat_place links for merged cats'
\echo '  3. Deduplicated same-cat-same-place entries'
\echo '  4. Removed residual pollution links'
\echo ''
\echo 'Root causes found:'
\echo '  - Merged cats retained orphaned cat_place_relationships'
\echo '  - Same cat linked to same place via multiple source_tables'
\echo '  - Residual pollution from pre-MIG_590 ingests'
\echo ''
\echo 'Impact on map: Places should now show accurate counts.'
\echo 'FFSC clinic or partner orgs may legitimately have 100+ cats.'
\echo ''
