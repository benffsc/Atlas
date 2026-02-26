-- MIG_2400: Fix v_person_list_v3 to match API expectations
-- Date: 2026-02-21
-- Issue: People API returns 500 because view columns don't match API query
-- The API at /api/people/route.ts expects specific columns that don't exist

-- Drop and recreate the view with all expected columns
CREATE OR REPLACE VIEW sot.v_person_list_v3 AS
SELECT
  p.person_id,
  COALESCE(p.display_name, TRIM(CONCAT(p.first_name, ' ', p.last_name))) AS display_name,

  -- account_type: derives from entity_type and is_organization
  CASE
    WHEN p.is_organization = true THEN 'organization'
    WHEN p.entity_type = 'organization' THEN 'organization'
    WHEN p.entity_type IS NOT NULL THEN p.entity_type
    ELSE 'person'
  END AS account_type,

  -- is_canonical: always true since we filter merged_into_person_id IS NULL
  TRUE AS is_canonical,

  -- surface_quality: derive from data_quality field
  CASE
    WHEN p.data_quality = 'verified' THEN 'High'
    WHEN p.data_quality = 'good' THEN 'High'
    WHEN p.data_quality = 'needs_review' THEN 'Medium'
    WHEN p.data_quality = 'garbage' THEN 'Low'
    WHEN p.is_verified = true THEN 'High'
    WHEN p.primary_email IS NOT NULL AND p.primary_phone IS NOT NULL THEN 'High'
    WHEN p.primary_email IS NOT NULL OR p.primary_phone IS NOT NULL THEN 'Medium'
    ELSE 'Low'
  END AS surface_quality,

  -- quality_reason: explain the quality tier
  CASE
    WHEN p.data_quality = 'verified' THEN 'Verified by staff'
    WHEN p.data_quality = 'good' THEN 'Good data quality'
    WHEN p.data_quality = 'needs_review' THEN 'Needs review'
    WHEN p.data_quality = 'garbage' THEN 'Poor data quality'
    WHEN p.is_verified = true THEN 'Verified record'
    WHEN p.primary_email IS NOT NULL AND p.primary_phone IS NOT NULL THEN 'Has email and phone'
    WHEN p.primary_email IS NOT NULL THEN 'Has email only'
    WHEN p.primary_phone IS NOT NULL THEN 'Has phone only'
    ELSE 'Missing contact info'
  END AS quality_reason,

  -- has_email and has_phone booleans
  (p.primary_email IS NOT NULL) AS has_email,
  (p.primary_phone IS NOT NULL) AS has_phone,

  -- cat_count and place_count
  COALESCE((SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.person_id = p.person_id), 0)::int AS cat_count,
  COALESCE((SELECT COUNT(*) FROM sot.person_place pp WHERE pp.person_id = p.person_id), 0)::int AS place_count,

  -- cat_names: aggregate of linked cat names (limit 3)
  (SELECT STRING_AGG(COALESCE(c.name, c.display_name), ', ' ORDER BY pc.created_at DESC)
   FROM sot.person_cat pc
   JOIN sot.cats c ON c.cat_id = pc.cat_id AND c.merged_into_cat_id IS NULL
   WHERE pc.person_id = p.person_id
   LIMIT 3) AS cat_names,

  -- primary_place: formatted primary place string
  COALESCE(pl.formatted_address, pl.display_name) AS primary_place,

  p.created_at,

  -- source_quality: describe source system reliability
  CASE
    WHEN p.source_system IN ('clinichq', 'shelterluv') THEN 'clinic_verified'
    WHEN p.source_system = 'volunteerhub' THEN 'volunteer_system'
    WHEN p.source_system = 'atlas_ui' THEN 'staff_entered'
    WHEN p.source_system = 'web_intake' THEN 'web_submission'
    WHEN p.source_system = 'airtable' THEN 'legacy_import'
    WHEN p.source_system = 'petlink' THEN 'microchip_registry'
    ELSE COALESCE(p.source_system, 'unknown')
  END AS source_quality,

  -- Additional useful fields from original view
  p.first_name,
  p.last_name,
  p.primary_email,
  p.primary_phone,
  p.entity_type,
  p.is_organization,
  p.is_verified,
  p.data_quality,
  p.source_system,
  p.updated_at,
  pl.place_id AS primary_place_id,
  pl.display_name AS primary_place_name,
  pl.formatted_address AS primary_place_address,
  COALESCE((SELECT COUNT(*) FROM ops.requests r WHERE r.requester_person_id = p.person_id), 0)::int AS request_count,
  (SELECT pr.role FROM sot.person_roles pr WHERE pr.person_id = p.person_id ORDER BY pr.created_at DESC LIMIT 1) AS primary_role,
  (SELECT pr.trapper_type FROM sot.person_roles pr WHERE pr.person_id = p.person_id AND pr.trapper_type IS NOT NULL ORDER BY pr.created_at DESC LIMIT 1) AS trapper_type
FROM sot.people p
LEFT JOIN sot.places pl ON pl.place_id = p.primary_place_id AND pl.merged_into_place_id IS NULL
WHERE p.merged_into_person_id IS NULL;

-- Add index hint comment
COMMENT ON VIEW sot.v_person_list_v3 IS 'Person list view for /api/people endpoint. Fixed in MIG_2400 to match API column expectations.';
