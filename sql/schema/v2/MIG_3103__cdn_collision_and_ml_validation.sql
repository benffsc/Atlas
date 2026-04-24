-- MIG_3103: CDN collision check + ML cross-validation (with foster support)
--
-- Guards baked into ops.set_clinic_day_number():
-- 1. Collision: refuse if CDN already claimed on same date
-- 2. ML validation: refuse if ML entry owner != appointment owner
-- 3. Foster exception: when either side is foster, check cat name instead of owner
-- 4. Name formatting tolerance: handles "Name - call phone" vs "NAME"
--
-- Created: 2026-04-20, updated 2026-04-21

\echo 'MIG_3103: CDN collision + ML validation + foster support'

BEGIN;

CREATE OR REPLACE FUNCTION ops.set_clinic_day_number(
  p_appointment_id UUID,
  p_value          INTEGER,
  p_source         ops.clinic_day_number_source,
  p_changed_by     UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_current INTEGER;
  v_current_source ops.clinic_day_number_source;
  v_manually_overridden BOOLEAN;
  v_appt_date DATE;
  v_appt_client TEXT;
  v_appt_cat_name TEXT;
  v_collision_id UUID;
  v_collision_name TEXT;
  v_ml_owner TEXT;
  v_ml_cat TEXT;
  v_ml_is_foster BOOLEAN;
  v_ml_raw TEXT;
BEGIN
  SELECT
    a.clinic_day_number, a.clinic_day_number_source,
    ops.is_field_manually_set(a.manually_overridden_fields, 'clinic_day_number'),
    a.appointment_date, a.client_name, c.name
  INTO v_current, v_current_source, v_manually_overridden, v_appt_date, v_appt_client, v_appt_cat_name
  FROM ops.appointments a
  LEFT JOIN sot.cats c ON c.cat_id = a.cat_id
  WHERE a.appointment_id = p_appointment_id AND a.merged_into_appointment_id IS NULL;

  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v_manually_overridden AND p_source != 'manual' THEN RETURN FALSE; END IF;
  IF v_current IS NOT DISTINCT FROM p_value
     AND v_current_source IS NOT DISTINCT FROM p_source THEN RETURN TRUE; END IF;

  IF p_value IS NOT NULL THEN
    -- ── Guard 1: Collision ──────────────────────────────────────────
    SELECT a2.appointment_id, a2.client_name INTO v_collision_id, v_collision_name
    FROM ops.appointments a2
    WHERE a2.appointment_date = v_appt_date AND a2.clinic_day_number = p_value
      AND a2.appointment_id != p_appointment_id AND a2.merged_into_appointment_id IS NULL
    LIMIT 1;

    IF v_collision_id IS NOT NULL THEN
      RAISE NOTICE 'set_cdn: COLLISION CDN=% date=% claimed by % (%)',
        p_value, v_appt_date, v_collision_name, v_collision_id;
      RETURN FALSE;
    END IF;

    -- ── Guard 2: ML cross-validation (skip for manual) ──────────────
    IF p_source != 'manual' AND v_appt_client IS NOT NULL THEN
      SELECT e.parsed_owner_name, e.parsed_cat_name,
             COALESCE(e.is_foster, false), e.raw_client_name
      INTO v_ml_owner, v_ml_cat, v_ml_is_foster, v_ml_raw
      FROM ops.clinic_day_entries e
      JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
      WHERE cd.clinic_date = v_appt_date
        AND e.line_number = p_value
      LIMIT 1;

      IF v_ml_owner IS NOT NULL THEN
        -- ── Foster exception ──────────────────────────────────────
        IF v_ml_is_foster
           OR LOWER(COALESCE(v_ml_raw, '')) LIKE 'foster %'
           OR LOWER(v_appt_client) LIKE '%foster%'
        THEN
          -- For fosters: check cat name instead of owner
          IF v_ml_cat IS NOT NULL AND v_appt_cat_name IS NOT NULL
             AND similarity(LOWER(v_ml_cat), LOWER(v_appt_cat_name)) < 0.3
             AND LOWER(v_appt_cat_name) NOT LIKE '%' || LOWER(v_ml_cat) || '%'
          THEN
            RAISE NOTICE 'set_cdn: FOSTER CAT MISMATCH CDN=% ml_cat=% appt_cat=%',
              p_value, v_ml_cat, v_appt_cat_name;
            RETURN FALSE;
          END IF;
          -- If cat name matches or no cat name to check: allow
        ELSE
          -- ── Normal owner check ────────────────────────────────
          IF similarity(LOWER(v_ml_owner), LOWER(v_appt_client)) < 0.3 THEN
            -- Check if first name at least matches (handles phone suffixes)
            IF LOWER(v_appt_client) NOT LIKE
                 '%' || LOWER(SPLIT_PART(v_ml_owner, ' ', 1)) || '%'
               AND LOWER(COALESCE(v_ml_raw, '')) NOT LIKE
                 '%' || LOWER(SPLIT_PART(v_appt_client, ' ', 1)) || '%'
               -- Also check cat name as fallback
               AND (v_ml_cat IS NULL
                    OR LOWER(v_appt_client) NOT LIKE '%' || LOWER(v_ml_cat) || '%')
            THEN
              RAISE NOTICE 'set_cdn: ML MISMATCH CDN=% ml_owner=% appt=%',
                p_value, v_ml_owner, v_appt_client;
              RETURN FALSE;
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  -- ── Write ─────────────────────────────────────────────────────────
  UPDATE ops.appointments
  SET clinic_day_number = p_value,
      clinic_day_number_source = CASE WHEN p_value IS NULL THEN NULL ELSE p_source END,
      manually_overridden_fields = CASE
        WHEN p_source = 'manual'
             AND NOT ops.is_field_manually_set(manually_overridden_fields, 'clinic_day_number')
        THEN array_append(manually_overridden_fields, 'clinic_day_number')
        ELSE manually_overridden_fields
      END,
      updated_at = NOW()
  WHERE appointment_id = p_appointment_id;

  INSERT INTO ops.entity_edits (
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, change_source
  ) VALUES (
    'ops.appointments', p_appointment_id, 'clinic_day_number',
    v_current::TEXT, p_value::TEXT, p_changed_by, p_source::TEXT
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMIT;

\echo 'Done: set_clinic_day_number with collision + ML validation + foster support'
