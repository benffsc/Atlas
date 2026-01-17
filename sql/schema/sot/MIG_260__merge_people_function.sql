-- MIG_260: Add merge_people function
--
-- Problem:
--   MIG_225 added merge infrastructure for cats and places, but merge_people()
--   was referenced but never implemented. This causes duplicate resolution to fail.
--
-- Solution:
--   Create merge_people() function similar to merge_cats() that:
--   - Transfers person_identifiers (emails, phones)
--   - Transfers person_place_relationships
--   - Transfers person_cat_relationships
--   - Transfers person_roles
--   - Updates sot_requests.requester_person_id references
--   - Updates sot_appointments links
--   - Enriches target with missing data from source
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_260__merge_people_function.sql

\echo ''
\echo '=============================================='
\echo 'MIG_260: Merge People Function'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Ensure merge columns exist on sot_people
-- ============================================================

\echo '1. Ensuring merge columns exist...'

ALTER TABLE trapper.sot_people
ADD COLUMN IF NOT EXISTS merged_into_person_id UUID REFERENCES trapper.sot_people(person_id),
ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS merge_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_sot_people_merged_into
    ON trapper.sot_people(merged_into_person_id)
    WHERE merged_into_person_id IS NOT NULL;

-- ============================================================
-- 2. Create merge_people function
-- ============================================================

\echo '2. Creating merge_people function...'

CREATE OR REPLACE FUNCTION trapper.merge_people(
    p_source_person_id UUID,
    p_target_person_id UUID,
    p_reason TEXT DEFAULT 'manual_merge',
    p_merged_by TEXT DEFAULT 'system'
) RETURNS jsonb AS $$
DECLARE
    v_source_person RECORD;
    v_target_person RECORD;
    v_result jsonb;
    v_transferred jsonb := '{}'::jsonb;
    v_count INT;
BEGIN
    -- Validate inputs
    IF p_source_person_id = p_target_person_id THEN
        RAISE EXCEPTION 'Cannot merge person into themselves';
    END IF;

    -- Get source person
    SELECT * INTO v_source_person FROM trapper.sot_people WHERE person_id = p_source_person_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Source person not found: %', p_source_person_id;
    END IF;

    IF v_source_person.merged_into_person_id IS NOT NULL THEN
        RAISE EXCEPTION 'Source person is already merged into %', v_source_person.merged_into_person_id;
    END IF;

    -- Get target person
    SELECT * INTO v_target_person FROM trapper.sot_people WHERE person_id = p_target_person_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target person not found: %', p_target_person_id;
    END IF;

    IF v_target_person.merged_into_person_id IS NOT NULL THEN
        RAISE EXCEPTION 'Target person is already merged. Merge into the canonical person instead: %', v_target_person.merged_into_person_id;
    END IF;

    -- Transfer person_identifiers (emails, phones, addresses)
    WITH transferred AS (
        UPDATE trapper.person_identifiers
        SET person_id = p_target_person_id
        WHERE person_id = p_source_person_id
        AND NOT EXISTS (
            SELECT 1 FROM trapper.person_identifiers pi2
            WHERE pi2.person_id = p_target_person_id
            AND pi2.id_type = person_identifiers.id_type
            AND pi2.id_value_norm = person_identifiers.id_value_norm
        )
        RETURNING identifier_id
    )
    SELECT COUNT(*) INTO v_count FROM transferred;
    v_transferred := jsonb_set(v_transferred, '{identifiers}', to_jsonb(v_count));

    -- Transfer person_place_relationships
    WITH transferred AS (
        UPDATE trapper.person_place_relationships
        SET person_id = p_target_person_id
        WHERE person_id = p_source_person_id
        AND NOT EXISTS (
            SELECT 1 FROM trapper.person_place_relationships ppr2
            WHERE ppr2.person_id = p_target_person_id
            AND ppr2.place_id = person_place_relationships.place_id
        )
        RETURNING relationship_id
    )
    SELECT COUNT(*) INTO v_count FROM transferred;
    v_transferred := jsonb_set(v_transferred, '{place_relationships}', to_jsonb(v_count));

    -- Transfer person_cat_relationships
    WITH transferred AS (
        UPDATE trapper.person_cat_relationships
        SET person_id = p_target_person_id
        WHERE person_id = p_source_person_id
        AND NOT EXISTS (
            SELECT 1 FROM trapper.person_cat_relationships pcr2
            WHERE pcr2.person_id = p_target_person_id
            AND pcr2.cat_id = person_cat_relationships.cat_id
        )
        RETURNING relationship_id
    )
    SELECT COUNT(*) INTO v_count FROM transferred;
    v_transferred := jsonb_set(v_transferred, '{cat_relationships}', to_jsonb(v_count));

    -- Transfer person_roles (trapper roles, etc)
    WITH transferred AS (
        UPDATE trapper.person_roles
        SET person_id = p_target_person_id
        WHERE person_id = p_source_person_id
        AND NOT EXISTS (
            SELECT 1 FROM trapper.person_roles pr2
            WHERE pr2.person_id = p_target_person_id
            AND pr2.role = person_roles.role
        )
        RETURNING role_id
    )
    SELECT COUNT(*) INTO v_count FROM transferred;
    v_transferred := jsonb_set(v_transferred, '{roles}', to_jsonb(v_count));

    -- Update sot_requests.requester_person_id
    WITH transferred AS (
        UPDATE trapper.sot_requests
        SET requester_person_id = p_target_person_id
        WHERE requester_person_id = p_source_person_id
        RETURNING request_id
    )
    SELECT COUNT(*) INTO v_count FROM transferred;
    v_transferred := jsonb_set(v_transferred, '{requests_as_requester}', to_jsonb(v_count));

    -- Update request_trapper_assignments
    WITH transferred AS (
        UPDATE trapper.request_trapper_assignments
        SET trapper_person_id = p_target_person_id
        WHERE trapper_person_id = p_source_person_id
        AND NOT EXISTS (
            SELECT 1 FROM trapper.request_trapper_assignments rta2
            WHERE rta2.request_id = request_trapper_assignments.request_id
            AND rta2.trapper_person_id = p_target_person_id
        )
        RETURNING assignment_id
    )
    SELECT COUNT(*) INTO v_count FROM transferred;
    v_transferred := jsonb_set(v_transferred, '{trapper_assignments}', to_jsonb(v_count));

    -- Update sot_appointments (trapper_person_id)
    WITH transferred AS (
        UPDATE trapper.sot_appointments
        SET trapper_person_id = p_target_person_id
        WHERE trapper_person_id = p_source_person_id
        RETURNING appointment_id
    )
    SELECT COUNT(*) INTO v_count FROM transferred;
    v_transferred := jsonb_set(v_transferred, '{appointments_as_trapper}', to_jsonb(v_count));

    -- Update journal_entries.created_by_staff_id (if using person_id)
    -- Note: Some systems use staff_id separately, check schema
    BEGIN
        WITH transferred AS (
            UPDATE trapper.journal_entries
            SET created_by_staff_id = p_target_person_id
            WHERE created_by_staff_id = p_source_person_id
            RETURNING entry_id
        )
        SELECT COUNT(*) INTO v_count FROM transferred;
        v_transferred := jsonb_set(v_transferred, '{journal_entries}', to_jsonb(v_count));
    EXCEPTION WHEN undefined_column THEN
        -- Column doesn't exist, skip
        NULL;
    END;

    -- Mark source as merged
    UPDATE trapper.sot_people
    SET merged_into_person_id = p_target_person_id,
        merged_at = NOW(),
        merge_reason = p_reason,
        updated_at = NOW()
    WHERE person_id = p_source_person_id;

    -- Enrich target person with any missing data from source
    UPDATE trapper.sot_people
    SET
        first_name = COALESCE(first_name, v_source_person.first_name),
        last_name = COALESCE(last_name, v_source_person.last_name),
        display_name = COALESCE(
            NULLIF(display_name, ''),
            NULLIF(v_source_person.display_name, '')
        ),
        email = COALESCE(email, v_source_person.email),
        phone = COALESCE(phone, v_source_person.phone),
        address = COALESCE(address, v_source_person.address),
        notes = CASE
            WHEN notes IS NULL THEN v_source_person.notes
            WHEN v_source_person.notes IS NOT NULL AND notes NOT LIKE '%' || v_source_person.notes || '%'
                THEN notes || E'\n[Merged from ' || p_source_person_id::TEXT || '] ' || v_source_person.notes
            ELSE notes
        END,
        updated_at = NOW()
    WHERE person_id = p_target_person_id;

    -- Build result
    v_result := jsonb_build_object(
        'success', true,
        'source_person_id', p_source_person_id,
        'target_person_id', p_target_person_id,
        'source_name', v_source_person.display_name,
        'target_name', v_target_person.display_name,
        'reason', p_reason,
        'merged_by', p_merged_by,
        'merged_at', NOW(),
        'transferred', v_transferred
    );

    -- Log the merge to data_changes
    INSERT INTO trapper.data_changes (
        entity_type, entity_id, change_type, old_value, new_value, changed_by
    ) VALUES (
        'person',
        p_source_person_id,
        'merge',
        jsonb_build_object('merged_into', NULL),
        jsonb_build_object('merged_into', p_target_person_id, 'reason', p_reason),
        p_merged_by
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.merge_people IS
'Merges source person into target person, transferring all relationships and marking source as merged.
The target person becomes the canonical record. Source person is preserved but marked as merged.
Use undo_person_merge() to reverse if needed.

Transfers:
- person_identifiers (emails, phones)
- person_place_relationships
- person_cat_relationships
- person_roles (trapper status, etc)
- sot_requests.requester_person_id
- request_trapper_assignments
- sot_appointments.trapper_person_id
- journal_entries (if applicable)';

-- ============================================================
-- 3. Create undo_person_merge function
-- ============================================================

\echo '3. Creating undo_person_merge function...'

CREATE OR REPLACE FUNCTION trapper.undo_person_merge(
    p_merged_person_id UUID
) RETURNS jsonb AS $$
DECLARE
    v_merged_person RECORD;
    v_target_person_id UUID;
    v_result jsonb;
BEGIN
    -- Get merged person
    SELECT * INTO v_merged_person FROM trapper.sot_people WHERE person_id = p_merged_person_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Person not found: %', p_merged_person_id;
    END IF;

    IF v_merged_person.merged_into_person_id IS NULL THEN
        RAISE EXCEPTION 'Person is not merged: %', p_merged_person_id;
    END IF;

    v_target_person_id := v_merged_person.merged_into_person_id;

    -- Clear merge status (relationships stay with target - manual cleanup if needed)
    UPDATE trapper.sot_people
    SET merged_into_person_id = NULL,
        merged_at = NULL,
        merge_reason = NULL,
        updated_at = NOW()
    WHERE person_id = p_merged_person_id;

    -- Log the undo
    INSERT INTO trapper.data_changes (
        entity_type, entity_id, change_type, old_value, new_value, changed_by
    ) VALUES (
        'person',
        p_merged_person_id,
        'undo_merge',
        jsonb_build_object('merged_into', v_target_person_id),
        jsonb_build_object('merged_into', NULL),
        'system'
    );

    v_result := jsonb_build_object(
        'success', true,
        'unmerged_person_id', p_merged_person_id,
        'was_merged_into', v_target_person_id,
        'note', 'Relationships remain with target person. Manual cleanup may be needed.'
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.undo_person_merge IS
'Removes the merged status from a person. Note: Transferred relationships stay with the target person.
For full reversal, relationships must be manually reassigned.';

-- ============================================================
-- 4. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Functions created:'
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name IN ('merge_people', 'undo_person_merge')
ORDER BY routine_name;

\echo ''
SELECT 'MIG_260 Complete' AS status;
