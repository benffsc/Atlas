-- MIG_2929: Create ops.redirect_request() function
--
-- Problem: The redirect API route calls ops.redirect_request() but this function
-- was never ported from V1. The "create new request" path of redirect fails.
--
-- Solution: Create the function following the same pattern as ops.handoff_request().
-- Uses centralized functions: sot.find_or_create_place_deduped(),
-- sot.find_or_create_person(), ops.find_or_create_request(),
-- sot.link_person_to_place().
--
-- Also updates sot.link_person_to_place() to accept NUMERIC confidence
-- (fixes TEXT-to-NUMERIC type mismatch from MIG_2021).
--
-- FFS-498: Centralize entity write contracts
-- Created: 2026-03-13

\echo ''
\echo '=============================================='
\echo '  MIG_2929: Create ops.redirect_request()'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. FIX link_person_to_place CONFIDENCE TYPE
-- ============================================================================

\echo '1. Fixing sot.link_person_to_place() confidence type...'

DROP FUNCTION IF EXISTS sot.link_person_to_place(UUID, UUID, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION sot.link_person_to_place(
    p_person_id UUID,
    p_place_id UUID,
    p_relationship_type TEXT DEFAULT 'resident',
    p_evidence_type TEXT DEFAULT 'manual',
    p_source_system TEXT DEFAULT 'atlas_ui',
    p_confidence NUMERIC DEFAULT 0.9
)
RETURNS UUID AS $$
DECLARE
    v_link_id UUID;
BEGIN
    -- Validate entities exist and aren't merged
    IF NOT EXISTS (
        SELECT 1 FROM sot.people WHERE person_id = p_person_id AND merged_into_person_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM sot.places WHERE place_id = p_place_id AND merged_into_place_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    -- Insert or update relationship
    INSERT INTO sot.person_place (
        person_id, place_id, relationship_type,
        confidence, evidence_type, source_system
    ) VALUES (
        p_person_id, p_place_id, p_relationship_type,
        p_confidence, p_evidence_type, p_source_system
    )
    ON CONFLICT (person_id, place_id, relationship_type)
    DO UPDATE SET
        confidence = GREATEST(sot.person_place.confidence, EXCLUDED.confidence),
        updated_at = NOW()
    RETURNING id INTO v_link_id;

    RETURN v_link_id;
EXCEPTION WHEN undefined_column THEN
    -- Fallback: Try with just person_id, place_id conflict
    INSERT INTO sot.person_place (
        person_id, place_id, relationship_type,
        confidence, evidence_type, source_system
    ) VALUES (
        p_person_id, p_place_id, p_relationship_type,
        p_confidence, p_evidence_type, p_source_system
    )
    ON CONFLICT (person_id, place_id) DO UPDATE SET
        relationship_type = EXCLUDED.relationship_type,
        confidence = GREATEST(sot.person_place.confidence, EXCLUDED.confidence),
        updated_at = NOW()
    RETURNING id INTO v_link_id;

    RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.link_person_to_place IS
'V2: Creates or updates a person-place relationship.
MIG_2929: Accepts NUMERIC confidence (fixes MIG_2021 TEXT mismatch).
Validates entities exist and are not merged before linking.
Uses ON CONFLICT to update if higher confidence.';

\echo '   Fixed sot.link_person_to_place()'

-- ============================================================================
-- 2. CREATE ops.redirect_request() FUNCTION
-- ============================================================================

\echo ''
\echo '2. Creating ops.redirect_request()...'

CREATE OR REPLACE FUNCTION ops.redirect_request(
    p_original_request_id UUID,
    p_redirect_reason TEXT,
    p_new_address TEXT DEFAULT NULL,
    p_new_place_id UUID DEFAULT NULL,
    p_new_requester_name TEXT DEFAULT NULL,
    p_new_requester_phone TEXT DEFAULT NULL,
    p_new_requester_email TEXT DEFAULT NULL,
    p_summary TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_estimated_cat_count INTEGER DEFAULT NULL,
    p_created_by TEXT DEFAULT NULL,
    p_has_kittens BOOLEAN DEFAULT FALSE,
    p_kitten_count INTEGER DEFAULT NULL,
    p_kitten_age_weeks TEXT DEFAULT NULL,
    p_kitten_assessment_status TEXT DEFAULT NULL,
    p_kitten_assessment_outcome TEXT DEFAULT NULL,
    p_kitten_not_needed_reason TEXT DEFAULT NULL
)
RETURNS TABLE(
    original_request_id UUID,
    new_request_id UUID,
    redirect_status TEXT
) AS $$
DECLARE
    v_original RECORD;
    v_new_place_id UUID;
    v_new_request_id UUID;
    v_resolved_person_id UUID;
    v_first_name TEXT;
    v_last_name TEXT;
BEGIN
    -- Validate original request exists and is in valid state
    SELECT * INTO v_original
    FROM ops.requests
    WHERE ops.requests.request_id = p_original_request_id;

    IF v_original IS NULL THEN
        RAISE EXCEPTION 'Request % not found', p_original_request_id;
    END IF;

    IF v_original.status IN ('redirected', 'handed_off', 'cancelled') THEN
        RAISE EXCEPTION 'Request has already been closed (status: %)', v_original.status;
    END IF;

    -- Step 1: Resolve place
    IF p_new_place_id IS NOT NULL THEN
        v_new_place_id := p_new_place_id;
    ELSIF p_new_address IS NOT NULL AND p_new_address != '' THEN
        v_new_place_id := sot.find_or_create_place_deduped(
            p_formatted_address := p_new_address,
            p_display_name := NULL,
            p_lat := NULL,
            p_lng := NULL,
            p_source_system := 'atlas_ui'
        );
    ELSE
        -- Inherit place from original
        v_new_place_id := v_original.place_id;
    END IF;

    -- Step 2: Resolve person (if contact info provided)
    IF p_new_requester_email IS NOT NULL OR p_new_requester_phone IS NOT NULL THEN
        -- Parse name into first/last
        IF p_new_requester_name IS NOT NULL AND p_new_requester_name != '' THEN
            -- Check for "Last, First" format
            IF p_new_requester_name LIKE '%,%' THEN
                v_last_name := TRIM(split_part(p_new_requester_name, ',', 1));
                v_first_name := TRIM(split_part(p_new_requester_name, ',', 2));
            ELSE
                v_first_name := TRIM(split_part(p_new_requester_name, ' ', 1));
                v_last_name := TRIM(SUBSTRING(p_new_requester_name FROM POSITION(' ' IN p_new_requester_name) + 1));
                IF v_last_name = v_first_name THEN v_last_name := NULL; END IF;
            END IF;
        END IF;

        BEGIN
            SELECT resolved_person_id INTO v_resolved_person_id
            FROM sot.data_engine_resolve_identity(
                p_new_requester_email,
                p_new_requester_phone,
                v_first_name,
                v_last_name,
                NULL,
                'atlas_ui'
            )
            WHERE decision_type IN ('auto_match', 'new_entity');
        EXCEPTION WHEN OTHERS THEN
            -- Non-blocking: person resolution failure shouldn't block redirect
            RAISE WARNING 'Person resolution failed for redirect: %', SQLERRM;
        END;
    END IF;

    -- Step 3: Create new request
    v_new_request_id := ops.find_or_create_request(
        p_source_system := 'atlas_ui',
        p_source_record_id := 'redirect_' || p_original_request_id::TEXT,
        p_source_created_at := NOW(),
        p_place_id := v_new_place_id,
        p_requester_person_id := v_resolved_person_id,
        p_summary := COALESCE(p_summary, 'Redirected from request ' || p_original_request_id::TEXT),
        p_estimated_cat_count := p_estimated_cat_count,
        p_status := 'new'
    );

    -- Step 4: Update new request with additional fields
    UPDATE ops.requests SET
        notes = p_notes,
        raw_requester_name = p_new_requester_name,
        raw_requester_phone = p_new_requester_phone,
        raw_requester_email = p_new_requester_email,
        redirected_from_request_id = p_original_request_id,
        transfer_type = 'redirect',
        created_by = p_created_by,
        -- Kitten fields
        has_kittens = p_has_kittens,
        kitten_count = p_kitten_count,
        kitten_age_weeks = p_kitten_age_weeks,
        kitten_assessment_status = p_kitten_assessment_status,
        kitten_assessment_outcome = p_kitten_assessment_outcome,
        kitten_not_needed_reason = p_kitten_not_needed_reason,
        -- Inherit key fields from original
        county = COALESCE(v_original.county, 'Sonoma'),
        property_type = v_original.property_type
    WHERE ops.requests.request_id = v_new_request_id;

    -- Step 5: Link person to place (THE FIX — was missing in redirect flow)
    IF v_resolved_person_id IS NOT NULL AND v_new_place_id IS NOT NULL THEN
        PERFORM sot.link_person_to_place(
            p_person_id := v_resolved_person_id,
            p_place_id := v_new_place_id,
            p_relationship_type := 'resident',
            p_evidence_type := 'manual',
            p_source_system := 'atlas_ui',
            p_confidence := 0.9
        );
    END IF;

    -- Step 6: Close original request
    UPDATE ops.requests SET
        status = 'redirected',
        redirected_to_request_id = v_new_request_id,
        redirect_reason = p_redirect_reason,
        redirect_at = NOW(),
        resolved_at = NOW(),
        transfer_type = 'redirect',
        resolution_notes = 'Redirected: ' || COALESCE(p_redirect_reason, 'No reason given')
    WHERE ops.requests.request_id = p_original_request_id
      AND ops.requests.status NOT IN ('redirected', 'handed_off');

    -- Step 7: Audit log
    INSERT INTO sot.entity_edits (
        entity_type, entity_id, edit_type, field_name,
        new_value, reason, edited_by
    ) VALUES (
        'request', p_original_request_id, 'field_update', 'status',
        to_jsonb('redirected'::TEXT),
        'Redirected to new request ' || v_new_request_id::TEXT || ': ' || COALESCE(p_redirect_reason, ''),
        p_created_by
    );

    RETURN QUERY SELECT
        p_original_request_id,
        v_new_request_id,
        'redirected'::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.redirect_request IS
'V2: Redirects a request to a new location.
Creates new request, resolves person/place, creates person-place link.
FFS-498: Uses centralized sot.link_person_to_place() for relationship creation.
MIG_2929.';

\echo '   Created ops.redirect_request()'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Functions created:'
SELECT proname, proargnames[1:3] AS first_args
FROM pg_proc
WHERE proname IN ('redirect_request', 'link_person_to_place')
  AND pronamespace IN (
    SELECT oid FROM pg_namespace WHERE nspname IN ('ops', 'sot')
  );

\echo ''
\echo '=============================================='
\echo '  MIG_2929 Complete!'
\echo '=============================================='
\echo ''
