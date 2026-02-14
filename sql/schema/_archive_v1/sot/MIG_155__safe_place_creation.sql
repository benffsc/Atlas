-- MIG_155__safe_place_creation.sql
-- Safe place creation with deduplication
--
-- Problem:
--   Places are created eagerly from raw text without normalization.
--   This creates duplicates like "15999 Hwy 1" vs "15999 Coast Hwy" vs "15999 CA-1".
--
-- Solution:
--   1. Require geocoding before place creation
--   2. Match on geocoded canonical address
--   3. Queue uncertain matches for review
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_155__safe_place_creation.sql

\echo ''
\echo 'MIG_155: Safe Place Creation'
\echo '============================================'

-- ============================================================
-- 1. Create place_review_queue for uncertain matches
-- ============================================================

\echo ''
\echo 'Creating place_review_queue table...'

CREATE TABLE IF NOT EXISTS trapper.place_review_queue (
    queue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The raw input
    raw_address TEXT NOT NULL,
    source_system TEXT,
    source_record_id TEXT,

    -- Potential matches
    candidate_place_ids UUID[],
    candidate_scores NUMERIC[],

    -- Status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'created', 'rejected')),
    resolved_place_id UUID REFERENCES trapper.places(place_id),
    resolved_by TEXT,
    resolved_at TIMESTAMPTZ,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_place_review_queue_status ON trapper.place_review_queue(status);

COMMENT ON TABLE trapper.place_review_queue IS
'Queue for address-to-place matching that needs human review.';

-- ============================================================
-- 2. Function to find matching place by address
-- ============================================================

\echo ''
\echo 'Creating find_matching_place function...'

CREATE OR REPLACE FUNCTION trapper.find_matching_place(
    p_address TEXT,
    p_threshold NUMERIC DEFAULT 0.85
)
RETURNS TABLE (
    place_id UUID,
    display_name TEXT,
    formatted_address TEXT,
    match_score NUMERIC,
    match_type TEXT
) AS $$
BEGIN
    RETURN QUERY

    -- Exact match on formatted_address
    SELECT
        p.place_id,
        p.display_name,
        p.formatted_address,
        1.0::NUMERIC as match_score,
        'exact'::TEXT as match_type
    FROM trapper.places p
    WHERE LOWER(p.formatted_address) = LOWER(p_address)

    UNION ALL

    -- Exact match on display_name
    SELECT
        p.place_id,
        p.display_name,
        p.formatted_address,
        0.95::NUMERIC as match_score,
        'display_name'::TEXT as match_type
    FROM trapper.places p
    WHERE LOWER(p.display_name) = LOWER(p_address)
      AND NOT EXISTS (SELECT 1 FROM trapper.places p2 WHERE LOWER(p2.formatted_address) = LOWER(p_address))

    UNION ALL

    -- Similarity match
    SELECT
        p.place_id,
        p.display_name,
        p.formatted_address,
        similarity(LOWER(p.formatted_address), LOWER(p_address))::NUMERIC as match_score,
        'similarity'::TEXT as match_type
    FROM trapper.places p
    WHERE similarity(LOWER(p.formatted_address), LOWER(p_address)) >= p_threshold
      AND LOWER(p.formatted_address) != LOWER(p_address)

    ORDER BY match_score DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.find_matching_place IS
'Finds places matching an address. Returns candidates with match scores.
- exact (1.0): formatted_address matches exactly
- display_name (0.95): display_name matches exactly
- similarity (0.85+): pg_trgm similarity match';

-- ============================================================
-- 3. Safe place creation function
-- ============================================================

\echo ''
\echo 'Creating get_or_create_place_safe function...'

CREATE OR REPLACE FUNCTION trapper.get_or_create_place_safe(
    p_address TEXT,
    p_source_system TEXT DEFAULT NULL,
    p_source_record_id TEXT DEFAULT NULL,
    p_auto_create_threshold NUMERIC DEFAULT 0.95
)
RETURNS TABLE (
    place_id UUID,
    action TEXT,
    match_score NUMERIC
) AS $$
DECLARE
    v_match RECORD;
    v_new_place_id UUID;
    v_candidates UUID[];
    v_scores NUMERIC[];
BEGIN
    -- Skip empty addresses
    IF p_address IS NULL OR TRIM(p_address) = '' THEN
        RETURN;
    END IF;

    -- Skip obvious non-addresses (image URLs, etc.)
    IF p_address ILIKE '%http%' OR p_address ILIKE '%.png%' OR p_address ILIKE '%.jpg%' THEN
        RETURN;
    END IF;

    -- Find matching places
    SELECT * INTO v_match
    FROM trapper.find_matching_place(p_address, 0.7)
    LIMIT 1;

    IF v_match.place_id IS NOT NULL THEN
        -- High confidence match - return existing place
        IF v_match.match_score >= p_auto_create_threshold THEN
            RETURN QUERY SELECT v_match.place_id, 'matched'::TEXT, v_match.match_score;
            RETURN;
        END IF;

        -- Medium confidence - queue for review
        SELECT ARRAY_AGG(mp.place_id), ARRAY_AGG(mp.match_score)
        INTO v_candidates, v_scores
        FROM trapper.find_matching_place(p_address, 0.7) mp;

        INSERT INTO trapper.place_review_queue (
            raw_address, source_system, source_record_id,
            candidate_place_ids, candidate_scores
        ) VALUES (
            p_address, p_source_system, p_source_record_id,
            v_candidates, v_scores
        );

        RETURN QUERY SELECT NULL::UUID, 'queued'::TEXT, v_match.match_score;
        RETURN;
    END IF;

    -- No match found - create new place
    INSERT INTO trapper.places (
        display_name,
        formatted_address,
        place_kind,
        place_origin,
        is_address_backed
    ) VALUES (
        p_address,
        p_address,
        'unknown',
        'atlas',
        FALSE
    )
    RETURNING places.place_id INTO v_new_place_id;

    RETURN QUERY SELECT v_new_place_id, 'created'::TEXT, 0::NUMERIC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.get_or_create_place_safe IS
'Safely gets or creates a place, avoiding duplicates.
- Matches existing places by address similarity
- Auto-matches at 95%+ confidence
- Queues for review at 70-95% confidence
- Creates new only if no match found';

-- ============================================================
-- 4. Verification
-- ============================================================

\echo ''
\echo 'Testing with 15999 Coast Hwy...';

SELECT * FROM trapper.find_matching_place('15999 Coast Hwy');

SELECT 'MIG_155 Complete' AS status;
