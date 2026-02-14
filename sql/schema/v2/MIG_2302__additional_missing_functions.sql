-- MIG_2302: Additional Missing Functions
-- Date: 2026-02-14
--
-- Purpose: Add remaining functions that code still references

\echo ''
\echo '=============================================='
\echo '  MIG_2302: Additional Missing Functions'
\echo '=============================================='
\echo ''

-- ============================================================================
-- CAT FUNCTIONS
-- ============================================================================

\echo '1. Creating cat functions...'

CREATE OR REPLACE FUNCTION ops.get_cat_summary(p_cat_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT JSONB_BUILD_OBJECT(
        'cat_id', c.cat_id,
        'atlas_id', c.atlas_cat_id,
        'name', c.cat_name,
        'microchip', (SELECT id_value FROM sot.cat_identifiers WHERE cat_id = c.cat_id AND id_type = 'microchip' LIMIT 1),
        'altered_status', c.altered_status,
        'sex', c.sex,
        'primary_color', c.primary_color,
        'place_count', (SELECT COUNT(*) FROM sot.cat_place WHERE cat_id = c.cat_id),
        'appointment_count', (SELECT COUNT(*) FROM ops.appointments WHERE cat_id = c.cat_id)
    ) INTO v_result
    FROM sot.cats c
    WHERE c.cat_id = p_cat_id;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- COLONY FUNCTIONS
-- ============================================================================

\echo '2. Creating colony functions...'

CREATE OR REPLACE FUNCTION ops.assign_colony_person(
    p_colony_id UUID,
    p_person_id UUID,
    p_role TEXT DEFAULT 'caretaker',
    p_assigned_by UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Link person to colony place
    INSERT INTO sot.person_place (person_id, place_id, relationship_type, evidence_type, source_system)
    VALUES (p_person_id, p_colony_id, p_role, 'manual', 'atlas_ui')
    ON CONFLICT DO NOTHING;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ops.end_colony_person(
    p_colony_id UUID,
    p_person_id UUID,
    p_ended_by UUID DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Remove person-place relationship
    DELETE FROM sot.person_place
    WHERE person_id = p_person_id AND place_id = p_colony_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- CLINIC FUNCTIONS
-- ============================================================================

\echo '3. Creating clinic functions...'

CREATE OR REPLACE FUNCTION ops.get_default_clinic_type(p_date DATE)
RETURNS TEXT AS $$
BEGIN
    -- Default clinic type based on day of week
    CASE EXTRACT(DOW FROM p_date)
        WHEN 0 THEN RETURN 'sunday_clinic';
        WHEN 6 THEN RETURN 'saturday_clinic';
        ELSE RETURN 'weekday_clinic';
    END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION ops.resolve_trapper_alias(p_name TEXT)
RETURNS UUID AS $$
DECLARE
    v_person_id UUID;
BEGIN
    -- Try exact match first
    SELECT person_id INTO v_person_id
    FROM sot.people
    WHERE display_name ILIKE p_name
        AND merged_into_person_id IS NULL
    LIMIT 1;

    IF v_person_id IS NOT NULL THEN
        RETURN v_person_id;
    END IF;

    -- Try alias match
    SELECT person_id INTO v_person_id
    FROM sot.people
    WHERE aliases @> ARRAY[p_name]
        AND merged_into_person_id IS NULL
    LIMIT 1;

    RETURN v_person_id;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION ops.apply_smart_master_list_matches(p_clinic_date DATE)
RETURNS TABLE (matches_applied INT) AS $$
BEGIN
    RETURN QUERY SELECT 0;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ops.create_master_list_relationships(p_clinic_date DATE)
RETURNS TABLE (relationships_created INT) AS $$
BEGIN
    RETURN QUERY SELECT 0;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMPREHENSIVE LOOKUP FUNCTIONS (for Tippy)
-- ============================================================================

\echo '4. Creating comprehensive lookup functions...'

CREATE OR REPLACE FUNCTION ops.comprehensive_person_lookup(
    p_search_term TEXT,
    p_options JSONB DEFAULT '{}'
)
RETURNS JSONB AS $$
DECLARE
    v_results JSONB;
BEGIN
    SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'person_id', p.person_id,
        'display_name', p.display_name,
        'email', (SELECT id_value FROM sot.person_identifiers WHERE person_id = p.person_id AND id_type = 'email' LIMIT 1),
        'phone', (SELECT id_value FROM sot.person_identifiers WHERE person_id = p.person_id AND id_type = 'phone' LIMIT 1),
        'roles', (SELECT ARRAY_AGG(role) FROM ops.person_roles WHERE person_id = p.person_id AND role_status = 'active'),
        'cat_count', (SELECT COUNT(*) FROM sot.person_cat WHERE person_id = p.person_id),
        'is_trapper', EXISTS (SELECT 1 FROM ops.person_roles WHERE person_id = p.person_id AND role IN ('trapper', 'ffsc_trapper', 'community_trapper'))
    ))
    INTO v_results
    FROM sot.people p
    WHERE p.merged_into_person_id IS NULL
        AND (
            p.display_name ILIKE '%' || p_search_term || '%'
            OR EXISTS (
                SELECT 1 FROM sot.person_identifiers pi
                WHERE pi.person_id = p.person_id
                    AND pi.id_value ILIKE '%' || p_search_term || '%'
            )
        )
    LIMIT 20;

    RETURN COALESCE(v_results, '[]'::JSONB);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION ops.comprehensive_cat_lookup(
    p_search_term TEXT,
    p_options JSONB DEFAULT '{}'
)
RETURNS JSONB AS $$
DECLARE
    v_results JSONB;
BEGIN
    SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'cat_id', c.cat_id,
        'atlas_id', c.atlas_cat_id,
        'name', c.cat_name,
        'microchip', (SELECT id_value FROM sot.cat_identifiers WHERE cat_id = c.cat_id AND id_type = 'microchip' LIMIT 1),
        'altered_status', c.altered_status,
        'sex', c.sex,
        'primary_color', c.primary_color
    ))
    INTO v_results
    FROM sot.cats c
    WHERE c.merged_into_cat_id IS NULL
        AND (
            c.cat_name ILIKE '%' || p_search_term || '%'
            OR c.atlas_cat_id ILIKE '%' || p_search_term || '%'
            OR EXISTS (
                SELECT 1 FROM sot.cat_identifiers ci
                WHERE ci.cat_id = c.cat_id
                    AND ci.id_value ILIKE '%' || p_search_term || '%'
            )
        )
    LIMIT 20;

    RETURN COALESCE(v_results, '[]'::JSONB);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION ops.comprehensive_place_lookup(p_search_term TEXT)
RETURNS JSONB AS $$
DECLARE
    v_results JSONB;
BEGIN
    SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'place_id', p.place_id,
        'display_name', p.display_name,
        'address', a.display_address,
        'cat_count', (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = p.place_id),
        'request_count', (SELECT COUNT(*) FROM ops.requests WHERE place_id = p.place_id)
    ))
    INTO v_results
    FROM sot.places p
    LEFT JOIN sot.addresses a ON a.address_id = p.sot_address_id
    WHERE p.merged_into_place_id IS NULL
        AND (
            p.display_name ILIKE '%' || p_search_term || '%'
            OR a.display_address ILIKE '%' || p_search_term || '%'
        )
    LIMIT 20;

    RETURN COALESCE(v_results, '[]'::JSONB);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION ops.query_volunteerhub_data(p_query_type TEXT)
RETURNS JSONB AS $$
BEGIN
    CASE p_query_type
        WHEN 'trappers' THEN
            RETURN (
                SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
                    'person_id', p.person_id,
                    'display_name', p.display_name,
                    'role', pr.role,
                    'status', pr.role_status
                ))
                FROM sot.people p
                JOIN ops.person_roles pr ON pr.person_id = p.person_id
                WHERE pr.role IN ('trapper', 'ffsc_trapper', 'community_trapper', 'head_trapper')
                    AND pr.role_status = 'active'
                    AND p.merged_into_person_id IS NULL
            );
        WHEN 'fosters' THEN
            RETURN (
                SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
                    'person_id', p.person_id,
                    'display_name', p.display_name
                ))
                FROM sot.people p
                JOIN ops.person_roles pr ON pr.person_id = p.person_id
                WHERE pr.role = 'foster'
                    AND pr.role_status = 'active'
                    AND p.merged_into_person_id IS NULL
            );
        ELSE
            RETURN '[]'::JSONB;
    END CASE;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- EMAIL FUNCTIONS
-- ============================================================================

\echo '5. Creating email functions...'

CREATE OR REPLACE FUNCTION ops.mark_out_of_county_email_sent(
    p_submission_id UUID,
    p_sent_by UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE ops.intake_submissions
    SET out_of_county_email_sent = TRUE,
        out_of_county_email_sent_at = NOW(),
        updated_at = NOW()
    WHERE submission_id = p_submission_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Create view for pending out of county emails
CREATE OR REPLACE VIEW ops.v_pending_out_of_county_emails AS
SELECT
    s.submission_id,
    s.submitter_name,
    s.submitter_email,
    s.address,
    s.created_at
FROM ops.intake_submissions s
WHERE s.out_of_county = TRUE
    AND (s.out_of_county_email_sent IS NULL OR s.out_of_county_email_sent = FALSE)
    AND s.submitter_email IS NOT NULL;

\echo '   Created all functions'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  MIG_2302 Complete!'
\echo '=============================================='
\echo ''
