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

-- Drop the old function first (return type is changing)
DROP FUNCTION IF EXISTS trapper.enrich_place(text,text,text,text,text,text,text,uuid,text);

-- Fix the enrich_place function to use correct schema
-- Note: Output columns use out_ prefix to avoid ambiguity with table columns
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
  out_place_id UUID,
  out_is_new BOOLEAN,
  out_matched_by TEXT,
  out_needs_geocoding BOOLEAN
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
    SET created_at = NOW();
  END IF;

  out_place_id := v_place_id;
  out_is_new := v_is_new;
  out_matched_by := v_matched_by;
  out_needs_geocoding := v_needs_geocoding;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.enrich_place IS
'Find or create a place from address components. Uses find_or_create_place_deduped internally.
Handles deduplication and geocoding queue. Optionally links the place to a person.
Accepts relationship_type values like cats_location, property_owner and maps to valid enum.';

-- Update enrich_person_with_place to use new column names
CREATE OR REPLACE FUNCTION trapper.enrich_person_with_place(
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_street_address TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_zip TEXT DEFAULT NULL,
  p_county TEXT DEFAULT NULL,
  p_source_system TEXT DEFAULT 'unknown',
  p_source_record_id TEXT DEFAULT NULL,
  p_interaction_type TEXT DEFAULT NULL,
  p_roles TEXT[] DEFAULT NULL
)
RETURNS TABLE(
  person_id UUID,
  place_id UUID,
  person_is_new BOOLEAN,
  place_is_new BOOLEAN
) AS $$
DECLARE
  v_person_id UUID;
  v_place_id UUID;
  v_person_is_new BOOLEAN;
  v_place_is_new BOOLEAN;
BEGIN
  -- First, enrich the person
  SELECT ep.person_id, ep.is_new INTO v_person_id, v_person_is_new
  FROM trapper.enrich_person(
    p_email := p_email,
    p_phone := p_phone,
    p_first_name := p_first_name,
    p_last_name := p_last_name,
    p_source_system := p_source_system,
    p_source_record_id := p_source_record_id,
    p_interaction_type := p_interaction_type,
    p_roles := p_roles
  ) ep;

  -- Then, enrich the place (if address provided) and link to person
  IF p_street_address IS NOT NULL AND p_street_address != '' THEN
    SELECT epl.out_place_id, epl.out_is_new INTO v_place_id, v_place_is_new
    FROM trapper.enrich_place(
      p_street_address := p_street_address,
      p_city := p_city,
      p_zip := p_zip,
      p_county := p_county,
      p_source_system := p_source_system,
      p_source_record_id := p_source_record_id,
      p_person_id := v_person_id,
      p_relationship_type := 'residence'
    ) epl;
  END IF;

  RETURN QUERY SELECT v_person_id, v_place_id, v_person_is_new, COALESCE(v_place_is_new, FALSE);
END;
$$ LANGUAGE plpgsql;

-- Update link_intake_to_place to use new column names
CREATE OR REPLACE FUNCTION trapper.link_intake_to_place(p_submission_id UUID)
RETURNS UUID AS $$
DECLARE
  v_sub RECORD;
  v_place_id UUID;
BEGIN
  SELECT * INTO v_sub FROM trapper.web_intake_submissions WHERE submission_id = p_submission_id;

  IF v_sub IS NULL OR v_sub.cats_address IS NULL THEN
    RETURN NULL;
  END IF;

  -- Already linked?
  IF v_sub.place_id IS NOT NULL THEN
    RETURN v_sub.place_id;
  END IF;

  -- Find or create place using new column name
  SELECT epl.out_place_id INTO v_place_id
  FROM trapper.enrich_place(
    p_street_address := v_sub.cats_address,
    p_city := v_sub.cats_city,
    p_zip := v_sub.cats_zip,
    p_county := v_sub.county,
    p_source_system := 'web_intake',
    p_source_record_id := v_sub.submission_id::TEXT,
    p_person_id := v_sub.matched_person_id,
    p_relationship_type := 'cats_location'
  ) epl;

  -- Update submission with place_id
  UPDATE trapper.web_intake_submissions
  SET place_id = v_place_id
  WHERE submission_id = p_submission_id;

  RETURN v_place_id;
END;
$$ LANGUAGE plpgsql;

\echo ''
\echo 'MIG_252 complete!'
\echo '  - enrich_place now uses correct column name (role, not relationship_type)'
\echo '  - Uses find_or_create_place_deduped for place creation'
\echo '  - Maps input values to valid person_place_role enum values'
\echo '  - Works with current places table schema (formatted_address, normalized_address)'
\echo ''
