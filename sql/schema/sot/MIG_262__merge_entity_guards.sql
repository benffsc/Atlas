-- MIG_262: Merge Entity Guards and Identifier Cascade
--
-- Problem:
--   1. Ingest scripts can recreate merged entities by inserting new identifiers
--      pointing to merged records instead of canonical ones
--   2. Existing person_identifiers/cat_identifiers may point to merged entities
--
-- Solution:
--   1. Add BEFORE INSERT triggers that auto-redirect to canonical entities
--   2. Cascade existing orphaned identifiers to their canonical entities
--   3. Add constraint triggers to prevent direct references to merged entities
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_262__merge_entity_guards.sql

\echo ''
\echo '=============================================='
\echo 'MIG_262: Merge Entity Guards'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Create trigger to auto-redirect person_identifiers to canonical person
-- ============================================================

\echo '1. Creating person_identifiers canonical redirect trigger...'

CREATE OR REPLACE FUNCTION trapper.trg_person_identifier_canonical_redirect()
RETURNS TRIGGER AS $$
DECLARE
    v_canonical_id UUID;
BEGIN
    -- Check if the person_id points to a merged person
    SELECT merged_into_person_id INTO v_canonical_id
    FROM trapper.sot_people
    WHERE person_id = NEW.person_id
      AND merged_into_person_id IS NOT NULL;

    IF v_canonical_id IS NOT NULL THEN
        -- Follow the merge chain to get the canonical person
        v_canonical_id := trapper.get_canonical_person_id(NEW.person_id);

        -- Check if identifier already exists for canonical person
        IF EXISTS (
            SELECT 1 FROM trapper.person_identifiers
            WHERE person_id = v_canonical_id
              AND id_type = NEW.id_type
              AND id_value_norm = NEW.id_value_norm
        ) THEN
            -- Skip insert, already exists on canonical
            RAISE NOTICE 'Identifier already exists on canonical person %, skipping', v_canonical_id;
            RETURN NULL;
        END IF;

        -- Redirect to canonical person
        RAISE NOTICE 'Redirecting identifier from merged person % to canonical %', NEW.person_id, v_canonical_id;
        NEW.person_id := v_canonical_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_person_identifier_canonical ON trapper.person_identifiers;
CREATE TRIGGER trg_person_identifier_canonical
    BEFORE INSERT ON trapper.person_identifiers
    FOR EACH ROW
    EXECUTE FUNCTION trapper.trg_person_identifier_canonical_redirect();

COMMENT ON FUNCTION trapper.trg_person_identifier_canonical_redirect IS
'Auto-redirects new person_identifiers from merged persons to their canonical person.
Prevents orphaned identifiers pointing to merged entities.';

-- ============================================================
-- 2. Create trigger to auto-redirect cat_identifiers to canonical cat
-- ============================================================

\echo '2. Creating cat_identifiers canonical redirect trigger...'

CREATE OR REPLACE FUNCTION trapper.trg_cat_identifier_canonical_redirect()
RETURNS TRIGGER AS $$
DECLARE
    v_canonical_id UUID;
BEGIN
    -- Check if the cat_id points to a merged cat
    SELECT merged_into_cat_id INTO v_canonical_id
    FROM trapper.sot_cats
    WHERE cat_id = NEW.cat_id
      AND merged_into_cat_id IS NOT NULL;

    IF v_canonical_id IS NOT NULL THEN
        -- Follow the merge chain to get the canonical cat
        v_canonical_id := trapper.get_canonical_cat_id(NEW.cat_id);

        -- Check if identifier already exists for canonical cat
        IF EXISTS (
            SELECT 1 FROM trapper.cat_identifiers
            WHERE cat_id = v_canonical_id
              AND id_type = NEW.id_type
              AND id_value = NEW.id_value
        ) THEN
            -- Skip insert, already exists on canonical
            RAISE NOTICE 'Identifier already exists on canonical cat %, skipping', v_canonical_id;
            RETURN NULL;
        END IF;

        -- Redirect to canonical cat
        RAISE NOTICE 'Redirecting identifier from merged cat % to canonical %', NEW.cat_id, v_canonical_id;
        NEW.cat_id := v_canonical_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cat_identifier_canonical ON trapper.cat_identifiers;
CREATE TRIGGER trg_cat_identifier_canonical
    BEFORE INSERT ON trapper.cat_identifiers
    FOR EACH ROW
    EXECUTE FUNCTION trapper.trg_cat_identifier_canonical_redirect();

COMMENT ON FUNCTION trapper.trg_cat_identifier_canonical_redirect IS
'Auto-redirects new cat_identifiers from merged cats to their canonical cat.
Prevents orphaned identifiers pointing to merged entities.';

-- ============================================================
-- 3. Create trigger to redirect relationship inserts to canonical entities
-- ============================================================

\echo '3. Creating person_place_relationships canonical redirect trigger...'

CREATE OR REPLACE FUNCTION trapper.trg_person_place_rel_canonical_redirect()
RETURNS TRIGGER AS $$
DECLARE
    v_canonical_person_id UUID;
    v_canonical_place_id UUID;
BEGIN
    -- Check person
    SELECT merged_into_person_id INTO v_canonical_person_id
    FROM trapper.sot_people
    WHERE person_id = NEW.person_id
      AND merged_into_person_id IS NOT NULL;

    IF v_canonical_person_id IS NOT NULL THEN
        NEW.person_id := trapper.get_canonical_person_id(NEW.person_id);
    END IF;

    -- Check place
    SELECT merged_into_place_id INTO v_canonical_place_id
    FROM trapper.places
    WHERE place_id = NEW.place_id
      AND merged_into_place_id IS NOT NULL;

    IF v_canonical_place_id IS NOT NULL THEN
        NEW.place_id := trapper.get_canonical_place_id(NEW.place_id);
    END IF;

    -- Check if relationship already exists after redirects
    IF EXISTS (
        SELECT 1 FROM trapper.person_place_relationships
        WHERE person_id = NEW.person_id
          AND place_id = NEW.place_id
    ) THEN
        RAISE NOTICE 'Relationship already exists between person % and place %, skipping', NEW.person_id, NEW.place_id;
        RETURN NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_person_place_rel_canonical ON trapper.person_place_relationships;
CREATE TRIGGER trg_person_place_rel_canonical
    BEFORE INSERT ON trapper.person_place_relationships
    FOR EACH ROW
    EXECUTE FUNCTION trapper.trg_person_place_rel_canonical_redirect();

-- ============================================================
-- 4. Cascade existing orphaned person_identifiers to canonical persons
-- ============================================================

\echo ''
\echo '4. Cascading orphaned person_identifiers to canonical persons...'

DO $$
DECLARE
    v_count INT := 0;
    v_rec RECORD;
BEGIN
    FOR v_rec IN
        SELECT pi.identifier_id, pi.person_id,
               trapper.get_canonical_person_id(pi.person_id) AS canonical_id
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people p ON p.person_id = pi.person_id
        WHERE p.merged_into_person_id IS NOT NULL
    LOOP
        -- Check if identifier already exists on canonical
        IF NOT EXISTS (
            SELECT 1 FROM trapper.person_identifiers pi2
            WHERE pi2.person_id = v_rec.canonical_id
              AND pi2.id_type = (SELECT id_type FROM trapper.person_identifiers WHERE identifier_id = v_rec.identifier_id)
              AND pi2.id_value_norm = (SELECT id_value_norm FROM trapper.person_identifiers WHERE identifier_id = v_rec.identifier_id)
        ) THEN
            -- Move to canonical
            UPDATE trapper.person_identifiers
            SET person_id = v_rec.canonical_id
            WHERE identifier_id = v_rec.identifier_id;
            v_count := v_count + 1;
        ELSE
            -- Delete duplicate
            DELETE FROM trapper.person_identifiers WHERE identifier_id = v_rec.identifier_id;
        END IF;
    END LOOP;

    RAISE NOTICE 'Cascaded % orphaned person identifiers to canonical persons', v_count;
END;
$$;

-- ============================================================
-- 5. Cascade existing orphaned cat_identifiers to canonical cats
-- ============================================================

\echo '5. Cascading orphaned cat_identifiers to canonical cats...'

DO $$
DECLARE
    v_count INT := 0;
    v_rec RECORD;
BEGIN
    FOR v_rec IN
        SELECT ci.identifier_id, ci.cat_id,
               trapper.get_canonical_cat_id(ci.cat_id) AS canonical_id
        FROM trapper.cat_identifiers ci
        JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
        WHERE c.merged_into_cat_id IS NOT NULL
    LOOP
        -- Check if identifier already exists on canonical
        IF NOT EXISTS (
            SELECT 1 FROM trapper.cat_identifiers ci2
            WHERE ci2.cat_id = v_rec.canonical_id
              AND ci2.id_type = (SELECT id_type FROM trapper.cat_identifiers WHERE identifier_id = v_rec.identifier_id)
              AND ci2.id_value = (SELECT id_value FROM trapper.cat_identifiers WHERE identifier_id = v_rec.identifier_id)
        ) THEN
            -- Move to canonical
            UPDATE trapper.cat_identifiers
            SET cat_id = v_rec.canonical_id
            WHERE identifier_id = v_rec.identifier_id;
            v_count := v_count + 1;
        ELSE
            -- Delete duplicate
            DELETE FROM trapper.cat_identifiers WHERE identifier_id = v_rec.identifier_id;
        END IF;
    END LOOP;

    RAISE NOTICE 'Cascaded % orphaned cat identifiers to canonical cats', v_count;
END;
$$;

-- ============================================================
-- 6. Cascade orphaned person_place_relationships
-- ============================================================

\echo '6. Cascading orphaned person_place_relationships...'

DO $$
DECLARE
    v_count INT := 0;
BEGIN
    -- Update relationships pointing to merged persons
    WITH to_update AS (
        SELECT ppr.relationship_id,
               trapper.get_canonical_person_id(ppr.person_id) AS canonical_person_id,
               trapper.get_canonical_place_id(ppr.place_id) AS canonical_place_id
        FROM trapper.person_place_relationships ppr
        JOIN trapper.sot_people p ON p.person_id = ppr.person_id
        WHERE p.merged_into_person_id IS NOT NULL
    )
    UPDATE trapper.person_place_relationships ppr
    SET person_id = tu.canonical_person_id
    FROM to_update tu
    WHERE ppr.relationship_id = tu.relationship_id
      AND NOT EXISTS (
          SELECT 1 FROM trapper.person_place_relationships ppr2
          WHERE ppr2.person_id = tu.canonical_person_id
            AND ppr2.place_id = ppr.place_id
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Updated % person_place_relationships to canonical persons', v_count;

    -- Update relationships pointing to merged places
    WITH to_update AS (
        SELECT ppr.relationship_id,
               trapper.get_canonical_place_id(ppr.place_id) AS canonical_place_id
        FROM trapper.person_place_relationships ppr
        JOIN trapper.places pl ON pl.place_id = ppr.place_id
        WHERE pl.merged_into_place_id IS NOT NULL
    )
    UPDATE trapper.person_place_relationships ppr
    SET place_id = tu.canonical_place_id
    FROM to_update tu
    WHERE ppr.relationship_id = tu.relationship_id
      AND NOT EXISTS (
          SELECT 1 FROM trapper.person_place_relationships ppr2
          WHERE ppr2.person_id = ppr.person_id
            AND ppr2.place_id = tu.canonical_place_id
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Updated % person_place_relationships to canonical places', v_count;
END;
$$;

-- ============================================================
-- 7. Cascade orphaned person_cat_relationships
-- ============================================================

\echo '7. Cascading orphaned person_cat_relationships...'

DO $$
DECLARE
    v_count INT := 0;
BEGIN
    -- Update relationships pointing to merged persons
    WITH to_update AS (
        SELECT pcr.relationship_id,
               trapper.get_canonical_person_id(pcr.person_id) AS canonical_person_id
        FROM trapper.person_cat_relationships pcr
        JOIN trapper.sot_people p ON p.person_id = pcr.person_id
        WHERE p.merged_into_person_id IS NOT NULL
    )
    UPDATE trapper.person_cat_relationships pcr
    SET person_id = tu.canonical_person_id
    FROM to_update tu
    WHERE pcr.relationship_id = tu.relationship_id
      AND NOT EXISTS (
          SELECT 1 FROM trapper.person_cat_relationships pcr2
          WHERE pcr2.person_id = tu.canonical_person_id
            AND pcr2.cat_id = pcr.cat_id
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Updated % person_cat_relationships to canonical persons', v_count;

    -- Update relationships pointing to merged cats
    WITH to_update AS (
        SELECT pcr.relationship_id,
               trapper.get_canonical_cat_id(pcr.cat_id) AS canonical_cat_id
        FROM trapper.person_cat_relationships pcr
        JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
        WHERE c.merged_into_cat_id IS NOT NULL
    )
    UPDATE trapper.person_cat_relationships pcr
    SET cat_id = tu.canonical_cat_id
    FROM to_update tu
    WHERE pcr.relationship_id = tu.relationship_id
      AND NOT EXISTS (
          SELECT 1 FROM trapper.person_cat_relationships pcr2
          WHERE pcr2.person_id = pcr.person_id
            AND pcr2.cat_id = tu.canonical_cat_id
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Updated % person_cat_relationships to canonical cats', v_count;
END;
$$;

-- ============================================================
-- 8. Cascade orphaned cat_place_relationships
-- ============================================================

\echo '8. Cascading orphaned cat_place_relationships...'

DO $$
DECLARE
    v_count INT := 0;
BEGIN
    -- Update relationships pointing to merged cats
    WITH to_update AS (
        SELECT cpr.relationship_id,
               trapper.get_canonical_cat_id(cpr.cat_id) AS canonical_cat_id
        FROM trapper.cat_place_relationships cpr
        JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
        WHERE c.merged_into_cat_id IS NOT NULL
    )
    UPDATE trapper.cat_place_relationships cpr
    SET cat_id = tu.canonical_cat_id
    FROM to_update tu
    WHERE cpr.relationship_id = tu.relationship_id
      AND NOT EXISTS (
          SELECT 1 FROM trapper.cat_place_relationships cpr2
          WHERE cpr2.cat_id = tu.canonical_cat_id
            AND cpr2.place_id = cpr.place_id
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Updated % cat_place_relationships to canonical cats', v_count;

    -- Update relationships pointing to merged places
    WITH to_update AS (
        SELECT cpr.relationship_id,
               trapper.get_canonical_place_id(cpr.place_id) AS canonical_place_id
        FROM trapper.cat_place_relationships cpr
        JOIN trapper.places pl ON pl.place_id = cpr.place_id
        WHERE pl.merged_into_place_id IS NOT NULL
    )
    UPDATE trapper.cat_place_relationships cpr
    SET place_id = tu.canonical_place_id
    FROM to_update tu
    WHERE cpr.relationship_id = tu.relationship_id
      AND NOT EXISTS (
          SELECT 1 FROM trapper.cat_place_relationships cpr2
          WHERE cpr2.cat_id = cpr.cat_id
            AND cpr2.place_id = tu.canonical_place_id
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Updated % cat_place_relationships to canonical places', v_count;
END;
$$;

-- ============================================================
-- 9. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Orphaned identifiers remaining (should be 0):'
SELECT 'person_identifiers' AS table_name, COUNT(*) AS orphaned_count
FROM trapper.person_identifiers pi
JOIN trapper.sot_people p ON p.person_id = pi.person_id
WHERE p.merged_into_person_id IS NOT NULL
UNION ALL
SELECT 'cat_identifiers', COUNT(*)
FROM trapper.cat_identifiers ci
JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
WHERE c.merged_into_cat_id IS NOT NULL;

\echo ''
\echo 'Triggers created:'
SELECT trigger_name, event_object_table, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'trapper'
  AND trigger_name LIKE 'trg_%canonical%'
ORDER BY event_object_table;

\echo ''
SELECT 'MIG_262 Complete' AS status;
