-- ============================================================================
-- MIG_555: Link Adopted Cats to Adopter Addresses
-- ============================================================================
-- ShelterLuv adoption outcomes create:
--   person_cat_relationships (adopter → cat)
--   person_place_relationships (adopter → address)
-- But they DON'T create:
--   cat_place_relationships (cat → address)
--
-- This means adopted cats don't show up on their adopter's address pin in
-- the map, even though the place is tagged adopter_residence. This migration
-- fills that gap by linking cats to their adopter's place.
-- ============================================================================

\echo '=== MIG_555: Link Adopted Cats to Adopter Addresses ==='

-- Check how many would be created
\echo 'Adopted cats missing cat_place_relationships:'
SELECT COUNT(DISTINCT pcr.cat_id) AS cats_to_link
FROM trapper.person_cat_relationships pcr
JOIN trapper.person_place_relationships ppr ON ppr.person_id = pcr.person_id
JOIN trapper.places pl ON pl.place_id = ppr.place_id AND pl.merged_into_place_id IS NULL
JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id AND c.merged_into_cat_id IS NULL
WHERE pcr.relationship_type = 'adopter'
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_place_relationships existing
    WHERE existing.cat_id = pcr.cat_id AND existing.place_id = ppr.place_id
  );

-- Create cat_place_relationships for adopted cats at their adopter's address
INSERT INTO trapper.cat_place_relationships (cat_id, place_id, relationship_type, source_system)
SELECT DISTINCT
  pcr.cat_id,
  ppr.place_id,
  'adopter_residence',
  'shelterluv'
FROM trapper.person_cat_relationships pcr
JOIN trapper.person_place_relationships ppr ON ppr.person_id = pcr.person_id
JOIN trapper.places pl ON pl.place_id = ppr.place_id AND pl.merged_into_place_id IS NULL
JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id AND c.merged_into_cat_id IS NULL
WHERE pcr.relationship_type = 'adopter'
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_place_relationships existing
    WHERE existing.cat_id = pcr.cat_id AND existing.place_id = ppr.place_id
  );

\echo 'Rows inserted:'
SELECT COUNT(*) AS new_cat_place_links
FROM trapper.cat_place_relationships
WHERE relationship_type = 'adopter_residence' AND source_system = 'shelterluv';

\echo '=== MIG_555 Complete ==='
