-- ============================================================================
-- MIG_556: Merge Sonoma County Animal Services Duplicates
-- ============================================================================
-- Merges the 6 duplicate "Sonoma County Animal Services" person records
-- into a single canonical record with real contact information.
-- ============================================================================

\echo '=== MIG_556: Merge SCAS Duplicates ==='

-- First, let's see what we're working with
\echo 'Current SCAS person records:'
SELECT
  person_id,
  display_name,
  person_type,
  source_system,
  created_at
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
  AND (
    LOWER(display_name) LIKE '%sonoma county animal service%'
    OR LOWER(display_name) LIKE '%scas%'
  )
ORDER BY created_at;

-- Run the merge (dry run first to show what would happen)
\echo ''
\echo 'Dry run - what would be merged:'
SELECT * FROM trapper.merge_organization_duplicates('Sonoma County Animal Services', TRUE);

-- Actually perform the merge
\echo ''
\echo 'Performing merge...'
SELECT * FROM trapper.merge_organization_duplicates('Sonoma County Animal Services', FALSE);

-- Create/update the place for SCAS
\echo ''
\echo 'Creating/updating SCAS place...'
DO $$
DECLARE
  v_place_id UUID;
  v_org RECORD;
BEGIN
  -- Get the org record
  SELECT * INTO v_org
  FROM trapper.known_organizations
  WHERE short_name = 'SCAS';

  -- Find or create place
  SELECT place_id INTO v_place_id
  FROM trapper.places
  WHERE LOWER(display_name) LIKE '%sonoma county animal service%'
    AND merged_into_place_id IS NULL
  ORDER BY created_at
  LIMIT 1;

  IF v_place_id IS NULL THEN
    -- Create new place
    INSERT INTO trapper.places (
      display_name,
      formatted_address,
      street_address,
      city,
      state,
      zip,
      lat,
      lng,
      place_type,
      source_system
    ) VALUES (
      v_org.canonical_name,
      '1247 Century Ct, Santa Rosa, CA 95403',
      '1247 Century Ct',
      'Santa Rosa',
      'CA',
      '95403',
      v_org.lat,
      v_org.lng,
      'shelter',
      'atlas_enrichment'
    )
    RETURNING place_id INTO v_place_id;

    RAISE NOTICE 'Created new place: %', v_place_id;
  ELSE
    -- Update existing place with correct info
    UPDATE trapper.places
    SET
      display_name = v_org.canonical_name,
      formatted_address = '1247 Century Ct, Santa Rosa, CA 95403',
      street_address = '1247 Century Ct',
      city = 'Santa Rosa',
      state = 'CA',
      zip = '95403',
      lat = v_org.lat,
      lng = v_org.lng,
      updated_at = NOW()
    WHERE place_id = v_place_id;

    RAISE NOTICE 'Updated existing place: %', v_place_id;
  END IF;

  -- Link org to place
  UPDATE trapper.known_organizations
  SET canonical_place_id = v_place_id, updated_at = NOW()
  WHERE org_id = v_org.org_id;

  -- Link person to place if both exist
  IF v_org.canonical_person_id IS NOT NULL THEN
    INSERT INTO trapper.person_place_relationships (
      person_id,
      place_id,
      relationship_type,
      source_system
    ) VALUES (
      v_org.canonical_person_id,
      v_place_id,
      'works_at',
      'atlas_enrichment'
    )
    ON CONFLICT (person_id, place_id, relationship_type) DO NOTHING;
  END IF;
END;
$$;

-- Also merge other known orgs that might have duplicates
\echo ''
\echo 'Checking other organizations for duplicates...'

SELECT
  ko.canonical_name,
  ko.short_name,
  (
    SELECT COUNT(*)
    FROM trapper.sot_people p
    WHERE p.merged_into_person_id IS NULL
      AND (
        LOWER(p.display_name) LIKE '%' || LOWER(ko.canonical_name) || '%'
        OR (ko.short_name IS NOT NULL AND LOWER(p.display_name) LIKE '%' || LOWER(ko.short_name) || '%')
      )
  ) AS duplicate_count
FROM trapper.known_organizations ko
WHERE ko.is_active
ORDER BY duplicate_count DESC;

-- Merge Humane Society duplicates if any
SELECT * FROM trapper.merge_organization_duplicates('Humane Society of Sonoma County', FALSE);

-- Merge Pets Lifeline duplicates if any
SELECT * FROM trapper.merge_organization_duplicates('Pets Lifeline', FALSE);

-- Merge North Bay Animal Services duplicates if any
SELECT * FROM trapper.merge_organization_duplicates('North Bay Animal Services', FALSE);

-- Merge Rohnert Park duplicates if any
SELECT * FROM trapper.merge_organization_duplicates('Rohnert Park Animal Shelter', FALSE);

\echo ''
\echo 'Final status:'
SELECT * FROM trapper.v_known_org_status;

\echo '=== MIG_556 Complete ==='
