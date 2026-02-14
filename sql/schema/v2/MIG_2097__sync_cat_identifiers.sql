-- MIG_2097: Sync denormalized sot.cats columns with normalized sot.cat_identifiers
-- Date: 2026-02-14
-- Issue: Data stored in both sot.cats (microchip, clinichq_animal_id, shelterluv_animal_id)
--        AND sot.cat_identifiers. We need to ensure they stay in sync.
--
-- Strategy: Trigger on sot.cats to auto-populate cat_identifiers when denormalized fields change

-- ============================================================================
-- TRIGGER FUNCTION: Sync cat_identifiers when sot.cats is updated
-- ============================================================================
CREATE OR REPLACE FUNCTION sot.sync_cat_identifiers()
RETURNS TRIGGER AS $$
BEGIN
    -- Handle microchip
    IF NEW.microchip IS NOT NULL AND NEW.microchip != '' THEN
        INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at)
        VALUES (NEW.cat_id, 'microchip', NEW.microchip, COALESCE(NEW.source_system, 'clinichq'), NOW())
        ON CONFLICT (id_type, id_value)
        DO UPDATE SET cat_id = EXCLUDED.cat_id;  -- Handle microchip reassignment
    END IF;

    -- Handle clinichq_animal_id
    IF NEW.clinichq_animal_id IS NOT NULL AND NEW.clinichq_animal_id != '' THEN
        INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at)
        VALUES (NEW.cat_id, 'clinichq_animal_id', NEW.clinichq_animal_id, 'clinichq', NOW())
        ON CONFLICT (id_type, id_value)
        DO UPDATE SET cat_id = EXCLUDED.cat_id;
    END IF;

    -- Handle shelterluv_animal_id
    IF NEW.shelterluv_animal_id IS NOT NULL AND NEW.shelterluv_animal_id != '' THEN
        INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at)
        VALUES (NEW.cat_id, 'shelterluv_animal_id', NEW.shelterluv_animal_id, 'shelterluv', NOW())
        ON CONFLICT (id_type, id_value)
        DO UPDATE SET cat_id = EXCLUDED.cat_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- DROP EXISTING TRIGGER IF EXISTS
-- ============================================================================
DROP TRIGGER IF EXISTS trg_sync_cat_identifiers ON sot.cats;

-- ============================================================================
-- CREATE TRIGGER: Run on INSERT and UPDATE
-- ============================================================================
CREATE TRIGGER trg_sync_cat_identifiers
AFTER INSERT OR UPDATE OF microchip, clinichq_animal_id, shelterluv_animal_id
ON sot.cats
FOR EACH ROW
EXECUTE FUNCTION sot.sync_cat_identifiers();

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE 'MIG_2097: Trigger sot.sync_cat_identifiers created';
    RAISE NOTICE 'MIG_2097: From now on, changes to sot.cats.microchip/clinichq_animal_id/shelterluv_animal_id';
    RAISE NOTICE 'MIG_2097: will automatically sync to sot.cat_identifiers';
END $$;

-- ============================================================================
-- ALSO: Sync person_identifiers when sot.people is updated
-- ============================================================================
CREATE OR REPLACE FUNCTION sot.sync_person_identifiers()
RETURNS TRIGGER AS $$
BEGIN
    -- Handle primary_email
    IF NEW.primary_email IS NOT NULL AND NEW.primary_email != '' THEN
        INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, source_system, created_at)
        VALUES (
            NEW.person_id,
            'email',
            NEW.primary_email,
            LOWER(TRIM(NEW.primary_email)),
            COALESCE(NEW.source_system, 'atlas'),
            NOW()
        )
        ON CONFLICT (id_type, id_value_norm)
        DO UPDATE SET person_id = EXCLUDED.person_id;  -- Handle reassignment
    END IF;

    -- Handle primary_phone
    IF NEW.primary_phone IS NOT NULL AND NEW.primary_phone != '' THEN
        INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, source_system, created_at)
        VALUES (
            NEW.person_id,
            'phone',
            NEW.primary_phone,
            REGEXP_REPLACE(NEW.primary_phone, '[^0-9]', '', 'g'),  -- Normalize: digits only
            COALESCE(NEW.source_system, 'atlas'),
            NOW()
        )
        ON CONFLICT (id_type, id_value_norm)
        DO UPDATE SET person_id = EXCLUDED.person_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- CREATE PERSON TRIGGER
-- ============================================================================
DROP TRIGGER IF EXISTS trg_sync_person_identifiers ON sot.people;

CREATE TRIGGER trg_sync_person_identifiers
AFTER INSERT OR UPDATE OF primary_email, primary_phone
ON sot.people
FOR EACH ROW
EXECUTE FUNCTION sot.sync_person_identifiers();

DO $$
BEGIN
    RAISE NOTICE 'MIG_2097: Trigger sot.sync_person_identifiers created';
    RAISE NOTICE 'MIG_2097: From now on, changes to sot.people.primary_email/primary_phone';
    RAISE NOTICE 'MIG_2097: will automatically sync to sot.person_identifiers';
END $$;
