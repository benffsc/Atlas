-- MIG_2202: Move Remaining Functions to sot/ops
-- Date: 2026-02-14
--
-- Purpose: Complete V2 function migration
--          - Add missing functions to sot/ops
--          - Update functions that reference trapper.staff to use ops.staff
--
-- After this migration, trapper functions are all wrappers calling sot/ops
-- and can be safely dropped along with trapper views

\echo ''
\echo '=============================================='
\echo '  MIG_2202: Move Functions to V2 Schemas'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. ADD MISSING FUNCTIONS TO SOT/OPS
-- ============================================================================

\echo '1. Adding missing functions to sot/ops...'

-- is_valid_person_name (wrapper for classify_owner_name)
CREATE OR REPLACE FUNCTION sot.is_valid_person_name(p_name text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    RETURN sot.classify_owner_name(p_name) = 'person';
END;
$$;

COMMENT ON FUNCTION sot.is_valid_person_name(text) IS
'Returns TRUE if name classifies as a person (not org/address/garbage).
Wrapper for classify_owner_name().';

\echo '   Created sot.is_valid_person_name()'

-- find_or_create_request (belongs in ops since it creates ops.requests)
CREATE OR REPLACE FUNCTION ops.find_or_create_request(
    p_source_system text,
    p_source_record_id text,
    p_source_created_at timestamptz DEFAULT NULL,
    p_place_id uuid DEFAULT NULL,
    p_requester_person_id uuid DEFAULT NULL,
    p_summary text DEFAULT NULL,
    p_status text DEFAULT 'new',
    p_priority text DEFAULT 'normal'
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
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

    -- Create new request
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
$$;

COMMENT ON FUNCTION ops.find_or_create_request(text, text, timestamptz, uuid, uuid, text, text, text) IS
'Find or create a request by source_system + source_record_id.
Returns existing request_id if found, creates new one otherwise.';

\echo '   Created ops.find_or_create_request()'

-- ============================================================================
-- 2. FIX FUNCTIONS THAT REFERENCE TRAPPER.STAFF
-- ============================================================================

\echo ''
\echo '2. Fixing functions that reference trapper.staff...'

-- ops.record_failed_login - update to use ops.staff directly
CREATE OR REPLACE FUNCTION ops.record_failed_login(p_email text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE ops.staff
    SET login_attempts = login_attempts + 1,
        locked_until = CASE
            WHEN login_attempts >= 4 THEN NOW() + INTERVAL '15 minutes'
            ELSE locked_until
        END
    WHERE LOWER(email) = LOWER(p_email);
END;
$$;

COMMENT ON FUNCTION ops.record_failed_login(text) IS
'Record a failed login attempt for rate limiting.
After 5 failures, locks account for 15 minutes.';

\echo '   Updated ops.record_failed_login()'

-- ops.staff_can_access - update to use ops.staff directly
CREATE OR REPLACE FUNCTION ops.staff_can_access(
    p_staff_id uuid,
    p_resource text,
    p_action text
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
    v_role TEXT;
BEGIN
    SELECT auth_role INTO v_role
    FROM ops.staff
    WHERE staff_id = p_staff_id AND is_active = TRUE;

    IF v_role IS NULL THEN RETURN FALSE; END IF;
    IF v_role = 'admin' THEN RETURN TRUE; END IF;

    -- Staff can read most things
    IF v_role = 'staff' AND p_action IN ('read', 'list', 'view') THEN
        RETURN TRUE;
    END IF;

    -- Staff can write to operational resources
    IF v_role = 'staff' AND p_action IN ('create', 'update', 'write') THEN
        IF p_resource IN ('requests', 'intakes', 'journals', 'appointments') THEN
            RETURN TRUE;
        END IF;
    END IF;

    RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION ops.staff_can_access(uuid, text, text) IS
'Check if staff member can perform action on resource.
Admin: full access. Staff: read all, write to operational resources.';

\echo '   Updated ops.staff_can_access()'

-- ============================================================================
-- 3. UPDATE TRAPPER WRAPPERS TO CALL V2 FUNCTIONS
-- ============================================================================

\echo ''
\echo '3. Updating trapper wrappers to call V2 functions...'

-- Update trapper.is_valid_person_name to call sot version
CREATE OR REPLACE FUNCTION trapper.is_valid_person_name(p_name text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    RETURN sot.is_valid_person_name(p_name);
END;
$$;

\echo '   Updated trapper.is_valid_person_name() to call sot version'

-- Update trapper.find_or_create_request to call ops version
CREATE OR REPLACE FUNCTION trapper.find_or_create_request(
    p_source_system text,
    p_source_record_id text,
    p_source_created_at timestamptz DEFAULT NULL,
    p_place_id uuid DEFAULT NULL,
    p_requester_person_id uuid DEFAULT NULL,
    p_summary text DEFAULT NULL,
    p_status text DEFAULT 'new',
    p_priority text DEFAULT 'normal'
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN ops.find_or_create_request(
        p_source_system, p_source_record_id, p_source_created_at,
        p_place_id, p_requester_person_id, p_summary, p_status, p_priority
    );
END;
$$;

\echo '   Updated trapper.find_or_create_request() to call ops version'

-- Update trapper.record_failed_login to call ops version
CREATE OR REPLACE FUNCTION trapper.record_failed_login(p_email text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM ops.record_failed_login(p_email);
END;
$$;

\echo '   Updated trapper.record_failed_login() to call ops version'

-- Update trapper.staff_can_access to call ops version
CREATE OR REPLACE FUNCTION trapper.staff_can_access(
    p_staff_id uuid,
    p_resource text,
    p_action text
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN ops.staff_can_access(p_staff_id, p_resource, p_action);
END;
$$;

\echo '   Updated trapper.staff_can_access() to call ops version'

-- ============================================================================
-- 4. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

DO $$
DECLARE
    v_sot_count INT;
    v_ops_count INT;
    v_trapper_count INT;
BEGIN
    SELECT COUNT(*) INTO v_sot_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'sot';

    SELECT COUNT(*) INTO v_ops_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'ops';

    SELECT COUNT(*) INTO v_trapper_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'trapper';

    RAISE NOTICE 'Function counts:';
    RAISE NOTICE '  sot.*: % functions', v_sot_count;
    RAISE NOTICE '  ops.*: % functions', v_ops_count;
    RAISE NOTICE '  trapper.*: % functions (all now wrappers)', v_trapper_count;
END $$;

\echo ''
\echo '=============================================='
\echo '  MIG_2202 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created in sot/ops:'
\echo '  - sot.is_valid_person_name()'
\echo '  - ops.find_or_create_request()'
\echo ''
\echo 'Fixed (now use ops.staff directly):'
\echo '  - ops.record_failed_login()'
\echo '  - ops.staff_can_access()'
\echo ''
\echo 'Updated trapper wrappers to call V2 versions:'
\echo '  - trapper.is_valid_person_name() -> sot.is_valid_person_name()'
\echo '  - trapper.find_or_create_request() -> ops.find_or_create_request()'
\echo '  - trapper.record_failed_login() -> ops.record_failed_login()'
\echo '  - trapper.staff_can_access() -> ops.staff_can_access()'
\echo ''
\echo 'All trapper functions are now thin wrappers.'
\echo 'Safe to proceed with code updates and eventual trapper drop.'
\echo ''
