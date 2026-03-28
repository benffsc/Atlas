-- MIG_3004: Fix missing ops.get_config_value function
-- FFS-935: data_engine_resolve_identity references ops.get_config_value() which doesn't exist
--
-- Root cause: MIG_2990 introduced a call to ops.get_config_value() in data_engine_resolve_identity
-- but only ops.get_config(text, jsonb) and ops.get_config_numeric(text, numeric) exist.
-- This broke sot.find_or_create_person() — all identity resolution via the centralized function
-- has been silently failing since MIG_2990.
--
-- Fix: Create ops.get_config_value(text, text) as a text-returning wrapper around ops.get_config.
-- This is the expected companion to get_config (jsonb) and get_config_numeric (numeric).

BEGIN;

-- Create the text-returning config helper
CREATE OR REPLACE FUNCTION ops.get_config_value(p_key text, p_default text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        (SELECT value #>> '{}' FROM ops.app_config WHERE key = p_key),
        p_default
    );
$$;

COMMENT ON FUNCTION ops.get_config_value(text, text)
IS 'FFS-935: Returns app_config value as text. Companion to get_config (jsonb) and get_config_numeric (numeric).';

-- Verify the fix: data_engine_resolve_identity should not error
DO $$
DECLARE
    v_result RECORD;
BEGIN
    SELECT * INTO v_result
    FROM sot.data_engine_resolve_identity(
        'test-fix-935@example.com', NULL, 'Verification', 'Test', NULL, 'atlas_ui'
    );

    IF v_result.decision_type IS NULL THEN
        RAISE EXCEPTION 'data_engine_resolve_identity returned NULL decision_type';
    END IF;

    RAISE NOTICE 'FFS-935 fix verified: data_engine_resolve_identity returned decision_type=%', v_result.decision_type;

    -- Clean up: remove the test match_decision
    DELETE FROM sot.match_decisions WHERE decision_id = v_result.decision_id;
END $$;

COMMIT;
