-- MIG_2043: Auto-match exact name + single identifier
-- Date: 2026-02-13
-- Issue: 5,143 reviews pending where name matches exactly but only one identifier
--
-- Scoring weights (from MIG_2007):
--   Email: 0.40, Phone: 0.25, Name: 0.25, Address: 0.10
--
-- Current scores for exact name + single identifier:
--   Name + Phone = 0.50 (flagged for review)
--   Name + Phone + Address = 0.60 (flagged for review)
--   Name + Email = 0.65 (flagged for review)
--   Name + Email + Address = 0.75 (flagged for review)
--
-- Fix: If name matches exactly (score = 0.25) AND at least one identifier
--      matches (email >= 0.35 OR phone >= 0.20), auto-match.
--
-- Rationale: Two different people with IDENTICAL name AND same phone/email
--            is extremely rare. Safe to auto-match.

-- Step 1: Analyze what we're approving
SELECT
  'BEFORE: Pending reviews by name match status' as context,
  CASE
    WHEN (score_breakdown->>'name')::numeric >= 0.24 THEN 'Exact name'
    ELSE 'Fuzzy/partial name'
  END as name_match,
  COUNT(*) as count
FROM sot.match_decisions
WHERE review_status = 'pending'
GROUP BY 2;

-- Step 2: Bulk approve exact name + single identifier matches
WITH to_approve AS (
  SELECT md.decision_id
  FROM sot.match_decisions md
  WHERE md.review_status = 'pending'
    -- Name matches exactly (score component = 0.25, with some tolerance)
    AND (md.score_breakdown->>'name')::numeric >= 0.24
    -- At least one identifier matches
    AND (
      (md.score_breakdown->>'email')::numeric >= 0.35  -- email matched
      OR (md.score_breakdown->>'phone')::numeric >= 0.20  -- phone matched
    )
)
UPDATE sot.match_decisions
SET
  review_status = 'approved',
  review_action = 'auto_approved',
  reviewed_at = NOW(),
  reviewed_by = 'MIG_2043',
  review_notes = 'Bulk approved: exact name match + identifier is sufficient evidence'
WHERE decision_id IN (SELECT decision_id FROM to_approve);

-- Step 3: Report results
SELECT
  'AFTER: Reviews by status' as context,
  review_status,
  COUNT(*) as count
FROM sot.match_decisions
GROUP BY review_status
ORDER BY 2;

-- Step 4: Update the data engine function with new auto-match logic
CREATE OR REPLACE FUNCTION sot.data_engine_resolve_identity(
    p_email TEXT,
    p_phone TEXT,
    p_first_name TEXT,
    p_last_name TEXT,
    p_address TEXT,
    p_source_system TEXT,
    p_processing_job_id UUID DEFAULT NULL
) RETURNS TABLE (
    person_id UUID,
    decision_type TEXT,
    decision_reason TEXT,
    match_details JSONB
) LANGUAGE plpgsql AS $$
DECLARE
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_display_name TEXT;
    v_address_norm TEXT;
    v_candidate RECORD;
    v_new_person_id UUID;
    v_decision_type TEXT;
    v_reason TEXT;
    v_match_details JSONB;
    v_decision_id UUID;
    v_is_exact_name_match BOOLEAN;
    v_has_identifier_match BOOLEAN;
BEGIN
    -- Normalize inputs
    v_email_norm := LOWER(TRIM(COALESCE(p_email, '')));
    v_phone_norm := REGEXP_REPLACE(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
    IF LENGTH(v_phone_norm) = 11 AND v_phone_norm LIKE '1%' THEN
        v_phone_norm := SUBSTRING(v_phone_norm FROM 2);
    END IF;
    v_display_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));
    v_address_norm := LOWER(TRIM(COALESCE(p_address, '')));

    -- Check for empty identifiers
    IF (v_email_norm = '' OR v_email_norm IS NULL)
       AND (v_phone_norm = '' OR v_phone_norm IS NULL OR LENGTH(v_phone_norm) < 10) THEN
        -- No valid identifiers - reject
        v_decision_type := 'rejected';
        v_reason := 'No valid email or phone provided';
        v_match_details := jsonb_build_object('error', 'missing_identifiers');

        INSERT INTO sot.match_decisions (
            source_system, incoming_email, incoming_phone, incoming_name, incoming_address,
            candidates_evaluated, decision_type, decision_reason, review_status, processing_job_id
        ) VALUES (
            p_source_system, p_email, p_phone, v_display_name, p_address,
            0, v_decision_type, v_reason, 'not_required', p_processing_job_id
        )
        RETURNING match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT NULL::UUID, v_decision_type, v_reason, v_match_details;
        RETURN;
    END IF;

    -- Check soft blacklist
    IF EXISTS (
        SELECT 1 FROM sot.soft_blacklist sb
        WHERE (sb.identifier_type = 'email' AND sb.identifier_norm = v_email_norm)
           OR (sb.identifier_type = 'phone' AND sb.identifier_norm = v_phone_norm)
    ) THEN
        v_decision_type := 'new_entity';
        v_reason := 'Identifier is soft-blacklisted - creating new record';

        INSERT INTO sot.people (first_name, last_name, display_name, source_system)
        VALUES (p_first_name, p_last_name, v_display_name, p_source_system)
        RETURNING people.person_id INTO v_new_person_id;

        v_match_details := jsonb_build_object('soft_blacklist', true, 'new_person_id', v_new_person_id);

        INSERT INTO sot.match_decisions (
            source_system, incoming_email, incoming_phone, incoming_name, incoming_address,
            candidates_evaluated, decision_type, decision_reason, resulting_person_id,
            review_status, processing_job_id
        ) VALUES (
            p_source_system, p_email, p_phone, v_display_name, p_address,
            0, v_decision_type, v_reason, v_new_person_id, 'not_required', p_processing_job_id
        );

        RETURN QUERY SELECT v_new_person_id, v_decision_type, v_reason, v_match_details;
        RETURN;
    END IF;

    -- Score candidates
    SELECT * INTO v_candidate
    FROM sot.data_engine_score_candidates(
        v_email_norm,
        v_phone_norm,
        v_display_name,
        v_address_norm
    )
    LIMIT 1;

    -- Check for exact name match + identifier match (MIG_2043)
    -- Name component = 0.25 means exact match (name_similarity returns 1.0 * 0.25 weight)
    v_is_exact_name_match := v_candidate.name_score >= 0.24;
    v_has_identifier_match := (v_candidate.email_score >= 0.35 OR v_candidate.phone_score >= 0.20);

    -- Decision logic based on score
    -- AUTO-MATCH CONDITIONS (MIG_2042 + MIG_2043):
    --   1. Total score >= 0.90 (name + email + phone match)
    --   2. Exact name match + at least one identifier (NEW)
    IF v_candidate.person_id IS NOT NULL AND (
        v_candidate.total_score >= 0.90
        OR (v_is_exact_name_match AND v_has_identifier_match)
    ) THEN
        -- High confidence: auto-match
        v_decision_type := 'auto_match';
        v_reason := CASE
            WHEN v_candidate.total_score >= 0.90 THEN
                'High confidence match (score ' || ROUND(v_candidate.total_score, 2)::TEXT || ')'
            ELSE
                'Exact name match with identifier (score ' || ROUND(v_candidate.total_score, 2)::TEXT || ')'
        END;
        v_new_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'score_breakdown', v_candidate.score_breakdown,
            'exact_name_match', v_is_exact_name_match,
            'has_identifier', v_has_identifier_match
        );

        -- Add any new identifiers to existing person
        IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_new_person_id, 'email', p_email, v_email_norm, 1.0, p_source_system)
            ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;
        END IF;

        IF v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_new_person_id, 'phone', p_phone, v_phone_norm, 1.0, p_source_system)
            ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;
        END IF;

    ELSIF v_candidate.person_id IS NOT NULL AND v_candidate.total_score >= 0.50 THEN
        -- Medium confidence: needs review
        -- This now only triggers for fuzzy name matches or partial identifier matches
        v_decision_type := 'review_pending';
        v_reason := 'Fuzzy match (score ' || ROUND(v_candidate.total_score, 2)::TEXT || ') - needs verification';
        v_new_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'score_breakdown', v_candidate.score_breakdown,
            'exact_name_match', v_is_exact_name_match,
            'has_identifier', v_has_identifier_match
        );

    ELSE
        -- Low confidence or no match: create new person
        v_decision_type := 'new_entity';
        v_reason := CASE
            WHEN v_candidate.person_id IS NULL THEN 'No matching candidates found'
            ELSE 'Low confidence match (score ' || ROUND(v_candidate.total_score, 2)::TEXT || ') - creating new record'
        END;

        INSERT INTO sot.people (first_name, last_name, display_name, source_system)
        VALUES (p_first_name, p_last_name, v_display_name, p_source_system)
        RETURNING people.person_id INTO v_new_person_id;

        -- Add identifiers
        IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_new_person_id, 'email', p_email, v_email_norm, 1.0, p_source_system)
            ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;
        END IF;

        IF v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_new_person_id, 'phone', p_phone, v_phone_norm, 1.0, p_source_system)
            ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;
        END IF;

        v_match_details := jsonb_build_object('new_person_id', v_new_person_id);
    END IF;

    -- Log the decision
    INSERT INTO sot.match_decisions (
        source_system, incoming_email, incoming_phone, incoming_name, incoming_address,
        candidates_evaluated, top_candidate_person_id, top_candidate_score, score_breakdown,
        decision_type, decision_reason, resulting_person_id, review_status, processing_job_id
    ) VALUES (
        p_source_system, p_email, p_phone, v_display_name, p_address,
        CASE WHEN v_candidate.person_id IS NOT NULL THEN 1 ELSE 0 END,
        v_candidate.person_id, v_candidate.total_score, v_candidate.score_breakdown,
        v_decision_type, v_reason, v_new_person_id,
        CASE WHEN v_decision_type = 'review_pending' THEN 'pending' ELSE 'not_required' END,
        p_processing_job_id
    )
    RETURNING match_decisions.decision_id INTO v_decision_id;

    RETURN QUERY SELECT v_new_person_id, v_decision_type, v_reason, v_match_details;
END;
$$;

COMMENT ON FUNCTION sot.data_engine_resolve_identity IS
'V2 Data Engine: Resolves person identity from incoming data.
Auto-match conditions (MIG_2042 + MIG_2043):
  1. Total score >= 0.90 (name + email + phone match)
  2. Exact name match (0.25) + at least one identifier (email >= 0.35 OR phone >= 0.20)
Review required: Fuzzy name matches, partial identifier matches (score 0.50-0.89 without exact name)
New entity: No match found or score < 0.50';

-- Final summary
SELECT
  'FINAL: Match decisions summary' as context,
  decision_type,
  review_status,
  COUNT(*) as count
FROM sot.match_decisions
GROUP BY 1, 2
ORDER BY 3 DESC;
