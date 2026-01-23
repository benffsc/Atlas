\echo ''
\echo '=============================================='
\echo 'MIG_564: Contact Info Update Matching'
\echo '=============================================='
\echo ''
\echo 'Enhances identity resolution to recognize returning people'
\echo 'who have moved or changed phone numbers but kept their email.'
\echo ''
\echo 'Key changes:'
\echo '  - Exact email match + similar name (>=0.6) = same person'
\echo '  - Exact email match + different name (<0.5) = household member'
\echo '  - New phone/address added as additional identifiers'
\echo ''

-- ============================================================================
-- STEP 1: Add is_primary column to person_identifiers
-- ============================================================================

\echo 'Step 1: Adding is_primary column to person_identifiers...'

ALTER TABLE trapper.person_identifiers
ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN trapper.person_identifiers.is_primary IS
'TRUE for current/preferred contact method, FALSE for historical.
When a person updates their phone, old phone is kept with is_primary=FALSE.';

-- ============================================================================
-- STEP 1B: Add 'contact_info_update' to decision_type check constraint
-- ============================================================================

\echo 'Step 1B: Updating decision_type check constraint...'

ALTER TABLE trapper.data_engine_match_decisions
DROP CONSTRAINT IF EXISTS data_engine_match_decisions_decision_type_check;

ALTER TABLE trapper.data_engine_match_decisions
ADD CONSTRAINT data_engine_match_decisions_decision_type_check
CHECK (decision_type IN (
    'auto_match',
    'contact_info_update',  -- NEW: same person with updated contact info
    'review_pending',
    'new_entity',
    'household_member',
    'rejected'
));

-- ============================================================================
-- STEP 2: Create helper function for adding/updating identifiers
-- ============================================================================

\echo 'Step 2: Creating add_person_identifier helper function...'

CREATE OR REPLACE FUNCTION trapper.add_person_identifier(
    p_person_id UUID,
    p_id_type TEXT,
    p_id_value TEXT,
    p_source_system TEXT DEFAULT 'atlas',
    p_make_primary BOOLEAN DEFAULT TRUE
)
RETURNS UUID AS $$
DECLARE
    v_id_value_norm TEXT;
    v_identifier_id UUID;
    v_existing_id UUID;
BEGIN
    -- Normalize the value
    IF p_id_type = 'email' THEN
        v_id_value_norm := trapper.norm_email(p_id_value);
    ELSIF p_id_type = 'phone' THEN
        v_id_value_norm := trapper.norm_phone_us(p_id_value);
    ELSE
        v_id_value_norm := LOWER(TRIM(p_id_value));
    END IF;

    IF v_id_value_norm IS NULL OR v_id_value_norm = '' THEN
        RETURN NULL;
    END IF;

    -- Check if this identifier already exists for this person
    SELECT identifier_id INTO v_existing_id
    FROM trapper.person_identifiers
    WHERE person_id = p_person_id
      AND id_type = p_id_type::trapper.identifier_type
      AND id_value_norm = v_id_value_norm;

    IF v_existing_id IS NOT NULL THEN
        -- Already exists, just update is_primary if needed
        IF p_make_primary THEN
            UPDATE trapper.person_identifiers
            SET is_primary = TRUE
            WHERE identifier_id = v_existing_id;

            -- Demote other identifiers of same type
            UPDATE trapper.person_identifiers
            SET is_primary = FALSE
            WHERE person_id = p_person_id
              AND id_type = p_id_type::trapper.identifier_type
              AND identifier_id != v_existing_id;
        END IF;
        RETURN v_existing_id;
    END IF;

    -- Check if this identifier belongs to another person (conflict)
    SELECT identifier_id INTO v_existing_id
    FROM trapper.person_identifiers
    WHERE id_type = p_id_type::trapper.identifier_type
      AND id_value_norm = v_id_value_norm
      AND person_id != p_person_id;

    IF v_existing_id IS NOT NULL THEN
        -- Identifier belongs to someone else - don't add (avoid conflict)
        RAISE NOTICE 'Identifier % already belongs to another person', v_id_value_norm;
        RETURN NULL;
    END IF;

    -- If making primary, demote existing identifiers of same type
    IF p_make_primary THEN
        UPDATE trapper.person_identifiers
        SET is_primary = FALSE
        WHERE person_id = p_person_id
          AND id_type = p_id_type::trapper.identifier_type;
    END IF;

    -- Insert new identifier
    INSERT INTO trapper.person_identifiers (
        person_id, id_type, id_value_raw, id_value_norm,
        source_system, is_primary
    ) VALUES (
        p_person_id, p_id_type::trapper.identifier_type, p_id_value, v_id_value_norm,
        p_source_system, p_make_primary
    )
    RETURNING identifier_id INTO v_identifier_id;

    RETURN v_identifier_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.add_person_identifier IS
'Adds a new identifier to a person, handling:
- Normalization (email/phone)
- Duplicate detection (same person already has it)
- Conflict prevention (another person has it)
- Primary/historical tracking (demotes old, promotes new)';

-- ============================================================================
-- STEP 3: Update data_engine_resolve_identity with email+name matching
-- ============================================================================

\echo 'Step 3: Updating data_engine_resolve_identity...'

CREATE OR REPLACE FUNCTION trapper.data_engine_resolve_identity(
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'unknown',
    p_staged_record_id UUID DEFAULT NULL,
    p_job_id UUID DEFAULT NULL
)
RETURNS TABLE (
    person_id UUID,
    decision_type TEXT,
    confidence_score NUMERIC,
    household_id UUID,
    decision_id UUID
) AS $$
DECLARE
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_display_name TEXT;
    v_address_norm TEXT;
    v_top_candidate RECORD;
    v_decision_type TEXT;
    v_decision_reason TEXT;
    v_new_person_id UUID;
    v_household_id UUID;
    v_decision_id UUID;
    v_score_breakdown JSONB;
    v_rules_applied JSONB;
    v_candidates_count INT;
    v_start_time TIMESTAMPTZ;
    v_duration_ms INT;
    -- NEW: For email+name matching
    v_email_match RECORD;
    v_name_similarity NUMERIC;
    v_place_id UUID;
BEGIN
    v_start_time := clock_timestamp();

    -- Normalize inputs
    v_email_norm := trapper.norm_email(p_email);
    v_phone_norm := trapper.norm_phone_us(p_phone);
    v_display_name := TRIM(CONCAT_WS(' ',
        NULLIF(TRIM(COALESCE(p_first_name, '')), ''),
        NULLIF(TRIM(COALESCE(p_last_name, '')), '')
    ));
    v_address_norm := trapper.normalize_address(COALESCE(p_address, ''));

    -- Early rejection: internal accounts
    IF trapper.is_internal_account(v_display_name) THEN
        v_decision_type := 'rejected';
        v_decision_reason := 'Internal account detected';

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            decision_type, decision_reason, processing_job_id,
            processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, 0,
            v_decision_type, v_decision_reason, p_job_id,
            EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT NULL::UUID, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id;
        RETURN;
    END IF;

    -- Early rejection: no usable identifiers
    IF v_email_norm IS NULL AND v_phone_norm IS NULL THEN
        v_decision_type := 'rejected';
        v_decision_reason := 'No email or phone provided';

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            decision_type, decision_reason, processing_job_id,
            processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, 0,
            v_decision_type, v_decision_reason, p_job_id,
            EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT NULL::UUID, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id;
        RETURN;
    END IF;

    -- =========================================================================
    -- NEW: SPECIAL CASE - Exact email match with name verification
    -- This handles people who moved/changed phone but kept same email
    -- =========================================================================
    IF v_email_norm IS NOT NULL THEN
        -- Find existing person with this email
        SELECT
            p.person_id,
            p.display_name AS existing_display_name
        INTO v_email_match
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = v_email_norm
          AND p.merged_into_person_id IS NULL
          AND p.is_canonical = TRUE
        LIMIT 1;

        IF v_email_match.person_id IS NOT NULL THEN
            -- Calculate name similarity
            v_name_similarity := trapper.name_similarity(
                v_display_name,
                v_email_match.existing_display_name
            );

            -- High name similarity: Same person with updated contact info
            IF v_name_similarity >= 0.6 THEN
                v_decision_type := 'contact_info_update';
                v_decision_reason := 'Same person - email match with similar name (similarity: ' ||
                                     ROUND(v_name_similarity, 2)::TEXT || ')';

                -- Add new phone if provided and different
                IF v_phone_norm IS NOT NULL THEN
                    PERFORM trapper.add_person_identifier(
                        v_email_match.person_id,
                        'phone',
                        p_phone,
                        p_source_system,
                        TRUE  -- Make primary
                    );
                END IF;

                -- Link to new address if provided
                IF p_address IS NOT NULL AND p_address != '' THEN
                    v_place_id := trapper.find_or_create_place_deduped(
                        p_address,
                        NULL,  -- display_name
                        NULL,  -- lat
                        NULL,  -- lng
                        p_source_system
                    );

                    IF v_place_id IS NOT NULL THEN
                        INSERT INTO trapper.person_place_relationships (
                            person_id, place_id, role, confidence,
                            source_system, source_table
                        ) VALUES (
                            v_email_match.person_id, v_place_id, 'resident', 0.9,
                            p_source_system, 'data_engine_contact_update'
                        )
                        ON CONFLICT ON CONSTRAINT uq_person_place_role DO NOTHING;
                    END IF;
                END IF;

                v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

                v_score_breakdown := jsonb_build_object(
                    'email_score', 1.0,
                    'name_score', v_name_similarity,
                    'phone_score', 0,
                    'address_score', 0,
                    'total_score', 0.96
                );

                INSERT INTO trapper.data_engine_match_decisions (
                    staged_record_id, source_system, incoming_email, incoming_phone,
                    incoming_name, incoming_address, candidates_evaluated,
                    top_candidate_person_id, top_candidate_score, decision_type,
                    decision_reason, resulting_person_id, score_breakdown,
                    rules_applied, processing_job_id, processing_duration_ms
                ) VALUES (
                    p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                    v_display_name, v_address_norm, 1,
                    v_email_match.person_id, 0.96, v_decision_type,
                    v_decision_reason, v_email_match.person_id, v_score_breakdown,
                    '["exact_email_name_match"]'::JSONB, p_job_id, v_duration_ms
                ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

                RETURN QUERY SELECT
                    v_email_match.person_id,
                    v_decision_type,
                    0.96::NUMERIC,
                    NULL::UUID,
                    v_decision_id;
                RETURN;

            -- Low name similarity: Different person sharing email (couple/family)
            ELSIF v_name_similarity < 0.5 THEN
                -- Don't auto-match, let it fall through to household logic
                -- But note: we've found an email match with different name
                RAISE NOTICE 'Email match found but name similarity low (%), routing to household logic',
                    ROUND(v_name_similarity, 2);
            END IF;
            -- Name similarity 0.5-0.6: Ambiguous, fall through to standard scoring
        END IF;
    END IF;

    -- =========================================================================
    -- STANDARD SCORING PATH (unchanged from original)
    -- =========================================================================

    -- Get candidates count
    SELECT COUNT(*) INTO v_candidates_count
    FROM trapper.data_engine_score_candidates(v_email_norm, v_phone_norm, v_display_name, v_address_norm);

    -- Get top candidate
    SELECT * INTO v_top_candidate
    FROM trapper.data_engine_score_candidates(v_email_norm, v_phone_norm, v_display_name, v_address_norm)
    ORDER BY total_score DESC
    LIMIT 1;

    -- Build score breakdown
    IF v_top_candidate.person_id IS NOT NULL THEN
        v_score_breakdown := jsonb_build_object(
            'email_score', v_top_candidate.email_score,
            'phone_score', v_top_candidate.phone_score,
            'name_score', v_top_candidate.name_score,
            'address_score', v_top_candidate.address_score,
            'total_score', v_top_candidate.total_score
        );
        v_rules_applied := to_jsonb(v_top_candidate.matched_rules);
    END IF;

    -- Decision logic based on score and context
    IF v_top_candidate.person_id IS NOT NULL AND v_top_candidate.total_score >= 0.95 THEN
        -- High confidence: auto-match
        v_decision_type := 'auto_match';
        v_decision_reason := 'High confidence match (' || ROUND(v_top_candidate.total_score, 2)::TEXT || ') to ' || COALESCE(v_top_candidate.display_name, 'unknown');

        v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            top_candidate_person_id, top_candidate_score, decision_type,
            decision_reason, resulting_person_id, score_breakdown, rules_applied,
            processing_job_id, processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
            v_decision_reason, trapper.get_canonical_person_id(v_top_candidate.person_id),
            v_score_breakdown, v_rules_applied, p_job_id, v_duration_ms
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT
            trapper.get_canonical_person_id(v_top_candidate.person_id),
            v_decision_type,
            v_top_candidate.total_score,
            v_top_candidate.household_id,
            v_decision_id;
        RETURN;

    ELSIF v_top_candidate.person_id IS NOT NULL AND v_top_candidate.total_score >= 0.50 THEN
        -- Medium confidence: check if household situation
        IF v_top_candidate.is_household_candidate AND v_top_candidate.name_score < 0.5 THEN
            v_decision_type := 'household_member';
            v_decision_reason := 'Household member detected (score ' || ROUND(v_top_candidate.total_score, 2)::TEXT || ', name similarity ' || ROUND(v_top_candidate.name_score, 2)::TEXT || ')';
            v_household_id := v_top_candidate.household_id;

            -- Create new person
            v_new_person_id := trapper.create_person_basic(
                v_display_name, v_email_norm, v_phone_norm, p_source_system
            );

            -- Add to household if exists
            IF v_household_id IS NOT NULL AND v_new_person_id IS NOT NULL THEN
                INSERT INTO trapper.household_members (household_id, person_id, inferred_from, source_system)
                VALUES (v_household_id, v_new_person_id, 'data_engine_matching', p_source_system)
                ON CONFLICT DO NOTHING;

                UPDATE trapper.households SET member_count = member_count + 1, updated_at = NOW()
                WHERE households.household_id = v_household_id;
            END IF;

        ELSE
            -- Uncertain: needs review
            v_decision_type := 'review_pending';
            v_decision_reason := 'Medium confidence match (' || ROUND(v_top_candidate.total_score, 2)::TEXT || ') - needs human review';

            -- Create new person (will be merged or kept separate after review)
            v_new_person_id := trapper.create_person_basic(
                v_display_name, v_email_norm, v_phone_norm, p_source_system
            );

            -- Flag as potential duplicate
            IF v_new_person_id IS NOT NULL THEN
                INSERT INTO trapper.potential_person_duplicates (
                    person_id, potential_match_id, match_type, name_similarity,
                    new_source_system, existing_source_system, status
                ) VALUES (
                    v_new_person_id, v_top_candidate.person_id, 'data_engine_review',
                    v_top_candidate.name_score, p_source_system,
                    (SELECT data_source::TEXT FROM trapper.sot_people WHERE sot_people.person_id = v_top_candidate.person_id),
                    'pending'
                ) ON CONFLICT DO NOTHING;
            END IF;
        END IF;

        v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            top_candidate_person_id, top_candidate_score, decision_type,
            decision_reason, resulting_person_id, household_id,
            score_breakdown, rules_applied, processing_job_id,
            review_status, processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
            v_decision_reason, v_new_person_id, v_household_id,
            v_score_breakdown, v_rules_applied, p_job_id,
            CASE WHEN v_decision_type = 'review_pending' THEN 'pending' ELSE NULL END,
            v_duration_ms
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT
            COALESCE(v_new_person_id, v_top_candidate.person_id),
            v_decision_type,
            v_top_candidate.total_score,
            v_household_id,
            v_decision_id;
        RETURN;

    ELSE
        -- No match or low confidence: create new person
        v_decision_type := 'new_entity';
        IF v_top_candidate.person_id IS NOT NULL THEN
            v_decision_reason := 'Low confidence match (' || ROUND(v_top_candidate.total_score, 2)::TEXT || ') - creating new person';
        ELSE
            v_decision_reason := 'No matching candidates found';
        END IF;

        v_new_person_id := trapper.create_person_basic(
            v_display_name, v_email_norm, v_phone_norm, p_source_system
        );

        v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            top_candidate_person_id, top_candidate_score, decision_type,
            decision_reason, resulting_person_id, score_breakdown,
            rules_applied, processing_job_id, processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, COALESCE(v_candidates_count, 0),
            v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
            v_decision_reason, v_new_person_id, v_score_breakdown,
            v_rules_applied, p_job_id, v_duration_ms
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT
            v_new_person_id,
            v_decision_type,
            COALESCE(v_top_candidate.total_score, 0::NUMERIC),
            NULL::UUID,
            v_decision_id;
        RETURN;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity IS
'Main identity resolution function for the Data Engine.

Enhanced in MIG_564 to handle contact info updates:
- Exact email match + similar name (>=0.6) = contact_info_update
  Returns existing person, adds new phone/address as additional identifiers
- Exact email match + different name (<0.5) = household_member
  Creates new person, adds to household (couple/family sharing email)
- Ambiguous name (0.5-0.6) = falls through to review_pending

Decision types:
- auto_match: High confidence (>=0.95), link to existing
- contact_info_update: Same person with updated contact info (NEW)
- household_member: Different person sharing identifier
- review_pending: Needs human review
- new_entity: No match found
- rejected: Invalid input';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_564 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  - Added is_primary column to person_identifiers'
\echo '  - Created add_person_identifier() helper function'
\echo '  - Updated data_engine_resolve_identity() with email+name matching'
\echo ''
\echo 'New behavior:'
\echo '  - Exact email + similar name (>=0.6): Same person, add new contact info'
\echo '  - Exact email + different name (<0.5): Household member (couple/family)'
\echo '  - Ambiguous (0.5-0.6): Review pending'
\echo ''
\echo 'Test with:'
\echo '  SELECT * FROM trapper.data_engine_resolve_identity('
\echo '      ''gise0831@yahoo.com'','
\echo '      ''707-206-1094'','
\echo '      ''Myrna'', ''Chavez'','
\echo '      ''3328 Santa Rosa, CA 95407'','
\echo '      ''test'''
\echo '  );'
\echo ''
