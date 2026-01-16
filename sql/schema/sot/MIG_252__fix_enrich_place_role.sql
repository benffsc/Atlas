-- MIG_252: Fix enrich_place function to use correct schema
--
-- Problems:
--   1. Used 'relationship_type' column but table has 'role'
--   2. Used invalid enum values like 'cats_location' and 'property_owner'
--   3. Referenced non-existent columns (street_address, city, state, zip, etc.)
--
-- Fix: Rewrite enrich_place to use find_or_create_place_deduped and correct columns
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_252__fix_enrich_place_role.sql

\echo ''
\echo 'MIG_252: Fix enrich_place function'
\echo '===================================='
\echo ''

-- Fix the enrich_place function to use correct schema
CREATE OR REPLACE FUNCTION trapper.enrich_place(
  p_street_address TEXT,
  p_city TEXT DEFAULT NULL,
  p_state TEXT DEFAULT 'CA',
  p_zip TEXT DEFAULT NULL,
  p_county TEXT DEFAULT NULL,
  p_source_system TEXT DEFAULT 'unknown',
  p_source_record_id TEXT DEFAULT NULL,
  p_person_id UUID DEFAULT NULL,
  p_relationship_type TEXT DEFAULT 'requester'  -- Accepts any input, maps to valid enum
)
RETURNS TABLE(
  place_id UUID,
  is_new BOOLEAN,
  matched_by TEXT,
  needs_geocoding BOOLEAN
) AS $$
DECLARE
  v_place_id UUID;
  v_is_new BOOLEAN := FALSE;
  v_matched_by TEXT := NULL;
  v_needs_geocoding BOOLEAN := FALSE;
  v_formatted_address TEXT;
  v_normalized_address TEXT;
  v_role trapper.person_place_role;
  v_data_source TEXT;
BEGIN
  -- Map source_system to valid data_source enum
  v_data_source := CASE
    WHEN p_source_system IN ('web_intake', 'web_app', 'airtable', 'airtable_sync', 'airtable_ffsc',
                              'clinichq', 'atlas_ui', 'petlink', 'app', 'file_upload', 'legacy_import')
      THEN COALESCE(p_source_system, 'web_intake')
    WHEN p_source_system LIKE 'airtable%' THEN 'airtable_sync'
    WHEN p_source_system IN ('jotform', 'jotform_public') THEN 'web_intake'
    ELSE 'web_intake'  -- Default for unknown sources
  END;
  -- Map relationship_type to valid person_place_role enum
  -- Accept various input values and map to valid enum
  v_role := CASE
    WHEN p_relationship_type IN ('cats_location', 'requester', 'request') THEN 'requester'
    WHEN p_relationship_type IN ('property_owner', 'owner') THEN 'owner'
    WHEN p_relationship_type IN ('residence', 'resident', 'home') THEN 'resident'
    WHEN p_relationship_type = 'contact' THEN 'contact'
    WHEN p_relationship_type = 'tenant' THEN 'tenant'
    WHEN p_relationship_type = 'manager' THEN 'manager'
    ELSE 'requester'  -- Default to requester for intake submissions
  END;

  -- Build formatted address from components
  v_formatted_address := COALESCE(p_street_address, '');
  IF p_city IS NOT NULL AND p_city != '' THEN
    v_formatted_address := v_formatted_address || ', ' || p_city;
  END IF;
  IF p_state IS NOT NULL AND p_state != '' THEN
    v_formatted_address := v_formatted_address || ', ' || p_state;
  END IF;
  IF p_zip IS NOT NULL AND p_zip != '' THEN
    v_formatted_address := v_formatted_address || ' ' || p_zip;
  END IF;

  -- Skip if no real address
  IF p_street_address IS NULL OR trim(p_street_address) = '' OR length(trim(p_street_address)) < 5 THEN
    RETURN;
  END IF;

  -- Normalize for matching
  v_normalized_address := trapper.normalize_address(v_formatted_address);

  -- Try to find existing place by normalized address
  SELECT p.place_id INTO v_place_id
  FROM trapper.places p
  WHERE p.merged_into_place_id IS NULL
    AND p.normalized_address = v_normalized_address
  LIMIT 1;

  IF v_place_id IS NOT NULL THEN
    v_matched_by := 'normalized_address';
  END IF;

  -- Try fuzzy match on formatted_address
  IF v_place_id IS NULL THEN
    SELECT p.place_id INTO v_place_id
    FROM trapper.places p
    WHERE p.merged_into_place_id IS NULL
      AND p.formatted_address IS NOT NULL
      AND lower(p.formatted_address) LIKE '%' || lower(trim(p_street_address)) || '%'
    LIMIT 1;

    IF v_place_id IS NOT NULL THEN
      v_matched_by := 'formatted_address';
    END IF;
  END IF;

  -- No match - create new place using find_or_create_place_deduped
  IF v_place_id IS NULL THEN
    v_place_id := trapper.find_or_create_place_deduped(
      p_formatted_address := v_formatted_address,
      p_display_name := NULL,
      p_lat := NULL,
      p_lng := NULL,
      p_source_system := v_data_source
    );

    v_is_new := TRUE;
    v_matched_by := 'new';
    v_needs_geocoding := TRUE;
  ELSE
    -- Check if existing place needs geocoding
    SELECT (p.location IS NULL)
    INTO v_needs_geocoding
    FROM trapper.places p
    WHERE p.place_id = v_place_id;
  END IF;

  -- Link to person if provided (use correct 'role' column)
  IF p_person_id IS NOT NULL AND v_place_id IS NOT NULL THEN
    INSERT INTO trapper.person_place_relationships (
      person_id, place_id, role, source_system, created_at
    ) VALUES (
      p_person_id, v_place_id, v_role, p_source_system, NOW()
    )
    ON CONFLICT (person_id, place_id, role) DO UPDATE
    SET created_at = NOW();  -- Just touch the timestamp
  END IF;

  RETURN QUERY SELECT v_place_id AS place_id, v_is_new AS is_new, v_matched_by AS matched_by, v_needs_geocoding AS needs_geocoding;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.enrich_place IS
'Find or create a place from address components. Uses find_or_create_place_deduped internally.
Handles deduplication and geocoding queue. Optionally links the place to a person.
Accepts relationship_type values like cats_location, property_owner and maps to valid enum.';

\echo ''
\echo 'MIG_252 complete!'
\echo '  - enrich_place now uses correct column name (role, not relationship_type)'
\echo '  - Uses find_or_create_place_deduped for place creation'
\echo '  - Maps input values to valid person_place_role enum values'
\echo '  - Works with current places table schema (formatted_address, normalized_address)'
\echo ''
