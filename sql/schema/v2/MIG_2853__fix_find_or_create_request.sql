-- MIG_2853__fix_find_or_create_request.sql
-- Date: 2026-03-06
--
-- PROBLEM: ops.handoff_request() (MIG_2503) calls ops.find_or_create_request()
-- with 18 named params (email, phone, name, notes, cat count, kittens, etc.)
-- but ops.find_or_create_request() (MIG_2202) only accepts 8 params:
--   (source_system, source_record_id, source_created_at, place_id,
--    requester_person_id, summary, status, priority)
--
-- The "Create New Request" handoff path fails at runtime with a
-- function signature mismatch error.
--
-- SOLUTION: DROP + CREATE ops.find_or_create_request() with additional DEFAULT
-- params to match what ops.handoff_request() passes. All new params have defaults
-- so existing 8-param callers continue working unchanged.
--
-- Fixes FFS-271
--
-- Run: psql "$DATABASE_URL" -f sql/schema/v2/MIG_2853__fix_find_or_create_request.sql

\echo ''
\echo '=============================================='
\echo '  MIG_2853: Fix find_or_create_request'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. DROP EXISTING FUNCTION (required because adding params changes signature)
-- ============================================================================

\echo '1. Dropping existing ops.find_or_create_request...'

DROP FUNCTION IF EXISTS ops.find_or_create_request(text, text, timestamptz, uuid, uuid, text, text, text);

-- ============================================================================
-- 2. CREATE EXTENDED FUNCTION
-- ============================================================================

\echo '2. Creating extended ops.find_or_create_request...'

CREATE OR REPLACE FUNCTION ops.find_or_create_request(
    p_source_system text,
    p_source_record_id text,
    p_source_created_at timestamptz DEFAULT NULL,
    p_place_id uuid DEFAULT NULL,
    p_requester_person_id uuid DEFAULT NULL,
    p_summary text DEFAULT NULL,
    p_status text DEFAULT 'new',
    p_priority text DEFAULT 'normal',
    -- Extended params for handoff flow (all have defaults for backward compat)
    p_requester_email text DEFAULT NULL,
    p_requester_phone text DEFAULT NULL,
    p_requester_name text DEFAULT NULL,
    p_notes text DEFAULT NULL,
    p_estimated_cat_count int DEFAULT NULL,
    p_has_kittens boolean DEFAULT FALSE,
    p_kitten_count int DEFAULT NULL,
    p_kitten_age_weeks int DEFAULT NULL,
    p_kitten_assessment_status text DEFAULT NULL,
    p_kitten_assessment_outcome text DEFAULT NULL,
    p_kitten_not_needed_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
    v_request_id UUID;
    v_person_id UUID;
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

    -- If no person_id provided but email/phone given, resolve via Data Engine
    v_person_id := p_requester_person_id;
    IF v_person_id IS NULL AND (p_requester_email IS NOT NULL OR p_requester_phone IS NOT NULL) THEN
        v_person_id := sot.find_or_create_person(
            p_email := p_requester_email,
            p_phone := p_requester_phone,
            p_first_name := split_part(COALESCE(p_requester_name, ''), ', ', 2),
            p_last_name := split_part(COALESCE(p_requester_name, ''), ', ', 1),
            p_source_system := p_source_system
        );
    END IF;

    -- Create new request
    INSERT INTO ops.requests (
        source_system, source_record_id, source_created_at,
        place_id, requester_person_id, summary, status, priority,
        notes, estimated_cat_count, has_kittens,
        kitten_count, kitten_age_weeks,
        kitten_assessment_status, kitten_assessment_outcome,
        kitten_not_needed_reason
    ) VALUES (
        p_source_system, p_source_record_id, p_source_created_at,
        p_place_id, v_person_id, p_summary, p_status, p_priority,
        p_notes, p_estimated_cat_count, p_has_kittens,
        p_kitten_count, p_kitten_age_weeks,
        p_kitten_assessment_status, p_kitten_assessment_outcome,
        p_kitten_not_needed_reason
    )
    RETURNING request_id INTO v_request_id;

    RETURN v_request_id;
END;
$$;

COMMENT ON FUNCTION ops.find_or_create_request IS
'Find or create a request by source_system + source_record_id.
Returns existing request_id if found, creates new one otherwise.

Extended in MIG_2853 with additional DEFAULT params for handoff flow:
email, phone, name, notes, cat count, kitten fields.
When email/phone provided without person_id, resolves via Data Engine.
All new params have defaults so existing callers work unchanged.';

-- ============================================================================
-- 3. UPDATE TRAPPER WRAPPER
-- ============================================================================

\echo '3. Updating trapper.find_or_create_request wrapper (if schema exists)...'

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'trapper') THEN
    EXECUTE 'DROP FUNCTION IF EXISTS trapper.find_or_create_request(text, text, timestamptz, uuid, uuid, text, text, text)';

    EXECUTE $func$
    CREATE OR REPLACE FUNCTION trapper.find_or_create_request(
        p_source_system text,
        p_source_record_id text,
        p_source_created_at timestamptz DEFAULT NULL,
        p_place_id uuid DEFAULT NULL,
        p_requester_person_id uuid DEFAULT NULL,
        p_summary text DEFAULT NULL,
        p_status text DEFAULT 'new',
        p_priority text DEFAULT 'normal',
        p_requester_email text DEFAULT NULL,
        p_requester_phone text DEFAULT NULL,
        p_requester_name text DEFAULT NULL,
        p_notes text DEFAULT NULL,
        p_estimated_cat_count int DEFAULT NULL,
        p_has_kittens boolean DEFAULT FALSE,
        p_kitten_count int DEFAULT NULL,
        p_kitten_age_weeks int DEFAULT NULL,
        p_kitten_assessment_status text DEFAULT NULL,
        p_kitten_assessment_outcome text DEFAULT NULL,
        p_kitten_not_needed_reason text DEFAULT NULL
    )
    RETURNS uuid
    LANGUAGE plpgsql
    AS $inner$
    BEGIN
        RETURN ops.find_or_create_request(
            p_source_system, p_source_record_id, p_source_created_at,
            p_place_id, p_requester_person_id, p_summary, p_status, p_priority,
            p_requester_email, p_requester_phone, p_requester_name,
            p_notes, p_estimated_cat_count, p_has_kittens,
            p_kitten_count, p_kitten_age_weeks,
            p_kitten_assessment_status, p_kitten_assessment_outcome,
            p_kitten_not_needed_reason
        );
    END;
    $inner$;
    $func$;
    RAISE NOTICE 'Updated trapper.find_or_create_request wrapper';
  ELSE
    RAISE NOTICE 'trapper schema does not exist, skipping wrapper';
  END IF;
END $$;

\echo '   Trapper wrapper handled'

-- ============================================================================
-- 4. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

-- Verify function exists with correct param count
DO $$
DECLARE
    v_param_count INT;
BEGIN
    SELECT pronargs INTO v_param_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'ops' AND p.proname = 'find_or_create_request';

    IF v_param_count = 19 THEN
        RAISE NOTICE 'ops.find_or_create_request: % params (CORRECT)', v_param_count;
    ELSE
        RAISE WARNING 'ops.find_or_create_request: % params (EXPECTED 19)', v_param_count;
    END IF;
END $$;

-- Verify trapper wrapper exists
DO $$
DECLARE
    v_param_count INT;
BEGIN
    SELECT pronargs INTO v_param_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'trapper' AND p.proname = 'find_or_create_request';

    IF v_param_count = 19 THEN
        RAISE NOTICE 'trapper.find_or_create_request: % params (CORRECT)', v_param_count;
    ELSE
        RAISE WARNING 'trapper.find_or_create_request: % params (EXPECTED 19)', v_param_count;
    END IF;
END $$;

\echo ''
\echo '=============================================='
\echo '  MIG_2853 Complete'
\echo '=============================================='
\echo ''
\echo 'Fixed ops.find_or_create_request() signature to accept extended params.'
\echo 'The "Create New Request" handoff path will now work correctly.'
\echo ''
\echo 'New params (all have defaults for backward compat):'
\echo '  p_requester_email, p_requester_phone, p_requester_name,'
\echo '  p_notes, p_estimated_cat_count, p_has_kittens,'
\echo '  p_kitten_count, p_kitten_age_weeks,'
\echo '  p_kitten_assessment_status, p_kitten_assessment_outcome,'
\echo '  p_kitten_not_needed_reason'
\echo ''
