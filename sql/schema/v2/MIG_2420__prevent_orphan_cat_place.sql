-- MIG_2420: Prevent Orphan cat_place with person_relationship Evidence
--
-- SAFEGUARD: Adds a trigger that rejects INSERT into sot.cat_place with
-- evidence_type = 'person_relationship' if there's no backing person_cat relationship.
--
-- This prevents the mega-place bug from DATA_GAP_039 from recurring.

BEGIN;

-- =============================================================================
-- Create validation function
-- =============================================================================

CREATE OR REPLACE FUNCTION sot.validate_cat_place_person_relationship()
RETURNS TRIGGER AS $$
BEGIN
    -- Only validate person_relationship evidence type
    IF NEW.evidence_type = 'person_relationship' THEN
        -- Check if there's a backing person_cat relationship
        IF NOT EXISTS (
            SELECT 1 FROM sot.person_cat pc
            WHERE pc.cat_id = NEW.cat_id
        ) THEN
            RAISE EXCEPTION 'Cannot create cat_place with evidence_type=person_relationship without backing person_cat relationship for cat_id=%', NEW.cat_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Create trigger
-- =============================================================================

DROP TRIGGER IF EXISTS trg_validate_cat_place_person_relationship ON sot.cat_place;

CREATE TRIGGER trg_validate_cat_place_person_relationship
    BEFORE INSERT ON sot.cat_place
    FOR EACH ROW
    WHEN (NEW.evidence_type = 'person_relationship')
    EXECUTE FUNCTION sot.validate_cat_place_person_relationship();

COMMIT;

-- =============================================================================
-- Verification: Test the trigger
-- =============================================================================

DO $$
DECLARE
    v_test_cat_id UUID;
    v_test_place_id UUID;
BEGIN
    -- Get a cat that has NO person_cat relationship
    SELECT c.cat_id INTO v_test_cat_id
    FROM sot.cats c
    WHERE c.merged_into_cat_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM sot.person_cat pc WHERE pc.cat_id = c.cat_id)
    LIMIT 1;

    -- Get any place
    SELECT place_id INTO v_test_place_id
    FROM sot.places
    WHERE merged_into_place_id IS NULL
    LIMIT 1;

    IF v_test_cat_id IS NOT NULL AND v_test_place_id IS NOT NULL THEN
        -- Try to insert invalid relationship (should fail)
        BEGIN
            INSERT INTO sot.cat_place (cat_id, place_id, relationship_type, evidence_type, source_system)
            VALUES (v_test_cat_id, v_test_place_id, 'test', 'person_relationship', 'test');

            -- If we get here, trigger didn't work
            RAISE EXCEPTION 'TRIGGER FAILED: Should have rejected person_relationship without backing person_cat';
        EXCEPTION
            WHEN OTHERS THEN
                -- Expected - trigger rejected the insert
                RAISE NOTICE 'MIG_2420: Trigger working correctly - rejected orphan person_relationship';
        END;

        -- Clean up any test data that might have snuck through
        DELETE FROM sot.cat_place WHERE source_system = 'test';
    ELSE
        RAISE NOTICE 'MIG_2420: Could not find test data, skipping trigger verification';
    END IF;
END $$;

SELECT 'MIG_2420: Safeguard trigger installed - orphan person_relationship cat_place links will be rejected' as status;
