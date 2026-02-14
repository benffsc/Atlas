\echo ''
\echo '=============================================='
\echo 'MIG_525: Add is_canonical to Person List View'
\echo '=============================================='
\echo ''

-- Add is_canonical column to v_person_list_v3 for API filtering and UI display

CREATE OR REPLACE VIEW trapper.v_person_list_v3 AS
SELECT
  p.person_id,
  p.display_name,
  p.account_type,
  p.is_canonical,  -- Added for filtering
  -- Surface quality from v_person_surface_quality logic
  CASE
    WHEN p.account_type != 'person' THEN 'Low'
    WHEN p.is_canonical = FALSE THEN 'Low'  -- Non-canonical = Low quality
    WHEN trapper.is_address_like_name(p.display_name) THEN 'Low'
    WHEN NOT trapper.is_valid_person_name(p.display_name) THEN 'Low'
    WHEN COALESCE(ps.has_email, FALSE) OR COALESCE(ps.has_phone, FALSE) THEN 'High'
    WHEN COALESCE(ps.cat_count, 0) > 0 THEN 'Medium'
    ELSE 'Medium'
  END AS surface_quality,
  -- Quality reason
  CASE
    WHEN p.account_type != 'person' THEN 'non_person_account'
    WHEN p.is_canonical = FALSE THEN 'non_canonical'  -- Added reason
    WHEN trapper.is_address_like_name(p.display_name) THEN 'address_like_name'
    WHEN NOT trapper.is_valid_person_name(p.display_name) THEN 'invalid_name'
    WHEN COALESCE(ps.has_email, FALSE) AND COALESCE(ps.has_phone, FALSE) THEN 'has_email_and_phone'
    WHEN COALESCE(ps.has_email, FALSE) THEN 'has_email'
    WHEN COALESCE(ps.has_phone, FALSE) THEN 'has_phone'
    WHEN COALESCE(ps.cat_count, 0) > 0 THEN 'has_cats'
    ELSE 'valid_name_only'
  END AS quality_reason,
  -- Identifier flags
  COALESCE(ps.has_email, FALSE) AS has_email,
  COALESCE(ps.has_phone, FALSE) AS has_phone,
  -- Counts from cache (O(1) lookup)
  COALESCE(ps.cat_count, 0) AS cat_count,
  COALESCE(ps.place_count, 0) AS place_count,
  -- Names/places from cache
  ps.cat_names,
  ps.primary_place,
  -- Timestamps
  p.created_at,
  -- Source quality (for API compatibility)
  trapper.get_person_source_quality(p.person_id) AS source_quality,
  -- Data quality (for deep_search filtering compatibility)
  CASE
    WHEN p.account_type != 'person' THEN 'low'
    WHEN p.is_canonical = FALSE THEN 'low'  -- Non-canonical = low
    WHEN NOT trapper.is_valid_person_name(p.display_name) THEN 'low'
    WHEN COALESCE(ps.has_email, FALSE) OR COALESCE(ps.has_phone, FALSE) THEN 'high'
    ELSE 'medium'
  END AS data_quality
FROM trapper.sot_people p
LEFT JOIN trapper.person_stats_cache ps ON ps.person_id = p.person_id
WHERE p.merged_into_person_id IS NULL;

COMMENT ON VIEW trapper.v_person_list_v3 IS
'Person list view with pre-aggregated stats from cache for O(1) performance.
Includes is_canonical flag for filtering non-canonical (garbage/organization) records.
Non-canonical records are automatically given surface_quality = Low.';

\echo ''
\echo 'View updated. Non-canonical records now get surface_quality = Low.'
\echo ''
