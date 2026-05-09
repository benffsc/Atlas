-- MIG_3127: Fix lifecycle trigger — add transfer + foster_end event types
-- The original MIG_3126 trigger only handled adoption, return_to_field, foster_start, mortality.
-- Missing: transfer (1,504 events) and foster_end (7,747 events) get no cat_place updates.
--
-- transfer: Cat transferred to another org/location → depart origin, create destination
-- foster_end: Cat returned from foster to FFSC → depart foster home

CREATE OR REPLACE FUNCTION sot.lifecycle_event_update_cat_place()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_origin_place_id UUID;
BEGIN
  IF NEW.event_type IN ('adoption', 'return_to_field', 'foster_start', 'mortality', 'transfer', 'foster_end') THEN

    -- Find origin place
    v_origin_place_id := NEW.origin_place_id;
    IF v_origin_place_id IS NULL THEN
      SELECT cle.origin_place_id INTO v_origin_place_id
      FROM sot.cat_lifecycle_events cle
      WHERE cle.cat_id = NEW.cat_id AND cle.event_type = 'intake' AND cle.origin_place_id IS NOT NULL
      ORDER BY cle.event_at ASC LIMIT 1;
    END IF;

    -- Mark departed from origin
    IF v_origin_place_id IS NOT NULL THEN
      UPDATE sot.cat_place
      SET presence_status = 'departed'
      WHERE cat_id = NEW.cat_id AND place_id = v_origin_place_id
        AND presence_status NOT IN ('departed', 'presumed_departed');
    END IF;

    -- For adoption/RTF/transfer: depart from all current places
    IF NEW.event_type IN ('adoption', 'return_to_field', 'transfer') THEN
      UPDATE sot.cat_place SET presence_status = 'departed'
      WHERE cat_id = NEW.cat_id
        AND presence_status NOT IN ('departed', 'presumed_departed')
        AND place_id != COALESCE(NEW.destination_place_id, '00000000-0000-0000-0000-000000000000'::uuid);
    END IF;

    -- foster_end: cat departs foster home (origin), no new destination (back to FFSC)
    IF NEW.event_type = 'foster_end' THEN
      -- Depart from foster place specifically
      IF v_origin_place_id IS NOT NULL THEN
        UPDATE sot.cat_place
        SET presence_status = 'departed'
        WHERE cat_id = NEW.cat_id AND place_id = v_origin_place_id
          AND presence_status NOT IN ('departed', 'presumed_departed');
      END IF;
    END IF;

    -- Create destination cat_place
    IF NEW.destination_place_id IS NOT NULL AND NEW.event_type NOT IN ('mortality', 'foster_end') THEN
      INSERT INTO sot.cat_place (cat_id, place_id, relationship_type, presence_status, evidence_type, confidence, source_system)
      VALUES (
        NEW.cat_id, NEW.destination_place_id,
        CASE
          WHEN NEW.event_subtype ILIKE '%relocation%' OR NEW.event_subtype ILIKE '%barn%' THEN 'relocated_to'
          WHEN NEW.event_type = 'foster_start' THEN 'associated'
          WHEN NEW.event_type = 'transfer' THEN 'relocated_to'
          ELSE 'home'
        END,
        'current', 'cross_system_match', 0.9, 'shelterluv'
      ) ON CONFLICT (cat_id, place_id, relationship_type) DO UPDATE
        SET presence_status = 'current', updated_at = NOW();
    END IF;

    -- Mortality: depart everywhere + mark deceased
    IF NEW.event_type = 'mortality' THEN
      UPDATE sot.cat_place SET presence_status = 'departed'
      WHERE cat_id = NEW.cat_id AND presence_status NOT IN ('departed', 'presumed_departed');
      UPDATE sot.cats SET is_deceased = TRUE, deceased_at = NEW.event_at
      WHERE cat_id = NEW.cat_id AND (is_deceased IS NULL OR is_deceased = FALSE);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger already exists from MIG_3126, this just replaces the function body
