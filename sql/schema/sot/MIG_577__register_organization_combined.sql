\echo '=== MIG_577: Combined Organization Registration ==='
\echo ''
\echo 'Creates helper function to register organizations with both person and place linkage.'
\echo 'Also creates combined lookup function for Data Engine integration.'
\echo ''

-- ============================================================================
-- PART 1: Combined Registration Function
-- ============================================================================

\echo 'Creating register_organization() function...'

CREATE OR REPLACE FUNCTION trapper.register_organization(
    p_org_name TEXT,                    -- Display name: "Coast Guard Station" or "Park N Ride"
    p_address TEXT,                     -- Physical address: "16574 CA-116, Guerneville, CA 95446"
    p_representative_name TEXT DEFAULT NULL,  -- Contact person name
    p_representative_email TEXT DEFAULT NULL, -- Contact email
    p_representative_phone TEXT DEFAULT NULL, -- Contact phone
    p_name_patterns TEXT[] DEFAULT NULL,      -- Additional ILIKE patterns (optional)
    p_org_type TEXT DEFAULT 'feeding_site',   -- Type: feeding_site, shelter, rescue, etc.
    p_notes TEXT DEFAULT NULL
)
RETURNS TABLE(
    org_id INT,
    place_id UUID,
    person_id UUID,
    message TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
    v_place_id UUID;
    v_person_id UUID;
    v_org_id INT;
    v_pattern TEXT;
    v_patterns TEXT[];
BEGIN
    -- 1. Create/find the place
    IF p_address IS NOT NULL AND TRIM(p_address) != '' THEN
        v_place_id := trapper.find_or_create_place_deduped(
            p_address,
            p_org_name,  -- Use org name as place name
            NULL, NULL,  -- No coords provided
            'atlas_ui'
        );
    END IF;

    -- 2. Create/find the representative person
    IF p_representative_email IS NOT NULL OR p_representative_phone IS NOT NULL OR p_representative_name IS NOT NULL THEN
        v_person_id := trapper.find_or_create_person(
            p_representative_email,
            p_representative_phone,
            split_part(COALESCE(p_representative_name, ''), ' ', 1),  -- First name
            CASE
                WHEN position(' ' in COALESCE(p_representative_name, '')) > 0
                THEN substring(p_representative_name from position(' ' in p_representative_name) + 1)
                ELSE NULL
            END,  -- Last name
            NULL,  -- No address for person
            'atlas_ui'
        );
    END IF;

    -- 3. Build pattern array (org name + any additional patterns)
    v_patterns := COALESCE(p_name_patterns, ARRAY[]::TEXT[]);
    IF NOT '%' || p_org_name || '%' = ANY(v_patterns) THEN
        v_patterns := array_prepend('%' || p_org_name || '%', v_patterns);
    END IF;

    -- 4. Add to known_organizations (for detection)
    INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, linked_place_id, notes)
    VALUES (p_org_name, '%' || p_org_name || '%', p_org_type, v_place_id, p_notes)
    ON CONFLICT (org_name) DO UPDATE SET
        org_name_pattern = COALESCE(EXCLUDED.org_name_pattern, known_organizations.org_name_pattern),
        linked_place_id = COALESCE(EXCLUDED.linked_place_id, known_organizations.linked_place_id),
        notes = COALESCE(EXCLUDED.notes, known_organizations.notes)
    RETURNING known_organizations.org_id INTO v_org_id;

    -- 5. Add to data_fixing_patterns (for is_organization_name detection)
    FOREACH v_pattern IN ARRAY v_patterns
    LOOP
        INSERT INTO trapper.data_fixing_patterns (pattern_name, pattern_type, pattern_ilike, is_organization, fix_notes)
        VALUES (
            'org_' || regexp_replace(v_pattern, '[^a-zA-Z0-9]', '_', 'g'),  -- pattern_name
            'name',
            v_pattern,
            TRUE,
            'Auto-added via register_organization for: ' || p_org_name
        )
        ON CONFLICT (pattern_name) DO NOTHING;
    END LOOP;

    -- 6. Add person mapping (if representative provided)
    IF v_person_id IS NOT NULL THEN
        FOREACH v_pattern IN ARRAY v_patterns
        LOOP
            INSERT INTO trapper.organization_person_mappings (
                org_pattern, org_pattern_type, representative_person_id,
                org_display_name, notes, created_by
            )
            VALUES (v_pattern, 'ilike', v_person_id, p_org_name, p_notes, 'system:register_organization')
            ON CONFLICT (org_pattern, org_pattern_type) DO UPDATE SET
                representative_person_id = EXCLUDED.representative_person_id,
                org_display_name = EXCLUDED.org_display_name,
                updated_at = NOW();
        END LOOP;
    END IF;

    -- 7. Add place mapping (if place created)
    IF v_place_id IS NOT NULL THEN
        FOREACH v_pattern IN ARRAY v_patterns
        LOOP
            INSERT INTO trapper.organization_place_mappings (
                org_pattern, org_pattern_type, place_id,
                org_display_name, notes, created_by
            )
            VALUES (v_pattern, 'ilike', v_place_id, p_org_name, p_notes, 'system:register_organization')
            ON CONFLICT (org_pattern, org_pattern_type) DO UPDATE SET
                place_id = EXCLUDED.place_id,
                org_display_name = EXCLUDED.org_display_name,
                updated_at = NOW();
        END LOOP;
    END IF;

    -- Return results
    RETURN QUERY SELECT
        v_org_id,
        v_place_id,
        v_person_id,
        format('Registered "%s": place_id=%s, person_id=%s, %s patterns',
            p_org_name,
            COALESCE(v_place_id::TEXT, 'none'),
            COALESCE(v_person_id::TEXT, 'none'),
            array_length(v_patterns, 1)
        )::TEXT;
END;
$$;

COMMENT ON FUNCTION trapper.register_organization IS
'Registers an organization with both person and place linkage.
Creates entries in:
  - known_organizations (for detection via is_organization_name)
  - data_fixing_patterns (for backup detection)
  - organization_person_mappings (for person routing)
  - organization_place_mappings (for place routing)

Example:
  SELECT * FROM trapper.register_organization(
    ''Coast Guard Station'',
    ''16920 Sir Francis Drake Blvd, Inverness, CA 94937'',
    ''Natasha Reed'', NULL, NULL,
    ARRAY[''%Coast Guard%'', ''%USCG%''],
    ''government'',
    ''US Coast Guard Station - Natasha Reed is community trapper''
  );';

-- ============================================================================
-- PART 2: Combined Lookup Function
-- ============================================================================

\echo 'Creating get_organization_routing() function...'

CREATE OR REPLACE FUNCTION trapper.get_organization_routing(p_owner_name TEXT)
RETURNS TABLE(
    is_organization BOOLEAN,
    representative_person_id UUID,
    linked_place_id UUID,
    org_display_name TEXT
)
LANGUAGE plpgsql AS $$
BEGIN
    -- Check if it's an organization
    IF NOT trapper.is_organization_name(p_owner_name) THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;

    -- Get person and place routing
    RETURN QUERY SELECT
        TRUE,
        trapper.get_organization_representative(p_owner_name),
        trapper.get_organization_place(p_owner_name),
        COALESCE(
            (SELECT m.org_display_name FROM trapper.organization_person_mappings m
             WHERE p_owner_name ILIKE m.org_pattern LIMIT 1),
            (SELECT m.org_display_name FROM trapper.organization_place_mappings m
             WHERE p_owner_name ILIKE m.org_pattern LIMIT 1),
            p_owner_name
        );
END;
$$;

COMMENT ON FUNCTION trapper.get_organization_routing IS
'Combined lookup for organization routing.
Returns is_organization, representative_person_id, linked_place_id, and display name.

Example:
  SELECT * FROM trapper.get_organization_routing(''Coast Guard Station Tomales Rd'');
  -- Returns: (true, <person_uuid>, <place_uuid>, "Coast Guard Station")';

-- ============================================================================
-- PART 3: Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='

-- Test the functions exist
SELECT 'register_organization exists' as test,
       EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'register_organization' AND pronamespace = 'trapper'::regnamespace) as result;

SELECT 'get_organization_routing exists' as test,
       EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'get_organization_routing' AND pronamespace = 'trapper'::regnamespace) as result;

\echo ''
\echo '=== MIG_577 Complete ==='
\echo ''
\echo 'Created functions:'
\echo '  - register_organization(name, address, rep_name, rep_email, rep_phone, patterns, type, notes)'
\echo '  - get_organization_routing(name) -> (is_org, person_id, place_id, display_name)'
\echo ''
\echo 'Example usage:'
\echo '  SELECT * FROM trapper.register_organization('
\echo '    ''Park N Ride'','
\echo '    ''16574 CA-116, Guerneville, CA 95446'','
\echo '    NULL, NULL, NULL,'
\echo '    ARRAY[''%Park N Ride%'', ''%ParkNRide%''],'
\echo '    ''feeding_site'','
\echo '    ''Construction site feeding location'''
\echo '  );'
\echo ''
