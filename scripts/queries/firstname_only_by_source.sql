-- Query to analyze first-name-only records by source system
-- Run this to understand where incomplete name data originates

-- Summary by source system
SELECT
    p.source_system,
    COUNT(*) as total_firstname_only,
    COUNT(*) FILTER (WHERE pi_count.cnt > 0) as has_identifiers,
    COUNT(*) FILTER (WHERE pi_count.cnt = 0) as no_identifiers,
    COUNT(*) FILTER (WHERE pcat.cnt > 0) as has_cat_relationships,
    COUNT(*) FILTER (WHERE pplace.cnt > 0) as has_place_relationships
FROM trapper.sot_people p
LEFT JOIN LATERAL (
    SELECT COUNT(*) as cnt
    FROM trapper.person_identifiers pi
    WHERE pi.person_id = p.id
) pi_count ON TRUE
LEFT JOIN LATERAL (
    SELECT COUNT(*) as cnt
    FROM trapper.person_cat_relationships pcr
    WHERE pcr.person_id = p.id
) pcat ON TRUE
LEFT JOIN LATERAL (
    SELECT COUNT(*) as cnt
    FROM trapper.person_place_relationships ppr
    WHERE ppr.person_id = p.id
) pplace ON TRUE
WHERE p.merged_into_person_id IS NULL
  AND (
    p.last_name IS NULL
    OR TRIM(p.last_name) = ''
    OR p.last_name = p.first_name  -- Sometimes first name copied to both
  )
  AND p.first_name IS NOT NULL
  AND TRIM(p.first_name) != ''
GROUP BY p.source_system
ORDER BY total_firstname_only DESC;

-- Detailed sample of first-name-only records
SELECT
    p.id,
    p.first_name,
    p.last_name,
    p.display_name,
    p.source_system,
    p.source_record_id,
    p.created_at::date as created,
    (SELECT COUNT(*) FROM trapper.person_identifiers pi WHERE pi.person_id = p.id) as identifiers,
    (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.id) as cat_links,
    (SELECT string_agg(pi.id_type || ':' || LEFT(pi.id_value, 20), ', ')
     FROM trapper.person_identifiers pi WHERE pi.person_id = p.id) as identifier_preview
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND (
    p.last_name IS NULL
    OR TRIM(p.last_name) = ''
  )
  AND p.first_name IS NOT NULL
  AND TRIM(p.first_name) != ''
ORDER BY p.source_system, p.created_at DESC
LIMIT 50;

-- Check for "Rosa" specifically
SELECT
    p.id,
    p.first_name,
    p.last_name,
    p.display_name,
    p.source_system,
    p.created_at,
    (SELECT string_agg(pi.id_type || ':' || pi.id_value, ', ')
     FROM trapper.person_identifiers pi WHERE pi.person_id = p.id) as identifiers
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND (LOWER(p.first_name) LIKE '%rosa%' OR LOWER(p.display_name) LIKE '%rosa%')
ORDER BY p.created_at DESC;
