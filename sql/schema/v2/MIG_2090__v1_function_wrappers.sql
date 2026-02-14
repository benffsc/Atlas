-- MIG_2090: V1 Function Wrappers
-- Date: 2026-02-14
-- Purpose: Make trapper.* functions delegate to sot.*/ops.* implementations
-- This allows all existing code to continue working while V2 is the real implementation

\echo ''
\echo '=============================================='
\echo '  MIG_2090: V1 Function Wrappers'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. IDENTITY RESOLUTION FUNCTIONS
-- ============================================================================

\echo '1. Creating identity resolution wrappers...'

-- find_or_create_person: delegate to sot.find_or_create_person
CREATE OR REPLACE FUNCTION trapper.find_or_create_person(
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'atlas_ui'
)
RETURNS UUID AS $$
BEGIN
    -- Delegate to V2 implementation
    RETURN sot.find_or_create_person(
        p_email, p_phone, p_first_name, p_last_name, p_address, p_source_system
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_person IS
'V1 compatibility wrapper - delegates to sot.find_or_create_person()';

-- data_engine_resolve_identity: delegate to sot version
CREATE OR REPLACE FUNCTION trapper.data_engine_resolve_identity(
    p_email TEXT,
    p_phone TEXT,
    p_first_name TEXT,
    p_last_name TEXT,
    p_address TEXT,
    p_source_system TEXT,
    p_staged_record_id UUID DEFAULT NULL,
    p_job_id UUID DEFAULT NULL
)
RETURNS TABLE(
    decision_type TEXT,
    person_id UUID,
    display_name TEXT,
    confidence NUMERIC,
    reason TEXT,
    match_details JSONB,
    decision_id UUID
) AS $$
DECLARE
    v_result RECORD;
BEGIN
    -- Delegate to V2 implementation (note: sot version returns resolved_person_id)
    SELECT * INTO v_result
    FROM sot.data_engine_resolve_identity(
        p_email, p_phone, p_first_name, p_last_name, p_address, p_source_system
    );

    -- Map resolved_person_id back to person_id for V1 compatibility
    RETURN QUERY SELECT
        v_result.decision_type,
        v_result.resolved_person_id AS person_id,
        v_result.display_name,
        v_result.confidence,
        v_result.reason,
        v_result.match_details,
        v_result.decision_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity IS
'V1 compatibility wrapper - delegates to sot.data_engine_resolve_identity()';

\echo '   Created identity resolution wrappers'

-- ============================================================================
-- 2. PLACE FUNCTIONS
-- ============================================================================

\echo ''
\echo '2. Creating place function wrappers...'

-- find_or_create_place_deduped: delegate to sot version
CREATE OR REPLACE FUNCTION trapper.find_or_create_place_deduped(
    p_formatted_address TEXT DEFAULT NULL,
    p_display_name TEXT DEFAULT NULL,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL,
    p_source_system TEXT DEFAULT 'atlas_ui',
    p_google_place_id TEXT DEFAULT NULL,
    p_place_kind TEXT DEFAULT 'unknown',
    p_unit_number TEXT DEFAULT NULL
)
RETURNS UUID AS $$
BEGIN
    -- Delegate to V2 implementation
    RETURN sot.find_or_create_place_deduped(
        p_formatted_address, p_display_name, p_lat, p_lng,
        p_source_system, p_google_place_id, p_place_kind, p_unit_number
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_place_deduped IS
'V1 compatibility wrapper - delegates to sot.find_or_create_place_deduped()';

\echo '   Created place function wrappers'

-- ============================================================================
-- 3. CAT FUNCTIONS
-- ============================================================================

\echo ''
\echo '3. Creating cat function wrappers...'

-- find_or_create_cat_by_microchip: delegate to sot version
-- Note: sot version has more parameters (clinichq_animal_id, shelterluv_animal_id, ownership_type)
CREATE OR REPLACE FUNCTION trapper.find_or_create_cat_by_microchip(
    p_microchip TEXT,
    p_name TEXT DEFAULT NULL,
    p_sex TEXT DEFAULT NULL,
    p_breed TEXT DEFAULT NULL,
    p_color TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'clinichq',
    p_ear_tip BOOLEAN DEFAULT NULL
)
RETURNS UUID AS $$
BEGIN
    -- Delegate to V2 implementation (pass NULLs for new V2-only params)
    RETURN sot.find_or_create_cat_by_microchip(
        p_microchip, p_name, p_sex, p_breed, p_color, p_source_system, p_ear_tip,
        NULL,  -- p_clinichq_animal_id
        NULL,  -- p_shelterluv_animal_id
        NULL   -- p_ownership_type
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_cat_by_microchip IS
'V1 compatibility wrapper - delegates to sot.find_or_create_cat_by_microchip()';

\echo '   Created cat function wrappers'

-- ============================================================================
-- 4. NORMALIZATION FUNCTIONS
-- ============================================================================

\echo ''
\echo '4. Creating normalization function wrappers...'

-- norm_phone_us: delegate to sot version
CREATE OR REPLACE FUNCTION trapper.norm_phone_us(p_phone TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN sot.norm_phone_us(p_phone);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.norm_phone_us IS
'V1 compatibility wrapper - delegates to sot.norm_phone_us()';

-- norm_email: delegate to sot version
CREATE OR REPLACE FUNCTION trapper.norm_email(p_email TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN sot.norm_email(p_email);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.norm_email IS
'V1 compatibility wrapper - delegates to sot.norm_email()';

-- normalize_address: delegate to sot version
CREATE OR REPLACE FUNCTION trapper.normalize_address(p_address TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN sot.normalize_address(p_address);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.normalize_address IS
'V1 compatibility wrapper - delegates to sot.normalize_address()';

\echo '   Created normalization function wrappers'

-- ============================================================================
-- 5. CLASSIFICATION/GUARD FUNCTIONS
-- ============================================================================

\echo ''
\echo '5. Creating classification/guard function wrappers...'

-- should_be_person: delegate to sot version
CREATE OR REPLACE FUNCTION trapper.should_be_person(
    p_first_name TEXT,
    p_last_name TEXT,
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN sot.should_be_person(p_first_name, p_last_name, p_email, p_phone);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.should_be_person IS
'V1 compatibility wrapper - delegates to sot.should_be_person()';

-- classify_owner_name: delegate to sot version
CREATE OR REPLACE FUNCTION trapper.classify_owner_name(p_name TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN sot.classify_owner_name(p_name);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.classify_owner_name IS
'V1 compatibility wrapper - delegates to sot.classify_owner_name()';

-- is_organization_name: delegate to sot version
CREATE OR REPLACE FUNCTION trapper.is_organization_name(p_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN sot.is_organization_name(p_name);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.is_organization_name IS
'V1 compatibility wrapper - delegates to sot.is_organization_name()';

-- is_valid_person_name: delegate to sot version (if exists)
CREATE OR REPLACE FUNCTION trapper.is_valid_person_name(p_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- V2 uses classify_owner_name instead
    RETURN sot.classify_owner_name(p_name) = 'person';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.is_valid_person_name IS
'V1 compatibility wrapper - uses sot.classify_owner_name()';

\echo '   Created classification/guard function wrappers'

-- ============================================================================
-- 6. ENTITY LINKING FUNCTIONS
-- ============================================================================

\echo ''
\echo '6. Creating entity linking function wrappers...'

-- link_cat_to_place: delegate to sot version
CREATE OR REPLACE FUNCTION trapper.link_cat_to_place(
    p_cat_id UUID,
    p_place_id UUID,
    p_relationship_type TEXT DEFAULT 'residence',
    p_evidence_type TEXT DEFAULT 'appointment',
    p_source_system TEXT DEFAULT 'atlas_ui',
    p_confidence NUMERIC DEFAULT 0.8
)
RETURNS UUID AS $$
BEGIN
    RETURN sot.link_cat_to_place(
        p_cat_id, p_place_id, p_relationship_type,
        p_evidence_type, p_source_system, p_confidence
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_cat_to_place IS
'V1 compatibility wrapper - delegates to sot.link_cat_to_place()';

-- link_person_to_cat: delegate to sot version
CREATE OR REPLACE FUNCTION trapper.link_person_to_cat(
    p_person_id UUID,
    p_cat_id UUID,
    p_relationship_type TEXT DEFAULT 'owner',
    p_evidence_type TEXT DEFAULT 'manual',
    p_source_system TEXT DEFAULT 'atlas_ui',
    p_confidence NUMERIC DEFAULT 0.8
)
RETURNS UUID AS $$
BEGIN
    RETURN sot.link_person_to_cat(
        p_person_id, p_cat_id, p_relationship_type,
        p_evidence_type, p_source_system, p_confidence
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_person_to_cat IS
'V1 compatibility wrapper - delegates to sot.link_person_to_cat()';

-- link_person_to_place: delegate to sot version
CREATE OR REPLACE FUNCTION trapper.link_person_to_place(
    p_person_id UUID,
    p_place_id UUID,
    p_relationship_type TEXT DEFAULT 'resident',
    p_evidence_type TEXT DEFAULT 'manual',
    p_source_system TEXT DEFAULT 'atlas_ui',
    p_confidence NUMERIC DEFAULT 0.8
)
RETURNS UUID AS $$
BEGIN
    RETURN sot.link_person_to_place(
        p_person_id, p_place_id, p_relationship_type,
        p_evidence_type, p_source_system, p_confidence
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_person_to_place IS
'V1 compatibility wrapper - delegates to sot.link_person_to_place()';

\echo '   Created entity linking function wrappers'

-- ============================================================================
-- 7. REQUEST FUNCTIONS
-- ============================================================================

\echo ''
\echo '7. Creating request function wrappers...'

-- find_or_create_request: delegate to ops version (if exists) or create pass-through
-- Note: requests live in ops schema in V2
CREATE OR REPLACE FUNCTION trapper.find_or_create_request(
    p_source_system TEXT,
    p_source_record_id TEXT,
    p_source_created_at TIMESTAMPTZ DEFAULT NULL,
    p_place_id UUID DEFAULT NULL,
    p_requester_person_id UUID DEFAULT NULL,
    p_summary TEXT DEFAULT NULL,
    p_status TEXT DEFAULT 'new',
    p_priority TEXT DEFAULT 'normal'
)
RETURNS UUID AS $$
DECLARE
    v_request_id UUID;
BEGIN
    -- Check if request exists by source
    SELECT request_id INTO v_request_id
    FROM ops.requests
    WHERE source_system = p_source_system
      AND source_record_id = p_source_record_id
    LIMIT 1;

    IF v_request_id IS NOT NULL THEN
        RETURN v_request_id;
    END IF;

    -- Create new request in ops schema
    INSERT INTO ops.requests (
        source_system, source_record_id, source_created_at,
        place_id, requester_person_id, summary, status, priority
    ) VALUES (
        p_source_system, p_source_record_id, p_source_created_at,
        p_place_id, p_requester_person_id, p_summary, p_status, p_priority
    )
    RETURNING request_id INTO v_request_id;

    RETURN v_request_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_request IS
'V1 compatibility wrapper - writes to ops.requests table';

\echo '   Created request function wrappers'

-- ============================================================================
-- 8. PLACE UTILITY FUNCTIONS
-- ============================================================================

\echo ''
\echo '8. Creating place utility function wrappers...'

-- get_place_family: delegate to sot version
CREATE OR REPLACE FUNCTION trapper.get_place_family(p_place_id UUID)
RETURNS UUID[] AS $$
BEGIN
    RETURN sot.get_place_family(p_place_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.get_place_family IS
'V1 compatibility wrapper - delegates to sot.get_place_family()';

\echo '   Created place utility function wrappers'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Wrapper functions created:'

SELECT
    routine_schema || '.' || routine_name AS function_name,
    SUBSTRING(obj_description((routine_schema || '.' || routine_name || '(' ||
        COALESCE((
            SELECT STRING_AGG(data_type, ', ' ORDER BY ordinal_position)
            FROM information_schema.parameters p2
            WHERE p2.specific_schema = p.specific_schema
              AND p2.specific_name = p.specific_name
              AND p2.parameter_mode = 'IN'
        ), '')
    || ')')::regprocedure::oid, 'pg_proc') FOR 50) AS comment_preview
FROM information_schema.routines
JOIN (
    SELECT DISTINCT specific_schema, specific_name
    FROM information_schema.parameters
) p USING (specific_schema, specific_name)
WHERE routine_schema = 'trapper'
  AND routine_type = 'FUNCTION'
  AND routine_name IN (
    'find_or_create_person',
    'find_or_create_place_deduped',
    'find_or_create_cat_by_microchip',
    'find_or_create_request',
    'data_engine_resolve_identity',
    'norm_phone_us',
    'norm_email',
    'normalize_address',
    'should_be_person',
    'classify_owner_name',
    'is_organization_name',
    'is_valid_person_name',
    'link_cat_to_place',
    'link_person_to_cat',
    'link_person_to_place',
    'get_place_family'
  )
ORDER BY routine_name;

\echo ''
\echo '=============================================='
\echo '  MIG_2090 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created V1 compatibility wrappers that delegate to V2 implementations:'
\echo '  - Identity: find_or_create_person, data_engine_resolve_identity'
\echo '  - Place: find_or_create_place_deduped, get_place_family'
\echo '  - Cat: find_or_create_cat_by_microchip'
\echo '  - Request: find_or_create_request'
\echo '  - Normalization: norm_phone_us, norm_email, normalize_address'
\echo '  - Classification: should_be_person, classify_owner_name, is_organization_name'
\echo '  - Entity Linking: link_cat_to_place, link_person_to_cat, link_person_to_place'
\echo ''
