\echo '=== MIG_568: Race Condition Protection for Person Creation ==='
\echo 'Adds advisory locking to prevent duplicate person creation from parallel requests'

-- ============================================================================
-- PROBLEM:
-- Two parallel requests with same email can both pass identity checks,
-- then both call create_person_basic. The second one gets a person created
-- but its identifier INSERT fails silently (ON CONFLICT DO NOTHING).
-- Result: "ghost" person record with no searchable identifiers.
--
-- SOLUTION:
-- 1. Add advisory lock based on identifier hash
-- 2. Double-check for existing person AFTER acquiring lock
-- 3. If found, return existing person instead of creating duplicate
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.create_person_basic(
    p_display_name TEXT,
    p_email_norm TEXT,
    p_phone_norm TEXT,
    p_source_system TEXT
)
RETURNS UUID AS $$
DECLARE
    v_person_id UUID;
    v_existing_person_id UUID;
    v_data_source trapper.data_source;
    v_lock_key BIGINT;
BEGIN
    -- Validate name
    IF NOT trapper.is_valid_person_name(p_display_name) THEN
        RETURN NULL;
    END IF;

    -- Calculate lock key from identifiers
    -- Using hashtext() to get a consistent integer for advisory lock
    v_lock_key := COALESCE(
        hashtext(COALESCE(p_email_norm, '') || '|' || COALESCE(p_phone_norm, '')),
        0
    );

    -- Skip locking if no identifiers (nothing to conflict on)
    IF p_email_norm IS NULL AND p_phone_norm IS NULL THEN
        -- Just create person without identifiers
        v_data_source := CASE p_source_system
            WHEN 'clinichq' THEN 'clinichq'::trapper.data_source
            WHEN 'airtable' THEN 'airtable'::trapper.data_source
            WHEN 'web_intake' THEN 'web_app'::trapper.data_source
            WHEN 'atlas_ui' THEN 'web_app'::trapper.data_source
            WHEN 'shelterluv' THEN 'shelterluv'::trapper.data_source
            WHEN 'volunteerhub' THEN 'volunteerhub'::trapper.data_source
            ELSE 'web_app'::trapper.data_source
        END;

        INSERT INTO trapper.sot_people (
            display_name, data_source, is_canonical, primary_email, primary_phone
        ) VALUES (
            p_display_name, v_data_source, TRUE, NULL, NULL
        ) RETURNING person_id INTO v_person_id;

        RETURN v_person_id;
    END IF;

    -- Acquire transaction-scoped advisory lock
    -- This blocks other transactions trying to create with same identifiers
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- Double-check: After acquiring lock, check if identifier now exists
    -- (Another transaction may have just created it)
    IF p_email_norm IS NOT NULL THEN
        SELECT pi.person_id INTO v_existing_person_id
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = p_email_norm
          AND sp.merged_into_person_id IS NULL
        LIMIT 1;

        IF v_existing_person_id IS NOT NULL THEN
            RAISE NOTICE 'Race condition avoided: returning existing person % (matched by email)', v_existing_person_id;
            RETURN v_existing_person_id;
        END IF;
    END IF;

    IF p_phone_norm IS NOT NULL AND v_existing_person_id IS NULL THEN
        SELECT pi.person_id INTO v_existing_person_id
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
        WHERE pi.id_type = 'phone'
          AND pi.id_value_norm = p_phone_norm
          AND sp.merged_into_person_id IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM trapper.identity_phone_blacklist bl
              WHERE bl.phone_norm = p_phone_norm
          )
        LIMIT 1;

        IF v_existing_person_id IS NOT NULL THEN
            RAISE NOTICE 'Race condition avoided: returning existing person % (matched by phone)', v_existing_person_id;
            RETURN v_existing_person_id;
        END IF;
    END IF;

    -- No existing person found - safe to create
    -- Map source_system to data_source enum
    v_data_source := CASE p_source_system
        WHEN 'clinichq' THEN 'clinichq'::trapper.data_source
        WHEN 'airtable' THEN 'airtable'::trapper.data_source
        WHEN 'web_intake' THEN 'web_app'::trapper.data_source
        WHEN 'atlas_ui' THEN 'web_app'::trapper.data_source
        WHEN 'shelterluv' THEN 'shelterluv'::trapper.data_source
        WHEN 'volunteerhub' THEN 'volunteerhub'::trapper.data_source
        ELSE 'web_app'::trapper.data_source
    END;

    -- Create person
    INSERT INTO trapper.sot_people (
        display_name, data_source, is_canonical, primary_email, primary_phone
    ) VALUES (
        p_display_name, v_data_source, TRUE, p_email_norm, p_phone_norm
    ) RETURNING person_id INTO v_person_id;

    -- Add email identifier
    IF p_email_norm IS NOT NULL AND p_email_norm != '' THEN
        INSERT INTO trapper.person_identifiers (
            person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
        ) VALUES (
            v_person_id, 'email', p_email_norm, p_email_norm, p_source_system, 1.0
        ) ON CONFLICT (id_type, id_value_norm) DO UPDATE
        SET person_id = EXCLUDED.person_id
        WHERE trapper.person_identifiers.person_id IN (
            -- Only update if existing person was merged away
            SELECT person_id FROM trapper.sot_people
            WHERE merged_into_person_id IS NOT NULL
        );
    END IF;

    -- Add phone identifier (if not blacklisted)
    IF p_phone_norm IS NOT NULL AND p_phone_norm != '' THEN
        IF NOT EXISTS (
            SELECT 1 FROM trapper.identity_phone_blacklist
            WHERE phone_norm = p_phone_norm
        ) THEN
            INSERT INTO trapper.person_identifiers (
                person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
            ) VALUES (
                v_person_id, 'phone', p_phone_norm, p_phone_norm, p_source_system, 1.0
            ) ON CONFLICT (id_type, id_value_norm) DO UPDATE
            SET person_id = EXCLUDED.person_id
            WHERE trapper.person_identifiers.person_id IN (
                -- Only update if existing person was merged away
                SELECT person_id FROM trapper.sot_people
                WHERE merged_into_person_id IS NOT NULL
            );
        END IF;
    END IF;

    RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_person_basic IS
'Creates a new person with email/phone identifiers. Uses advisory locking to prevent race conditions where parallel requests create duplicate people.';

\echo ''
\echo '=== MIG_568 Complete ==='
\echo ''
\echo 'Changes made:'
\echo '  1. Added pg_advisory_xact_lock based on identifier hash'
\echo '  2. Double-check for existing person after acquiring lock'
\echo '  3. Return existing person if found (race condition avoided)'
\echo '  4. ON CONFLICT now updates merged-away persons instead of DO NOTHING'
\echo ''
\echo 'This prevents "ghost" person records with no identifiers from being created'
\echo 'when two parallel requests try to create the same person simultaneously.'
