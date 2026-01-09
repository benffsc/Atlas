-- MIG_249__conservative_match_tiers.sql
-- MEGA_004 F1: Conservative matching tiers for deduplication
--
-- Implements safe matching rules in priority order:
-- Tier 0 (>=0.95): email+name exact match OR phone+name exact match
-- Tier 1 (>=0.80): phone match only OR email match only
-- Tier 2 (>=0.50): address proximity (<500m) + name fuzzy
-- Tier 3 (<0.50): name-only fuzzy (requires review)
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_249__conservative_match_tiers.sql

-- ============================================================
-- FUNCTION: calculate_name_similarity
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.calculate_name_similarity(
    name1 TEXT,
    name2 TEXT
)
RETURNS NUMERIC(4,3)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    n1 TEXT;
    n2 TEXT;
    sim NUMERIC;
BEGIN
    -- Normalize names
    n1 := LOWER(TRIM(REGEXP_REPLACE(COALESCE(name1, ''), '\s+', ' ', 'g')));
    n2 := LOWER(TRIM(REGEXP_REPLACE(COALESCE(name2, ''), '\s+', ' ', 'g')));

    -- Empty check
    IF n1 = '' OR n2 = '' THEN
        RETURN 0;
    END IF;

    -- Exact match
    IF n1 = n2 THEN
        RETURN 1.0;
    END IF;

    -- Use trigram similarity if pg_trgm is available
    -- Otherwise fall back to simple containment check
    BEGIN
        sim := similarity(n1, n2);
        RETURN sim;
    EXCEPTION WHEN undefined_function THEN
        -- Fallback: check if one contains the other
        IF n1 LIKE '%' || n2 || '%' OR n2 LIKE '%' || n1 || '%' THEN
            RETURN 0.7;
        END IF;
        RETURN 0;
    END;
END;
$$;

COMMENT ON FUNCTION trapper.calculate_name_similarity IS
'Calculate similarity between two names. Returns 0-1. Uses pg_trgm if available.';

-- ============================================================
-- FUNCTION: generate_person_match_candidates
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.generate_person_match_candidates(
    p_source_system TEXT DEFAULT 'clinichq',
    p_limit INT DEFAULT 100,
    p_min_confidence NUMERIC DEFAULT 0.50
)
RETURNS TABLE (
    source_record_id TEXT,
    candidate_person_id UUID,
    confidence NUMERIC(4,3),
    tier TEXT,
    evidence JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- Generate candidates for unlinked source records
    RETURN QUERY
    WITH unlinked_sources AS (
        -- Get unlinked source records
        SELECT
            us.source_record_id,
            us.display_name,
            us.email,
            us.phone,
            us.phone_normalized,
            us.address_display
        FROM trapper.v_people_unlinked_sources us
        WHERE us.source_system = p_source_system
          AND us.is_unlinked = true
          -- Skip already-marked historical-only records
          AND NOT trapper.is_historical_only(p_source_system, us.source_record_id)
          -- Skip records with open candidates already
          AND NOT us.has_open_candidates
        LIMIT p_limit
    ),
    candidates AS (
        -- Find potential matches from canonical people
        SELECT
            us.source_record_id,
            p.id AS candidate_person_id,

            -- Calculate confidence based on what matched
            CASE
                -- TIER 0 (>=0.95): email+name OR phone+name
                WHEN (
                    LOWER(COALESCE(us.email, '')) = LOWER(COALESCE(p.email, ''))
                    AND us.email IS NOT NULL
                    AND p.email IS NOT NULL
                    AND trapper.calculate_name_similarity(us.display_name, COALESCE(p.display_name, p.full_name)) >= 0.8
                ) THEN 0.98

                WHEN (
                    us.phone_normalized = p.phone_normalized
                    AND us.phone_normalized IS NOT NULL
                    AND p.phone_normalized IS NOT NULL
                    AND trapper.calculate_name_similarity(us.display_name, COALESCE(p.display_name, p.full_name)) >= 0.8
                ) THEN 0.96

                -- TIER 1 (>=0.80): phone only OR email only
                WHEN (
                    us.phone_normalized = p.phone_normalized
                    AND us.phone_normalized IS NOT NULL
                    AND p.phone_normalized IS NOT NULL
                ) THEN 0.85

                WHEN (
                    LOWER(COALESCE(us.email, '')) = LOWER(COALESCE(p.email, ''))
                    AND us.email IS NOT NULL
                    AND p.email IS NOT NULL
                ) THEN 0.82

                -- TIER 2 (>=0.50): name similarity >= 0.8
                WHEN trapper.calculate_name_similarity(us.display_name, COALESCE(p.display_name, p.full_name)) >= 0.85
                THEN 0.60

                -- TIER 3 (<0.50): name similarity >= 0.7
                WHEN trapper.calculate_name_similarity(us.display_name, COALESCE(p.display_name, p.full_name)) >= 0.70
                THEN 0.40

                ELSE 0
            END AS confidence,

            -- Tier label
            CASE
                WHEN (
                    LOWER(COALESCE(us.email, '')) = LOWER(COALESCE(p.email, ''))
                    AND us.email IS NOT NULL
                    AND trapper.calculate_name_similarity(us.display_name, COALESCE(p.display_name, p.full_name)) >= 0.8
                ) THEN 'tier0'
                WHEN (
                    us.phone_normalized = p.phone_normalized
                    AND us.phone_normalized IS NOT NULL
                    AND trapper.calculate_name_similarity(us.display_name, COALESCE(p.display_name, p.full_name)) >= 0.8
                ) THEN 'tier0'
                WHEN us.phone_normalized = p.phone_normalized AND us.phone_normalized IS NOT NULL THEN 'tier1'
                WHEN LOWER(COALESCE(us.email, '')) = LOWER(COALESCE(p.email, '')) AND us.email IS NOT NULL THEN 'tier1'
                WHEN trapper.calculate_name_similarity(us.display_name, COALESCE(p.display_name, p.full_name)) >= 0.85 THEN 'tier2'
                WHEN trapper.calculate_name_similarity(us.display_name, COALESCE(p.display_name, p.full_name)) >= 0.70 THEN 'tier3'
                ELSE 'no_match'
            END AS tier,

            -- Evidence JSON
            jsonb_build_object(
                'source_name', us.display_name,
                'source_email', us.email,
                'source_phone', us.phone_normalized,
                'candidate_name', COALESCE(p.display_name, p.full_name),
                'candidate_email', p.email,
                'candidate_phone', p.phone_normalized,
                'phone_match', us.phone_normalized = p.phone_normalized AND us.phone_normalized IS NOT NULL,
                'email_match', LOWER(COALESCE(us.email, '')) = LOWER(COALESCE(p.email, '')) AND us.email IS NOT NULL,
                'name_similarity', trapper.calculate_name_similarity(us.display_name, COALESCE(p.display_name, p.full_name)),
                'matched_on', (
                    SELECT array_agg(field)::text[]
                    FROM (
                        SELECT 'phone_normalized' AS field
                        WHERE us.phone_normalized = p.phone_normalized AND us.phone_normalized IS NOT NULL
                        UNION ALL
                        SELECT 'email'
                        WHERE LOWER(COALESCE(us.email, '')) = LOWER(COALESCE(p.email, '')) AND us.email IS NOT NULL
                    ) fields
                )
            ) AS evidence

        FROM unlinked_sources us
        CROSS JOIN trapper.people p
        WHERE
            -- At least one matching criterion
            (us.phone_normalized = p.phone_normalized AND us.phone_normalized IS NOT NULL AND LENGTH(us.phone_normalized) >= 10)
            OR (LOWER(COALESCE(us.email, '')) = LOWER(COALESCE(p.email, '')) AND us.email IS NOT NULL AND us.email LIKE '%@%')
            OR trapper.calculate_name_similarity(us.display_name, COALESCE(p.display_name, p.full_name)) >= 0.70
    )
    SELECT
        c.source_record_id,
        c.candidate_person_id,
        c.confidence,
        c.tier,
        c.evidence
    FROM candidates c
    WHERE c.confidence >= p_min_confidence
      AND c.tier != 'no_match'
    ORDER BY c.confidence DESC;
END;
$$;

COMMENT ON FUNCTION trapper.generate_person_match_candidates IS
'Generate match candidates for unlinked source records using conservative tier logic.
Tier 0 (>=0.95): email+name or phone+name exact
Tier 1 (>=0.80): phone only or email only
Tier 2 (>=0.50): high name similarity
Tier 3 (<0.50): moderate name similarity (needs review)';

-- ============================================================
-- FUNCTION: insert_match_candidates
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.insert_match_candidates(
    p_source_system TEXT DEFAULT 'clinichq',
    p_limit INT DEFAULT 100,
    p_min_confidence NUMERIC DEFAULT 0.50,
    p_created_by TEXT DEFAULT 'system'
)
RETURNS TABLE (
    inserted_count INT,
    skipped_count INT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_inserted INT := 0;
    v_skipped INT := 0;
BEGIN
    -- Insert candidates (skip if already exists)
    WITH candidates AS (
        SELECT * FROM trapper.generate_person_match_candidates(p_source_system, p_limit, p_min_confidence)
    ),
    insertions AS (
        INSERT INTO trapper.person_match_candidates (
            source_system,
            source_record_id,
            candidate_person_id,
            confidence,
            evidence,
            status
        )
        SELECT
            p_source_system,
            c.source_record_id,
            c.candidate_person_id,
            c.confidence,
            c.evidence,
            'open'
        FROM candidates c
        ON CONFLICT (source_system, source_record_id, candidate_person_id) DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_inserted FROM insertions;

    -- Count how many were skipped (already existed)
    SELECT COUNT(*) - v_inserted INTO v_skipped
    FROM trapper.generate_person_match_candidates(p_source_system, p_limit, p_min_confidence);

    RETURN QUERY SELECT v_inserted, GREATEST(v_skipped, 0);
END;
$$;

COMMENT ON FUNCTION trapper.insert_match_candidates IS
'Generate and insert match candidates into person_match_candidates table.
Returns count of inserted and skipped (already existed) candidates.';

-- ============================================================
-- VIEW: v_match_tier_summary
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_match_tier_summary AS
SELECT
    pmc.source_system,
    CASE
        WHEN pmc.confidence >= 0.95 THEN 'tier0'
        WHEN pmc.confidence >= 0.80 THEN 'tier1'
        WHEN pmc.confidence >= 0.50 THEN 'tier2'
        ELSE 'tier3'
    END AS tier,
    pmc.status,
    COUNT(*) AS count,
    ROUND(AVG(pmc.confidence), 3) AS avg_confidence,
    MIN(pmc.created_at)::date AS oldest,
    MAX(pmc.created_at)::date AS newest
FROM trapper.person_match_candidates pmc
GROUP BY pmc.source_system, tier, pmc.status
ORDER BY pmc.source_system, tier, pmc.status;

COMMENT ON VIEW trapper.v_match_tier_summary IS
'Summary of match candidates by tier and status for monitoring.';

-- ============================================================
-- Verification
-- ============================================================

\echo ''
\echo 'MIG_249 applied. Conservative match tier functions created.'
\echo ''

\echo 'Testing calculate_name_similarity:'
SELECT
    trapper.calculate_name_similarity('John Smith', 'John Smith') AS exact,
    trapper.calculate_name_similarity('John Smith', 'john smith') AS case_diff,
    trapper.calculate_name_similarity('John Smith', 'Jon Smith') AS typo,
    trapper.calculate_name_similarity('John Smith', 'Jane Doe') AS different;

\echo ''
\echo 'Current match tier summary (may be empty if no candidates yet):'
SELECT * FROM trapper.v_match_tier_summary;

\echo ''
\echo 'To generate candidates:'
\echo '  SELECT * FROM trapper.generate_person_match_candidates(''clinichq'', 10, 0.50);'
\echo ''
\echo 'To insert candidates into review queue:'
\echo '  SELECT * FROM trapper.insert_match_candidates(''clinichq'', 100, 0.50);'
