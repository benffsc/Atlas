-- MIG_2858: Create missing sot.unlink_person_primary_address() function (FFS-208)
--
-- Problem: DELETE endpoint at /api/people/[id]/address calls
-- sot.unlink_person_primary_address() which doesn't exist, causing 500 errors.
-- MIG_2834 fixed the relink function and data repair, but never created the unlink.
--
-- Depends on: MIG_2834 (fixed relink_person_primary_address)

BEGIN;

CREATE OR REPLACE FUNCTION sot.unlink_person_primary_address(
    p_person_id UUID,
    p_changed_by TEXT DEFAULT 'api'
)
RETURNS BOOLEAN AS $$
DECLARE
    v_old_place_id UUID;
    v_old_address_id UUID;
BEGIN
    -- Get current values
    SELECT primary_place_id, primary_address_id
    INTO v_old_place_id, v_old_address_id
    FROM sot.people
    WHERE person_id = p_person_id
      AND merged_into_person_id IS NULL;

    -- Nothing to unlink
    IF v_old_place_id IS NULL AND v_old_address_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Clear both columns
    UPDATE sot.people
    SET primary_place_id = NULL,
        primary_address_id = NULL,
        updated_at = NOW()
    WHERE person_id = p_person_id;

    -- Log changes
    IF v_old_place_id IS NOT NULL THEN
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('person', p_person_id, 'primary_place_id', to_jsonb(v_old_place_id::text), 'null'::jsonb, p_changed_by);
    END IF;

    IF v_old_address_id IS NOT NULL THEN
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('person', p_person_id, 'primary_address_id', to_jsonb(v_old_address_id::text), 'null'::jsonb, p_changed_by);
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.unlink_person_primary_address IS
'Clears primary_place_id and primary_address_id from a person record. Logs changes to ops.entity_edits. Called by DELETE /api/people/[id]/address.';

COMMIT;
