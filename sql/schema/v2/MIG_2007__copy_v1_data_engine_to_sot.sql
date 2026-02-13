-- MIG_2007: Copy V1 Data Engine Functions to V2 sot Schema
--
-- Purpose: Port the battle-tested V1 Data Engine functions to V2
-- This preserves the Fellegi-Sunter scoring, soft blacklist, and identity resolution
-- that were developed over 50+ migrations.
--
-- Key V1 functions being copied:
-- 1. sot.normalize_address() - Address normalization (MIG_815)
-- 2. sot.norm_phone_us() - US phone normalization
-- 3. sot.norm_email() - Email normalization
-- 4. sot.name_similarity() - Name comparison using pg_trgm
-- 5. sot.data_engine_score_candidates() - Multi-signal weighted scoring (MIG_315)
-- 6. sot.match_decisions table - Audit trail for identity resolution
--
-- Created: 2026-02-12

\echo ''
\echo '=============================================='
\echo '  MIG_2007: Copy V1 Data Engine to V2 sot'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. HELPER FUNCTIONS - Normalization
-- ============================================================================

\echo '1. Creating normalization helper functions...'

-- Address normalization (from MIG_815)
CREATE OR REPLACE FUNCTION sot.normalize_address(p_address TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE
    v_result TEXT;
BEGIN
    IF p_address IS NULL OR BTRIM(p_address) = '' THEN
        RETURN NULL;
    END IF;

    v_result := BTRIM(p_address);

    -- Strip ", USA" / ", US" suffix
    v_result := REGEXP_REPLACE(v_result, ',\s*(USA|US|United States)\s*$', '', 'i');

    -- Strip em-dash city placeholder
    v_result := REGEXP_REPLACE(v_result, ',\s*[—–]+\s*,', ',', 'g');
    v_result := REGEXP_REPLACE(v_result, ',\s*--+\s*,', ',', 'g');
    v_result := REGEXP_REPLACE(v_result, '\s*[—–]+\s*$', '', 'g');
    v_result := REGEXP_REPLACE(v_result, '\s*--+\s*$', '', 'g');

    -- Normalize comma before zip
    v_result := REGEXP_REPLACE(v_result, ',\s*([A-Za-z]{2}),\s*(\d{5})', ', \1 \2', 'gi');

    -- Remove periods from abbreviations
    v_result := REGEXP_REPLACE(v_result, '\.(\s|,|$)', '\1', 'g');
    v_result := REGEXP_REPLACE(v_result, '([A-Za-z])\.([A-Za-z])', '\1\2', 'g');

    -- Collapse whitespace
    v_result := REGEXP_REPLACE(v_result, '\s+', ' ', 'g');

    -- Remove double commas, space before comma
    v_result := REGEXP_REPLACE(v_result, ',\s*,', ',', 'g');
    v_result := REGEXP_REPLACE(v_result, '\s+,', ',', 'g');

    -- Normalize apartment/unit spelling
    v_result := REGEXP_REPLACE(v_result, '\y(apartment)\y', 'apt', 'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(suite)\y', 'ste', 'gi');

    -- Strip comma between house number and street name
    v_result := REGEXP_REPLACE(v_result, '^(\d+),\s+', '\1 ', 'g');

    -- Fix inverted addresses (MIG_815)
    v_result := REGEXP_REPLACE(v_result, '^([a-zA-Z][a-zA-Z ]+?)\s+(\d{2,6})(\s*,|\s*$)', '\2 \1\3');

    -- Normalize street suffixes
    v_result := REGEXP_REPLACE(v_result, '\y(road)\y',      'rd',   'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(street)\y',    'st',   'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(avenue)\y',    'ave',  'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(drive)\y',     'dr',   'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(boulevard)\y', 'blvd', 'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(lane)\y',      'ln',   'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(court)\y',     'ct',   'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(circle)\y',    'cir',  'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(place)\y',     'pl',   'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(highway)\y',   'hwy',  'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(terrace)\y',   'ter',  'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(parkway)\y',   'pkwy', 'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(trail)\y',     'trl',  'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(square)\y',    'sq',   'gi');

    -- Normalize directional abbreviations
    v_result := REGEXP_REPLACE(v_result, '\y(north)\y',     'n',  'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(south)\y',     's',  'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(east)\y',      'e',  'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(west)\y',      'w',  'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(northwest)\y', 'nw', 'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(northeast)\y', 'ne', 'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(southwest)\y', 'sw', 'gi');
    v_result := REGEXP_REPLACE(v_result, '\y(southeast)\y', 'se', 'gi');

    -- Normalize # prefix for units
    v_result := REGEXP_REPLACE(v_result, '\s*#\s*', ' #', 'g');

    -- Final LOWER + TRIM
    v_result := LOWER(BTRIM(v_result));

    RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION sot.normalize_address IS
'V2: Normalizes addresses for deduplication.
Ported from V1 MIG_815 with inverted address detection.';

-- US Phone normalization
CREATE OR REPLACE FUNCTION sot.norm_phone_us(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_digits TEXT;
BEGIN
    IF p_phone IS NULL OR TRIM(p_phone) = '' THEN
        RETURN NULL;
    END IF;

    -- Strip non-digits
    v_digits := REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g');

    -- Strip leading 1 for US numbers
    IF LENGTH(v_digits) = 11 AND v_digits LIKE '1%' THEN
        v_digits := SUBSTRING(v_digits FROM 2);
    END IF;

    -- Valid US phone is 10 digits
    IF LENGTH(v_digits) != 10 THEN
        RETURN NULL;
    END IF;

    RETURN v_digits;
END;
$$;

COMMENT ON FUNCTION sot.norm_phone_us IS
'V2: Normalizes US phone numbers to 10 digits.
Strips leading 1, returns NULL if not valid 10-digit phone.';

-- Email normalization
CREATE OR REPLACE FUNCTION sot.norm_email(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_email TEXT;
BEGIN
    IF p_email IS NULL OR TRIM(p_email) = '' THEN
        RETURN NULL;
    END IF;

    v_email := LOWER(TRIM(p_email));

    -- Basic validation: must contain @
    IF v_email NOT LIKE '%@%' THEN
        RETURN NULL;
    END IF;

    RETURN v_email;
END;
$$;

COMMENT ON FUNCTION sot.norm_email IS
'V2: Normalizes email addresses.
Lowercases and trims. Returns NULL if not valid email format.';

-- Name similarity using pg_trgm (if available) or simple comparison
CREATE OR REPLACE FUNCTION sot.name_similarity(p_name1 TEXT, p_name2 TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF p_name1 IS NULL OR p_name2 IS NULL THEN
        RETURN 0.0;
    END IF;

    -- Use pg_trgm similarity if available
    RETURN similarity(LOWER(TRIM(p_name1)), LOWER(TRIM(p_name2)));
EXCEPTION WHEN undefined_function THEN
    -- Fallback to simple comparison
    IF LOWER(TRIM(p_name1)) = LOWER(TRIM(p_name2)) THEN
        RETURN 1.0;
    ELSE
        RETURN 0.0;
    END IF;
END;
$$;

COMMENT ON FUNCTION sot.name_similarity IS
'V2: Compares two names using trigram similarity.
Uses pg_trgm similarity() if available, falls back to exact match.';

\echo '   Created normalize_address, norm_phone_us, norm_email, name_similarity'

-- ============================================================================
-- 2. MATCH DECISIONS TABLE - Audit Trail
-- ============================================================================

\echo ''
\echo '2. Creating sot.match_decisions audit table...'

CREATE TABLE IF NOT EXISTS sot.match_decisions (
    decision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Input data
    source_system TEXT NOT NULL,
    incoming_email TEXT,
    incoming_phone TEXT,
    incoming_name TEXT,
    incoming_address TEXT,

    -- Scoring results
    candidates_evaluated INT DEFAULT 0,
    top_candidate_person_id UUID,
    top_candidate_score NUMERIC(4,3),
    score_breakdown JSONB,
    rules_applied JSONB,

    -- Decision
    decision_type TEXT NOT NULL CHECK (decision_type IN (
        'auto_match',       -- High confidence (>= 0.95)
        'review_pending',   -- Medium confidence (0.50 - 0.95)
        'household_member', -- Same address, different person
        'new_entity',       -- No match found, create new
        'rejected'          -- Failed should_be_person() gate
    )),
    decision_reason TEXT,
    resulting_person_id UUID,
    household_id UUID,

    -- Review workflow
    review_status TEXT DEFAULT 'not_required' CHECK (review_status IN (
        'not_required', 'pending', 'approved', 'merged', 'rejected', 'deferred'
    )),
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    review_action TEXT,

    -- Processing metadata
    processing_job_id UUID,
    processing_duration_ms INT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sot_match_decisions_source
    ON sot.match_decisions(source_system, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sot_match_decisions_review
    ON sot.match_decisions(review_status)
    WHERE review_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_sot_match_decisions_person
    ON sot.match_decisions(resulting_person_id)
    WHERE resulting_person_id IS NOT NULL;

COMMENT ON TABLE sot.match_decisions IS
'V2: Audit trail for all identity resolution decisions.
Ported from V1 data_engine_match_decisions.
Tracks: input data, scoring, decision type, review workflow.';

\echo '   Created sot.match_decisions'

-- ============================================================================
-- 3. DATA ENGINE CANDIDATE SCORING (from MIG_315/MIG_888)
-- ============================================================================

\echo ''
\echo '3. Creating sot.data_engine_score_candidates()...'

CREATE OR REPLACE FUNCTION sot.data_engine_score_candidates(
    p_email_norm TEXT,
    p_phone_norm TEXT,
    p_display_name TEXT,
    p_address_norm TEXT
)
RETURNS TABLE (
    person_id UUID,
    display_name TEXT,
    total_score NUMERIC,
    email_score NUMERIC,
    phone_score NUMERIC,
    name_score NUMERIC,
    address_score NUMERIC,
    household_id UUID,
    is_household_candidate BOOLEAN,
    matched_rules TEXT[],
    score_breakdown JSONB
) AS $$
BEGIN
    RETURN QUERY
    WITH
    -- Email matches (with soft blacklist check)
    email_matches AS (
        SELECT DISTINCT
            pi.person_id AS matched_person_id,
            CASE
                -- Check soft blacklist (MIG_888)
                WHEN EXISTS (
                    SELECT 1 FROM sot.soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_email_norm
                    AND sbl.identifier_type = 'email'
                ) THEN 0.5::NUMERIC  -- Soft blacklisted: half weight
                ELSE 1.0::NUMERIC
            END as score,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM sot.soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_email_norm
                    AND sbl.identifier_type = 'email'
                ) THEN 'exact_email_soft_blacklist'::TEXT
                ELSE 'exact_email'::TEXT
            END as rule
        FROM sot.person_identifiers pi
        WHERE p_email_norm IS NOT NULL
          AND p_email_norm != ''
          AND pi.id_type = 'email'
          AND pi.id_value_norm = p_email_norm
          AND pi.confidence >= 0.5  -- MIG_887: Exclude low-confidence identifiers
          AND EXISTS (
              SELECT 1 FROM sot.people sp
              WHERE sp.person_id = pi.person_id
              AND sp.merged_into_person_id IS NULL
          )
    ),

    -- Phone matches (with soft blacklist check)
    phone_matches AS (
        SELECT DISTINCT
            pi.person_id AS matched_person_id,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM sot.soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_phone_norm
                    AND sbl.identifier_type = 'phone'
                ) THEN 0.5::NUMERIC  -- Soft blacklisted: half weight
                ELSE 1.0::NUMERIC
            END as score,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM sot.soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_phone_norm
                    AND sbl.identifier_type = 'phone'
                ) THEN 'exact_phone_soft_blacklist'::TEXT
                ELSE 'exact_phone'::TEXT
            END as rule
        FROM sot.person_identifiers pi
        WHERE p_phone_norm IS NOT NULL
          AND p_phone_norm != ''
          AND pi.id_type = 'phone'
          AND pi.id_value_norm = p_phone_norm
          AND pi.confidence >= 0.5
          AND EXISTS (
              SELECT 1 FROM sot.people sp
              WHERE sp.person_id = pi.person_id
              AND sp.merged_into_person_id IS NULL
          )
    ),

    -- All unique candidates from identifier matches
    all_candidates AS (
        SELECT matched_person_id FROM email_matches
        UNION
        SELECT matched_person_id FROM phone_matches
    ),

    -- Calculate scores for each candidate
    -- Weights: Email 40%, Phone 25%, Name 25%, Address 10% (Fellegi-Sunter based)
    scored_candidates AS (
        SELECT
            sp.person_id,
            sp.display_name,
            -- Email score: 40% weight
            COALESCE((SELECT em.score FROM email_matches em WHERE em.matched_person_id = sp.person_id), 0.0) * 0.40 AS email_component,
            -- Phone score: 25% weight
            COALESCE((SELECT pm.score FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id), 0.0) * 0.25 AS phone_component,
            -- Name similarity: 25% weight
            CASE
                WHEN p_display_name IS NULL OR p_display_name = '' THEN 0.0
                WHEN sp.display_name IS NULL OR sp.display_name = '' THEN 0.0
                ELSE sot.name_similarity(p_display_name, sp.display_name) * 0.25
            END AS name_component,
            -- Address match: 10% weight
            CASE
                WHEN p_address_norm IS NOT NULL AND p_address_norm != '' AND EXISTS (
                    SELECT 1 FROM sot.person_place ppr
                    JOIN sot.places pl ON pl.place_id = ppr.place_id
                    WHERE ppr.person_id = sp.person_id
                    AND LOWER(pl.formatted_address) LIKE '%' || p_address_norm || '%'
                    AND pl.merged_into_place_id IS NULL
                ) THEN 0.10
                ELSE 0.0
            END AS address_component,
            -- Track matched rules
            ARRAY_REMOVE(ARRAY[
                (SELECT em.rule FROM email_matches em WHERE em.matched_person_id = sp.person_id),
                (SELECT pm.rule FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id)
            ], NULL) AS matched_rules
        FROM all_candidates ac
        JOIN sot.people sp ON sp.person_id = ac.matched_person_id
        WHERE sp.merged_into_person_id IS NULL
    )

    SELECT
        sc.person_id,
        sc.display_name,
        (sc.email_component + sc.phone_component + sc.name_component + sc.address_component)::NUMERIC AS total_score,
        sc.email_component AS email_score,
        sc.phone_component AS phone_score,
        sc.name_component AS name_score,
        sc.address_component AS address_score,
        NULL::UUID AS household_id,  -- V2 doesn't have household table yet
        FALSE AS is_household_candidate,
        sc.matched_rules,
        jsonb_build_object(
            'email', sc.email_component,
            'phone', sc.phone_component,
            'name', sc.name_component,
            'address', sc.address_component
        ) AS score_breakdown
    FROM scored_candidates sc
    WHERE (sc.email_component + sc.phone_component + sc.name_component + sc.address_component) > 0
    ORDER BY (sc.email_component + sc.phone_component + sc.name_component + sc.address_component) DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.data_engine_score_candidates IS
'V2: Scores all potential person matches using Fellegi-Sunter weighted multi-signal matching.
Ported from V1 MIG_315/MIG_888.
Weights: Email 40%, Phone 25%, Name 25%, Address 10%.
Soft-blacklisted identifiers score at half weight (0.5 instead of 1.0).
Confidence >= 0.5 filter (MIG_887) excludes fabricated PetLink emails.';

\echo '   Created sot.data_engine_score_candidates()'

-- ============================================================================
-- 4. DATA ENGINE IDENTITY RESOLUTION (from MIG_315/MIG_919)
-- ============================================================================

\echo ''
\echo '4. Creating sot.data_engine_resolve_identity()...'

CREATE OR REPLACE FUNCTION sot.data_engine_resolve_identity(
    p_email TEXT,
    p_phone TEXT,
    p_first_name TEXT,
    p_last_name TEXT,
    p_address TEXT,
    p_source_system TEXT
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
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_display_name TEXT;
    v_address_norm TEXT;
    v_candidate RECORD;
    v_decision_type TEXT;
    v_reason TEXT;
    v_match_details JSONB;
    v_person_id UUID;
    v_decision_id UUID;
    v_classification TEXT;
BEGIN
    -- Normalize inputs
    v_email_norm := sot.norm_email(p_email);
    v_phone_norm := sot.norm_phone_us(p_phone);
    v_display_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));
    v_address_norm := sot.normalize_address(COALESCE(p_address, ''));

    -- =========================================================================
    -- PHASE 0: CONSOLIDATED GATE (MIG_919)
    -- Uses should_be_person() to check all rejection criteria
    -- =========================================================================

    IF NOT sot.should_be_person(p_first_name, p_last_name, p_email, p_phone) THEN
        -- Build specific rejection reason
        v_reason := 'Failed should_be_person() gate: ';

        IF v_email_norm LIKE '%@forgottenfelines.com' OR v_email_norm LIKE '%@forgottenfelines.org' THEN
            v_reason := v_reason || 'FFSC organizational email';
        ELSIF v_email_norm LIKE 'info@%' OR v_email_norm LIKE 'office@%' OR v_email_norm LIKE 'contact@%' THEN
            v_reason := v_reason || 'Generic organizational email prefix';
        ELSIF v_email_norm IS NOT NULL AND EXISTS (
            SELECT 1 FROM sot.soft_blacklist
            WHERE identifier_norm = v_email_norm
              AND identifier_type = 'email'
              AND require_name_similarity >= 0.9
        ) THEN
            v_reason := v_reason || 'Soft-blacklisted organizational email';
        ELSIF (v_email_norm IS NULL OR v_email_norm = '') AND (v_phone_norm IS NULL OR v_phone_norm = '') THEN
            v_reason := v_reason || 'No email or phone provided';
        ELSIF p_first_name IS NULL OR TRIM(COALESCE(p_first_name, '')) = '' THEN
            v_reason := v_reason || 'No first name provided';
        ELSE
            v_classification := sot.classify_owner_name(v_display_name);
            v_reason := v_reason || 'Name classification: ' || COALESCE(v_classification, 'unknown');
        END IF;

        -- Log the rejection
        INSERT INTO sot.match_decisions (
            source_system, incoming_email, incoming_phone, incoming_name, incoming_address,
            decision_type, decision_reason, rules_applied
        ) VALUES (
            p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm,
            'rejected', v_reason, '["should_be_person_gate"]'::JSONB
        ) RETURNING match_decisions.decision_id INTO v_decision_id;

        -- Return rejection
        RETURN QUERY SELECT
            'rejected'::TEXT,
            NULL::UUID,
            NULL::TEXT,
            0.0::NUMERIC,
            v_reason,
            jsonb_build_object(
                'gate', 'should_be_person',
                'email_checked', v_email_norm,
                'name_checked', v_display_name,
                'classification', sot.classify_owner_name(v_display_name)
            ),
            v_decision_id;
        RETURN;
    END IF;

    -- =========================================================================
    -- PHASE 1+: SCORING AND MATCHING
    -- =========================================================================

    -- Get best candidate from scoring function
    SELECT * INTO v_candidate
    FROM sot.data_engine_score_candidates(
        v_email_norm,
        v_phone_norm,
        v_display_name,
        v_address_norm
    )
    LIMIT 1;

    -- Decision logic based on score
    IF v_candidate.person_id IS NOT NULL AND v_candidate.total_score >= 0.95 THEN
        -- High confidence: auto-match
        v_decision_type := 'auto_match';
        v_reason := 'High confidence match (score ' || ROUND(v_candidate.total_score, 2)::TEXT || ')';
        v_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'score_breakdown', v_candidate.score_breakdown
        );

        -- Add any new identifiers to existing person
        IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_person_id, 'email', p_email, v_email_norm, 1.0, p_source_system)
            ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;
        END IF;

        IF v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_person_id, 'phone', p_phone, v_phone_norm, 1.0, p_source_system)
            ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;
        END IF;

    ELSIF v_candidate.person_id IS NOT NULL AND v_candidate.total_score >= 0.50 THEN
        -- Medium confidence: needs review but return existing person
        v_decision_type := 'review_pending';
        v_reason := 'Medium confidence match (score ' || ROUND(v_candidate.total_score, 2)::TEXT || ') - needs verification';
        v_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'score_breakdown', v_candidate.score_breakdown
        );

    ELSE
        -- Low confidence or no match: create new person
        v_decision_type := 'new_entity';
        v_reason := CASE
            WHEN v_candidate.person_id IS NULL THEN 'No matching candidates found'
            ELSE 'Low confidence match (score ' || ROUND(COALESCE(v_candidate.total_score, 0), 2)::TEXT || ')'
        END;

        -- Create new person
        INSERT INTO sot.people (first_name, last_name, display_name, primary_email, primary_phone, source_system)
        VALUES (
            TRIM(p_first_name),
            TRIM(p_last_name),
            v_display_name,
            v_email_norm,
            v_phone_norm,
            p_source_system
        )
        RETURNING sot.people.person_id INTO v_person_id;

        -- Add identifiers
        IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_person_id, 'email', p_email, v_email_norm, 1.0, p_source_system)
            ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;
        END IF;

        IF v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_person_id, 'phone', p_phone, v_phone_norm, 1.0, p_source_system)
            ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;
        END IF;

        v_match_details := jsonb_build_object(
            'nearest_candidate', v_candidate.person_id,
            'nearest_score', COALESCE(v_candidate.total_score, 0)
        );
    END IF;

    -- Log decision
    INSERT INTO sot.match_decisions (
        source_system, incoming_email, incoming_phone, incoming_name, incoming_address,
        candidates_evaluated, top_candidate_person_id, top_candidate_score,
        decision_type, decision_reason, resulting_person_id,
        score_breakdown,
        review_status
    ) VALUES (
        p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm,
        CASE WHEN v_candidate.person_id IS NOT NULL THEN 1 ELSE 0 END,
        v_candidate.person_id, v_candidate.total_score,
        v_decision_type, v_reason, v_person_id,
        v_candidate.score_breakdown,
        CASE WHEN v_decision_type = 'review_pending' THEN 'pending' ELSE 'not_required' END
    ) RETURNING match_decisions.decision_id INTO v_decision_id;

    RETURN QUERY SELECT
        v_decision_type,
        v_person_id,
        v_display_name,
        COALESCE(v_candidate.total_score, 0.0)::NUMERIC,
        v_reason,
        v_match_details,
        v_decision_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.data_engine_resolve_identity IS
'V2: Main Data Engine entry point for identity resolution.
Ported from V1 MIG_315/MIG_919.

Phase 0: should_be_person() gate (catches orgs, sites, garbage)
Phase 1+: Multi-signal scoring with Fellegi-Sunter weights

Decision types:
- auto_match: >= 0.95 confidence
- review_pending: 0.50 - 0.95 confidence
- new_entity: < 0.50 or no candidates
- rejected: Failed Phase 0 gate

All decisions logged to sot.match_decisions for audit.';

\echo '   Created sot.data_engine_resolve_identity()'

-- ============================================================================
-- 5. FIND OR CREATE PERSON (Standard Entry Point)
-- ============================================================================

\echo ''
\echo '5. Creating sot.find_or_create_person()...'

CREATE OR REPLACE FUNCTION sot.find_or_create_person(
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'unknown'
)
RETURNS UUID AS $$
DECLARE
    v_result RECORD;
BEGIN
    -- Use Data Engine for identity resolution
    SELECT * INTO v_result
    FROM sot.data_engine_resolve_identity(
        p_email, p_phone, p_first_name, p_last_name, p_address, p_source_system
    );

    RETURN v_result.person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.find_or_create_person IS
'V2: Standard entry point for finding or creating a person.
Wrapper for data_engine_resolve_identity().
Returns person_id (NULL if rejected by should_be_person gate).';

\echo '   Created sot.find_or_create_person()'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Testing sot.normalize_address():'
SELECT
    input,
    sot.normalize_address(input) AS normalized
FROM (VALUES
    ('123 Main Street, Santa Rosa, CA 95401'),
    ('456 Oak Avenue, Petaluma, California 94952, USA'),
    ('Valley Ford Road 14495')
) AS t(input);

\echo ''
\echo 'Testing sot.classify_owner_name():'
SELECT
    input,
    sot.classify_owner_name(input) AS classification
FROM (VALUES
    ('John Smith'),
    ('Silveira Ranch'),
    ('123 Main Street'),
    ('Sonoma Humane Society'),
    ('Unknown'),
    ('FFSC Foster')
) AS t(input);

\echo ''
\echo '=============================================='
\echo '  MIG_2007 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created V2 Data Engine functions:'
\echo '  - sot.normalize_address()'
\echo '  - sot.norm_phone_us()'
\echo '  - sot.norm_email()'
\echo '  - sot.name_similarity()'
\echo '  - sot.match_decisions (audit table)'
\echo '  - sot.data_engine_score_candidates()'
\echo '  - sot.data_engine_resolve_identity()'
\echo '  - sot.find_or_create_person()'
\echo ''
\echo 'Fellegi-Sunter weights preserved: Email 40%, Phone 25%, Name 25%, Address 10%'
\echo 'Soft blacklist checking enabled'
\echo 'Phase 0 gate (should_be_person) enforced'
\echo ''
