-- MIG_295: Auto-Linking Improvements
--
-- Creates functions for automatic entity linking that can be run periodically:
-- 1. Link cats to places via appointment owner info
-- 2. Link appointments to trappers
-- 3. Create places from intake addresses
-- 4. Link intake requesters to places
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_295__auto_linking_improvements.sql

\echo ''
\echo 'MIG_295: Auto-Linking Improvements'
\echo '==================================='
\echo ''

-- 1. Enhanced function to link cats from appointments to places
-- This extends link_appointment_cats_to_places() to be more comprehensive
\echo 'Creating enhanced cat-place linking function...'

CREATE OR REPLACE FUNCTION trapper.run_cat_place_linking()
RETURNS TABLE (
  cats_linked INT,
  places_involved INT
) AS $$
DECLARE
  v_cats_linked INT := 0;
  v_places INT := 0;
BEGIN
  -- Link cats to places via owner contact info from appointments
  WITH links_created AS (
    INSERT INTO trapper.cat_place_relationships (
      cat_id,
      place_id,
      relationship_type,
      confidence,
      source_system,
      source_table
    )
    SELECT DISTINCT
      c.cat_id,
      ppr.place_id,
      'appointment_site'::TEXT,
      0.85,
      'clinichq',
      'appointment_owner_link'
    FROM trapper.sot_cats c
    JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
    JOIN trapper.staged_records sr ON sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.payload->>'microchip' = ci.id_value
    JOIN trapper.person_identifiers pi ON (
      pi.id_value_norm = trapper.norm_email(sr.payload->>'email')
      OR pi.id_value_norm = trapper.norm_phone_us(sr.payload->>'phone')
    )
    JOIN trapper.person_place_relationships ppr ON ppr.person_id = pi.person_id
    WHERE NOT EXISTS (
      SELECT 1 FROM trapper.cat_place_relationships cpr
      WHERE cpr.cat_id = c.cat_id AND cpr.place_id = ppr.place_id
    )
    RETURNING cat_id, place_id
  )
  SELECT COUNT(DISTINCT cat_id), COUNT(DISTINCT place_id)
  INTO v_cats_linked, v_places
  FROM links_created;

  RETURN QUERY SELECT v_cats_linked, v_places;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_cat_place_linking IS
'Links cats to places via appointment owner contact info. Run periodically.';

-- 2. Function to link appointments to trappers
\echo 'Creating appointment-trapper linking function...'

CREATE OR REPLACE FUNCTION trapper.run_appointment_trapper_linking()
RETURNS INT AS $$
DECLARE
  v_linked INT := 0;
BEGIN
  -- Link appointments to trappers via email/phone matching
  WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET trapper_person_id = pi.person_id
    FROM trapper.person_identifiers pi
    JOIN trapper.person_roles pr ON pr.person_id = pi.person_id
      AND pr.role = 'trapper'
      AND pr.trapper_type IN ('ffsc_trapper', 'head_trapper', 'coordinator', 'community_trapper')
    WHERE a.trapper_person_id IS NULL
      AND (
        pi.id_value_norm = trapper.norm_email(a.owner_email)
        OR pi.id_value_norm = trapper.norm_phone_us(a.owner_phone)
      )
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_linked FROM updates;

  RETURN v_linked;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_appointment_trapper_linking IS
'Links appointments to trappers via email/phone matching. Run periodically.';

-- 3. Function to create places from intake addresses and link to submissions
\echo 'Creating intake place creation function...'

CREATE OR REPLACE FUNCTION trapper.create_places_from_intake()
RETURNS INT AS $$
DECLARE
  v_created INT := 0;
  v_rec RECORD;
BEGIN
  -- Find intake submissions with geocoded addresses but no place_id
  FOR v_rec IN
    SELECT
      w.submission_id,
      w.geo_formatted_address,
      w.geo_latitude,
      w.geo_longitude,
      w.cats_address
    FROM trapper.web_intake_submissions w
    WHERE w.place_id IS NULL
      AND w.geo_latitude IS NOT NULL
      AND w.geo_longitude IS NOT NULL
      AND w.geo_formatted_address IS NOT NULL
    LIMIT 100  -- Process in batches
  LOOP
    -- Create place using centralized function
    DECLARE
      v_place_id UUID;
    BEGIN
      SELECT trapper.find_or_create_place_deduped(
        p_formatted_address := v_rec.geo_formatted_address,
        p_display_name := NULL::TEXT,
        p_lat := v_rec.geo_latitude,
        p_lng := v_rec.geo_longitude,
        p_source_system := 'web_intake'::TEXT
      ) INTO v_place_id;

      -- Link submission to place
      IF v_place_id IS NOT NULL THEN
        UPDATE trapper.web_intake_submissions
        SET place_id = v_place_id, updated_at = NOW()
        WHERE submission_id = v_rec.submission_id
          AND place_id IS NULL;

        v_created := v_created + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Log error but continue
      RAISE NOTICE 'Failed to create place for submission %: %', v_rec.submission_id, SQLERRM;
    END;
  END LOOP;

  RETURN v_created;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_places_from_intake IS
'Creates places from geocoded intake addresses and links them. Run after geocoding.';

-- 4. Function to link intake requesters to their places
\echo 'Creating intake requester-place linking function...'

CREATE OR REPLACE FUNCTION trapper.link_intake_requesters_to_places()
RETURNS INT AS $$
DECLARE
  v_linked INT := 0;
BEGIN
  -- Link matched persons to intake places
  WITH links_created AS (
    INSERT INTO trapper.person_place_relationships (
      person_id,
      place_id,
      role,
      confidence,
      source_system,
      source_table
    )
    SELECT DISTINCT
      w.matched_person_id,
      w.place_id,
      'requester'::trapper.person_place_role,
      0.80,
      'web_intake'::TEXT,
      'intake_submission'::TEXT
    FROM trapper.web_intake_submissions w
    WHERE w.matched_person_id IS NOT NULL
      AND w.place_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_place_relationships ppr
        WHERE ppr.person_id = w.matched_person_id
          AND ppr.place_id = w.place_id
      )
    RETURNING person_id, place_id
  )
  SELECT COUNT(*) INTO v_linked FROM links_created;

  RETURN v_linked;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_intake_requesters_to_places IS
'Links intake requesters to their places. Run after intake person matching.';

-- 5. Combined function to run all linking operations
\echo 'Creating master linking function...'

CREATE OR REPLACE FUNCTION trapper.run_all_entity_linking()
RETURNS TABLE (
  operation TEXT,
  count INT
) AS $$
DECLARE
  v_count INT;
  v_cats INT;
  v_places INT;
BEGIN
  -- 1. Create places from intake
  SELECT trapper.create_places_from_intake() INTO v_count;
  RETURN QUERY SELECT 'places_created_from_intake'::TEXT, v_count;

  -- 2. Link intake requesters to places
  SELECT trapper.link_intake_requesters_to_places() INTO v_count;
  RETURN QUERY SELECT 'intake_requester_place_links'::TEXT, v_count;

  -- 3. Link cats to places
  SELECT cats_linked, places_involved INTO v_cats, v_places
  FROM trapper.run_cat_place_linking();
  RETURN QUERY SELECT 'cats_linked_to_places'::TEXT, v_cats;

  -- 4. Link appointments to trappers
  SELECT trapper.run_appointment_trapper_linking() INTO v_count;
  RETURN QUERY SELECT 'appointments_linked_to_trappers'::TEXT, v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_all_entity_linking IS
'Runs all entity linking operations. Call periodically (e.g., hourly or after batch ingest).';

-- 6. Summary stats
\echo ''
\echo 'Running initial entity linking...'
SELECT * FROM trapper.run_all_entity_linking();

\echo ''
\echo 'MIG_295 complete!'
\echo ''
\echo 'New functions:'
\echo '  - run_cat_place_linking() - Links cats to places via appointment owners'
\echo '  - run_appointment_trapper_linking() - Links appointments to trappers'
\echo '  - create_places_from_intake() - Creates places from geocoded intake addresses'
\echo '  - link_intake_requesters_to_places() - Links intake requesters to places'
\echo '  - run_all_entity_linking() - Runs all linking operations'
\echo ''
\echo 'Run SELECT * FROM trapper.run_all_entity_linking(); periodically'
\echo ''
