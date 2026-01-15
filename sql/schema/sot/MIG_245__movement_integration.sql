-- MIG_245: Integrate Movement Tracking with Cat-Place Linking
--
-- Purpose:
--   - When cats are linked to places, automatically record movement events
--   - Update enrich_cat() to record movements
--   - Update link_appointment_cats_to_places() to record movements
--   - Ensure complete tracking of cat location history
--
-- Dependencies:
--   - MIG_235 (cat-place linking functions)
--   - MIG_236 (movement tracking tables - must be applied first)
--   - MIG_244 (enrich_cat function)
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_245__movement_integration.sql

\echo ''
\echo 'MIG_245: Movement Tracking Integration'
\echo '======================================='
\echo ''

-- ============================================================
-- 1. Update link_appointment_cats_to_places to record movements
-- ============================================================

\echo 'Updating link_appointment_cats_to_places to record movements...'

DROP FUNCTION IF EXISTS trapper.link_appointment_cats_to_places();

CREATE OR REPLACE FUNCTION trapper.link_appointment_cats_to_places()
RETURNS TABLE(
    cats_linked INT,
    places_found INT,
    relationships_created INT,
    movements_recorded INT
) AS $$
DECLARE
    v_cats_linked INT := 0;
    v_places_found INT := 0;
    v_relationships_created INT := 0;
    v_movements_recorded INT := 0;
    v_cat_record RECORD;
BEGIN
    -- Link cats from appointments where we have both cat_id and can find place via owner
    FOR v_cat_record IN
        SELECT DISTINCT
            a.cat_id,
            a.appointment_id,
            ppr.place_id,
            a.appointment_date::DATE AS event_date,
            'high' as confidence
        FROM trapper.sot_appointments a
        -- Get place via person identifiers
        JOIN trapper.person_identifiers pi ON (
            (pi.id_type = 'email' AND a.owner_email IS NOT NULL AND pi.id_value_norm = LOWER(TRIM(a.owner_email)))
            OR (pi.id_type = 'phone' AND a.owner_phone IS NOT NULL AND pi.id_value_norm = RIGHT(REGEXP_REPLACE(a.owner_phone, '[^0-9]', '', 'g'), 10))
        )
        JOIN trapper.person_place_relationships ppr ON ppr.person_id = pi.person_id
        WHERE a.cat_id IS NOT NULL
        -- Exclude existing relationships
        AND NOT EXISTS (
            SELECT 1 FROM trapper.cat_place_relationships cpr
            WHERE cpr.cat_id = a.cat_id AND cpr.place_id = ppr.place_id
        )
        ORDER BY a.cat_id, a.appointment_date
    LOOP
        -- Create cat-place relationship (skip if any relationship already exists for this cat-place)
        IF NOT EXISTS (
            SELECT 1 FROM trapper.cat_place_relationships
            WHERE cat_id = v_cat_record.cat_id AND place_id = v_cat_record.place_id
        ) THEN
            INSERT INTO trapper.cat_place_relationships (
                cat_id, place_id, relationship_type, confidence, source_system, source_table
            )
            VALUES (
                v_cat_record.cat_id,
                v_cat_record.place_id,
                'appointment_site',
                v_cat_record.confidence,
                'appointment_linking',
                'mig_245_appointments'
            );

            v_relationships_created := v_relationships_created + 1;
            v_cats_linked := v_cats_linked + 1;

            -- Record movement event
            PERFORM trapper.record_cat_movement(
                v_cat_record.cat_id,
                v_cat_record.place_id,
                v_cat_record.event_date,
                'appointment',
                v_cat_record.appointment_id::TEXT,
                NULL,
                'link_appointment_cats_to_places'
            );
            v_movements_recorded := v_movements_recorded + 1;
        END IF;
    END LOOP;

    -- Count unique places
    SELECT COUNT(DISTINCT place_id)
    INTO v_places_found
    FROM trapper.cat_place_relationships
    WHERE source_table = 'mig_245_appointments';

    RAISE NOTICE 'Appointment cat-place linking: % cats linked to % places (% relationships, % movements)',
        v_cats_linked, v_places_found, v_relationships_created, v_movements_recorded;

    RETURN QUERY SELECT v_cats_linked, v_places_found, v_relationships_created, v_movements_recorded;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_appointment_cats_to_places() IS
'Links cats from appointments to places via owner contact info.
Also records movement events for tracking location history.';

-- ============================================================
-- 2. Update enrich_cat to record movements when linking places
-- ============================================================

\echo 'Updating enrich_cat to record movements...'

-- Drop existing function to avoid ambiguity (re-created with new signature)
DROP FUNCTION IF EXISTS trapper.enrich_cat(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, TEXT, TEXT, UUID, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION trapper.enrich_cat(
  -- Identifiers (provide at least one)
  p_microchip TEXT DEFAULT NULL,
  p_clinic_animal_id TEXT DEFAULT NULL,
  p_airtable_id TEXT DEFAULT NULL,
  -- Cat details
  p_name TEXT DEFAULT NULL,
  p_sex TEXT DEFAULT NULL, -- 'male', 'female', 'unknown'
  p_altered_status TEXT DEFAULT NULL, -- 'altered', 'intact', 'unknown'
  p_breed TEXT DEFAULT NULL,
  p_primary_color TEXT DEFAULT NULL,
  p_secondary_color TEXT DEFAULT NULL,
  p_birth_year INT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  -- Ownership
  p_ownership_type TEXT DEFAULT NULL, -- 'owned', 'community', 'feral', 'stray'
  -- Linking
  p_owner_person_id UUID DEFAULT NULL, -- Link to owner
  p_place_id UUID DEFAULT NULL, -- Link to place
  -- Movement tracking
  p_event_date DATE DEFAULT NULL, -- Date for movement tracking (defaults to today)
  -- Tracking
  p_source_system TEXT DEFAULT 'unknown',
  p_source_record_id TEXT DEFAULT NULL
)
RETURNS TABLE(
  cat_id UUID,
  is_new BOOLEAN,
  matched_by TEXT
) AS $$
DECLARE
  v_cat_id UUID;
  v_is_new BOOLEAN := FALSE;
  v_matched_by TEXT := NULL;
  v_display_name TEXT;
  v_norm_microchip TEXT;
  v_place_is_new BOOLEAN := FALSE;
BEGIN
  -- Normalize microchip
  v_norm_microchip := NULLIF(regexp_replace(upper(trim(p_microchip)), '[^A-Z0-9]', '', 'g'), '');

  -- Build display name
  v_display_name := COALESCE(
    NULLIF(trim(p_name), ''),
    CASE WHEN v_norm_microchip IS NOT NULL THEN 'Cat-' || substring(v_norm_microchip, 1, 8) ELSE NULL END,
    CASE WHEN p_clinic_animal_id IS NOT NULL THEN 'Cat-' || p_clinic_animal_id ELSE NULL END,
    'Unknown Cat'
  );

  -- Try to match by microchip first (most reliable)
  IF v_norm_microchip IS NOT NULL THEN
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
    WHERE ci.id_type = 'microchip'
      AND upper(regexp_replace(ci.id_value, '[^A-Z0-9]', '', 'g')) = v_norm_microchip
      AND c.merged_into_cat_id IS NULL
    LIMIT 1;

    IF v_cat_id IS NOT NULL THEN
      v_matched_by := 'microchip';
    END IF;
  END IF;

  -- Try clinic animal ID if no microchip match
  IF v_cat_id IS NULL AND p_clinic_animal_id IS NOT NULL THEN
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
    WHERE ci.id_type = 'clinichq_animal_id'
      AND ci.id_value = p_clinic_animal_id
      AND c.merged_into_cat_id IS NULL
    LIMIT 1;

    IF v_cat_id IS NOT NULL THEN
      v_matched_by := 'clinichq_animal_id';
    END IF;
  END IF;

  -- Try Airtable ID if still no match
  IF v_cat_id IS NULL AND p_airtable_id IS NOT NULL THEN
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
    WHERE ci.id_type = 'airtable_id'
      AND ci.id_value = p_airtable_id
      AND c.merged_into_cat_id IS NULL
    LIMIT 1;

    IF v_cat_id IS NOT NULL THEN
      v_matched_by := 'airtable_id';
    END IF;
  END IF;

  -- No match - create new cat
  IF v_cat_id IS NULL THEN
    -- Require at least one identifier
    IF v_norm_microchip IS NULL AND p_clinic_animal_id IS NULL AND p_airtable_id IS NULL THEN
      RAISE EXCEPTION 'Cannot create cat without at least one identifier (microchip, clinic_animal_id, or airtable_id)';
    END IF;

    INSERT INTO trapper.sot_cats (
      display_name,
      sex,
      altered_status,
      breed,
      primary_color,
      secondary_color,
      birth_year,
      notes,
      ownership_type,
      data_source,
      created_at,
      updated_at
    ) VALUES (
      v_display_name,
      COALESCE(p_sex, 'unknown'),
      COALESCE(p_altered_status, 'unknown'),
      p_breed,
      p_primary_color,
      p_secondary_color,
      p_birth_year,
      p_notes,
      COALESCE(p_ownership_type, 'unknown'),
      p_source_system::trapper.data_source,
      NOW(),
      NOW()
    )
    RETURNING sot_cats.cat_id INTO v_cat_id;

    v_is_new := TRUE;
    v_matched_by := 'new';

    -- Add identifiers
    IF v_norm_microchip IS NOT NULL THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system)
      VALUES (v_cat_id, 'microchip', v_norm_microchip, p_source_system);
    END IF;

    IF p_clinic_animal_id IS NOT NULL THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system)
      VALUES (v_cat_id, 'clinichq_animal_id', p_clinic_animal_id, p_source_system);
    END IF;

    IF p_airtable_id IS NOT NULL THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system)
      VALUES (v_cat_id, 'airtable_id', p_airtable_id, p_source_system);
    END IF;
  ELSE
    -- ENRICH existing cat: add missing identifiers and update fields
    IF v_norm_microchip IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM trapper.cat_identifiers WHERE cat_id = v_cat_id AND id_type = 'microchip'
    ) THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system)
      VALUES (v_cat_id, 'microchip', v_norm_microchip, p_source_system);
    END IF;

    IF p_clinic_animal_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM trapper.cat_identifiers WHERE cat_id = v_cat_id AND id_type = 'clinichq_animal_id'
    ) THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system)
      VALUES (v_cat_id, 'clinichq_animal_id', p_clinic_animal_id, p_source_system);
    END IF;

    -- Update cat with better data (fill in missing fields)
    UPDATE trapper.sot_cats c
    SET
      display_name = CASE WHEN c.display_name IS NULL OR c.display_name = 'Unknown Cat' OR c.display_name LIKE 'Cat-%' THEN COALESCE(NULLIF(trim(p_name), ''), c.display_name) ELSE c.display_name END,
      sex = CASE WHEN c.sex IS NULL OR c.sex = 'unknown' THEN COALESCE(p_sex, c.sex) ELSE c.sex END,
      altered_status = CASE WHEN c.altered_status IS NULL OR c.altered_status = 'unknown' THEN COALESCE(p_altered_status, c.altered_status) ELSE c.altered_status END,
      breed = COALESCE(c.breed, p_breed),
      primary_color = COALESCE(c.primary_color, p_primary_color),
      secondary_color = COALESCE(c.secondary_color, p_secondary_color),
      birth_year = COALESCE(c.birth_year, p_birth_year),
      ownership_type = CASE WHEN c.ownership_type IS NULL OR c.ownership_type = 'unknown' THEN COALESCE(p_ownership_type, c.ownership_type) ELSE c.ownership_type END,
      updated_at = NOW()
    WHERE c.cat_id = v_cat_id;
  END IF;

  -- Link to owner if provided
  IF p_owner_person_id IS NOT NULL THEN
    INSERT INTO trapper.cat_owner_relationships (cat_id, person_id, relationship_type, is_current, source_system, source_record_id)
    VALUES (v_cat_id, p_owner_person_id, 'owner', TRUE, p_source_system, p_source_record_id)
    ON CONFLICT (cat_id, person_id, relationship_type) DO UPDATE
    SET is_current = TRUE, updated_at = NOW();
  END IF;

  -- Link to place if provided AND record movement
  IF p_place_id IS NOT NULL THEN
    -- Check if this is a new place relationship for this cat
    v_place_is_new := NOT EXISTS (
      SELECT 1 FROM trapper.cat_place_relationships
      WHERE cat_id = v_cat_id AND place_id = p_place_id
    );

    INSERT INTO trapper.cat_place_relationships (cat_id, place_id, relationship_type, source_system)
    VALUES (v_cat_id, p_place_id, 'residence', p_source_system)
    ON CONFLICT DO NOTHING;

    -- Record movement event (only if place relationship is new or we have a specific date)
    IF v_place_is_new OR p_event_date IS NOT NULL THEN
      PERFORM trapper.record_cat_movement(
        v_cat_id,
        p_place_id,
        COALESCE(p_event_date, CURRENT_DATE),
        'enrichment',
        p_source_record_id,
        NULL,
        'enrich_cat'
      );
    END IF;
  END IF;

  RETURN QUERY SELECT v_cat_id, v_is_new, v_matched_by;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.enrich_cat(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, TEXT, TEXT, UUID, UUID, DATE, TEXT, TEXT) IS
'Universal function to add or update a cat from any data source.
Handles identity matching by microchip/clinic_id, enrichment, linking, and movement tracking.
Use this from ALL sync scripts that process cat data.';

-- ============================================================
-- 3. Create function to backfill movements from existing relationships
-- ============================================================

\echo 'Creating function to backfill movements...'

CREATE OR REPLACE FUNCTION trapper.backfill_cat_movements_from_relationships()
RETURNS TABLE(cats_processed INT, movements_created INT) AS $$
DECLARE
  v_cats_processed INT := 0;
  v_movements_created INT := 0;
  v_cat_record RECORD;
BEGIN
  -- For each cat-place relationship, create a movement event if one doesn't exist
  FOR v_cat_record IN
    SELECT DISTINCT ON (cpr.cat_id, cpr.place_id)
      cpr.cat_id,
      cpr.place_id,
      cpr.created_at,
      cpr.source_system
    FROM trapper.cat_place_relationships cpr
    WHERE NOT EXISTS (
      SELECT 1 FROM trapper.cat_movement_events me
      WHERE me.cat_id = cpr.cat_id
        AND me.to_place_id = cpr.place_id
    )
    ORDER BY cpr.cat_id, cpr.place_id, cpr.created_at
  LOOP
    PERFORM trapper.record_cat_movement(
      v_cat_record.cat_id,
      v_cat_record.place_id,
      v_cat_record.created_at::DATE,
      'backfill',
      NULL,
      'Backfilled from cat_place_relationship',
      'backfill_cat_movements'
    );

    IF FOUND THEN
      v_movements_created := v_movements_created + 1;
    END IF;
    v_cats_processed := v_cats_processed + 1;
  END LOOP;

  RAISE NOTICE 'Backfill complete: processed % cat-place relationships, created % movements',
    v_cats_processed, v_movements_created;

  RETURN QUERY SELECT v_cats_processed, v_movements_created;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.backfill_cat_movements_from_relationships IS
'Backfills movement events from existing cat_place_relationships.
Run once after applying MIG_245 to create historical movement records.';

-- ============================================================
-- 4. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Checking movement tracking tables exist:';
SELECT
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'cat_movement_events') AS movement_events_exists,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'cat_reunifications') AS reunifications_exists;

\echo ''
\echo 'Checking functions exist:';
SELECT
  (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'trapper' AND routine_name = 'record_cat_movement') AS record_movement_exists,
  (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'trapper' AND routine_name = 'link_appointment_cats_to_places') AS link_appointments_exists,
  (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'trapper' AND routine_name = 'enrich_cat') AS enrich_cat_exists;

\echo ''
\echo 'MIG_245 Complete!'
\echo ''
\echo 'Next steps:'
\echo '  1. If MIG_236 not yet applied, run: psql "$DATABASE_URL" -f sql/schema/sot/MIG_236__cat_movement_tracking.sql'
\echo '  2. Backfill existing movements: SELECT * FROM trapper.backfill_cat_movements_from_relationships();'
\echo '  3. Re-link appointments to populate movements: SELECT * FROM trapper.link_appointment_cats_to_places();'
\echo ''
