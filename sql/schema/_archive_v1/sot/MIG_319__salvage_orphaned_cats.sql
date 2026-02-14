\echo '=== MIG_319: Salvage Orphaned Cats ==='
\echo 'Ensures cats with real clinic data are NEVER deleted, even when linked to garbage data'
\echo ''

-- ============================================================================
-- PRINCIPLE: SALVAGE ALL GOOD DATA
-- ============================================================================
-- Cats with real microchips, clinic appointments, or medical data must be
-- preserved in SoT tables even if:
-- - Linked to placeholder/garbage person names
-- - Linked to FFSC locations masquerading as people
-- - Linked to test/internal accounts
--
-- The correct action is to UNLINK the cat from the invalid person, NOT to
-- delete the cat record. Clinic history is ground truth.
-- ============================================================================

-- ============================================================================
-- VIEW: Cats Linked to Invalid People
-- These cats have real clinic data but are linked to garbage/placeholder people
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_cats_with_invalid_owners AS
SELECT
    c.cat_id,
    c.display_name as cat_name,
    c.sex,
    c.is_altered,
    c.source_system,

    -- Owner info (invalid)
    p.person_id as invalid_person_id,
    p.display_name as invalid_owner_name,

    -- Why invalid
    CASE
        WHEN trapper.is_organization_name(p.display_name) THEN 'organization_as_person'
        WHEN trapper.is_garbage_name(p.display_name) THEN 'garbage_name'
        WHEN p.display_name ILIKE '%test%' THEN 'test_data'
        WHEN p.display_name ILIKE '%ffsc%' OR p.display_name ILIKE '%forgotten felines%' THEN 'ffsc_internal'
        WHEN p.display_name = 'Unknown Unknown' THEN 'placeholder'
        ELSE 'other_invalid'
    END as invalid_reason,

    -- Clinic data (ground truth - should NEVER be deleted)
    (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.cat_id = c.cat_id) as appointment_count,
    (SELECT COUNT(*) FROM trapper.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip') as microchip_count,

    -- Place links (can help re-attribute)
    (SELECT pl.place_id FROM trapper.cat_place_relationships cpr
     JOIN trapper.places pl ON pl.place_id = cpr.place_id
     WHERE cpr.cat_id = c.cat_id
     LIMIT 1) as linked_place_id,

    c.created_at

FROM trapper.sot_cats c
JOIN trapper.sot_people p ON p.person_id = c.owner_person_id
WHERE p.merged_into_person_id IS NULL
  AND NOT trapper.is_valid_person_name(p.display_name);

COMMENT ON VIEW trapper.v_cats_with_invalid_owners IS
'Cats with real clinic data linked to garbage/placeholder/organization owners.
These cats should be PRESERVED (not deleted) - only the link to invalid person should be cleared.';

-- ============================================================================
-- VIEW: Clinic Appointments with Invalid Owners
-- Appointments that have cat data but invalid owner info
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_appointments_with_invalid_owners AS
SELECT
    a.appointment_id,
    a.appointment_date,
    a.cat_id,
    c.display_name as cat_name,

    -- Invalid owner info from appointment
    a.owner_name,
    a.owner_email,
    a.owner_phone,

    -- Why invalid
    CASE
        WHEN a.owner_email IN ('none', 'no') THEN 'placeholder_email'
        WHEN a.owner_email ILIKE '%@noemail.com' THEN 'clinichq_placeholder'
        WHEN a.owner_email ILIKE '%@petestablish%' THEN 'petestablish_test'
        WHEN trapper.is_organization_name(a.owner_name) THEN 'organization_as_person'
        WHEN a.owner_name ILIKE '%test%' THEN 'test_data'
        WHEN a.owner_name ILIKE '%ffsc%' THEN 'ffsc_internal'
        ELSE 'other_invalid'
    END as invalid_reason,

    -- Cat has real data
    c.is_altered,
    (SELECT COUNT(*) FROM trapper.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip') as has_microchip,

    -- Place link (can help re-attribute)
    a.location_name,
    a.trapper_person_id

FROM trapper.sot_appointments a
JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
WHERE (
    -- Invalid email patterns
    a.owner_email IN ('none', 'no')
    OR a.owner_email ILIKE '%@noemail.com'
    OR a.owner_email ILIKE '%@petestablish%'
    -- Invalid name patterns
    OR trapper.is_organization_name(a.owner_name)
    OR a.owner_name ILIKE '%test%'
    OR a.owner_name ILIKE '%ffsc%'
);

COMMENT ON VIEW trapper.v_appointments_with_invalid_owners IS
'Clinic appointments where owner info is invalid/placeholder but cat data is real.
The cat and appointment records should be preserved.';

-- ============================================================================
-- FUNCTION: Safely Orphan Cat from Invalid Person
-- Removes the link but NEVER deletes the cat
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.safely_orphan_cat(
    p_cat_id UUID,
    p_reason TEXT DEFAULT 'invalid_owner'
)
RETURNS JSONB AS $$
DECLARE
    v_cat RECORD;
    v_old_owner_id UUID;
    v_old_owner_name TEXT;
    v_place_count INT;
BEGIN
    -- Get cat and current owner
    SELECT c.*, p.display_name as owner_name
    INTO v_cat
    FROM trapper.sot_cats c
    LEFT JOIN trapper.sot_people p ON p.person_id = c.owner_person_id
    WHERE c.cat_id = p_cat_id;

    -- Count place links (these are PRESERVED - never deleted)
    SELECT COUNT(*) INTO v_place_count
    FROM trapper.cat_place_relationships
    WHERE cat_id = p_cat_id;

    IF v_cat IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cat not found');
    END IF;

    v_old_owner_id := v_cat.owner_person_id;
    v_old_owner_name := v_cat.owner_name;

    -- Clear owner link but NEVER delete the cat
    UPDATE trapper.sot_cats
    SET owner_person_id = NULL,
        updated_at = NOW()
    WHERE cat_id = p_cat_id;

    -- Log the change
    INSERT INTO trapper.entity_edits (
        entity_type, entity_id, field_name, old_value, new_value,
        edited_by, edit_reason, source_system
    ) VALUES (
        'cat', p_cat_id, 'owner_person_id',
        v_old_owner_id::TEXT, NULL,
        'data_engine', p_reason || ': ' || COALESCE(v_old_owner_name, 'unknown'),
        'data_fixing'
    );

    RETURN jsonb_build_object(
        'success', true,
        'cat_id', p_cat_id,
        'cat_name', v_cat.display_name,
        'old_owner_id', v_old_owner_id,
        'old_owner_name', v_old_owner_name,
        'action', 'orphaned',
        'reason', p_reason,
        'place_links_preserved', v_place_count,
        'note', 'Cat-place relationships preserved for Beacon analytics'
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.safely_orphan_cat IS
'Removes owner link from a cat without deleting the cat record.
Use this when the owner is garbage/placeholder data but the cat has real clinic history.

CRITICAL: This function NEVER deletes:
- The cat record itself
- The cat_place_relationships (preserved for Beacon analytics)
- The cat_identifiers (microchips)
- The sot_appointments (clinic history)

Only the owner_person_id link is cleared.';

-- ============================================================================
-- FUNCTION: Bulk Orphan Cats from Invalid People
-- Processes all cats linked to invalid people
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.bulk_orphan_cats_from_invalid_people(
    p_dry_run BOOLEAN DEFAULT TRUE,
    p_limit INT DEFAULT 100
)
RETURNS TABLE (
    cat_id UUID,
    cat_name TEXT,
    old_owner_name TEXT,
    invalid_reason TEXT,
    action_taken TEXT
) AS $$
DECLARE
    v_cat RECORD;
    v_result JSONB;
BEGIN
    FOR v_cat IN
        SELECT
            c.cat_id,
            c.display_name as cat_name,
            p.display_name as owner_name,
            CASE
                WHEN trapper.is_organization_name(p.display_name) THEN 'organization_as_person'
                WHEN trapper.is_garbage_name(p.display_name) THEN 'garbage_name'
                WHEN p.display_name ILIKE '%test%' THEN 'test_data'
                WHEN p.display_name ILIKE '%ffsc%' THEN 'ffsc_internal'
                WHEN p.display_name = 'Unknown Unknown' THEN 'placeholder'
                ELSE 'other_invalid'
            END as reason
        FROM trapper.sot_cats c
        JOIN trapper.sot_people p ON p.person_id = c.owner_person_id
        WHERE p.merged_into_person_id IS NULL
          AND NOT trapper.is_valid_person_name(p.display_name)
        LIMIT p_limit
    LOOP
        IF p_dry_run THEN
            cat_id := v_cat.cat_id;
            cat_name := v_cat.cat_name;
            old_owner_name := v_cat.owner_name;
            invalid_reason := v_cat.reason;
            action_taken := 'would_orphan';
            RETURN NEXT;
        ELSE
            v_result := trapper.safely_orphan_cat(v_cat.cat_id, v_cat.reason);
            cat_id := v_cat.cat_id;
            cat_name := v_cat.cat_name;
            old_owner_name := v_cat.owner_name;
            invalid_reason := v_cat.reason;
            action_taken := 'orphaned';
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.bulk_orphan_cats_from_invalid_people IS
'Safely orphan cats that are linked to invalid/garbage people.
Use p_dry_run=TRUE (default) to preview changes before applying.
NEVER deletes cat records - only clears the owner_person_id link.';

-- ============================================================================
-- VIEW: Summary of Salvageable Data
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_salvageable_data_summary AS
SELECT
    -- Cats with invalid owners (need orphaning)
    (SELECT COUNT(*) FROM trapper.v_cats_with_invalid_owners) as cats_with_invalid_owners,

    -- Of those, how many have clinic history
    (SELECT COUNT(*) FROM trapper.v_cats_with_invalid_owners WHERE appointment_count > 0) as cats_with_clinic_history,

    -- How many have microchips
    (SELECT COUNT(*) FROM trapper.v_cats_with_invalid_owners WHERE microchip_count > 0) as cats_with_microchips,

    -- Appointments with invalid owners
    (SELECT COUNT(*) FROM trapper.v_appointments_with_invalid_owners) as appointments_with_invalid_owners,

    -- Breakdown by reason
    (SELECT COUNT(*) FROM trapper.v_cats_with_invalid_owners WHERE invalid_reason = 'organization_as_person') as org_as_person,
    (SELECT COUNT(*) FROM trapper.v_cats_with_invalid_owners WHERE invalid_reason = 'garbage_name') as garbage_name,
    (SELECT COUNT(*) FROM trapper.v_cats_with_invalid_owners WHERE invalid_reason = 'ffsc_internal') as ffsc_internal,
    (SELECT COUNT(*) FROM trapper.v_cats_with_invalid_owners WHERE invalid_reason = 'placeholder') as placeholder,
    (SELECT COUNT(*) FROM trapper.v_cats_with_invalid_owners WHERE invalid_reason = 'test_data') as test_data;

COMMENT ON VIEW trapper.v_salvageable_data_summary IS
'Summary of cats that need to be salvaged (orphaned from invalid owners).
All these cats will be preserved - only the owner link will be cleared.';

-- ============================================================================
-- SHOW SUMMARY
-- ============================================================================

\echo ''
\echo '=== Salvageable Data Summary ==='
SELECT * FROM trapper.v_salvageable_data_summary;

\echo ''
\echo '=== Preview: Cats to Orphan (first 20) ==='
SELECT * FROM trapper.bulk_orphan_cats_from_invalid_people(TRUE, 20);

\echo ''
\echo '=== MIG_319 Complete ==='
\echo 'Created:'
\echo '  - v_cats_with_invalid_owners view'
\echo '  - v_appointments_with_invalid_owners view'
\echo '  - safely_orphan_cat() function'
\echo '  - bulk_orphan_cats_from_invalid_people() function'
\echo '  - v_salvageable_data_summary view'
\echo ''
\echo 'PRINCIPLE: Cats with clinic data are NEVER deleted.'
\echo 'Run: SELECT * FROM trapper.bulk_orphan_cats_from_invalid_people(FALSE, 100);'
\echo 'to actually orphan cats from invalid owners.'
\echo ''
