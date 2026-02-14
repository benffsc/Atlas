\echo '=== MIG_484: Cat Merge Candidates ==='
\echo 'Creates table and functions for cat duplicate detection and merge review'
\echo ''

-- ============================================================================
-- PURPOSE
-- Create infrastructure for detecting and reviewing potential cat duplicates.
-- Cats with same owner + same name + same sex should be flagged for review.
-- Microchip matches are auto-merged (handled by unified_find_or_create_cat).
-- ============================================================================

\echo 'Step 1: Creating cat_merge_candidates table...'

CREATE TABLE IF NOT EXISTS trapper.cat_merge_candidates (
    candidate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The two cats that might be duplicates
    cat_id_a UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),
    cat_id_b UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),

    -- Match details
    match_reason TEXT NOT NULL,  -- 'same_owner_same_name', 'same_location_similar_name', etc
    match_confidence NUMERIC(3,2) CHECK (match_confidence BETWEEN 0 AND 1),
    match_details JSONB DEFAULT '{}',  -- Additional context

    -- Review status
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'merged', 'rejected', 'deferred')),
    reviewed_by UUID REFERENCES trapper.staff(staff_id),
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Prevent duplicate candidates
    UNIQUE (cat_id_a, cat_id_b)
);

-- Ensure cat_id_a < cat_id_b to avoid A-B and B-A duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_cat_merge_ordered
ON trapper.cat_merge_candidates (LEAST(cat_id_a, cat_id_b), GREATEST(cat_id_a, cat_id_b));

-- Index for finding pending reviews
CREATE INDEX IF NOT EXISTS idx_cat_merge_pending
ON trapper.cat_merge_candidates (status) WHERE status = 'pending';

COMMENT ON TABLE trapper.cat_merge_candidates IS
'Queue of potential cat duplicates for staff review.
Auto-populated when cats match on owner+name+sex but lack microchip match.
Staff can merge, reject, or defer.';

\echo 'Created cat_merge_candidates table'

-- ============================================================================
-- Step 2: Function to find potential cat duplicates
-- ============================================================================

\echo ''
\echo 'Step 2: Creating find_cat_duplicates function...'

CREATE OR REPLACE FUNCTION trapper.find_cat_duplicates()
RETURNS TABLE (
    cat_id_a UUID,
    cat_id_b UUID,
    name_a TEXT,
    name_b TEXT,
    owner_email TEXT,
    match_reason TEXT,
    match_confidence NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH cats_with_owners AS (
        -- Get cats with their owner's email
        SELECT
            c.cat_id,
            c.display_name,
            c.sex,
            c.microchip,
            pi.id_value_norm as owner_email
        FROM trapper.sot_cats c
        JOIN trapper.person_cat_relationships pcr ON pcr.cat_id = c.cat_id
            AND pcr.relationship_type = 'owner'
        JOIN trapper.person_identifiers pi ON pi.person_id = pcr.person_id
            AND pi.id_type = 'email'
        WHERE c.merged_into_cat_id IS NULL
    )
    SELECT DISTINCT
        a.cat_id as cat_id_a,
        b.cat_id as cat_id_b,
        a.display_name as name_a,
        b.display_name as name_b,
        a.owner_email,
        'same_owner_same_name' as match_reason,
        CASE
            WHEN a.sex = b.sex THEN 0.85
            WHEN a.sex IS NULL OR b.sex IS NULL THEN 0.70
            ELSE 0.50  -- Different sex, less likely same cat
        END as match_confidence
    FROM cats_with_owners a
    JOIN cats_with_owners b ON a.cat_id < b.cat_id  -- Avoid duplicates
        AND a.owner_email = b.owner_email
        AND LOWER(a.display_name) = LOWER(b.display_name)
        AND (a.microchip IS NULL OR b.microchip IS NULL OR a.microchip != b.microchip)
    WHERE NOT EXISTS (
        -- Skip if already in candidates table
        SELECT 1 FROM trapper.cat_merge_candidates cmc
        WHERE (cmc.cat_id_a = a.cat_id AND cmc.cat_id_b = b.cat_id)
           OR (cmc.cat_id_a = b.cat_id AND cmc.cat_id_b = a.cat_id)
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_cat_duplicates IS
'Find potential cat duplicates based on same owner + same name.
Returns pairs not already in cat_merge_candidates table.';

\echo 'Created find_cat_duplicates function'

-- ============================================================================
-- Step 3: Function to populate merge candidates
-- ============================================================================

\echo ''
\echo 'Step 3: Creating populate_cat_merge_candidates function...'

CREATE OR REPLACE FUNCTION trapper.populate_cat_merge_candidates()
RETURNS TABLE (
    candidates_added INT,
    candidates_total INT
) AS $$
DECLARE
    v_added INT := 0;
    v_dup RECORD;
BEGIN
    FOR v_dup IN SELECT * FROM trapper.find_cat_duplicates() LOOP
        INSERT INTO trapper.cat_merge_candidates (
            cat_id_a, cat_id_b, match_reason, match_confidence,
            match_details
        )
        VALUES (
            v_dup.cat_id_a,
            v_dup.cat_id_b,
            v_dup.match_reason,
            v_dup.match_confidence,
            jsonb_build_object(
                'name_a', v_dup.name_a,
                'name_b', v_dup.name_b,
                'owner_email', v_dup.owner_email
            )
        )
        ON CONFLICT DO NOTHING;

        GET DIAGNOSTICS v_added = ROW_COUNT;
    END LOOP;

    RETURN QUERY SELECT
        v_added,
        (SELECT COUNT(*)::INT FROM trapper.cat_merge_candidates WHERE status = 'pending');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.populate_cat_merge_candidates IS
'Scan for potential cat duplicates and add to review queue.
Run periodically after data imports.';

\echo 'Created populate_cat_merge_candidates function'

-- ============================================================================
-- Step 4: Function to execute cat merge
-- ============================================================================

\echo ''
\echo 'Step 4: Creating execute_cat_merge function...'

CREATE OR REPLACE FUNCTION trapper.execute_cat_merge(
    p_candidate_id UUID,
    p_keep_cat_id UUID,  -- Which cat to keep
    p_staff_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_candidate RECORD;
    v_merge_cat_id UUID;
BEGIN
    -- Get candidate
    SELECT * INTO v_candidate
    FROM trapper.cat_merge_candidates
    WHERE candidate_id = p_candidate_id;

    IF v_candidate IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Candidate not found');
    END IF;

    IF v_candidate.status != 'pending' THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Candidate already processed');
    END IF;

    -- Determine which cat to merge
    IF p_keep_cat_id = v_candidate.cat_id_a THEN
        v_merge_cat_id := v_candidate.cat_id_b;
    ELSIF p_keep_cat_id = v_candidate.cat_id_b THEN
        v_merge_cat_id := v_candidate.cat_id_a;
    ELSE
        RETURN jsonb_build_object('success', FALSE, 'error', 'keep_cat_id must be one of the candidate cats');
    END IF;

    -- Mark the merged cat
    UPDATE trapper.sot_cats
    SET merged_into_cat_id = p_keep_cat_id,
        merge_reason = 'duplicate_merge',
        merged_at = NOW(),
        updated_at = NOW()
    WHERE cat_id = v_merge_cat_id;

    -- Move relationships to the kept cat
    UPDATE trapper.person_cat_relationships
    SET cat_id = p_keep_cat_id
    WHERE cat_id = v_merge_cat_id;

    UPDATE trapper.cat_place_relationships
    SET cat_id = p_keep_cat_id
    WHERE cat_id = v_merge_cat_id;

    -- Copy identifiers to kept cat (avoid duplicates)
    INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system)
    SELECT p_keep_cat_id, id_type, id_value, source_system
    FROM trapper.cat_identifiers
    WHERE cat_id = v_merge_cat_id
    ON CONFLICT (id_type, id_value) DO NOTHING;

    -- Update candidate status
    UPDATE trapper.cat_merge_candidates
    SET status = 'merged',
        reviewed_by = p_staff_id,
        reviewed_at = NOW(),
        review_notes = p_notes,
        updated_at = NOW()
    WHERE candidate_id = p_candidate_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'kept_cat_id', p_keep_cat_id,
        'merged_cat_id', v_merge_cat_id
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.execute_cat_merge IS
'Execute a cat merge from the candidates queue.
Marks one cat as merged into the other and moves relationships.';

\echo 'Created execute_cat_merge function'

-- ============================================================================
-- Step 5: Function to reject merge candidate
-- ============================================================================

\echo ''
\echo 'Step 5: Creating reject_cat_merge function...'

CREATE OR REPLACE FUNCTION trapper.reject_cat_merge(
    p_candidate_id UUID,
    p_staff_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
BEGIN
    UPDATE trapper.cat_merge_candidates
    SET status = 'rejected',
        reviewed_by = p_staff_id,
        reviewed_at = NOW(),
        review_notes = COALESCE(p_notes, 'Not duplicates'),
        updated_at = NOW()
    WHERE candidate_id = p_candidate_id
      AND status = 'pending';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Candidate not found or already processed');
    END IF;

    RETURN jsonb_build_object('success', TRUE);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.reject_cat_merge IS
'Reject a cat merge candidate (mark as not duplicates).';

\echo 'Created reject_cat_merge function'

-- ============================================================================
-- Step 6: View for merge review queue
-- ============================================================================

\echo ''
\echo 'Step 6: Creating cat merge review view...'

CREATE OR REPLACE VIEW trapper.v_cat_merge_review AS
SELECT
    cmc.candidate_id,
    cmc.status,
    cmc.match_reason,
    cmc.match_confidence,
    cmc.created_at,

    -- Cat A details
    cmc.cat_id_a,
    ca.display_name as cat_a_name,
    ca.sex as cat_a_sex,
    ca.microchip as cat_a_microchip,
    ca.altered_status as cat_a_altered,

    -- Cat B details
    cmc.cat_id_b,
    cb.display_name as cat_b_name,
    cb.sex as cat_b_sex,
    cb.microchip as cat_b_microchip,
    cb.altered_status as cat_b_altered,

    -- Shared owner email
    cmc.match_details->>'owner_email' as owner_email,

    -- Reviewer
    s.display_name as reviewed_by_name,
    cmc.reviewed_at,
    cmc.review_notes

FROM trapper.cat_merge_candidates cmc
JOIN trapper.sot_cats ca ON ca.cat_id = cmc.cat_id_a
JOIN trapper.sot_cats cb ON cb.cat_id = cmc.cat_id_b
LEFT JOIN trapper.staff s ON s.staff_id = cmc.reviewed_by
ORDER BY
    CASE cmc.status WHEN 'pending' THEN 0 ELSE 1 END,
    cmc.match_confidence DESC,
    cmc.created_at DESC;

COMMENT ON VIEW trapper.v_cat_merge_review IS
'Cat merge candidates with full details for review queue.';

\echo 'Created v_cat_merge_review view'

-- ============================================================================
-- Step 7: Summary
-- ============================================================================

\echo ''
\echo '=== MIG_484 Complete ==='
\echo ''
\echo 'Created cat merge infrastructure:'
\echo '  - cat_merge_candidates: Table for duplicate review queue'
\echo '  - find_cat_duplicates(): Find potential duplicates'
\echo '  - populate_cat_merge_candidates(): Add duplicates to queue'
\echo '  - execute_cat_merge(): Merge cats and move relationships'
\echo '  - reject_cat_merge(): Mark as not duplicates'
\echo '  - v_cat_merge_review: View for review UI'
\echo ''
\echo 'Usage:'
\echo '  SELECT * FROM trapper.populate_cat_merge_candidates();'
\echo '  SELECT * FROM trapper.v_cat_merge_review WHERE status = ''pending'';'
\echo ''

