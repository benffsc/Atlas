-- ============================================================================
-- MIG_936: SCAS Consolidation and Foster Hub Tagging
-- ============================================================================
-- Based on investigation findings from Phase 1:
--
-- Problem 1: 19 duplicate "Scas" person records exist (created from ClinicHQ)
-- Problem 2: "Scas" alone doesn't match org detection pattern
-- Problem 3: 1814 Empire Industrial Court is a major foster hub (1289 cats)
--            but not tagged appropriately
--
-- Fix:
-- 1. Add "SCAS" to org detection function
-- 2. Merge duplicate Scas person records
-- 3. Tag foster hub address with context
-- ============================================================================

\echo '=== MIG_936: SCAS Consolidation and Foster Hub Tagging ==='
\echo ''

-- ============================================================================
-- Part 1: Update is_organization_or_address_name to catch SCAS
-- ============================================================================

\echo 'Part 1: Updating org detection function to catch SCAS...'

CREATE OR REPLACE FUNCTION trapper.is_organization_or_address_name(p_display_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_name TEXT;
BEGIN
  v_name := TRIM(COALESCE(p_display_name, ''));

  -- Empty check
  IF v_name = '' THEN
    RETURN FALSE;
  END IF;

  -- ==========================================================================
  -- NEW (MIG_936): Known organization abbreviations
  -- ==========================================================================

  -- SCAS = Sonoma County Animal Services
  IF v_name ~* '^\s*scas\s*$' THEN
    RETURN TRUE;
  END IF;

  -- LMFM = Love Me Fix Me (waiver program, not a person)
  IF v_name ~* '^\s*lmfm\s*$' THEN
    RETURN TRUE;
  END IF;

  -- FFSC = Forgotten Felines of Sonoma County
  IF v_name ~* '^\s*ffsc\s*$' THEN
    RETURN TRUE;
  END IF;

  -- ==========================================================================
  -- Address patterns (likely a place, not a person)
  -- ==========================================================================

  -- Starts with number + space (address like "890 Rockwell Rd")
  IF v_name ~ '^\d+ ' THEN
    RETURN TRUE;
  END IF;

  -- Contains street type suffixes
  IF v_name ~* '\s(rd\.?|road|st\.?|street|ave\.?|avenue|blvd\.?|boulevard|dr\.?|drive|ln\.?|lane|way|ct\.?|court|pl\.?|place|cir\.?|circle)\s*$' THEN
    RETURN TRUE;
  END IF;

  -- Contains street type in middle (like "890 Rockwell Rd. Unit 5")
  IF v_name ~* '\s(rd\.?|road|st\.?|street|ave\.?|avenue|blvd\.?|boulevard)\s' THEN
    RETURN TRUE;
  END IF;

  -- ==========================================================================
  -- Location/Place patterns
  -- ==========================================================================

  -- Parking, plaza, area, center keywords
  IF v_name ~* '(parking|plaza|area|center|centre|lot|complex|facility|building|terminal)' THEN
    RETURN TRUE;
  END IF;

  -- "The ..." pattern (like "The Villages", "The Meadows")
  IF v_name ~* '^the\s' AND v_name !~* '^the\s(great|good|real|original)\s' THEN
    -- Allow "The Great John" but catch "The Villages"
    IF v_name ~* '\s(village|meadow|park|garden|estate|ranch|farm|lodge|inn|resort|place|manor|court|terrace)s?\s*$' THEN
      RETURN TRUE;
    END IF;
  END IF;

  -- ==========================================================================
  -- Business/Organization patterns
  -- ==========================================================================

  -- Corporate suffixes
  IF v_name ~* '\s(inc\.?|llc\.?|corp\.?|corporation|company|co\.?|ltd\.?|limited|enterprise|enterprises|group|partners|associates|services|service|supply|supplies|solutions|systems|industries|industry)\.?\s*$' THEN
    RETURN TRUE;
  END IF;

  -- Rescue/Shelter organizations
  IF v_name ~* '(rescue|shelter|humane|spca|animal\s+(control|services)|foster\s+program|sanctuary)' THEN
    RETURN TRUE;
  END IF;

  -- "... of ..." pattern often indicates organization
  IF v_name ~* '(friends|society|association|foundation|alliance|coalition)\s+of\s+' THEN
    RETURN TRUE;
  END IF;

  -- Transit/Government
  IF v_name ~* '(transit|transportation|county|city\s+of|state\s+of|department|district)' THEN
    RETURN TRUE;
  END IF;

  -- All caps name that's more than 2 words (usually an org, not a person)
  IF v_name = UPPER(v_name) AND v_name ~ '\s.*\s' AND LENGTH(v_name) > 15 THEN
    -- Three or more words, all caps, longer than 15 chars - likely an org
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$function$;

-- Verify it works
\echo ''
\echo 'Verification - SCAS pattern detection:'
SELECT
  name,
  trapper.is_organization_or_address_name(name) as is_org
FROM (VALUES
  ('Scas'),
  ('SCAS'),
  ('scas'),
  ('LMFM'),
  ('FFSC'),
  ('John Smith')
) AS t(name);

-- ============================================================================
-- Part 2: Consolidate SCAS person duplicates
-- ============================================================================

\echo ''
\echo 'Part 2: Consolidating SCAS person duplicates...'

-- Find the earliest "Scas" record to use as the canonical one
DO $$
DECLARE
  v_canonical_id UUID;
  v_duplicate_ids UUID[];
  v_merged_count INT := 0;
BEGIN
  -- Get the earliest Scas record (will be canonical)
  SELECT person_id INTO v_canonical_id
  FROM trapper.sot_people
  WHERE display_name = 'Scas'
    AND merged_into_person_id IS NULL
  ORDER BY created_at
  LIMIT 1;

  IF v_canonical_id IS NULL THEN
    RAISE NOTICE 'No Scas records found to consolidate';
    RETURN;
  END IF;

  -- Get all other Scas duplicates
  SELECT array_agg(person_id) INTO v_duplicate_ids
  FROM trapper.sot_people
  WHERE display_name = 'Scas'
    AND merged_into_person_id IS NULL
    AND person_id != v_canonical_id;

  IF v_duplicate_ids IS NULL OR array_length(v_duplicate_ids, 1) IS NULL THEN
    RAISE NOTICE 'Only one Scas record found, no duplicates to merge';
    RETURN;
  END IF;

  -- Mark duplicates as merged into canonical
  UPDATE trapper.sot_people
  SET
    merged_into_person_id = v_canonical_id,
    merged_at = NOW(),
    merge_reason = 'MIG_936: SCAS is an organization, not a person'
  WHERE person_id = ANY(v_duplicate_ids);

  GET DIAGNOSTICS v_merged_count = ROW_COUNT;

  RAISE NOTICE 'Merged % duplicate Scas records into canonical record %', v_merged_count, v_canonical_id;

  -- Also handle the address-based SCAS records (like "1500 Block Of Dutch Ln Penngrove Scas")
  -- These should be marked as merged too since they're org names, not people
  UPDATE trapper.sot_people
  SET
    merged_into_person_id = v_canonical_id,
    merged_at = NOW(),
    merge_reason = 'MIG_936: Address-based SCAS name is an organization reference'
  WHERE display_name ~* 'scas$'  -- Ends with SCAS
    AND display_name != 'Scas'
    AND merged_into_person_id IS NULL;

  GET DIAGNOSTICS v_merged_count = ROW_COUNT;

  IF v_merged_count > 0 THEN
    RAISE NOTICE 'Also merged % address-based SCAS records', v_merged_count;
  END IF;
END $$;

-- Show remaining SCAS records
\echo ''
\echo 'Remaining SCAS person records after consolidation:'
SELECT person_id, display_name, merged_into_person_id IS NOT NULL as is_merged
FROM trapper.sot_people
WHERE display_name ~* 'scas'
ORDER BY display_name, created_at
LIMIT 30;

-- ============================================================================
-- Part 3: Tag Foster Hub Address
-- ============================================================================

\echo ''
\echo 'Part 3: Tagging 1814 Empire Industrial Court as foster_home...'

-- Use assign_place_context function to tag the foster hub
DO $$
DECLARE
  v_place_id UUID;
  v_context_id UUID;
BEGIN
  -- Find the place
  SELECT place_id INTO v_place_id
  FROM trapper.places
  WHERE formatted_address ILIKE '%1814 Empire Industrial%'
    AND merged_into_place_id IS NULL
  LIMIT 1;

  IF v_place_id IS NULL THEN
    RAISE NOTICE 'Could not find 1814 Empire Industrial Court place';
    RETURN;
  END IF;

  -- Check if already tagged
  IF EXISTS (
    SELECT 1 FROM trapper.place_contexts
    WHERE place_id = v_place_id
      AND context_type = 'foster_home'
      AND valid_to IS NULL
  ) THEN
    RAISE NOTICE 'Place is already tagged as foster_home';
    RETURN;
  END IF;

  -- Tag it as foster_home using correct function signature
  -- assign_place_context(place_id, context_type, valid_from, evidence_type, evidence_entity_id, evidence_notes, confidence, source_system, source_record_id, assigned_by)
  SELECT trapper.assign_place_context(
    v_place_id,
    'foster_home',
    '2020-01-01'::DATE,        -- valid_from
    'system_detection',        -- evidence_type
    NULL::UUID,                -- evidence_entity_id
    'MIG_936 - Major foster hub with 1289+ cats linked via appointments', -- evidence_notes
    0.95,                      -- confidence
    'atlas',                   -- source_system
    'MIG_936',                 -- source_record_id
    'MIG_936'                  -- assigned_by
  ) INTO v_context_id;

  RAISE NOTICE 'Tagged place % as foster_home (context_id: %)', v_place_id, v_context_id;
END $$;

-- Verify the context was assigned
\echo ''
\echo 'Verification - Foster hub context:'
SELECT
  p.formatted_address,
  pc.context_type,
  pc.valid_from,
  pc.evidence_notes,
  (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = p.place_id) as cat_count
FROM trapper.places p
JOIN trapper.place_contexts pc ON pc.place_id = p.place_id
WHERE p.formatted_address ILIKE '%1814 Empire Industrial%'
  AND pc.valid_to IS NULL;

-- ============================================================================
-- Part 4: Verify SCAS is in known_organizations
-- ============================================================================

\echo ''
\echo 'Part 4: Verifying SCAS is in known_organizations...'

-- SCAS should already exist (org_id 16) - just verify
SELECT org_id, org_name, org_name_pattern
FROM trapper.known_organizations
WHERE org_name ILIKE '%scas%' OR org_name ILIKE '%sonoma county animal%';

-- Note: Future prevention is handled by is_organization_or_address_name() update in Part 1

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_936 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Updated is_organization_or_address_name() to catch SCAS, LMFM, FFSC'
\echo '  2. Consolidated duplicate Scas person records'
\echo '  3. Tagged 1814 Empire Industrial Court as foster_home'
\echo '  4. Verified SCAS exists in known_organizations'
\echo ''
\echo 'Future ClinicHQ imports with "Scas" will be rejected via should_be_person().'
\echo ''
