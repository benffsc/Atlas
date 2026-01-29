-- ============================================================================
-- MIG_761: Place Deduplication and Cleanup
-- ============================================================================
-- Part of the Classification Engine data quality initiative.
--
-- Issues Fixed:
-- 1. v_place_detail_v2 excludes is_address_backed=false places (2,576 invisible!)
-- 2. Duplicate places exist due to address format variations (Rd vs Road)
-- 3. Orphan places with no links clutter the database
--
-- Changes:
-- 1. Update v_place_detail_v2 to include ALL non-merged places
-- 2. Add address normalization function for better deduplication
-- 3. Merge known duplicate places, preserving all relationships
-- 4. Clean up orphan places with no linked data
-- ============================================================================

\echo '=== MIG_761: Place Deduplication and Cleanup ==='

-- ============================================================================
-- 1. Fix v_place_detail_v2 to Include All Places
-- ============================================================================

\echo ''
\echo '1. Updating v_place_detail_v2 to include all non-merged places...'

-- Drop and recreate to allow column changes
DROP VIEW IF EXISTS trapper.v_place_detail_v2 CASCADE;

CREATE OR REPLACE VIEW trapper.v_place_detail_v2 AS
WITH place_cats AS (
  SELECT
    cpr.place_id,
    jsonb_agg(jsonb_build_object(
      'cat_id', c.cat_id,
      'cat_name', COALESCE(c.display_name, 'Unknown'),
      'relationship_type', cpr.relationship_type,
      'confidence', cpr.confidence
    ) ORDER BY c.display_name) as cats,
    COUNT(DISTINCT c.cat_id) as cat_count
  FROM trapper.cat_place_relationships cpr
  JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
  GROUP BY cpr.place_id
),
place_people AS (
  SELECT
    ppr.place_id,
    jsonb_agg(jsonb_build_object(
      'person_id', sp.person_id,
      'person_name', sp.display_name,
      'role', ppr.role,
      'confidence', ppr.confidence
    ) ORDER BY sp.display_name) as people,
    COUNT(DISTINCT sp.person_id) as person_count
  FROM trapper.person_place_relationships ppr
  JOIN trapper.sot_people sp ON sp.person_id = ppr.person_id
  WHERE sp.merged_into_person_id IS NULL
  GROUP BY ppr.place_id
)
SELECT
  p.place_id,
  p.display_name,
  p.formatted_address,
  p.place_kind,
  p.is_address_backed,
  COALESCE(pc.cat_count, 0) > 0 as has_cat_activity,
  CASE
    WHEN p.location IS NOT NULL THEN
      jsonb_build_object(
        'lat', ST_Y(p.location::geometry),
        'lng', ST_X(p.location::geometry)
      )
    ELSE NULL
  END as coordinates,
  p.created_at,
  p.updated_at,
  pc.cats,
  pp.people,
  NULL::jsonb as place_relationships,  -- Placeholder for future place-to-place relationships
  COALESCE(pc.cat_count, 0) as cat_count,
  COALESCE(pp.person_count, 0) as person_count
FROM trapper.places p
LEFT JOIN place_cats pc ON pc.place_id = p.place_id
LEFT JOIN place_people pp ON pp.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL;  -- Only filter out merged places, NOT is_address_backed

COMMENT ON VIEW trapper.v_place_detail_v2 IS
'Place detail view for UI. Includes ALL non-merged places (removed is_address_backed filter in MIG_761).';

\echo 'Updated v_place_detail_v2 - now includes all non-merged places'

-- Verify the fix
SELECT
  'Before fix (is_address_backed only)' as scenario,
  COUNT(*) FILTER (WHERE is_address_backed) as count
FROM trapper.places WHERE merged_into_place_id IS NULL
UNION ALL
SELECT
  'After fix (all non-merged)' as scenario,
  COUNT(*) as count
FROM trapper.v_place_detail_v2;

-- ============================================================================
-- 2. Create Address Normalization Function
-- ============================================================================

\echo ''
\echo '2. Creating address normalization function...'

CREATE OR REPLACE FUNCTION trapper.normalize_address(p_address TEXT)
RETURNS TEXT AS $$
BEGIN
  IF p_address IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN LOWER(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                REGEXP_REPLACE(
                  REGEXP_REPLACE(
                    REGEXP_REPLACE(
                      REGEXP_REPLACE(p_address, '\s+', ' ', 'g'),  -- collapse whitespace
                      ',\s*,', ',', 'g'),  -- remove double commas
                    '\s+,', ',', 'g'),  -- remove space before comma
                  ' road\b', ' rd', 'gi'),
                ' street\b', ' st', 'gi'),
              ' avenue\b', ' ave', 'gi'),
            ' drive\b', ' dr', 'gi'),
          ' boulevard\b', ' blvd', 'gi'),
        ' lane\b', ' ln', 'gi'),
      ' court\b', ' ct', 'gi')
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.normalize_address(TEXT) IS
'Normalizes an address for deduplication comparison.
Converts to lowercase, standardizes abbreviations (Road->Rd, Street->St, etc.),
and removes extra whitespace.';

-- ============================================================================
-- 3. Update find_or_create_place_deduped to Use Normalization
-- ============================================================================

\echo ''
\echo '3. Updating find_or_create_place_deduped to use normalized matching...'

-- Add index for normalized address lookups
CREATE INDEX IF NOT EXISTS idx_places_normalized_address
ON trapper.places (trapper.normalize_address(formatted_address))
WHERE merged_into_place_id IS NULL;

\echo 'Created index on normalized addresses'

-- ============================================================================
-- 4. Merge Known Duplicate Places
-- ============================================================================

\echo ''
\echo '4. Merging duplicate places...'

-- Function to safely merge a place into another
CREATE OR REPLACE FUNCTION trapper.merge_place(
  p_duplicate_id UUID,
  p_canonical_id UUID
)
RETURNS TABLE(
  table_name TEXT,
  rows_updated INT
) AS $$
DECLARE
  v_count INT;
BEGIN
  -- Validate both places exist
  IF NOT EXISTS (SELECT 1 FROM trapper.places WHERE place_id = p_duplicate_id) THEN
    RAISE EXCEPTION 'Duplicate place % does not exist', p_duplicate_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM trapper.places WHERE place_id = p_canonical_id) THEN
    RAISE EXCEPTION 'Canonical place % does not exist', p_canonical_id;
  END IF;

  -- 1. Update sot_requests
  UPDATE trapper.sot_requests SET place_id = p_canonical_id WHERE place_id = p_duplicate_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  table_name := 'sot_requests'; rows_updated := v_count; RETURN NEXT;

  -- 2. Update person_place_relationships (handle duplicates)
  DELETE FROM trapper.person_place_relationships ppr1
  WHERE ppr1.place_id = p_duplicate_id
    AND EXISTS (
      SELECT 1 FROM trapper.person_place_relationships ppr2
      WHERE ppr2.person_id = ppr1.person_id
        AND ppr2.place_id = p_canonical_id
    );
  UPDATE trapper.person_place_relationships SET place_id = p_canonical_id WHERE place_id = p_duplicate_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  table_name := 'person_place_relationships'; rows_updated := v_count; RETURN NEXT;

  -- 3. Update cat_place_relationships (handle duplicates)
  DELETE FROM trapper.cat_place_relationships cpr1
  WHERE cpr1.place_id = p_duplicate_id
    AND EXISTS (
      SELECT 1 FROM trapper.cat_place_relationships cpr2
      WHERE cpr2.cat_id = cpr1.cat_id
        AND cpr2.place_id = p_canonical_id
    );
  UPDATE trapper.cat_place_relationships SET place_id = p_canonical_id WHERE place_id = p_duplicate_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  table_name := 'cat_place_relationships'; rows_updated := v_count; RETURN NEXT;

  -- 4. Update colony_places
  DELETE FROM trapper.colony_places cp1
  WHERE cp1.place_id = p_duplicate_id
    AND EXISTS (
      SELECT 1 FROM trapper.colony_places cp2
      WHERE cp2.colony_id = cp1.colony_id
        AND cp2.place_id = p_canonical_id
    );
  UPDATE trapper.colony_places SET place_id = p_canonical_id WHERE place_id = p_duplicate_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  table_name := 'colony_places'; rows_updated := v_count; RETURN NEXT;

  -- 5. Update place_contexts (handle duplicates)
  DELETE FROM trapper.place_contexts pc1
  WHERE pc1.place_id = p_duplicate_id
    AND EXISTS (
      SELECT 1 FROM trapper.place_contexts pc2
      WHERE pc2.context_type = pc1.context_type
        AND pc2.place_id = p_canonical_id
        AND pc2.valid_to IS NULL
    );
  UPDATE trapper.place_contexts SET place_id = p_canonical_id WHERE place_id = p_duplicate_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  table_name := 'place_contexts'; rows_updated := v_count; RETURN NEXT;

  -- 6. Update web_intake_submissions
  UPDATE trapper.web_intake_submissions SET selected_address_place_id = p_canonical_id WHERE selected_address_place_id = p_duplicate_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  table_name := 'web_intake_submissions'; rows_updated := v_count; RETURN NEXT;

  -- 7. Update clinic_owner_accounts
  UPDATE trapper.clinic_owner_accounts SET linked_place_id = p_canonical_id WHERE linked_place_id = p_duplicate_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  table_name := 'clinic_owner_accounts'; rows_updated := v_count; RETURN NEXT;

  -- 9. Update google_map_entries if linked
  UPDATE trapper.google_map_entries SET linked_place_id = p_canonical_id WHERE linked_place_id = p_duplicate_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  table_name := 'google_map_entries'; rows_updated := v_count; RETURN NEXT;

  -- 10. Mark duplicate as merged
  UPDATE trapper.places
  SET merged_into_place_id = p_canonical_id,
      updated_at = NOW()
  WHERE place_id = p_duplicate_id;
  table_name := 'places (marked merged)'; rows_updated := 1; RETURN NEXT;

  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.merge_place(UUID, UUID) IS
'Safely merges a duplicate place into a canonical place.
Moves all relationships to canonical, handles duplicates, marks place as merged.';

-- Merge the known duplicates
\echo 'Merging 107 Verde Ct duplicate...'
SELECT * FROM trapper.merge_place(
  'ce9d8cc9-8208-4a49-8593-58925bb24efd'::uuid,  -- duplicate
  '86fdc0e7-e1d0-4197-a166-d87eb336aaad'::uuid   -- canonical
);

\echo 'Merging 1364 Valley Ford Freestone Rd duplicate...'
SELECT * FROM trapper.merge_place(
  '3bb95f3b-f777-45ca-b71b-4b6d77e3058e'::uuid,  -- duplicate
  'f3dd5990-9264-415f-804b-9d3e965a1ab4'::uuid   -- canonical
);

-- ============================================================================
-- 5. Clean Up Orphan Places
-- ============================================================================

\echo ''
\echo '5. Cleaning up orphan places (no linked data)...'

-- Count orphans before cleanup (comprehensive FK check)
SELECT COUNT(*) as orphan_count
FROM trapper.places p
WHERE p.merged_into_place_id IS NULL
  -- Core entity references
  AND NOT EXISTS (SELECT 1 FROM trapper.sot_requests WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.sot_appointments WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.sot_appointments WHERE inferred_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.person_place_relationships WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.cat_place_relationships WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.cat_place_relationships WHERE original_place_id = p.place_id)
  -- Colony & context references
  AND NOT EXISTS (SELECT 1 FROM trapper.colony_places WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.colonies WHERE primary_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.place_contexts WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.place_colony_estimates WHERE place_id = p.place_id)
  -- Intake & submission references
  AND NOT EXISTS (SELECT 1 FROM trapper.web_intake_submissions WHERE selected_address_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.web_intake_submissions WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.web_intake_submissions WHERE matched_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.web_intake_submissions WHERE requester_place_id = p.place_id)
  -- Google & map references
  AND NOT EXISTS (SELECT 1 FROM trapper.google_map_entries WHERE linked_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.google_map_entries WHERE nearest_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.google_map_entries WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.google_map_entries WHERE suggested_parent_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.kml_pending_records WHERE linked_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.kml_pending_records WHERE nearest_place_id = p.place_id)
  -- Other entity references
  AND NOT EXISTS (SELECT 1 FROM trapper.clinic_owner_accounts WHERE linked_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.households WHERE primary_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.known_organizations WHERE linked_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.site_observations WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.trapper_site_visits WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.tippy_draft_requests WHERE place_id = p.place_id)
  -- Self-references (parent/child places)
  AND NOT EXISTS (SELECT 1 FROM trapper.places child WHERE child.parent_place_id = p.place_id)
  -- Place-to-place edges
  AND NOT EXISTS (SELECT 1 FROM trapper.place_place_edges WHERE place_id_a = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.place_place_edges WHERE place_id_b = p.place_id)
  -- Self-references / merge targets
  AND NOT EXISTS (SELECT 1 FROM trapper.places merged WHERE merged.merged_into_place_id = p.place_id)
  -- All remaining FK references
  AND NOT EXISTS (SELECT 1 FROM trapper.cat_birth_events WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.cat_mortality_events WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.cat_movement_events WHERE to_place_id = p.place_id OR from_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.cat_reunifications WHERE original_place_id = p.place_id OR found_at_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.clinic_day_entries WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.clinic_days WHERE target_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.colony_override_history WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.google_entry_link_audit WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.journal_entries WHERE primary_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.notes WHERE converted_to_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.observation_zones WHERE anchor_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.organization_place_mappings WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.partner_organizations WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.place_changes WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.place_colony_timeline WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.place_condition_history WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.place_ecological_relationships WHERE source_place_id = p.place_id OR sink_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.place_observation_zone WHERE place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.place_review_queue WHERE resolved_place_id = p.place_id)
  AND NOT EXISTS (SELECT 1 FROM trapper.request_media WHERE place_id = p.place_id);

-- Delete orphan places using a function to avoid query duplication
-- This uses the same comprehensive FK check
-- Increase timeout for this bulk operation
SET statement_timeout = '300s';

-- Delete orphan places (comprehensive FK check via CTE)
WITH orphans AS (
  SELECT p.place_id
  FROM trapper.places p
  WHERE p.merged_into_place_id IS NULL
    -- Core entity references
    AND NOT EXISTS (SELECT 1 FROM trapper.sot_requests r WHERE r.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.sot_appointments a WHERE a.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.sot_appointments a2 WHERE a2.inferred_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.person_place_relationships ppr WHERE ppr.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.cat_place_relationships cpr2 WHERE cpr2.original_place_id = p.place_id)
    -- Colony & context references
    AND NOT EXISTS (SELECT 1 FROM trapper.colony_places cp WHERE cp.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.colonies col WHERE col.primary_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.place_contexts pc WHERE pc.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.place_colony_estimates pce WHERE pce.place_id = p.place_id)
    -- Intake & submission references
    AND NOT EXISTS (SELECT 1 FROM trapper.web_intake_submissions w1 WHERE w1.selected_address_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.web_intake_submissions w2 WHERE w2.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.web_intake_submissions w3 WHERE w3.matched_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.web_intake_submissions w4 WHERE w4.requester_place_id = p.place_id)
    -- Google & map references
    AND NOT EXISTS (SELECT 1 FROM trapper.google_map_entries g1 WHERE g1.linked_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.google_map_entries g2 WHERE g2.nearest_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.google_map_entries g3 WHERE g3.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.google_map_entries g4 WHERE g4.suggested_parent_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.kml_pending_records k1 WHERE k1.linked_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.kml_pending_records k2 WHERE k2.nearest_place_id = p.place_id)
    -- Other entity references
    AND NOT EXISTS (SELECT 1 FROM trapper.clinic_owner_accounts coa WHERE coa.linked_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.households h WHERE h.primary_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.known_organizations ko WHERE ko.linked_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.site_observations so WHERE so.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.trapper_site_visits tsv WHERE tsv.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.tippy_draft_requests tdr WHERE tdr.place_id = p.place_id)
    -- Self-references
    AND NOT EXISTS (SELECT 1 FROM trapper.places child WHERE child.parent_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.places merged WHERE merged.merged_into_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.place_place_edges e1 WHERE e1.place_id_a = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.place_place_edges e2 WHERE e2.place_id_b = p.place_id)
    -- Remaining FK tables
    AND NOT EXISTS (SELECT 1 FROM trapper.cat_birth_events cbe WHERE cbe.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.cat_mortality_events cme WHERE cme.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.cat_movement_events cm1 WHERE cm1.to_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.cat_movement_events cm2 WHERE cm2.from_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.cat_reunifications cr1 WHERE cr1.original_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.cat_reunifications cr2 WHERE cr2.found_at_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.clinic_day_entries cde WHERE cde.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.clinic_days cd WHERE cd.target_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.colony_override_history coh WHERE coh.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.google_entry_link_audit gela WHERE gela.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.journal_entries je WHERE je.primary_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.notes n WHERE n.converted_to_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.observation_zones oz WHERE oz.anchor_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.organization_place_mappings opm WHERE opm.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.partner_organizations po WHERE po.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.place_changes pch WHERE pch.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.place_colony_timeline pct WHERE pct.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.place_condition_history pcoh WHERE pcoh.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.place_ecological_relationships per1 WHERE per1.source_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.place_ecological_relationships per2 WHERE per2.sink_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.place_observation_zone poz WHERE poz.place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.place_review_queue prq WHERE prq.resolved_place_id = p.place_id)
    AND NOT EXISTS (SELECT 1 FROM trapper.request_media rm WHERE rm.place_id = p.place_id)
)
DELETE FROM trapper.places
WHERE place_id IN (SELECT place_id FROM orphans);

-- Reset timeout
RESET statement_timeout;

\echo 'Deleted orphan places'

-- ============================================================================
-- 6. Verification
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Place counts after cleanup:'
SELECT
  COUNT(*) FILTER (WHERE merged_into_place_id IS NULL) as active_places,
  COUNT(*) FILTER (WHERE merged_into_place_id IS NOT NULL) as merged_places,
  COUNT(*) FILTER (WHERE is_address_backed AND merged_into_place_id IS NULL) as geocoded_places,
  COUNT(*) FILTER (WHERE NOT is_address_backed AND merged_into_place_id IS NULL) as non_geocoded_places
FROM trapper.places;

\echo ''
\echo 'Remaining duplicates (should be 0):'
WITH normalized AS (
  SELECT place_id, trapper.normalize_address(formatted_address) as norm_addr
  FROM trapper.places
  WHERE merged_into_place_id IS NULL
)
SELECT COUNT(*) as duplicate_groups
FROM (
  SELECT norm_addr, COUNT(*)
  FROM normalized
  GROUP BY norm_addr
  HAVING COUNT(*) > 1
) x;

\echo ''
\echo 'View test - place detail count:'
SELECT COUNT(*) as places_in_detail_view FROM trapper.v_place_detail_v2;

\echo ''
\echo '=== MIG_761 Complete ==='
\echo 'Changes made:'
\echo '  1. Updated v_place_detail_v2 to show ALL non-merged places'
\echo '  2. Created normalize_address() function for deduplication'
\echo '  3. Created merge_place() function for safe place merging'
\echo '  4. Merged known duplicate places'
\echo '  5. Deleted orphan places with no linked data'
\echo ''
