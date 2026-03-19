-- MIG_2967: Address audit trigger + place address consistency
-- FFS-647: Audit trail for address edits + auto-populate sot_address_id on places
--
-- Section A: Audit trigger on sot.addresses — logs field changes to ops.entity_edits
-- Section B: Consistency trigger on sot.places — auto-populates sot_address_id
-- Section C: Backfill existing places violating the invariant

BEGIN;

-- ==========================================================================
-- Section A: Audit trigger on sot.addresses
-- Logs changes to address fields into ops.entity_edits
-- ==========================================================================

CREATE OR REPLACE FUNCTION sot.audit_address_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_fields TEXT[] := ARRAY[
    'raw_address', 'formatted_address', 'display_line', 'display_address',
    'street_number', 'street_name', 'unit_number', 'city', 'state', 'postal_code',
    'latitude', 'longitude', 'geocoding_status'
  ];
  v_field TEXT;
  v_old_val TEXT;
  v_new_val TEXT;
BEGIN
  FOREACH v_field IN ARRAY v_fields
  LOOP
    EXECUTE format('SELECT ($1).%I::TEXT, ($2).%I::TEXT', v_field, v_field)
      INTO v_old_val, v_new_val
      USING OLD, NEW;

    IF v_old_val IS DISTINCT FROM v_new_val THEN
      INSERT INTO ops.entity_edits (
        entity_type, entity_id, field_name,
        old_value, new_value, changed_by, change_source
      ) VALUES (
        'address', NEW.address_id, v_field,
        v_old_val, v_new_val, NULL, 'trigger'
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_address_changes ON sot.addresses;
CREATE TRIGGER trg_audit_address_changes
  AFTER UPDATE ON sot.addresses
  FOR EACH ROW
  EXECUTE FUNCTION sot.audit_address_changes();


-- ==========================================================================
-- Section B: Consistency trigger on sot.places
-- BEFORE INSERT/UPDATE: if formatted_address is set but sot_address_id is NULL,
-- auto-populate via sot.find_or_create_address()
-- ==========================================================================

CREATE OR REPLACE FUNCTION sot.ensure_place_has_address()
RETURNS TRIGGER AS $$
BEGIN
  -- Only act if formatted_address is set and sot_address_id is missing
  IF NEW.formatted_address IS NOT NULL
     AND NEW.formatted_address != ''
     AND NEW.sot_address_id IS NULL
  THEN
    NEW.sot_address_id := sot.find_or_create_address(
      p_raw_input := NEW.formatted_address,
      p_formatted_address := NEW.formatted_address,
      p_lat := NEW.latitude,
      p_lng := NEW.longitude,
      p_source_system := COALESCE(NEW.source_system, 'atlas')
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ensure_place_has_address ON sot.places;
CREATE TRIGGER trg_ensure_place_has_address
  BEFORE INSERT OR UPDATE OF formatted_address, sot_address_id ON sot.places
  FOR EACH ROW
  EXECUTE FUNCTION sot.ensure_place_has_address();


-- ==========================================================================
-- Section C: Backfill existing places violating the invariant
-- ==========================================================================

DO $$
DECLARE
  v_count INT;
  v_place RECORD;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM sot.places
  WHERE formatted_address IS NOT NULL
    AND formatted_address != ''
    AND sot_address_id IS NULL
    AND merged_into_place_id IS NULL;

  RAISE NOTICE 'Found % places with formatted_address but no sot_address_id', v_count;

  IF v_count > 0 THEN
    FOR v_place IN
      SELECT place_id, formatted_address, latitude, longitude, source_system
      FROM sot.places
      WHERE formatted_address IS NOT NULL
        AND formatted_address != ''
        AND sot_address_id IS NULL
        AND merged_into_place_id IS NULL
    LOOP
      UPDATE sot.places
      SET sot_address_id = sot.find_or_create_address(
        p_raw_input := v_place.formatted_address,
        p_formatted_address := v_place.formatted_address,
        p_lat := v_place.latitude,
        p_lng := v_place.longitude,
        p_source_system := COALESCE(v_place.source_system, 'atlas')
      )
      WHERE place_id = v_place.place_id;
    END LOOP;

    RAISE NOTICE 'Backfilled sot_address_id for % places', v_count;
  END IF;
END $$;

COMMIT;
