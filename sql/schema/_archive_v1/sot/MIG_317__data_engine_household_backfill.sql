\echo '=== MIG_317: Data Engine Household Backfill ==='
\echo 'Creating households from existing data patterns'
\echo ''

-- ============================================================================
-- HOUSEHOLD DETECTION AND CREATION
-- Build households from existing person-place relationships
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.data_engine_build_households()
RETURNS TABLE (
    households_created INT,
    members_added INT,
    shared_identifiers_detected INT
) AS $$
DECLARE
    v_households_created INT := 0;
    v_members_added INT := 0;
    v_shared_detected INT := 0;
    v_rec RECORD;
    v_household_id UUID;
BEGIN
    -- Step 1: Find places with multiple people (potential households)
    FOR v_rec IN
        WITH place_people AS (
            SELECT
                ppr.place_id,
                pl.formatted_address,
                ARRAY_AGG(DISTINCT ppr.person_id) as person_ids,
                COUNT(DISTINCT ppr.person_id) as person_count
            FROM trapper.person_place_relationships ppr
            JOIN trapper.places pl ON pl.place_id = ppr.place_id AND pl.merged_into_place_id IS NULL
            JOIN trapper.sot_people p ON p.person_id = ppr.person_id AND p.merged_into_person_id IS NULL
            GROUP BY ppr.place_id, pl.formatted_address
            HAVING COUNT(DISTINCT ppr.person_id) >= 2
        )
        SELECT * FROM place_people
        WHERE NOT EXISTS (
            SELECT 1 FROM trapper.households h
            WHERE h.primary_place_id = place_people.place_id
        )
    LOOP
        -- Create household
        INSERT INTO trapper.households (
            primary_place_id, member_count, source_system, household_name
        ) VALUES (
            v_rec.place_id,
            v_rec.person_count,
            'backfill_mig317',
            CONCAT('Household at ', LEFT(v_rec.formatted_address, 50))
        )
        RETURNING household_id INTO v_household_id;

        v_households_created := v_households_created + 1;

        -- Add members
        INSERT INTO trapper.household_members (household_id, person_id, inferred_from, source_system)
        SELECT v_household_id, unnest(v_rec.person_ids), 'same_address', 'backfill_mig317'
        ON CONFLICT DO NOTHING;

        v_members_added := v_members_added + v_rec.person_count;
    END LOOP;

    -- Step 2: Detect and record shared identifiers
    INSERT INTO trapper.household_shared_identifiers (
        household_id,
        identifier_type,
        identifier_value_norm,
        member_person_ids
    )
    SELECT
        hm.household_id,
        si.identifier_type,
        si.identifier_value,
        si.person_ids
    FROM trapper.data_engine_detect_shared_identifiers() si
    JOIN trapper.household_members hm ON hm.person_id = ANY(si.person_ids) AND hm.valid_to IS NULL
    WHERE si.person_count >= 2
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_shared_detected = ROW_COUNT;

    RETURN QUERY SELECT v_households_created, v_members_added, v_shared_detected;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_build_households IS
'Builds household records from existing person-place relationships. Run as one-time backfill.';

\echo 'Created data_engine_build_households function'

-- ============================================================================
-- POPULATE SOFT BLACKLIST
-- Identifiers shared by >2 distinct names should be soft-blacklisted
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.data_engine_populate_soft_blacklist()
RETURNS TABLE (
    phones_added INT,
    emails_added INT
) AS $$
DECLARE
    v_phones_added INT := 0;
    v_emails_added INT := 0;
BEGIN
    -- Find phones shared by 3+ distinct names (not blacklisted)
    INSERT INTO trapper.data_engine_soft_blacklist (
        identifier_norm,
        identifier_type,
        reason,
        distinct_name_count,
        sample_names,
        require_name_similarity,
        require_address_match
    )
    SELECT
        pi.id_value_norm,
        'phone',
        'Shared by multiple distinct names',
        COUNT(DISTINCT p.display_name),
        ARRAY_AGG(DISTINCT p.display_name ORDER BY p.display_name) FILTER (WHERE p.display_name IS NOT NULL)[1:5],
        0.7,  -- Require 70% name similarity
        TRUE  -- Also require address match
    FROM trapper.person_identifiers pi
    JOIN trapper.sot_people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
    WHERE pi.id_type = 'phone'
      AND pi.id_value_norm IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM trapper.identity_phone_blacklist bl
          WHERE bl.phone_norm = pi.id_value_norm
      )
    GROUP BY pi.id_value_norm
    HAVING COUNT(DISTINCT p.display_name) >= 3
    ON CONFLICT (identifier_norm) DO UPDATE
    SET distinct_name_count = EXCLUDED.distinct_name_count,
        sample_names = EXCLUDED.sample_names;

    GET DIAGNOSTICS v_phones_added = ROW_COUNT;

    -- Find emails shared by 2+ distinct names
    INSERT INTO trapper.data_engine_soft_blacklist (
        identifier_norm,
        identifier_type,
        reason,
        distinct_name_count,
        sample_names,
        require_name_similarity,
        require_address_match
    )
    SELECT
        pi.id_value_norm,
        'email',
        'Shared by multiple distinct names',
        COUNT(DISTINCT p.display_name),
        ARRAY_AGG(DISTINCT p.display_name ORDER BY p.display_name) FILTER (WHERE p.display_name IS NOT NULL)[1:5],
        0.7,
        FALSE  -- Email sharing is more suspicious, don't require address
    FROM trapper.person_identifiers pi
    JOIN trapper.sot_people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
    WHERE pi.id_type = 'email'
      AND pi.id_value_norm IS NOT NULL
    GROUP BY pi.id_value_norm
    HAVING COUNT(DISTINCT p.display_name) >= 2
    ON CONFLICT (identifier_norm) DO UPDATE
    SET distinct_name_count = EXCLUDED.distinct_name_count,
        sample_names = EXCLUDED.sample_names;

    GET DIAGNOSTICS v_emails_added = ROW_COUNT;

    RETURN QUERY SELECT v_phones_added, v_emails_added;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_populate_soft_blacklist IS
'Populates the soft blacklist with identifiers shared by multiple distinct names.';

\echo 'Created data_engine_populate_soft_blacklist function'

-- ============================================================================
-- RUN BACKFILL
-- ============================================================================

\echo ''
\echo 'Running household backfill...'

SELECT * FROM trapper.data_engine_build_households();

\echo ''
\echo 'Populating soft blacklist...'

SELECT * FROM trapper.data_engine_populate_soft_blacklist();

\echo ''
\echo 'Verifying results...'

-- Show summary
SELECT
    (SELECT COUNT(*) FROM trapper.households) as total_households,
    (SELECT COUNT(*) FROM trapper.household_members WHERE valid_to IS NULL) as total_members,
    (SELECT COUNT(*) FROM trapper.household_shared_identifiers) as shared_identifiers,
    (SELECT COUNT(*) FROM trapper.data_engine_soft_blacklist) as soft_blacklisted;

\echo ''
\echo '=== MIG_317 Complete ==='
\echo 'Household backfill completed:'
\echo '  - Created households from person-place relationships'
\echo '  - Detected and recorded shared identifiers'
\echo '  - Populated soft blacklist for multi-name identifiers'
\echo ''
\echo 'Run SELECT * FROM trapper.v_households_summary; to view results'
\echo ''
