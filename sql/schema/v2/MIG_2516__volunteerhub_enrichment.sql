-- MIG_2516: VolunteerHub Skeleton Person Enrichment
-- Part of CHUNK 22: VolunteerHub Pipeline Fix
--
-- Problem: Skeleton people (created without names/contact info) have minimal data.
-- When VolunteerHub sync runs and finds matching volunteers, we should enrich the
-- skeleton person with the volunteer's name and contact info.

-- ============================================================================
-- 1. Enrich skeleton people from VolunteerHub data
-- ============================================================================
CREATE OR REPLACE FUNCTION sot.enrich_skeleton_people()
RETURNS TABLE(
  enriched_count INTEGER,
  skipped_count INTEGER,
  error_count INTEGER,
  details JSONB
) AS $$
DECLARE
  v_enriched INT := 0;
  v_skipped INT := 0;
  v_errors INT := 0;
  v_details JSONB := '[]'::JSONB;
  v_record RECORD;
  v_updated BOOLEAN;
BEGIN
  -- Find skeleton people (minimal data) that have VolunteerHub records
  FOR v_record IN
    SELECT
      p.person_id,
      p.display_name as current_name,
      p.first_name as current_first,
      p.last_name as current_last,
      vh.first_name as vh_first,
      vh.last_name as vh_last,
      vh.email as vh_email,
      vh.phone as vh_phone,
      vh.volunteerhub_id
    FROM sot.people p
    JOIN source.volunteerhub_volunteers vh ON vh.matched_person_id = p.person_id
    WHERE p.merged_into_person_id IS NULL
      AND p.data_quality = 'skeleton'
      AND vh.first_name IS NOT NULL
      AND vh.last_name IS NOT NULL
  LOOP
    v_updated := FALSE;

    BEGIN
      -- Update name if person has no name or minimal name
      IF v_record.current_first IS NULL OR v_record.current_last IS NULL THEN
        UPDATE sot.people
        SET
          first_name = COALESCE(first_name, v_record.vh_first),
          last_name = COALESCE(last_name, v_record.vh_last),
          display_name = COALESCE(
            NULLIF(display_name, ''),
            TRIM(v_record.vh_first || ' ' || v_record.vh_last)
          ),
          data_quality = 'standard',
          updated_at = NOW()
        WHERE person_id = v_record.person_id;

        v_updated := TRUE;
      END IF;

      -- Add email identifier if not exists
      IF v_record.vh_email IS NOT NULL THEN
        INSERT INTO sot.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system, confidence)
        VALUES (
          v_record.person_id,
          'email',
          v_record.vh_email,
          LOWER(TRIM(v_record.vh_email)),
          'volunteerhub',
          0.95
        )
        ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;

        IF FOUND THEN v_updated := TRUE; END IF;
      END IF;

      -- Add phone identifier if not exists
      IF v_record.vh_phone IS NOT NULL AND LENGTH(REGEXP_REPLACE(v_record.vh_phone, '\D', '', 'g')) >= 10 THEN
        INSERT INTO sot.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system, confidence)
        VALUES (
          v_record.person_id,
          'phone',
          v_record.vh_phone,
          REGEXP_REPLACE(v_record.vh_phone, '\D', '', 'g'),
          'volunteerhub',
          0.90
        )
        ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;

        IF FOUND THEN v_updated := TRUE; END IF;
      END IF;

      IF v_updated THEN
        -- Log the enrichment
        INSERT INTO sot.entity_edits (
          entity_type, entity_id, edit_type, field_name,
          old_value, new_value, edit_source, reason, edited_by
        ) VALUES (
          'person', v_record.person_id, 'enrich', 'skeleton_enrichment',
          jsonb_build_object(
            'name', v_record.current_name,
            'first_name', v_record.current_first,
            'last_name', v_record.current_last
          ),
          jsonb_build_object(
            'vh_first', v_record.vh_first,
            'vh_last', v_record.vh_last,
            'vh_email', v_record.vh_email IS NOT NULL,
            'vh_phone', v_record.vh_phone IS NOT NULL
          ),
          'volunteerhub_sync',
          'Skeleton person enriched from VolunteerHub data',
          'system'
        );

        v_enriched := v_enriched + 1;
        v_details := v_details || jsonb_build_object(
          'person_id', v_record.person_id,
          'vh_id', v_record.volunteerhub_id,
          'action', 'enriched'
        );
      ELSE
        v_skipped := v_skipped + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      v_details := v_details || jsonb_build_object(
        'person_id', v_record.person_id,
        'vh_id', v_record.volunteerhub_id,
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN QUERY SELECT v_enriched, v_skipped, v_errors, v_details;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.enrich_skeleton_people IS
'Enriches skeleton people (created with minimal data) from their matched VolunteerHub records.
Updates names and adds email/phone identifiers when available.
Called automatically after VolunteerHub sync to upgrade skeleton people to full records.';

-- ============================================================================
-- 2. Link VolunteerHub volunteer to their home place
-- ============================================================================
CREATE OR REPLACE FUNCTION sot.link_vh_volunteer_to_place(p_volunteerhub_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  v_vol RECORD;
  v_person_id UUID;
  v_place_id UUID;
  v_address TEXT;
BEGIN
  -- Get volunteer record with matched person
  SELECT
    vv.*,
    vv.matched_person_id as person_id,
    CONCAT_WS(', ',
      NULLIF(TRIM(COALESCE(vv.address, '')), ''),
      NULLIF(TRIM(COALESCE(vv.city, '')), ''),
      NULLIF(TRIM(COALESCE(vv.state, '')), ''),
      NULLIF(TRIM(COALESCE(vv.zip, '')), '')
    ) as full_address
  INTO v_vol
  FROM source.volunteerhub_volunteers vv
  WHERE vv.volunteerhub_id = p_volunteerhub_id
    AND vv.matched_person_id IS NOT NULL;

  IF v_vol IS NULL THEN
    RETURN jsonb_build_object('status', 'no_match', 'volunteerhub_id', p_volunteerhub_id);
  END IF;

  v_person_id := v_vol.person_id;
  v_address := v_vol.full_address;

  -- Skip if no address
  IF v_address IS NULL OR TRIM(v_address) IN ('', ', , ,', ', ,', ',') THEN
    RETURN jsonb_build_object('status', 'no_address', 'person_id', v_person_id);
  END IF;

  -- Check if person already has a place link
  IF EXISTS (
    SELECT 1 FROM sot.person_place
    WHERE person_id = v_person_id
      AND role = 'resident'
  ) THEN
    RETURN jsonb_build_object('status', 'already_linked', 'person_id', v_person_id);
  END IF;

  -- Find or create place
  v_place_id := sot.find_or_create_place_deduped(
    v_address, NULL, NULL, NULL, 'volunteerhub'
  );

  IF v_place_id IS NULL THEN
    RETURN jsonb_build_object('status', 'place_creation_failed', 'address', v_address);
  END IF;

  -- Link person to place
  INSERT INTO sot.person_place (
    person_id, place_id, role, source_system, confidence, note
  ) VALUES (
    v_person_id, v_place_id, 'resident', 'volunteerhub', 0.80,
    'Home address from VolunteerHub registration'
  )
  ON CONFLICT (person_id, place_id) DO UPDATE SET
    confidence = GREATEST(sot.person_place.confidence, 0.80),
    note = COALESCE(sot.person_place.note, 'Home address from VolunteerHub registration'),
    updated_at = NOW();

  RETURN jsonb_build_object(
    'status', 'linked',
    'person_id', v_person_id,
    'place_id', v_place_id,
    'address', v_address
  );
END;
$$;

COMMENT ON FUNCTION sot.link_vh_volunteer_to_place IS
'Links a VolunteerHub volunteer to their home place based on registration address.
Only creates link if person does not already have a resident relationship.';

-- ============================================================================
-- 3. Grant permissions
-- ============================================================================
GRANT EXECUTE ON FUNCTION sot.enrich_skeleton_people() TO postgres;
GRANT EXECUTE ON FUNCTION sot.link_vh_volunteer_to_place(TEXT) TO postgres;

-- ============================================================================
-- Run enrichment for any existing skeletons
-- ============================================================================
DO $$
DECLARE
  v_result RECORD;
BEGIN
  SELECT * INTO v_result FROM sot.enrich_skeleton_people();
  RAISE NOTICE 'Skeleton enrichment: % enriched, % skipped, % errors',
    v_result.enriched_count, v_result.skipped_count, v_result.error_count;
END $$;
