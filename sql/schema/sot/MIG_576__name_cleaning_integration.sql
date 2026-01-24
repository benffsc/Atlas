\echo '=== MIG_576: Name Cleaning Integration ==='
\echo 'Integrates name cleaning into Data Engine and cat creation to prevent garbage names on import'

-- ============================================================================
-- PART 1: Update Data Engine to clean names before processing
-- ============================================================================

\echo 'Updating data_engine_resolve_identity with name cleaning...'

-- Drop old 6-param version if exists
DROP FUNCTION IF EXISTS trapper.data_engine_resolve_identity(text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION trapper.data_engine_resolve_identity(
    p_email text DEFAULT NULL,
    p_phone text DEFAULT NULL,
    p_first_name text DEFAULT NULL,
    p_last_name text DEFAULT NULL,
    p_address text DEFAULT NULL,
    p_source_system text DEFAULT 'unknown',
    p_staged_record_id uuid DEFAULT NULL,
    p_job_id uuid DEFAULT NULL
)
RETURNS TABLE(person_id uuid, decision_type text, confidence_score numeric, household_id uuid, decision_id uuid)
LANGUAGE plpgsql
AS $function$
DECLARE
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_first_clean TEXT;
    v_last_clean TEXT;
    v_display_name TEXT;
    v_address_norm TEXT;
    v_decision_type TEXT;
    v_decision_reason TEXT;
    v_new_person_id UUID;
    v_household_id UUID;
    v_decision_id UUID;
    v_start_time TIMESTAMPTZ;
    v_email_match RECORD;
BEGIN
    v_start_time := clock_timestamp();

    v_email_norm := trapper.norm_email(p_email);
    v_phone_norm := trapper.norm_phone_us(p_phone);

    -- CRITICAL: Clean names to remove microchips and garbage patterns
    v_first_clean := trapper.clean_person_name(p_first_name);
    v_last_clean := trapper.clean_person_name(p_last_name);

    v_display_name := TRIM(CONCAT_WS(' ',
        NULLIF(v_first_clean, ''),
        NULLIF(v_last_clean, '')
    ));
    v_address_norm := trapper.normalize_address(COALESCE(p_address, ''));

    -- Early rejection: internal accounts
    IF trapper.is_internal_account(v_display_name) THEN
        v_decision_type := 'rejected';
        v_decision_reason := 'Internal account detected';
        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            decision_type, decision_reason, processing_job_id, processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, 0,
            v_decision_type, v_decision_reason, p_job_id,
            EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;
        RETURN QUERY SELECT NULL::UUID, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id;
        RETURN;
    END IF;

    -- Early rejection: no identifiers
    IF v_email_norm IS NULL AND v_phone_norm IS NULL THEN
        v_decision_type := 'rejected';
        v_decision_reason := 'No email or phone provided';
        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            decision_type, decision_reason, processing_job_id, processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, 0,
            v_decision_type, v_decision_reason, p_job_id,
            EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;
        RETURN QUERY SELECT NULL::UUID, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id;
        RETURN;
    END IF;

    -- Priority 0: Exact email match (exact_email_only rule)
    IF v_email_norm IS NOT NULL THEN
        SELECT p.person_id, p.display_name INTO v_email_match
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'email' AND pi.id_value_norm = v_email_norm
        AND p.merged_into_person_id IS NULL LIMIT 1;

        IF v_email_match.person_id IS NOT NULL THEN
            v_decision_type := 'auto_match';
            v_decision_reason := 'Exact email match (exact_email_only rule)';
            -- Update garbage name if we have a better one
            IF trapper.is_garbage_name(v_email_match.display_name)
               AND NOT trapper.is_garbage_name(v_display_name)
               AND v_display_name IS NOT NULL AND v_display_name != '' THEN
                UPDATE trapper.sot_people SET display_name = v_display_name, updated_at = NOW()
                WHERE sot_people.person_id = v_email_match.person_id;
            END IF;
            -- Add phone if provided
            IF v_phone_norm IS NOT NULL THEN
                INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system)
                VALUES (v_email_match.person_id, 'phone', v_phone_norm, v_phone_norm, p_source_system)
                ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;
            END IF;
            INSERT INTO trapper.data_engine_match_decisions (
                staged_record_id, source_system, incoming_email, incoming_phone,
                incoming_name, incoming_address, candidates_evaluated,
                decision_type, decision_reason, resulting_person_id, top_candidate_score,
                processing_job_id, processing_duration_ms
            ) VALUES (
                p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                v_display_name, v_address_norm, 1,
                v_decision_type, v_decision_reason, v_email_match.person_id, 1.0,
                p_job_id, EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT
            ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;
            RETURN QUERY SELECT v_email_match.person_id, v_decision_type, 1.0::NUMERIC, NULL::UUID, v_decision_id;
            RETURN;
        END IF;
    END IF;

    -- Priority 1: Exact phone match (exact_phone_only rule)
    IF v_phone_norm IS NOT NULL THEN
        SELECT p.person_id, p.display_name INTO v_email_match
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'phone' AND pi.id_value_norm = v_phone_norm
        AND p.merged_into_person_id IS NULL LIMIT 1;

        IF v_email_match.person_id IS NOT NULL THEN
            v_decision_type := 'auto_match';
            v_decision_reason := 'Exact phone match (exact_phone_only rule)';
            IF trapper.is_garbage_name(v_email_match.display_name)
               AND NOT trapper.is_garbage_name(v_display_name)
               AND v_display_name IS NOT NULL AND v_display_name != '' THEN
                UPDATE trapper.sot_people SET display_name = v_display_name, updated_at = NOW()
                WHERE sot_people.person_id = v_email_match.person_id;
            END IF;
            IF v_email_norm IS NOT NULL THEN
                INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system)
                VALUES (v_email_match.person_id, 'email', v_email_norm, v_email_norm, p_source_system)
                ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;
            END IF;
            INSERT INTO trapper.data_engine_match_decisions (
                staged_record_id, source_system, incoming_email, incoming_phone,
                incoming_name, incoming_address, candidates_evaluated,
                decision_type, decision_reason, resulting_person_id, top_candidate_score,
                processing_job_id, processing_duration_ms
            ) VALUES (
                p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                v_display_name, v_address_norm, 1,
                v_decision_type, v_decision_reason, v_email_match.person_id, 1.0,
                p_job_id, EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT
            ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;
            RETURN QUERY SELECT v_email_match.person_id, v_decision_type, 1.0::NUMERIC, NULL::UUID, v_decision_id;
            RETURN;
        END IF;
    END IF;

    -- No match - create new person with CLEAN name
    v_decision_type := 'new_entity';
    v_decision_reason := 'No matching email or phone found';
    INSERT INTO trapper.sot_people (display_name, primary_email, primary_phone, data_source)
    VALUES (COALESCE(NULLIF(v_display_name, ''), 'Unknown'), v_email_norm, v_phone_norm,
            p_source_system::trapper.data_source)
    RETURNING sot_people.person_id INTO v_new_person_id;

    IF v_email_norm IS NOT NULL THEN
        INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system)
        VALUES (v_new_person_id, 'email', v_email_norm, v_email_norm, p_source_system)
        ON CONFLICT DO NOTHING;
    END IF;
    IF v_phone_norm IS NOT NULL THEN
        INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system)
        VALUES (v_new_person_id, 'phone', v_phone_norm, v_phone_norm, p_source_system)
        ON CONFLICT DO NOTHING;
    END IF;

    INSERT INTO trapper.data_engine_match_decisions (
        staged_record_id, source_system, incoming_email, incoming_phone,
        incoming_name, incoming_address, candidates_evaluated,
        decision_type, decision_reason, resulting_person_id, top_candidate_score,
        processing_job_id, processing_duration_ms
    ) VALUES (
        p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
        v_display_name, v_address_norm, 0,
        v_decision_type, v_decision_reason, v_new_person_id, 0,
        p_job_id, EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT
    ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

    RETURN QUERY SELECT v_new_person_id, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id;
END;
$function$;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity(text, text, text, text, text, text, uuid, uuid) IS
'Main identity resolution function. Cleans names using clean_person_name() to remove microchips
and garbage patterns before matching. Matches on exact email (priority 0) or exact phone (priority 1).
Updated in MIG_576 to prevent duplicate creation from bad source data.';

-- ============================================================================
-- PART 2: Update cat creation to clean names
-- ============================================================================

\echo 'Updating find_or_create_cat_by_microchip with name cleaning...'

CREATE OR REPLACE FUNCTION trapper.find_or_create_cat_by_microchip(
    p_microchip text,
    p_name text DEFAULT NULL,
    p_sex text DEFAULT NULL,
    p_breed text DEFAULT NULL,
    p_altered_status text DEFAULT NULL,
    p_primary_color text DEFAULT NULL,
    p_secondary_color text DEFAULT NULL,
    p_ownership_type text DEFAULT NULL,
    p_source_system text DEFAULT 'clinichq'
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
    v_cat_id UUID;
    v_microchip TEXT;
    v_clean_name TEXT;
BEGIN
    v_microchip := TRIM(p_microchip);

    IF v_microchip IS NULL OR LENGTH(v_microchip) < 9 THEN
        RETURN NULL;
    END IF;

    -- Clean the name to remove microchips and garbage patterns
    v_clean_name := trapper.clean_cat_name(p_name);
    IF v_clean_name IS NULL OR v_clean_name = '' THEN
        v_clean_name := 'Unknown';  -- Never put microchip in name
    END IF;

    -- Find existing cat by microchip
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    WHERE ci.id_type = 'microchip' AND ci.id_value = v_microchip;

    IF v_cat_id IS NOT NULL THEN
        -- Update with new info, clean garbage names
        UPDATE trapper.sot_cats SET
            display_name = CASE
                WHEN display_name ~ '[0-9]{9,}' OR display_name ~* '^unknown\s*\(' THEN v_clean_name
                ELSE COALESCE(display_name, v_clean_name)
            END,
            sex = COALESCE(sex, p_sex),
            breed = COALESCE(breed, p_breed),
            altered_status = COALESCE(altered_status, p_altered_status),
            primary_color = COALESCE(primary_color, p_primary_color),
            secondary_color = COALESCE(secondary_color, p_secondary_color),
            ownership_type = COALESCE(ownership_type, p_ownership_type),
            data_source = 'clinichq',
            updated_at = NOW()
        WHERE cat_id = v_cat_id;

        RETURN v_cat_id;
    END IF;

    -- Create new cat with clean name
    INSERT INTO trapper.sot_cats (
        display_name, sex, breed, altered_status,
        primary_color, secondary_color, ownership_type,
        data_source, needs_microchip
    ) VALUES (
        v_clean_name,
        p_sex, p_breed, p_altered_status,
        p_primary_color, p_secondary_color, p_ownership_type,
        'clinichq', FALSE
    )
    RETURNING cat_id INTO v_cat_id;

    INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
    VALUES (v_cat_id, 'microchip', v_microchip, p_source_system, 'unified_rebuild');

    RETURN v_cat_id;
END;
$function$;

COMMENT ON FUNCTION trapper.find_or_create_cat_by_microchip IS
'Creates or finds a cat by microchip. Uses clean_cat_name() to strip microchips and garbage
from names. Never creates cats with microchip numbers embedded in display_name.
Updated in MIG_576 to prevent garbage names on import.';

-- ============================================================================
-- PART 3: Verification tests
-- ============================================================================

\echo ''
\echo '=== Verification Tests ==='

\echo 'Test 1: Person name cleaning in Data Engine'
SELECT
    'Joan 900085001746221' as input_name,
    trapper.clean_person_name('Joan 900085001746221') as cleaned,
    'Joan' as expected;

\echo 'Test 2: Cat name cleaning'
SELECT
    'Cat-981020053212687' as input_name,
    trapper.clean_cat_name('Cat-981020053212687') as cleaned,
    'Unknown' as expected;

\echo 'Test 3: Med Hold pattern cleaning'
SELECT
    'Med Holding: Black DSH- Noonan' as input_name,
    trapper.clean_cat_name('Med Holding: Black DSH- Noonan') as cleaned,
    'Black DSH- Noonan' as expected;

\echo ''
\echo 'MIG_576 complete: Name cleaning integrated into processing pipeline'
\echo 'Defense layers now active:'
\echo '  1. data_engine_resolve_identity() - cleans person names on every import'
\echo '  2. find_or_create_cat_by_microchip() - cleans cat names on every import'
\echo '  3. is_garbage_name() - rejects names with microchip patterns'
\echo '  4. exact_email_only + exact_phone_only rules - match regardless of name'
