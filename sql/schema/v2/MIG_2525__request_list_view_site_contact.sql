-- MIG_2525: Add Site Contact Fields to v_request_list View
--
-- Problem: The v_request_list view doesn't include the new MIG_2522 fields:
-- - requester_role_at_submission
-- - requester_is_site_contact
-- - site_contact_name
--
-- Solution: Update the view to include these fields from ops.requests
--
-- Created: 2026-02-26

\echo ''
\echo '=============================================='
\echo '  MIG_2525: Update v_request_list View'
\echo '=============================================='
\echo ''

-- First check if the columns exist (MIG_2522 must be applied first)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'ops' AND table_name = 'requests' AND column_name = 'requester_role_at_submission'
  ) THEN
    RAISE NOTICE 'MIG_2522 not yet applied - columns do not exist. Skipping view update.';
    RETURN;
  END IF;

  -- Update the view
  EXECUTE $view$
    CREATE OR REPLACE VIEW ops.v_request_list AS
    SELECT
      r.request_id,
      r.status::TEXT,
      r.priority::TEXT,
      r.summary,
      r.estimated_cat_count,
      COALESCE(r.has_kittens, FALSE) AS has_kittens,
      r.scheduled_date::TEXT,
      r.assigned_to,
      r.created_at,
      r.updated_at,
      r.source_created_at,
      r.place_id,
      -- Place info
      COALESCE(p.display_name, SPLIT_PART(p.formatted_address, ',', 1)) AS place_name,
      p.formatted_address AS place_address,
      sa.city AS place_city,
      -- Requester info
      r.requester_person_id,
      per.display_name AS requester_name,
      (SELECT COALESCE(pi.id_value_raw, pi.id_value_norm)
       FROM sot.person_identifiers pi
       WHERE pi.person_id = r.requester_person_id AND pi.id_type = 'email' AND pi.confidence >= 0.5
       LIMIT 1) AS requester_email,
      (SELECT COALESCE(pi.id_value_raw, pi.id_value_norm)
       FROM sot.person_identifiers pi
       WHERE pi.person_id = r.requester_person_id AND pi.id_type = 'phone' AND pi.confidence >= 0.5
       LIMIT 1) AS requester_phone,
      -- MIG_2522: Requestor intelligence
      r.requester_role_at_submission,
      r.requester_is_site_contact,
      sc.display_name AS site_contact_name,
      -- Location
      CASE WHEN p.location IS NOT NULL THEN ST_Y(p.location::geometry) END AS latitude,
      CASE WHEN p.location IS NOT NULL THEN ST_X(p.location::geometry) END AS longitude,
      -- Stats
      (SELECT COUNT(*) FROM ops.request_cats rc WHERE rc.request_id = r.request_id) AS linked_cat_count,
      -- Legacy flag
      r.source_system LIKE 'airtable%' AS is_legacy_request,
      -- Trapper info (SC_001)
      COALESCE((
        SELECT COUNT(*) FROM ops.request_trapper_assignments rta
        WHERE rta.request_id = r.request_id AND rta.status = 'active'
      ), 0)::INT AS active_trapper_count,
      p.location IS NOT NULL AS place_has_location,
      -- Data quality flags
      ARRAY_REMOVE(ARRAY[
        CASE WHEN r.assignment_status = 'pending' AND r.status NOT IN ('completed', 'cancelled') THEN 'no_trapper' END,
        CASE WHEN r.assignment_status = 'client_trapping' THEN 'client_trapping' END,
        CASE WHEN p.location IS NULL AND r.status NOT IN ('completed', 'cancelled') THEN 'no_geometry' END,
        CASE WHEN r.updated_at < NOW() - INTERVAL '30 days' AND r.status NOT IN ('completed', 'cancelled', 'on_hold') THEN 'stale_30d' END,
        CASE WHEN r.requester_person_id IS NULL THEN 'no_requester' END
      ], NULL) AS data_quality_flags,
      r.no_trapper_reason,
      -- Primary trapper name (SC_002)
      (SELECT per2.display_name
       FROM ops.request_trapper_assignments rta
       JOIN sot.people per2 ON per2.person_id = rta.trapper_person_id
       WHERE rta.request_id = r.request_id AND rta.status = 'active'
       ORDER BY (rta.assignment_type = 'primary') DESC, rta.assigned_at
       LIMIT 1) AS primary_trapper_name,
      r.assignment_status::TEXT,
      -- Map preview caching (MIG_2470)
      r.map_preview_url,
      r.map_preview_updated_at
    FROM ops.requests r
    LEFT JOIN sot.places p ON p.place_id = r.place_id AND p.merged_into_place_id IS NULL
    LEFT JOIN sot.addresses sa ON sa.address_id = p.sot_address_id
    LEFT JOIN sot.people per ON per.person_id = r.requester_person_id AND per.merged_into_person_id IS NULL
    LEFT JOIN sot.people sc ON sc.person_id = r.site_contact_person_id AND sc.merged_into_person_id IS NULL
  $view$;

  RAISE NOTICE 'Updated ops.v_request_list with site contact fields';
END;
$$;

COMMENT ON VIEW ops.v_request_list IS
'Request list view with computed fields for UI display. MIG_2525 added site contact fields.';

\echo ''
\echo '=============================================='
\echo '  MIG_2525 Complete'
\echo '=============================================='
\echo ''
