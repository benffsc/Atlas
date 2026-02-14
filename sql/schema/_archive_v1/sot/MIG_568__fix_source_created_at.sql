\echo ''
\echo '=============================================='
\echo 'MIG_565: Fix source_created_at in request promotion'
\echo '=============================================='
\echo ''
\echo 'Ensures source_created_at is always set when creating requests.'
\echo 'This is required for cat-request attribution window calculations.'
\echo ''

-- ============================================================================
-- STEP 1: Fix existing requests with NULL source_created_at
-- ============================================================================

\echo 'Step 1: Fixing existing requests with NULL source_created_at...'

UPDATE trapper.sot_requests
SET source_created_at = COALESCE(created_at, NOW())
WHERE source_created_at IS NULL;

-- ============================================================================
-- STEP 2: Add DEFAULT constraint to source_created_at column
-- ============================================================================

\echo 'Step 2: Adding DEFAULT to source_created_at column...'

ALTER TABLE trapper.sot_requests
ALTER COLUMN source_created_at SET DEFAULT NOW();

-- ============================================================================
-- STEP 3: Update promote_intake_request to explicitly set source_created_at
-- ============================================================================

\echo 'Step 3: Updating promote_intake_request function...'

-- Get the current function and update it
CREATE OR REPLACE FUNCTION trapper.promote_intake_request(p_raw_id uuid, p_promoted_by text DEFAULT 'system'::text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
    raw RECORD;
    new_request_id UUID;
    resolved_person_id UUID;
    resolved_place_id UUID;
BEGIN
    -- Get the raw intake request
    SELECT * INTO raw FROM trapper.raw_intake_request WHERE raw_id = p_raw_id;

    IF NOT FOUND THEN
        RAISE NOTICE 'Raw intake request not found: %', p_raw_id;
        RETURN NULL;
    END IF;

    -- Check if already promoted
    IF raw.intake_status = 'promoted' THEN
        RAISE NOTICE 'Request already promoted: %', raw.promoted_request_id;
        RETURN raw.promoted_request_id;
    END IF;

    -- Resolve person (use existing or create)
    IF raw.requester_person_id IS NOT NULL THEN
        resolved_person_id := raw.requester_person_id;
    ELSIF raw.raw_requester_email IS NOT NULL OR raw.raw_requester_phone IS NOT NULL THEN
        resolved_person_id := trapper.find_or_create_person(
            p_email := raw.raw_requester_email,
            p_phone := raw.raw_requester_phone,
            p_first_name := split_part(COALESCE(raw.raw_requester_name, ''), ' ', 1),
            p_last_name := nullif(trim(substring(COALESCE(raw.raw_requester_name, '') from position(' ' in COALESCE(raw.raw_requester_name, '')))), ''),
            p_address := raw.raw_address,
            p_source_system := raw.source_system
        );
    END IF;

    -- Resolve place (use existing or create)
    IF raw.place_id IS NOT NULL THEN
        resolved_place_id := raw.place_id;
    ELSIF raw.raw_address IS NOT NULL THEN
        resolved_place_id := trapper.find_or_create_place_deduped(
            p_formatted_address := raw.raw_address,
            p_source_system := raw.source_system
        );
    END IF;

    -- Create the SoT request
    INSERT INTO trapper.sot_requests (
        -- Location
        place_id,
        property_type,
        location_description,
        -- Contact
        requester_person_id,
        property_owner_contact,
        best_contact_times,
        property_owner_name,
        property_owner_phone,
        authorization_pending,
        -- Permission & Access
        permission_status,
        access_notes,
        traps_overnight_safe,
        access_without_contact,
        -- About the Cats
        estimated_cat_count,
        total_cats_reported,
        cat_count_semantic,
        wellness_cat_count,
        count_confidence,
        colony_duration,
        eartip_count,
        eartip_estimate,
        cats_are_friendly,
        -- Kittens
        has_kittens,
        kitten_count,
        kitten_age_weeks,
        -- Feeding
        is_being_fed,
        feeder_name,
        feeding_schedule,
        best_times_seen,
        -- Urgency
        urgency_reasons,
        urgency_deadline,
        urgency_notes,
        priority,
        -- Content
        summary,
        notes,
        internal_notes,
        request_purpose,
        -- Metadata
        data_source,
        source_system,
        source_created_at,  -- ADDED: Ensures attribution windows work
        created_by
    ) VALUES (
        resolved_place_id,
        NULLIF(raw.raw_property_type, '')::trapper.property_type,
        raw.raw_location_description,
        resolved_person_id,
        raw.raw_property_owner_contact,
        raw.raw_best_contact_times,
        raw.raw_property_owner_name,
        raw.raw_property_owner_phone,
        raw.raw_authorization_pending,
        COALESCE(NULLIF(raw.raw_permission_status, '')::trapper.permission_status, 'pending'),
        raw.raw_access_notes,
        raw.raw_traps_overnight_safe,
        raw.raw_access_without_contact,
        raw.raw_estimated_cat_count,
        raw.raw_estimated_cat_count,
        CASE
            WHEN raw.raw_wellness_cat_count IS NOT NULL AND raw.raw_wellness_cat_count > 0
            THEN 'wellness_only'::trapper.cat_count_semantic
            WHEN raw.raw_estimated_cat_count IS NOT NULL AND raw.raw_estimated_cat_count > 0
            THEN 'tnr_target'::trapper.cat_count_semantic
            ELSE 'unknown'::trapper.cat_count_semantic
        END,
        raw.raw_wellness_cat_count,
        NULLIF(raw.raw_count_confidence, '')::trapper.count_confidence,
        NULLIF(raw.raw_colony_duration, '')::trapper.colony_duration,
        raw.raw_eartip_count,
        NULLIF(raw.raw_eartip_estimate, '')::trapper.eartip_estimate,
        raw.raw_cats_are_friendly,
        COALESCE(raw.raw_has_kittens, FALSE),
        raw.raw_kitten_count,
        raw.raw_kitten_age_weeks,
        raw.raw_is_being_fed,
        raw.raw_feeder_name,
        raw.raw_feeding_schedule,
        raw.raw_best_times_seen,
        raw.raw_urgency_reasons,
        raw.raw_urgency_deadline,
        raw.raw_urgency_notes,
        COALESCE(NULLIF(raw.raw_priority, '')::trapper.request_priority, 'normal'),
        COALESCE(raw.raw_summary, raw.raw_requester_name, 'New Request'),
        raw.raw_notes,
        raw.raw_internal_notes,
        COALESCE(NULLIF(raw.raw_request_purpose, '')::trapper.request_purpose, 'tnr'),
        COALESCE(raw.source_system, 'atlas_ui')::trapper.data_source,
        raw.source_system,
        raw.created_at,  -- ADDED: Use raw intake creation time as source_created_at
        p_promoted_by
    )
    RETURNING request_id INTO new_request_id;

    -- Link person to place if both exist
    IF resolved_person_id IS NOT NULL AND resolved_place_id IS NOT NULL THEN
        INSERT INTO trapper.person_place_relationships (
            person_id, place_id, role, confidence, source_system, source_table
        ) VALUES (
            resolved_person_id, resolved_place_id, 'requester', 0.9, raw.source_system, 'raw_intake_request'
        )
        ON CONFLICT ON CONSTRAINT uq_person_place_role DO NOTHING;
    END IF;

    -- Update raw record
    UPDATE trapper.raw_intake_request
    SET intake_status = 'promoted',
        promoted_request_id = new_request_id,
        promoted_at = NOW()
    WHERE raw_id = p_raw_id;

    RETURN new_request_id;
END;
$function$;

COMMENT ON FUNCTION trapper.promote_intake_request IS
'Promotes a raw intake request to sot_requests.
MIG_565: Now explicitly sets source_created_at to ensure cat-request attribution windows work correctly.';

-- ============================================================================
-- STEP 4: Make attribution window logic handle NULL gracefully
-- ============================================================================

\echo 'Step 4: Creating safer cat-request linking function...'

CREATE OR REPLACE FUNCTION trapper.link_cats_to_requests_safe()
RETURNS TABLE(linked INT, skipped INT) AS $$
DECLARE
    v_linked INT := 0;
    v_skipped INT := 0;
BEGIN
    -- Link cats to requests within attribution windows
    -- Uses COALESCE to handle NULL source_created_at gracefully
    WITH new_links AS (
        INSERT INTO trapper.request_cat_links (request_id, cat_id, link_purpose, link_notes, linked_by)
        SELECT DISTINCT
            r.request_id,
            a.cat_id,
            CASE
                WHEN cp.is_spay = TRUE OR cp.is_neuter = TRUE THEN 'tnr_target'::trapper.cat_link_purpose
                ELSE 'wellness'::trapper.cat_link_purpose
            END,
            'Auto-linked: clinic visit ' || a.appointment_date::text || ' within request attribution window',
            'entity_linking_auto'
        FROM trapper.sot_appointments a
        JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
        JOIN trapper.sot_requests r ON r.place_id = cpr.place_id
        LEFT JOIN trapper.cat_procedures cp ON cp.appointment_id = a.appointment_id
        WHERE a.cat_id IS NOT NULL
            -- Attribution window with NULL-safe logic:
            -- If source_created_at is NULL, use created_at as fallback
            AND (
                -- Active request: appointment within window
                (r.resolved_at IS NULL
                 AND a.appointment_date >= COALESCE(r.source_created_at, r.created_at, '2020-01-01'::date) - INTERVAL '1 month')
                OR
                -- Resolved request: appointment before resolved + 3 month buffer
                (r.resolved_at IS NOT NULL
                 AND a.appointment_date <= r.resolved_at + INTERVAL '3 months'
                 AND a.appointment_date >= COALESCE(r.source_created_at, r.created_at, '2020-01-01'::date) - INTERVAL '1 month')
            )
            -- Only link recent appointments (last 60 days to catch more)
            AND a.appointment_date >= CURRENT_DATE - INTERVAL '60 days'
            AND NOT EXISTS (
                SELECT 1 FROM trapper.request_cat_links rcl
                WHERE rcl.request_id = r.request_id AND rcl.cat_id = a.cat_id
            )
        ON CONFLICT (request_id, cat_id) DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_linked FROM new_links;

    RETURN QUERY SELECT v_linked, v_skipped;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_cats_to_requests_safe IS
'Links cats to requests within attribution windows.
NULL-safe: Falls back to created_at if source_created_at is NULL.
Run via /api/cron/entity-linking or manually.';

-- ============================================================================
-- STEP 5: Run the safe linking function to catch any missed links
-- ============================================================================

\echo 'Step 5: Running safe linking to catch missed cats...'

SELECT * FROM trapper.link_cats_to_requests_safe();

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_565 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  - Fixed existing requests with NULL source_created_at'
\echo '  - Added DEFAULT NOW() to source_created_at column'
\echo '  - Updated promote_intake_request to set source_created_at'
\echo '  - Created link_cats_to_requests_safe() with NULL-safe logic'
\echo ''
\echo 'This ensures cat-request attribution windows always work correctly.'
\echo ''
