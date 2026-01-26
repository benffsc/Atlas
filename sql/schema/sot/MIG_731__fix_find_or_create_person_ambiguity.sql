\echo '=== MIG_731: Fix find_or_create_person function ambiguity ==='

-- The data_engine_resolve_identity has two overloaded versions (6-arg and 8-arg)
-- Both have defaults, causing ambiguity when called positionally.
-- Fix: Drop the 6-arg version and update callers to use the 8-arg version with NULL for extra params

-- First, drop the 6-arg version
DROP FUNCTION IF EXISTS trapper.data_engine_resolve_identity(text, text, text, text, text, text);

-- Update find_or_create_person to use 8-arg version with explicit NULLs
CREATE OR REPLACE FUNCTION trapper.find_or_create_person(
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'atlas_ui'
)
RETURNS UUID AS $$
DECLARE
    v_result RECORD;
BEGIN
    -- Use Data Engine for identity resolution (8-arg version with NULL for staged_record_id and job_id)
    SELECT * INTO v_result
    FROM trapper.data_engine_resolve_identity(
        p_email,
        p_phone,
        p_first_name,
        p_last_name,
        p_address,
        p_source_system,
        NULL::UUID,  -- p_staged_record_id
        NULL::UUID   -- p_job_id
    );

    RETURN v_result.person_id;
END;
$$ LANGUAGE plpgsql;

-- Also update unified_find_or_create_person if it exists
CREATE OR REPLACE FUNCTION trapper.unified_find_or_create_person(
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'atlas_ui'
)
RETURNS UUID AS $$
DECLARE
    v_result RECORD;
BEGIN
    SELECT * INTO v_result
    FROM trapper.data_engine_resolve_identity(
        p_email,
        p_phone,
        p_first_name,
        p_last_name,
        p_address,
        p_source_system,
        NULL::UUID,
        NULL::UUID
    );

    RETURN v_result.person_id;
END;
$$ LANGUAGE plpgsql;

\echo 'Fixed find_or_create_person function ambiguity by removing duplicate 6-arg version'
