-- MIG_241: Address/Place Enrichment System
--
-- Adds place enrichment similar to person enrichment.
-- When an address comes in from any source:
--   1. Geocode it (or queue for geocoding)
--   2. Match to existing places by coordinates
--   3. Create new place if no match
--   4. Link to person if applicable
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_241__address_enrichment.sql

\echo ''
\echo 'MIG_241: Address/Place Enrichment System'
\echo '========================================='
\echo ''

-- ============================================================
-- 1. Function to find or create a place from an address
-- ============================================================

\echo 'Creating enrich_place function...'

CREATE OR REPLACE FUNCTION trapper.enrich_place(
  p_street_address TEXT,
  p_city TEXT DEFAULT NULL,
  p_state TEXT DEFAULT 'CA',
  p_zip TEXT DEFAULT NULL,
  p_county TEXT DEFAULT NULL,
  p_source_system TEXT DEFAULT 'unknown',
  p_source_record_id TEXT DEFAULT NULL,
  p_person_id UUID DEFAULT NULL,  -- Optional: link this place to a person
  p_relationship_type TEXT DEFAULT 'residence'  -- 'residence', 'cats_location', 'property_owner'
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
  v_full_address TEXT;
  v_norm_address TEXT;
BEGIN
  -- Build full address
  v_full_address := COALESCE(p_street_address, '');
  IF p_city IS NOT NULL AND p_city != '' THEN
    v_full_address := v_full_address || ', ' || p_city;
  END IF;
  IF p_state IS NOT NULL AND p_state != '' THEN
    v_full_address := v_full_address || ', ' || p_state;
  END IF;
  IF p_zip IS NOT NULL AND p_zip != '' THEN
    v_full_address := v_full_address || ' ' || p_zip;
  END IF;

  -- Normalize address for matching
  v_norm_address := lower(trim(regexp_replace(
    regexp_replace(p_street_address, '\s+', ' ', 'g'),
    '[.,#]', '', 'g'
  )));

  -- Skip if no real address
  IF v_norm_address IS NULL OR v_norm_address = '' OR length(v_norm_address) < 5 THEN
    RETURN;
  END IF;

  -- Try to match by normalized address
  SELECT p.place_id INTO v_place_id
  FROM trapper.places p
  WHERE p.merged_into_place_id IS NULL
    AND lower(trim(regexp_replace(
        regexp_replace(p.street_address, '\s+', ' ', 'g'),
        '[.,#]', '', 'g'
    ))) = v_norm_address
    AND (p_city IS NULL OR p.city IS NULL OR lower(p.city) = lower(p_city))
  LIMIT 1;

  IF v_place_id IS NOT NULL THEN
    v_matched_by := 'address';
  END IF;

  -- Try to match by formatted address (geocoded)
  IF v_place_id IS NULL THEN
    SELECT p.place_id INTO v_place_id
    FROM trapper.places p
    WHERE p.merged_into_place_id IS NULL
      AND p.formatted_address IS NOT NULL
      AND lower(p.formatted_address) LIKE '%' || v_norm_address || '%'
    LIMIT 1;

    IF v_place_id IS NOT NULL THEN
      v_matched_by := 'formatted_address';
    END IF;
  END IF;

  -- No match - create new place
  IF v_place_id IS NULL THEN
    INSERT INTO trapper.places (
      street_address,
      city,
      state,
      zip,
      county,
      full_address,
      source_system,
      source_record_id,
      geocode_status,
      created_at,
      updated_at
    ) VALUES (
      p_street_address,
      p_city,
      COALESCE(p_state, 'CA'),
      p_zip,
      p_county,
      v_full_address,
      p_source_system,
      p_source_record_id,
      'pending',
      NOW(),
      NOW()
    )
    RETURNING places.place_id INTO v_place_id;

    v_is_new := TRUE;
    v_matched_by := 'new';
    v_needs_geocoding := TRUE;

    -- Add to geocoding queue
    INSERT INTO trapper.geocoding_queue (place_id, priority, source_system)
    VALUES (v_place_id, 5, p_source_system)
    ON CONFLICT (place_id) DO NOTHING;
  ELSE
    -- Check if existing place needs geocoding
    SELECT (p.geocode_status = 'pending' OR p.geocode_status = 'failed')
    INTO v_needs_geocoding
    FROM trapper.places p
    WHERE p.place_id = v_place_id;

    -- Enrich: update missing fields
    UPDATE trapper.places p
    SET
      city = COALESCE(p.city, p_city),
      zip = COALESCE(p.zip, p_zip),
      county = COALESCE(p.county, p_county),
      updated_at = NOW()
    WHERE p.place_id = v_place_id
      AND (p.city IS NULL OR p.zip IS NULL OR p.county IS NULL);
  END IF;

  -- Link to person if provided
  IF p_person_id IS NOT NULL AND v_place_id IS NOT NULL THEN
    INSERT INTO trapper.person_place_relationships (
      person_id, place_id, relationship_type, source_system, created_at
    ) VALUES (
      p_person_id, v_place_id, p_relationship_type, p_source_system, NOW()
    )
    ON CONFLICT (person_id, place_id, relationship_type) DO UPDATE
    SET updated_at = NOW();
  END IF;

  RETURN QUERY SELECT v_place_id, v_is_new, v_matched_by, v_needs_geocoding;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.enrich_place IS
'Find or create a place from an address. Handles deduplication and geocoding queue.
Optionally links the place to a person.';

-- ============================================================
-- 2. Combined person + place enrichment
-- ============================================================

\echo 'Creating enrich_person_with_place function...'

CREATE OR REPLACE FUNCTION trapper.enrich_person_with_place(
  -- Person fields
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  -- Address fields
  p_street_address TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_zip TEXT DEFAULT NULL,
  p_county TEXT DEFAULT NULL,
  -- Tracking
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
  v_result RECORD;
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
    SELECT epl.place_id, epl.is_new INTO v_place_id, v_place_is_new
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

COMMENT ON FUNCTION trapper.enrich_person_with_place IS
'Convenience function to enrich both a person and their address in one call.
Creates person, creates/matches place, and links them together.';

-- ============================================================
-- 3. Update intake to link submissions to places
-- ============================================================

\echo 'Creating function to link intake submission to place...'

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

  -- Find or create place
  SELECT epl.place_id INTO v_place_id
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

-- ============================================================
-- 4. Trigger to auto-link intake to place
-- ============================================================

\echo 'Creating trigger for automatic place linking...'

CREATE OR REPLACE FUNCTION trapper.trigger_intake_link_place()
RETURNS TRIGGER AS $$
BEGIN
  -- Run place linking if we have an address
  IF NEW.cats_address IS NOT NULL AND NEW.place_id IS NULL THEN
    PERFORM trapper.link_intake_to_place(NEW.submission_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_intake_link_place ON trapper.web_intake_submissions;
CREATE TRIGGER trg_intake_link_place
  AFTER INSERT ON trapper.web_intake_submissions
  FOR EACH ROW
  EXECUTE FUNCTION trapper.trigger_intake_link_place();

-- ============================================================
-- 5. Backfill: Link existing submissions to places
-- ============================================================

\echo 'Backfilling place links for existing submissions...'

DO $$
DECLARE
  v_count INT := 0;
  v_sub RECORD;
BEGIN
  FOR v_sub IN
    SELECT submission_id
    FROM trapper.web_intake_submissions
    WHERE place_id IS NULL
      AND cats_address IS NOT NULL
      AND cats_address != ''
    ORDER BY submitted_at DESC
    LIMIT 1000  -- Process in batches
  LOOP
    PERFORM trapper.link_intake_to_place(v_sub.submission_id);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Linked % submissions to places', v_count;
END;
$$;

-- ============================================================
-- 6. View: Places with intake summary
-- ============================================================

\echo 'Creating v_place_intake_summary view...'

CREATE OR REPLACE VIEW trapper.v_place_intake_summary AS
SELECT
  p.place_id,
  p.street_address,
  p.city,
  p.formatted_address,
  p.latitude,
  p.longitude,
  p.geocode_status,
  p.county,
  COUNT(DISTINCT w.submission_id) as intake_count,
  MAX(w.submitted_at) as last_intake,
  COUNT(DISTINCT w.matched_person_id) as unique_requesters,
  SUM(CASE WHEN w.is_emergency THEN 1 ELSE 0 END) as emergency_count,
  SUM(COALESCE(w.cat_count_estimate, 1)) as total_cats_reported
FROM trapper.places p
LEFT JOIN trapper.web_intake_submissions w ON w.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL
GROUP BY p.place_id;

COMMENT ON VIEW trapper.v_place_intake_summary IS
'Shows places with summary of intake submissions at that location.';

-- ============================================================
-- Summary
-- ============================================================

\echo ''
\echo 'MIG_241 Complete!'
\echo ''
\echo 'New functions:'
\echo '  - enrich_place(): Find or create a place from an address'
\echo '  - enrich_person_with_place(): Create person AND place in one call'
\echo '  - link_intake_to_place(): Link intake submission to a place'
\echo ''
\echo 'Triggers:'
\echo '  - trg_intake_link_place: Auto-links new intakes to places'
\echo ''
\echo 'Views:'
\echo '  - v_place_intake_summary: Places with intake statistics'
\echo ''
\echo 'Usage:'
\echo '  -- From any sync script:'
\echo '  SELECT * FROM trapper.enrich_person_with_place('
\echo '    p_email := ''john@example.com'','
\echo '    p_phone := ''707-555-1234'','
\echo '    p_first_name := ''John'','
\echo '    p_last_name := ''Doe'','
\echo '    p_street_address := ''123 Main St'','
\echo '    p_city := ''Santa Rosa'','
\echo '    p_zip := ''95401'','
\echo '    p_county := ''Sonoma'','
\echo '    p_source_system := ''jotform_public'''
\echo '  );'
\echo ''
