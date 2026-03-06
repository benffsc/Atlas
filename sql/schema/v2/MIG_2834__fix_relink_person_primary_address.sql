-- MIG_2834: Fix sot.relink_person_primary_address()
-- Bug: Function stored place_id into primary_address_id and never set primary_place_id
-- Fix: Correctly set BOTH primary_place_id and primary_address_id
-- Fixes FFS-208

\echo 'MIG_2834: Fixing sot.relink_person_primary_address()...'

CREATE OR REPLACE FUNCTION sot.relink_person_primary_address(
    p_person_id UUID,
    p_new_place_id UUID,
    p_new_address_id UUID DEFAULT NULL,
    p_changed_by TEXT DEFAULT 'api'
)
RETURNS BOOLEAN AS $$
DECLARE
    v_old_place_id UUID;
    v_old_address_id UUID;
    v_resolved_address_id UUID;
BEGIN
    -- Get current values
    SELECT primary_place_id, primary_address_id
    INTO v_old_place_id, v_old_address_id
    FROM sot.people WHERE person_id = p_person_id;

    -- Resolve address_id: use parameter if provided, otherwise look up from place
    v_resolved_address_id := p_new_address_id;
    IF v_resolved_address_id IS NULL AND p_new_place_id IS NOT NULL THEN
        SELECT sot_address_id INTO v_resolved_address_id
        FROM sot.places WHERE place_id = p_new_place_id;
    END IF;

    -- Update BOTH columns correctly
    UPDATE sot.people
    SET primary_place_id = p_new_place_id,
        primary_address_id = v_resolved_address_id,
        updated_at = NOW()
    WHERE person_id = p_person_id;

    -- Log both field changes
    IF v_old_place_id IS DISTINCT FROM p_new_place_id THEN
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('person', p_person_id, 'primary_place_id', to_jsonb(v_old_place_id::text), to_jsonb(p_new_place_id::text), p_changed_by);
    END IF;

    IF v_old_address_id IS DISTINCT FROM v_resolved_address_id THEN
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('person', p_person_id, 'primary_address_id', to_jsonb(v_old_address_id::text), to_jsonb(v_resolved_address_id::text), p_changed_by);
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Data repair: fix rows where primary_address_id contains a place UUID
-- (the old bug stored place_id into primary_address_id)
WITH corrupted AS (
    SELECT p.person_id, p.primary_address_id AS wrong_value, pl.sot_address_id AS correct_address_id
    FROM sot.people p
    JOIN sot.places pl ON pl.place_id = p.primary_address_id
    WHERE p.primary_address_id IS NOT NULL
      AND p.merged_into_person_id IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM sot.addresses a WHERE a.address_id = p.primary_address_id
      )
)
UPDATE sot.people p
SET primary_address_id = c.correct_address_id,
    primary_place_id = COALESCE(p.primary_place_id, c.wrong_value),
    updated_at = NOW()
FROM corrupted c
WHERE p.person_id = c.person_id;

\echo '   Fixed sot.relink_person_primary_address() and repaired corrupted rows'
