-- MIG_225__entity_merge_infrastructure.sql
-- Comprehensive merge infrastructure for all SOT entities
--
-- Purpose:
--   - Enable stable manual corrections that survive re-imports
--   - Provide merge/undo functions for cats, places, people
--   - Protect ingest from recreating merged entities
--   - Maintain referential integrity during merges
--
-- Entities covered:
--   - sot_cats: NEW merge infrastructure
--   - places: COMPLETE existing infrastructure
--   - sot_people: Already has infrastructure, add improvements
--
-- MANUAL APPLY:
--   export $(cat .env.local | grep DATABASE_URL)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_225__entity_merge_infrastructure.sql

\echo ''
\echo '=============================================='
\echo 'MIG_225: Entity Merge Infrastructure'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. CAT MERGE INFRASTRUCTURE
-- ============================================================

\echo '1. Adding merge columns to sot_cats...'

ALTER TABLE trapper.sot_cats
ADD COLUMN IF NOT EXISTS merged_into_cat_id UUID REFERENCES trapper.sot_cats(cat_id),
ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS merge_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_sot_cats_merged_into ON trapper.sot_cats(merged_into_cat_id) WHERE merged_into_cat_id IS NOT NULL;

COMMENT ON COLUMN trapper.sot_cats.merged_into_cat_id IS 'If set, this cat was merged into another cat. All queries should follow this reference.';
COMMENT ON COLUMN trapper.sot_cats.merged_at IS 'When the merge occurred';
COMMENT ON COLUMN trapper.sot_cats.merge_reason IS 'Why the merge was performed (duplicate, data_quality, manual_correction)';

-- ============================================================
-- 2. COMPLETE PLACES MERGE INFRASTRUCTURE
-- ============================================================

\echo '2. Completing places merge infrastructure...'

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS merge_reason TEXT;

COMMENT ON COLUMN trapper.places.merged_into_place_id IS 'If set, this place was merged into another place. All queries should follow this reference.';
COMMENT ON COLUMN trapper.places.merged_at IS 'When the merge occurred';
COMMENT ON COLUMN trapper.places.merge_reason IS 'Why the merge was performed (duplicate, same_location, manual_correction)';

-- ============================================================
-- 3. MERGE CATS FUNCTION
-- ============================================================

\echo '3. Creating merge_cats function...'

CREATE OR REPLACE FUNCTION trapper.merge_cats(
    p_source_cat_id UUID,
    p_target_cat_id UUID,
    p_reason TEXT DEFAULT 'manual_merge',
    p_merged_by TEXT DEFAULT 'system'
) RETURNS jsonb AS $$
DECLARE
    v_source_cat RECORD;
    v_target_cat RECORD;
    v_result jsonb;
    v_transferred jsonb := '{}'::jsonb;
BEGIN
    -- Validate inputs
    IF p_source_cat_id = p_target_cat_id THEN
        RAISE EXCEPTION 'Cannot merge cat into itself';
    END IF;

    -- Get source cat
    SELECT * INTO v_source_cat FROM trapper.sot_cats WHERE cat_id = p_source_cat_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Source cat not found: %', p_source_cat_id;
    END IF;

    IF v_source_cat.merged_into_cat_id IS NOT NULL THEN
        RAISE EXCEPTION 'Source cat is already merged into %', v_source_cat.merged_into_cat_id;
    END IF;

    -- Get target cat
    SELECT * INTO v_target_cat FROM trapper.sot_cats WHERE cat_id = p_target_cat_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target cat not found: %', p_target_cat_id;
    END IF;

    IF v_target_cat.merged_into_cat_id IS NOT NULL THEN
        RAISE EXCEPTION 'Target cat is already merged into another cat. Merge into the canonical cat instead: %', v_target_cat.merged_into_cat_id;
    END IF;

    -- Transfer cat_identifiers (microchips, etc)
    WITH transferred AS (
        UPDATE trapper.cat_identifiers
        SET cat_id = p_target_cat_id
        WHERE cat_id = p_source_cat_id
        AND NOT EXISTS (
            SELECT 1 FROM trapper.cat_identifiers ci2
            WHERE ci2.cat_id = p_target_cat_id
            AND ci2.id_type = cat_identifiers.id_type
            AND ci2.id_value = cat_identifiers.id_value
        )
        RETURNING identifier_id
    )
    SELECT jsonb_set(v_transferred, '{identifiers}', to_jsonb(COUNT(*))) INTO v_transferred FROM transferred;

    -- Transfer cat_procedures
    WITH transferred AS (
        UPDATE trapper.cat_procedures
        SET cat_id = p_target_cat_id
        WHERE cat_id = p_source_cat_id
        RETURNING procedure_id
    )
    SELECT jsonb_set(v_transferred, '{procedures}', to_jsonb(COUNT(*))) INTO v_transferred FROM transferred;

    -- Transfer cat_place_relationships
    WITH transferred AS (
        UPDATE trapper.cat_place_relationships
        SET cat_id = p_target_cat_id
        WHERE cat_id = p_source_cat_id
        AND NOT EXISTS (
            SELECT 1 FROM trapper.cat_place_relationships cpr2
            WHERE cpr2.cat_id = p_target_cat_id
            AND cpr2.place_id = cat_place_relationships.place_id
        )
        RETURNING relationship_id
    )
    SELECT jsonb_set(v_transferred, '{place_relationships}', to_jsonb(COUNT(*))) INTO v_transferred FROM transferred;

    -- Transfer person_cat_relationships
    WITH transferred AS (
        UPDATE trapper.person_cat_relationships
        SET cat_id = p_target_cat_id
        WHERE cat_id = p_source_cat_id
        AND NOT EXISTS (
            SELECT 1 FROM trapper.person_cat_relationships pcr2
            WHERE pcr2.cat_id = p_target_cat_id
            AND pcr2.person_id = person_cat_relationships.person_id
        )
        RETURNING relationship_id
    )
    SELECT jsonb_set(v_transferred, '{person_relationships}', to_jsonb(COUNT(*))) INTO v_transferred FROM transferred;

    -- Transfer sot_appointments
    WITH transferred AS (
        UPDATE trapper.sot_appointments
        SET cat_id = p_target_cat_id
        WHERE cat_id = p_source_cat_id
        RETURNING appointment_id
    )
    SELECT jsonb_set(v_transferred, '{appointments}', to_jsonb(COUNT(*))) INTO v_transferred FROM transferred;

    -- Transfer request_cat_links
    WITH transferred AS (
        UPDATE trapper.request_cat_links
        SET cat_id = p_target_cat_id
        WHERE cat_id = p_source_cat_id
        AND NOT EXISTS (
            SELECT 1 FROM trapper.request_cat_links rcl2
            WHERE rcl2.cat_id = p_target_cat_id
            AND rcl2.request_id = request_cat_links.request_id
        )
        RETURNING link_id
    )
    SELECT jsonb_set(v_transferred, '{request_links}', to_jsonb(COUNT(*))) INTO v_transferred FROM transferred;

    -- Mark source as merged
    UPDATE trapper.sot_cats
    SET merged_into_cat_id = p_target_cat_id,
        merged_at = NOW(),
        merge_reason = p_reason,
        updated_at = NOW()
    WHERE cat_id = p_source_cat_id;

    -- Enrich target cat with any missing data from source
    UPDATE trapper.sot_cats
    SET
        sex = COALESCE(sex, v_source_cat.sex),
        birth_year = COALESCE(birth_year, v_source_cat.birth_year),
        primary_color = COALESCE(primary_color, v_source_cat.primary_color),
        secondary_color = COALESCE(secondary_color, v_source_cat.secondary_color),
        breed = COALESCE(breed, v_source_cat.breed),
        notes = CASE
            WHEN notes IS NULL THEN v_source_cat.notes
            WHEN v_source_cat.notes IS NOT NULL THEN notes || E'\n[Merged] ' || v_source_cat.notes
            ELSE notes
        END,
        updated_at = NOW()
    WHERE cat_id = p_target_cat_id;

    -- Build result
    v_result := jsonb_build_object(
        'success', true,
        'source_cat_id', p_source_cat_id,
        'target_cat_id', p_target_cat_id,
        'source_atlas_id', v_source_cat.atlas_id,
        'target_atlas_id', v_target_cat.atlas_id,
        'source_name', v_source_cat.display_name,
        'target_name', v_target_cat.display_name,
        'reason', p_reason,
        'merged_by', p_merged_by,
        'merged_at', NOW(),
        'transferred', v_transferred
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.merge_cats IS
'Merges source cat into target cat, transferring all relationships and marking source as merged.
The target cat becomes the canonical record. Source cat is preserved but marked as merged.
Use undo_cat_merge() to reverse if needed.';

-- ============================================================
-- 4. UNDO CAT MERGE FUNCTION
-- ============================================================

\echo '4. Creating undo_cat_merge function...'

CREATE OR REPLACE FUNCTION trapper.undo_cat_merge(
    p_merged_cat_id UUID
) RETURNS jsonb AS $$
DECLARE
    v_merged_cat RECORD;
    v_target_cat_id UUID;
    v_result jsonb;
BEGIN
    -- Get merged cat
    SELECT * INTO v_merged_cat FROM trapper.sot_cats WHERE cat_id = p_merged_cat_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cat not found: %', p_merged_cat_id;
    END IF;

    IF v_merged_cat.merged_into_cat_id IS NULL THEN
        RAISE EXCEPTION 'Cat is not merged: %', p_merged_cat_id;
    END IF;

    v_target_cat_id := v_merged_cat.merged_into_cat_id;

    -- Clear merge status (relationships stay with target - manual cleanup if needed)
    UPDATE trapper.sot_cats
    SET merged_into_cat_id = NULL,
        merged_at = NULL,
        merge_reason = NULL,
        updated_at = NOW()
    WHERE cat_id = p_merged_cat_id;

    v_result := jsonb_build_object(
        'success', true,
        'unmerged_cat_id', p_merged_cat_id,
        'was_merged_into', v_target_cat_id,
        'note', 'Relationships remain with target cat. Manual cleanup may be needed.'
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.undo_cat_merge IS
'Removes the merged status from a cat. Note: Transferred relationships stay with the target cat.
For full reversal, relationships must be manually reassigned.';

-- ============================================================
-- 5. UNDO PLACE MERGE FUNCTION (if not exists)
-- ============================================================

\echo '5. Creating undo_place_merge function...'

CREATE OR REPLACE FUNCTION trapper.undo_place_merge(
    p_merged_place_id UUID
) RETURNS jsonb AS $$
DECLARE
    v_merged_place RECORD;
    v_target_place_id UUID;
    v_result jsonb;
BEGIN
    -- Get merged place
    SELECT * INTO v_merged_place FROM trapper.places WHERE place_id = p_merged_place_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Place not found: %', p_merged_place_id;
    END IF;

    IF v_merged_place.merged_into_place_id IS NULL THEN
        RAISE EXCEPTION 'Place is not merged: %', p_merged_place_id;
    END IF;

    v_target_place_id := v_merged_place.merged_into_place_id;

    -- Clear merge status
    UPDATE trapper.places
    SET merged_into_place_id = NULL,
        merged_at = NULL,
        merge_reason = NULL,
        updated_at = NOW()
    WHERE place_id = p_merged_place_id;

    v_result := jsonb_build_object(
        'success', true,
        'unmerged_place_id', p_merged_place_id,
        'was_merged_into', v_target_place_id,
        'note', 'Relationships remain with target place. Manual cleanup may be needed.'
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.undo_place_merge IS
'Removes the merged status from a place. Note: Transferred relationships stay with the target place.';

-- ============================================================
-- 6. CANONICAL ID RESOLUTION FUNCTIONS
-- ============================================================

\echo '6. Creating canonical ID resolution functions...'

-- Resolve cat to canonical (follows merge chain)
CREATE OR REPLACE FUNCTION trapper.get_canonical_cat_id(p_cat_id UUID)
RETURNS UUID AS $$
DECLARE
    v_current_id UUID := p_cat_id;
    v_next_id UUID;
    v_depth INT := 0;
BEGIN
    LOOP
        SELECT merged_into_cat_id INTO v_next_id
        FROM trapper.sot_cats
        WHERE cat_id = v_current_id;

        IF v_next_id IS NULL THEN
            RETURN v_current_id;
        END IF;

        v_current_id := v_next_id;
        v_depth := v_depth + 1;

        IF v_depth > 10 THEN
            RAISE EXCEPTION 'Merge chain too deep for cat %', p_cat_id;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;

-- Resolve person to canonical (follows merge chain)
CREATE OR REPLACE FUNCTION trapper.get_canonical_person_id(p_person_id UUID)
RETURNS UUID AS $$
DECLARE
    v_current_id UUID := p_person_id;
    v_next_id UUID;
    v_depth INT := 0;
BEGIN
    LOOP
        SELECT merged_into_person_id INTO v_next_id
        FROM trapper.sot_people
        WHERE person_id = v_current_id;

        IF v_next_id IS NULL THEN
            RETURN v_current_id;
        END IF;

        v_current_id := v_next_id;
        v_depth := v_depth + 1;

        IF v_depth > 10 THEN
            RAISE EXCEPTION 'Merge chain too deep for person %', p_person_id;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;

-- Resolve place to canonical (follows merge chain)
CREATE OR REPLACE FUNCTION trapper.get_canonical_place_id(p_place_id UUID)
RETURNS UUID AS $$
DECLARE
    v_current_id UUID := p_place_id;
    v_next_id UUID;
    v_depth INT := 0;
BEGIN
    LOOP
        SELECT merged_into_place_id INTO v_next_id
        FROM trapper.places
        WHERE place_id = v_current_id;

        IF v_next_id IS NULL THEN
            RETURN v_current_id;
        END IF;

        v_current_id := v_next_id;
        v_depth := v_depth + 1;

        IF v_depth > 10 THEN
            RAISE EXCEPTION 'Merge chain too deep for place %', p_place_id;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.get_canonical_cat_id IS 'Returns the canonical cat_id, following any merge chain';
COMMENT ON FUNCTION trapper.get_canonical_person_id IS 'Returns the canonical person_id, following any merge chain';
COMMENT ON FUNCTION trapper.get_canonical_place_id IS 'Returns the canonical place_id, following any merge chain';

-- ============================================================
-- 7. INGEST PROTECTION: Find canonical entity by identifier
-- ============================================================

\echo '7. Creating ingest protection functions...'

-- Find canonical cat by microchip (respects merges)
CREATE OR REPLACE FUNCTION trapper.find_canonical_cat_by_microchip(p_microchip TEXT)
RETURNS UUID AS $$
DECLARE
    v_cat_id UUID;
BEGIN
    -- Find cat with this microchip
    SELECT cat_id INTO v_cat_id
    FROM trapper.cat_identifiers
    WHERE id_type = 'microchip' AND id_value = p_microchip
    LIMIT 1;

    IF v_cat_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Return canonical (follows merge chain)
    RETURN trapper.get_canonical_cat_id(v_cat_id);
END;
$$ LANGUAGE plpgsql STABLE;

-- Find canonical person by email (respects merges)
CREATE OR REPLACE FUNCTION trapper.find_canonical_person_by_email(p_email TEXT)
RETURNS UUID AS $$
DECLARE
    v_person_id UUID;
BEGIN
    SELECT person_id INTO v_person_id
    FROM trapper.sot_people
    WHERE LOWER(TRIM(email)) = LOWER(TRIM(p_email))
    LIMIT 1;

    IF v_person_id IS NULL THEN
        -- Try person_identifiers
        SELECT person_id INTO v_person_id
        FROM trapper.person_identifiers
        WHERE id_type = 'email' AND LOWER(id_value_norm) = LOWER(TRIM(p_email))
        LIMIT 1;
    END IF;

    IF v_person_id IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN trapper.get_canonical_person_id(v_person_id);
END;
$$ LANGUAGE plpgsql STABLE;

-- Find canonical place by Google Place ID (respects merges)
CREATE OR REPLACE FUNCTION trapper.find_canonical_place_by_google_id(p_google_place_id TEXT)
RETURNS UUID AS $$
DECLARE
    v_place_id UUID;
BEGIN
    SELECT place_id INTO v_place_id
    FROM trapper.places
    WHERE google_place_id = p_google_place_id
    LIMIT 1;

    IF v_place_id IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN trapper.get_canonical_place_id(v_place_id);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.find_canonical_cat_by_microchip IS
'Finds canonical cat by microchip, following any merge chain. Use this during ingest to avoid creating duplicates.';
COMMENT ON FUNCTION trapper.find_canonical_person_by_email IS
'Finds canonical person by email, following any merge chain. Use this during ingest to avoid creating duplicates.';
COMMENT ON FUNCTION trapper.find_canonical_place_by_google_id IS
'Finds canonical place by Google Place ID, following any merge chain. Use this during ingest to avoid creating duplicates.';

-- ============================================================
-- 8. VIEWS: Exclude merged entities
-- ============================================================

\echo '8. Creating views that exclude merged entities...'

-- Canonical cats view (excludes merged)
CREATE OR REPLACE VIEW trapper.v_canonical_cats AS
SELECT c.*, ci.id_value as microchip
FROM trapper.sot_cats c
LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
WHERE c.merged_into_cat_id IS NULL;

COMMENT ON VIEW trapper.v_canonical_cats IS 'All cats that are not merged into another cat. Use this for UI and reports.';

-- Canonical people view (excludes merged)
CREATE OR REPLACE VIEW trapper.v_canonical_people AS
SELECT *
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL;

COMMENT ON VIEW trapper.v_canonical_people IS 'All people that are not merged into another person. Use this for UI and reports.';

-- Canonical places view (excludes merged)
CREATE OR REPLACE VIEW trapper.v_canonical_places AS
SELECT *
FROM trapper.places
WHERE merged_into_place_id IS NULL;

COMMENT ON VIEW trapper.v_canonical_places IS 'All places that are not merged into another place. Use this for UI and reports.';

-- ============================================================
-- 9. MERGE HISTORY TRACKING
-- ============================================================

\echo '9. Creating merge history table...'

CREATE TABLE IF NOT EXISTS trapper.entity_merge_history (
    merge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('cat', 'person', 'place')),
    source_entity_id UUID NOT NULL,
    target_entity_id UUID NOT NULL,
    source_atlas_id TEXT,
    target_atlas_id TEXT,
    merge_reason TEXT,
    merged_by TEXT,
    merged_at TIMESTAMPTZ DEFAULT NOW(),
    undone_at TIMESTAMPTZ,
    undone_by TEXT,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_merge_history_entity_type ON trapper.entity_merge_history(entity_type);
CREATE INDEX IF NOT EXISTS idx_merge_history_source ON trapper.entity_merge_history(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_merge_history_target ON trapper.entity_merge_history(target_entity_id);

COMMENT ON TABLE trapper.entity_merge_history IS 'Audit log of all entity merges for debugging and compliance';

-- Function to log merges
CREATE OR REPLACE FUNCTION trapper.log_entity_merge(
    p_entity_type TEXT,
    p_source_id UUID,
    p_target_id UUID,
    p_source_atlas_id TEXT,
    p_target_atlas_id TEXT,
    p_reason TEXT,
    p_merged_by TEXT,
    p_metadata JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_merge_id UUID;
BEGIN
    INSERT INTO trapper.entity_merge_history (
        entity_type, source_entity_id, target_entity_id,
        source_atlas_id, target_atlas_id, merge_reason, merged_by, metadata
    ) VALUES (
        p_entity_type, p_source_id, p_target_id,
        p_source_atlas_id, p_target_atlas_id, p_reason, p_merged_by, p_metadata
    )
    RETURNING merge_id INTO v_merge_id;

    RETURN v_merge_id;
END;
$$ LANGUAGE plpgsql;

-- Update merge_cats to log history
CREATE OR REPLACE FUNCTION trapper.merge_cats(
    p_source_cat_id UUID,
    p_target_cat_id UUID,
    p_reason TEXT DEFAULT 'manual_merge',
    p_merged_by TEXT DEFAULT 'system'
) RETURNS jsonb AS $$
DECLARE
    v_source_cat RECORD;
    v_target_cat RECORD;
    v_result jsonb;
    v_transferred jsonb := '{}'::jsonb;
    v_merge_id UUID;
BEGIN
    -- Validate inputs
    IF p_source_cat_id = p_target_cat_id THEN
        RAISE EXCEPTION 'Cannot merge cat into itself';
    END IF;

    -- Get source cat
    SELECT * INTO v_source_cat FROM trapper.sot_cats WHERE cat_id = p_source_cat_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Source cat not found: %', p_source_cat_id;
    END IF;

    IF v_source_cat.merged_into_cat_id IS NOT NULL THEN
        RAISE EXCEPTION 'Source cat is already merged into %', v_source_cat.merged_into_cat_id;
    END IF;

    -- Get target cat
    SELECT * INTO v_target_cat FROM trapper.sot_cats WHERE cat_id = p_target_cat_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target cat not found: %', p_target_cat_id;
    END IF;

    IF v_target_cat.merged_into_cat_id IS NOT NULL THEN
        RAISE EXCEPTION 'Target cat is already merged. Use canonical: %', v_target_cat.merged_into_cat_id;
    END IF;

    -- Transfer cat_identifiers
    WITH transferred AS (
        UPDATE trapper.cat_identifiers
        SET cat_id = p_target_cat_id
        WHERE cat_id = p_source_cat_id
        AND NOT EXISTS (
            SELECT 1 FROM trapper.cat_identifiers ci2
            WHERE ci2.cat_id = p_target_cat_id
            AND ci2.id_type = cat_identifiers.id_type
            AND ci2.id_value = cat_identifiers.id_value
        )
        RETURNING identifier_id
    )
    SELECT jsonb_set(v_transferred, '{identifiers}', to_jsonb(COUNT(*))) INTO v_transferred FROM transferred;

    -- Transfer cat_procedures
    WITH transferred AS (
        UPDATE trapper.cat_procedures
        SET cat_id = p_target_cat_id
        WHERE cat_id = p_source_cat_id
        RETURNING procedure_id
    )
    SELECT jsonb_set(v_transferred, '{procedures}', to_jsonb(COUNT(*))) INTO v_transferred FROM transferred;

    -- Transfer cat_place_relationships
    WITH transferred AS (
        UPDATE trapper.cat_place_relationships
        SET cat_id = p_target_cat_id
        WHERE cat_id = p_source_cat_id
        AND NOT EXISTS (
            SELECT 1 FROM trapper.cat_place_relationships cpr2
            WHERE cpr2.cat_id = p_target_cat_id
            AND cpr2.place_id = cat_place_relationships.place_id
        )
        RETURNING relationship_id
    )
    SELECT jsonb_set(v_transferred, '{place_relationships}', to_jsonb(COUNT(*))) INTO v_transferred FROM transferred;

    -- Transfer person_cat_relationships
    WITH transferred AS (
        UPDATE trapper.person_cat_relationships
        SET cat_id = p_target_cat_id
        WHERE cat_id = p_source_cat_id
        AND NOT EXISTS (
            SELECT 1 FROM trapper.person_cat_relationships pcr2
            WHERE pcr2.cat_id = p_target_cat_id
            AND pcr2.person_id = person_cat_relationships.person_id
        )
        RETURNING relationship_id
    )
    SELECT jsonb_set(v_transferred, '{person_relationships}', to_jsonb(COUNT(*))) INTO v_transferred FROM transferred;

    -- Transfer sot_appointments
    WITH transferred AS (
        UPDATE trapper.sot_appointments
        SET cat_id = p_target_cat_id
        WHERE cat_id = p_source_cat_id
        RETURNING appointment_id
    )
    SELECT jsonb_set(v_transferred, '{appointments}', to_jsonb(COUNT(*))) INTO v_transferred FROM transferred;

    -- Transfer request_cat_links
    WITH transferred AS (
        UPDATE trapper.request_cat_links
        SET cat_id = p_target_cat_id
        WHERE cat_id = p_source_cat_id
        AND NOT EXISTS (
            SELECT 1 FROM trapper.request_cat_links rcl2
            WHERE rcl2.cat_id = p_target_cat_id
            AND rcl2.request_id = request_cat_links.request_id
        )
        RETURNING link_id
    )
    SELECT jsonb_set(v_transferred, '{request_links}', to_jsonb(COUNT(*))) INTO v_transferred FROM transferred;

    -- Mark source as merged
    UPDATE trapper.sot_cats
    SET merged_into_cat_id = p_target_cat_id,
        merged_at = NOW(),
        merge_reason = p_reason,
        updated_at = NOW()
    WHERE cat_id = p_source_cat_id;

    -- Enrich target cat with any missing data from source
    UPDATE trapper.sot_cats
    SET
        sex = COALESCE(sex, v_source_cat.sex),
        birth_year = COALESCE(birth_year, v_source_cat.birth_year),
        primary_color = COALESCE(primary_color, v_source_cat.primary_color),
        secondary_color = COALESCE(secondary_color, v_source_cat.secondary_color),
        breed = COALESCE(breed, v_source_cat.breed),
        notes = CASE
            WHEN notes IS NULL THEN v_source_cat.notes
            WHEN v_source_cat.notes IS NOT NULL THEN notes || E'\n[Merged from ' || v_source_cat.atlas_id || '] ' || v_source_cat.notes
            ELSE notes
        END,
        updated_at = NOW()
    WHERE cat_id = p_target_cat_id;

    -- Log to history
    v_merge_id := trapper.log_entity_merge(
        'cat', p_source_cat_id, p_target_cat_id,
        v_source_cat.atlas_id, v_target_cat.atlas_id,
        p_reason, p_merged_by, v_transferred
    );

    -- Build result
    v_result := jsonb_build_object(
        'success', true,
        'merge_id', v_merge_id,
        'source_cat_id', p_source_cat_id,
        'target_cat_id', p_target_cat_id,
        'source_atlas_id', v_source_cat.atlas_id,
        'target_atlas_id', v_target_cat.atlas_id,
        'source_name', v_source_cat.display_name,
        'target_name', v_target_cat.display_name,
        'reason', p_reason,
        'merged_by', p_merged_by,
        'merged_at', NOW(),
        'transferred', v_transferred
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 10. VERIFICATION
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'
\echo ''

\echo 'Cat merge columns:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'sot_cats'
AND column_name LIKE '%merge%';

\echo ''
\echo 'Place merge columns:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'places'
AND column_name LIKE '%merge%';

\echo ''
\echo 'Merge functions created:'
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'trapper'
AND (routine_name LIKE '%merge%' OR routine_name LIKE 'get_canonical%' OR routine_name LIKE 'find_canonical%')
ORDER BY routine_name;

\echo ''
\echo 'Canonical views created:'
SELECT table_name
FROM information_schema.views
WHERE table_schema = 'trapper'
AND table_name LIKE 'v_canonical%';

\echo ''
\echo '=============================================='
\echo 'MIG_225 Complete!'
\echo '=============================================='
\echo ''
\echo 'New capabilities:'
\echo '  - merge_cats(source, target, reason, by) - Merge two cats'
\echo '  - undo_cat_merge(cat_id) - Undo a cat merge'
\echo '  - undo_place_merge(place_id) - Undo a place merge'
\echo '  - get_canonical_cat_id(cat_id) - Follow merge chain'
\echo '  - get_canonical_person_id(person_id) - Follow merge chain'
\echo '  - get_canonical_place_id(place_id) - Follow merge chain'
\echo '  - find_canonical_cat_by_microchip(chip) - Find cat for ingest'
\echo '  - find_canonical_person_by_email(email) - Find person for ingest'
\echo '  - find_canonical_place_by_google_id(id) - Find place for ingest'
\echo ''
\echo 'Views for UI (exclude merged entities):'
\echo '  - v_canonical_cats'
\echo '  - v_canonical_people'
\echo '  - v_canonical_places'
\echo ''
\echo 'Audit table: entity_merge_history'
\echo ''
