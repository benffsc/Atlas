-- MIG_2877: Restore Household Membership Building
-- FFS-342: data_engine_build_households() and related functions were never migrated from V1
--
-- Current state:
--   sot.households: 237 rows (130 email-based, 107 phone-based) with 0 members
--   sot.household_members: 0 rows
--   ops.clinic_accounts: 6,338 linked via household_id
--   653 places with 2+ people linked (potential new households)
--
-- This migration:
--   1. Creates sot.build_household_members() to populate members from shared identifiers
--   2. Creates sot.detect_shared_identifiers() to find shared phone/email
--   3. Creates sot.build_households_from_places() for place-based household detection
--   4. Backfills all membership

\echo 'MIG_2877: Restoring household membership building...'

-- ============================================================================
-- 1. DETECT SHARED IDENTIFIERS
-- ============================================================================

CREATE OR REPLACE FUNCTION sot.detect_shared_identifiers()
RETURNS TABLE (
    identifier_type TEXT,
    identifier_value TEXT,
    person_count BIGINT,
    person_ids UUID[],
    sample_names TEXT[]
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        pi.id_type::TEXT AS identifier_type,
        pi.id_value_norm AS identifier_value,
        COUNT(DISTINCT pi.person_id) AS person_count,
        ARRAY_AGG(DISTINCT pi.person_id) AS person_ids,
        ARRAY_AGG(DISTINCT p.display_name ORDER BY p.display_name) AS sample_names
    FROM sot.person_identifiers pi
    JOIN sot.people p ON p.person_id = pi.person_id
        AND p.merged_into_person_id IS NULL
    WHERE pi.id_type IN ('phone', 'email')
      AND pi.confidence >= 0.5
      AND NOT sot.is_identifier_blacklisted(pi.id_type::TEXT, pi.id_value_norm)
    GROUP BY pi.id_type, pi.id_value_norm
    HAVING COUNT(DISTINCT pi.person_id) > 1
    ORDER BY COUNT(DISTINCT pi.person_id) DESC;
END;
$$;

COMMENT ON FUNCTION sot.detect_shared_identifiers IS
'Detect phone/email identifiers shared by multiple people.
Used for household detection and soft-blacklist population.
Respects confidence >= 0.5 and blacklist filters.';

-- ============================================================================
-- 2. POPULATE MEMBERS FOR EXISTING HOUSEHOLDS
-- ============================================================================

CREATE OR REPLACE FUNCTION sot.build_household_members()
RETURNS TABLE (
    households_processed INT,
    members_added INT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_households_processed INT := 0;
    v_members_added INT := 0;
    v_household RECORD;
    v_person_id UUID;
    v_person_ids UUID[];
BEGIN
    -- Process email-based households
    FOR v_household IN
        SELECT h.household_id, h.shared_email, h.shared_phone, h.detection_reason
        FROM sot.households h
        WHERE h.shared_email IS NOT NULL OR h.shared_phone IS NOT NULL
    LOOP
        v_person_ids := ARRAY[]::UUID[];

        -- Find people matching the shared identifier
        IF v_household.detection_reason = 'shared_email' AND v_household.shared_email IS NOT NULL THEN
            SELECT ARRAY_AGG(DISTINCT pi.person_id)
            INTO v_person_ids
            FROM sot.person_identifiers pi
            JOIN sot.people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
            WHERE pi.id_type = 'email'
              AND pi.id_value_norm = sot.norm_email(v_household.shared_email)
              AND pi.confidence >= 0.5;
        ELSIF v_household.detection_reason = 'shared_phone' AND v_household.shared_phone IS NOT NULL THEN
            SELECT ARRAY_AGG(DISTINCT pi.person_id)
            INTO v_person_ids
            FROM sot.person_identifiers pi
            JOIN sot.people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
            WHERE pi.id_type = 'phone'
              AND pi.id_value_norm = sot.norm_phone_us(v_household.shared_phone)
              AND pi.confidence >= 0.5;
        END IF;

        -- Add members
        IF v_person_ids IS NOT NULL AND array_length(v_person_ids, 1) > 0 THEN
            FOREACH v_person_id IN ARRAY v_person_ids
            LOOP
                INSERT INTO sot.household_members (household_id, person_id, relationship, is_primary)
                VALUES (v_household.household_id, v_person_id, 'member', FALSE)
                ON CONFLICT (household_id, person_id) DO NOTHING;

                IF FOUND THEN
                    v_members_added := v_members_added + 1;
                END IF;
            END LOOP;

            -- Set first member as primary
            UPDATE sot.household_members
            SET is_primary = TRUE
            WHERE household_id = v_household.household_id
              AND member_id = (
                SELECT member_id FROM sot.household_members
                WHERE household_id = v_household.household_id
                ORDER BY joined_at LIMIT 1
              );

            v_households_processed := v_households_processed + 1;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_households_processed, v_members_added;
END;
$$;

COMMENT ON FUNCTION sot.build_household_members IS
'Populate household_members for existing households by matching
shared_email/shared_phone to person_identifiers.
Safe to re-run (uses ON CONFLICT DO NOTHING).';

-- ============================================================================
-- 3. BUILD HOUSEHOLDS FROM PLACES
-- ============================================================================

CREATE OR REPLACE FUNCTION sot.build_households_from_places()
RETURNS TABLE (
    households_created INT,
    members_added INT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_households_created INT := 0;
    v_members_added INT := 0;
    v_place RECORD;
    v_household_id UUID;
    v_person_id UUID;
    v_display_name TEXT;
BEGIN
    -- Find places with 2+ people that don't already have a household
    FOR v_place IN
        SELECT
            pp.place_id,
            pl.formatted_address,
            ARRAY_AGG(DISTINCT pp.person_id) AS person_ids,
            COUNT(DISTINCT pp.person_id) AS person_count
        FROM sot.person_place pp
        JOIN sot.places pl ON pl.place_id = pp.place_id
            AND pl.merged_into_place_id IS NULL
        JOIN sot.people p ON p.person_id = pp.person_id
            AND p.merged_into_person_id IS NULL
        WHERE pp.relationship_type IN ('resident', 'caretaker', 'home', 'residence', 'owner', 'renter', 'primary')
        GROUP BY pp.place_id, pl.formatted_address
        HAVING COUNT(DISTINCT pp.person_id) >= 2
    LOOP
        -- Check if household already exists for this address
        SELECT h.household_id INTO v_household_id
        FROM sot.households h
        WHERE h.primary_address = v_place.formatted_address
        LIMIT 1;

        -- Create household if needed
        IF v_household_id IS NULL THEN
            -- Generate display name from first person's last name
            SELECT p.last_name INTO v_display_name
            FROM sot.people p
            WHERE p.person_id = v_place.person_ids[1];

            INSERT INTO sot.households (
                primary_address,
                display_name,
                detection_reason,
                detected_at
            ) VALUES (
                v_place.formatted_address,
                CASE WHEN v_display_name IS NOT NULL
                    THEN 'The ' || v_display_name || ' Household'
                    ELSE 'Household at ' || LEFT(v_place.formatted_address, 40)
                END,
                'shared_address',
                NOW()
            )
            RETURNING household_id INTO v_household_id;

            v_households_created := v_households_created + 1;
        END IF;

        -- Add all people as members
        FOREACH v_person_id IN ARRAY v_place.person_ids
        LOOP
            INSERT INTO sot.household_members (household_id, person_id, relationship, is_primary)
            VALUES (v_household_id, v_person_id, 'member', FALSE)
            ON CONFLICT (household_id, person_id) DO NOTHING;

            IF FOUND THEN
                v_members_added := v_members_added + 1;
            END IF;
        END LOOP;

        -- Set first member as primary
        UPDATE sot.household_members
        SET is_primary = TRUE
        WHERE household_id = v_household_id
          AND member_id = (
            SELECT member_id FROM sot.household_members
            WHERE household_id = v_household_id
            ORDER BY joined_at LIMIT 1
          );
    END LOOP;

    RETURN QUERY SELECT v_households_created, v_members_added;
END;
$$;

COMMENT ON FUNCTION sot.build_households_from_places IS
'Detect households from places with 2+ people in residential relationships.
Creates new household records and populates membership.
Only considers residential relationship types (home, residence, owner, renter, primary).
Safe to re-run (ON CONFLICT DO NOTHING).';

-- ============================================================================
-- 4. BACKFILL: Populate members for existing 237 households
-- ============================================================================

\echo 'Backfilling members for existing 237 households...'

SELECT * FROM sot.build_household_members();

-- ============================================================================
-- 5. BACKFILL: Build households from places
-- ============================================================================

\echo 'Building households from multi-person places...'

SELECT * FROM sot.build_households_from_places();

-- ============================================================================
-- 6. VERIFICATION
-- ============================================================================

\echo ''
\echo '=== HOUSEHOLD MEMBERSHIP VERIFICATION ==='

DO $$
DECLARE
    v_household_count INT;
    v_member_count INT;
    v_populated INT;
BEGIN
    SELECT COUNT(*) INTO v_household_count FROM sot.households;
    SELECT COUNT(*) INTO v_member_count FROM sot.household_members;
    SELECT COUNT(DISTINCT household_id) INTO v_populated
    FROM sot.household_members;

    RAISE NOTICE 'Households total: %', v_household_count;
    RAISE NOTICE 'Household members total: %', v_member_count;
    RAISE NOTICE 'Households with members: % / %', v_populated, v_household_count;
END $$;

SELECT detection_reason, COUNT(*) AS households, SUM(member_ct) AS total_members
FROM (
    SELECT h.detection_reason,
           (SELECT COUNT(*) FROM sot.household_members hm WHERE hm.household_id = h.household_id) AS member_ct
    FROM sot.households h
) sub
GROUP BY detection_reason
ORDER BY households DESC;

\echo 'MIG_2877: Household membership restored'
