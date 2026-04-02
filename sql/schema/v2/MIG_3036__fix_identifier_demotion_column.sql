-- MIG_3036: Fix identifier_demotion_factor column name mismatch
--
-- Root cause: sot.identifier_demotion_factor() referenced
-- sot.data_engine_soft_blacklist.identifier_value which doesn't exist.
-- The actual column is identifier_norm (renamed in a prior migration).
-- This broke the entire owner_info processing pipeline:
--   find_or_create_person → data_engine_resolve_identity →
--   data_engine_score_candidates → identifier_demotion_factor → BOOM

CREATE OR REPLACE FUNCTION sot.identifier_demotion_factor(p_id_type text, p_id_value_norm text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
    v_is_proxy BOOLEAN;
    v_proxy_multiplier NUMERIC;
BEGIN
    IF p_id_value_norm IS NULL OR p_id_value_norm = '' THEN
        RETURN 1.0;
    END IF;

    -- Check if identifier is flagged as proxy (MIG_3027)
    SELECT COALESCE(is_proxy, FALSE) INTO v_is_proxy
    FROM sot.person_identifiers
    WHERE id_type = p_id_type AND id_value_norm = p_id_value_norm;

    IF NOT FOUND THEN
        RETURN 1.0;
    END IF;

    IF v_is_proxy THEN
        SELECT COALESCE(value::numeric, 0.5) INTO v_proxy_multiplier
        FROM ops.app_config WHERE key = 'identity.proxy_confidence_multiplier';
        IF v_proxy_multiplier IS NULL THEN v_proxy_multiplier := 0.5; END IF;
        RETURN v_proxy_multiplier;
    END IF;

    -- FIX: column is identifier_norm, not identifier_value
    IF EXISTS (
        SELECT 1 FROM sot.data_engine_soft_blacklist
        WHERE identifier_type = p_id_type AND identifier_norm = p_id_value_norm
    ) THEN
        RETURN 0.05;
    END IF;

    RETURN 1.0;
END;
$function$;
