\echo '=== MIG_633: Cat Duplicate Detection ==='
\echo 'Creates views and functions to detect and merge duplicate cat records'
\echo ''

-- ============================================================================
-- PURPOSE
-- Even with advisory locking (MIG_632), duplicates may already exist or slip
-- through edge cases. This migration provides:
-- 1. Detection view for potential duplicates
-- 2. Tracking table for flagged candidates
-- 3. Merge function for resolving duplicates
-- ============================================================================

-- Enable pg_trgm for similarity matching (if not already enabled)
\echo 'Step 1: Ensuring pg_trgm extension is available...'
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- Step 2: View to detect potential duplicate cats
-- ============================================================================

\echo ''
\echo 'Step 2: Creating v_potential_cat_duplicates view...'

CREATE OR REPLACE VIEW trapper.v_potential_cat_duplicates AS
WITH microchip_pairs AS (
    -- Find microchip pairs with high similarity
    SELECT
        c1.cat_id AS cat1_id,
        c2.cat_id AS cat2_id,
        c1_chip.id_value AS chip1,
        c2_chip.id_value AS chip2,
        c1.display_name AS name1,
        c2.display_name AS name2,
        c1.data_source AS source1,
        c2.data_source AS source2,
        similarity(c1_chip.id_value, c2_chip.id_value) AS microchip_similarity,
        -- Calculate edit distance for microchips
        tiger.levenshtein(c1_chip.id_value, c2_chip.id_value) AS edit_distance
    FROM trapper.sot_cats c1
    JOIN trapper.cat_identifiers c1_chip ON c1_chip.cat_id = c1.cat_id
        AND c1_chip.id_type = 'microchip'
    JOIN trapper.cat_identifiers c2_chip ON c2_chip.id_type = 'microchip'
        AND c1_chip.id_value != c2_chip.id_value  -- Different microchips
        AND c1.cat_id < c2_chip.cat_id  -- Avoid duplicate pairs
    JOIN trapper.sot_cats c2 ON c2.cat_id = c2_chip.cat_id
    WHERE c1.merged_into_cat_id IS NULL
      AND c2.merged_into_cat_id IS NULL
      AND LENGTH(c1_chip.id_value) >= 10  -- Only valid microchips
      AND LENGTH(c2_chip.id_value) >= 10
)
SELECT
    cat1_id,
    cat2_id,
    chip1,
    chip2,
    name1,
    name2,
    source1,
    source2,
    microchip_similarity,
    edit_distance,
    -- Confidence that these are duplicates
    CASE
        WHEN edit_distance = 1 THEN 0.95  -- Off by one digit
        WHEN edit_distance = 2 THEN 0.80  -- Off by two digits
        WHEN microchip_similarity > 0.9 THEN 0.70
        WHEN microchip_similarity > 0.8 THEN 0.50
        ELSE 0.30
    END AS duplicate_confidence,
    -- Likely cause
    CASE
        WHEN edit_distance = 1 THEN 'typo_single_digit'
        WHEN edit_distance = 2 THEN 'typo_two_digits'
        WHEN chip1 LIKE chip2 || '%' OR chip2 LIKE chip1 || '%' THEN 'truncation'
        ELSE 'unknown'
    END AS likely_cause
FROM microchip_pairs
WHERE edit_distance <= 3  -- Within 3 edits
   OR microchip_similarity > 0.8  -- Or very similar
ORDER BY duplicate_confidence DESC, edit_distance ASC;

COMMENT ON VIEW trapper.v_potential_cat_duplicates IS
'Detects potential duplicate cat records based on microchip similarity.

Uses Levenshtein edit distance and trigram similarity to find cats that
may be duplicates due to typos, truncation, or data entry errors.

Columns:
- cat1_id, cat2_id: The two cats being compared
- chip1, chip2: Their microchip values
- edit_distance: Number of edits to transform one chip to other
- duplicate_confidence: Probability these are duplicates (0-1)
- likely_cause: typo_single_digit, typo_two_digits, truncation, unknown';

\echo 'Created v_potential_cat_duplicates view'

-- ============================================================================
-- Step 3: Table to track duplicate candidates
-- ============================================================================

\echo ''
\echo 'Step 3: Creating cat_duplicate_candidates table...'

CREATE TABLE IF NOT EXISTS trapper.cat_duplicate_candidates (
    candidate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat1_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),
    cat2_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),
    duplicate_confidence NUMERIC(3,2) NOT NULL,
    likely_cause TEXT,
    detection_source TEXT DEFAULT 'auto',  -- 'auto', 'manual'
    flagged_at TIMESTAMPTZ DEFAULT NOW(),
    -- Resolution
    resolution TEXT CHECK (resolution IN ('merged', 'not_duplicate', 'pending')),
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    resolution_notes TEXT,
    -- Ensure unique pairs
    CONSTRAINT uq_cat_duplicate_pair UNIQUE (cat1_id, cat2_id),
    CONSTRAINT check_different_cats CHECK (cat1_id != cat2_id),
    -- Always store smaller ID first to prevent reverse duplicates
    CONSTRAINT check_ordered_ids CHECK (cat1_id < cat2_id)
);

CREATE INDEX IF NOT EXISTS idx_cat_duplicate_candidates_pending
    ON trapper.cat_duplicate_candidates(resolution) WHERE resolution = 'pending';

CREATE INDEX IF NOT EXISTS idx_cat_duplicate_candidates_confidence
    ON trapper.cat_duplicate_candidates(duplicate_confidence DESC);

COMMENT ON TABLE trapper.cat_duplicate_candidates IS
'Tracks potential duplicate cat records for review and resolution.
Populated automatically by detection job or manually flagged by staff.';

\echo 'Created cat_duplicate_candidates table'

-- ============================================================================
-- Step 4: Function to flag new duplicates
-- ============================================================================

\echo ''
\echo 'Step 4: Creating flag_cat_duplicates function...'

CREATE OR REPLACE FUNCTION trapper.flag_cat_duplicates(
    p_confidence_threshold NUMERIC DEFAULT 0.7
)
RETURNS TABLE (
    flagged_count INT,
    highest_confidence NUMERIC,
    by_cause JSONB
) AS $$
DECLARE
    v_flagged INT := 0;
    v_highest NUMERIC;
    v_by_cause JSONB;
BEGIN
    -- Insert new candidates that haven't been flagged yet
    WITH new_candidates AS (
        INSERT INTO trapper.cat_duplicate_candidates (
            cat1_id, cat2_id, duplicate_confidence, likely_cause,
            detection_source, resolution
        )
        SELECT
            LEAST(cat1_id, cat2_id),  -- Ensure smaller ID first
            GREATEST(cat1_id, cat2_id),
            duplicate_confidence,
            likely_cause,
            'auto',
            'pending'
        FROM trapper.v_potential_cat_duplicates
        WHERE duplicate_confidence >= p_confidence_threshold
        ON CONFLICT (cat1_id, cat2_id) DO NOTHING
        RETURNING *
    )
    SELECT COUNT(*) INTO v_flagged FROM new_candidates;

    -- Get statistics
    SELECT MAX(duplicate_confidence) INTO v_highest
    FROM trapper.cat_duplicate_candidates
    WHERE resolution = 'pending';

    SELECT jsonb_object_agg(likely_cause, cnt) INTO v_by_cause
    FROM (
        SELECT likely_cause, COUNT(*) as cnt
        FROM trapper.cat_duplicate_candidates
        WHERE resolution = 'pending'
        GROUP BY likely_cause
    ) sub;

    RETURN QUERY SELECT v_flagged, COALESCE(v_highest, 0.0), COALESCE(v_by_cause, '{}'::JSONB);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.flag_cat_duplicates IS
'Scans for potential duplicate cats and flags them for review.

Parameters:
- p_confidence_threshold: Minimum confidence to flag (default 0.7)

Returns:
- flagged_count: Number of new duplicates flagged
- highest_confidence: Highest confidence among pending
- by_cause: JSON object with counts by likely_cause';

\echo 'Created flag_cat_duplicates function'

-- ============================================================================
-- Step 5: Function to merge duplicate cats
-- ============================================================================

\echo ''
\echo 'Step 5: Creating merge_duplicate_cats function...'

CREATE OR REPLACE FUNCTION trapper.merge_duplicate_cats(
    p_keep_id UUID,
    p_merge_id UUID,
    p_resolved_by TEXT DEFAULT 'system'
)
RETURNS JSONB AS $$
DECLARE
    v_keep_cat RECORD;
    v_merge_cat RECORD;
    v_result JSONB := '{}'::JSONB;
    v_moved_identifiers INT := 0;
    v_moved_relationships INT := 0;
    v_moved_procedures INT := 0;
BEGIN
    -- Validate cats exist and aren't merged
    SELECT * INTO v_keep_cat FROM trapper.sot_cats WHERE cat_id = p_keep_id AND merged_into_cat_id IS NULL;
    SELECT * INTO v_merge_cat FROM trapper.sot_cats WHERE cat_id = p_merge_id AND merged_into_cat_id IS NULL;

    IF v_keep_cat IS NULL THEN
        RETURN jsonb_build_object('error', 'Keep cat not found or already merged');
    END IF;

    IF v_merge_cat IS NULL THEN
        RETURN jsonb_build_object('error', 'Merge cat not found or already merged');
    END IF;

    -- Move identifiers from merge cat to keep cat
    UPDATE trapper.cat_identifiers
    SET cat_id = p_keep_id
    WHERE cat_id = p_merge_id;
    GET DIAGNOSTICS v_moved_identifiers = ROW_COUNT;

    -- Move place relationships
    UPDATE trapper.cat_place_relationships
    SET cat_id = p_keep_id
    WHERE cat_id = p_merge_id
      AND NOT EXISTS (
          SELECT 1 FROM trapper.cat_place_relationships cpr2
          WHERE cpr2.cat_id = p_keep_id
            AND cpr2.place_id = cat_place_relationships.place_id
      );
    GET DIAGNOSTICS v_moved_relationships = ROW_COUNT;

    -- Delete duplicate place relationships
    DELETE FROM trapper.cat_place_relationships
    WHERE cat_id = p_merge_id;

    -- Move procedures if cat_procedures table exists
    BEGIN
        UPDATE trapper.cat_procedures
        SET cat_id = p_keep_id
        WHERE cat_id = p_merge_id;
        GET DIAGNOSTICS v_moved_procedures = ROW_COUNT;
    EXCEPTION WHEN undefined_table THEN
        -- Table doesn't exist, skip
        v_moved_procedures := 0;
    END;

    -- Move appointments
    UPDATE trapper.sot_appointments
    SET cat_id = p_keep_id
    WHERE cat_id = p_merge_id;

    -- Mark merge cat as merged
    UPDATE trapper.sot_cats
    SET merged_into_cat_id = p_keep_id,
        updated_at = NOW()
    WHERE cat_id = p_merge_id;

    -- Update duplicate candidate if exists
    UPDATE trapper.cat_duplicate_candidates
    SET resolution = 'merged',
        resolved_at = NOW(),
        resolved_by = p_resolved_by,
        resolution_notes = 'Merged ' || p_merge_id::TEXT || ' into ' || p_keep_id::TEXT
    WHERE (cat1_id = LEAST(p_keep_id, p_merge_id) AND cat2_id = GREATEST(p_keep_id, p_merge_id))
       OR (cat1_id = LEAST(p_keep_id, p_merge_id) AND cat2_id = GREATEST(p_keep_id, p_merge_id));

    -- Build result
    v_result := jsonb_build_object(
        'success', TRUE,
        'keep_cat_id', p_keep_id,
        'merged_cat_id', p_merge_id,
        'moved_identifiers', v_moved_identifiers,
        'moved_relationships', v_moved_relationships,
        'moved_procedures', v_moved_procedures
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.merge_duplicate_cats IS
'Merges a duplicate cat into another, preserving all relationships.

Parameters:
- p_keep_id: The cat to keep (survivor)
- p_merge_id: The cat to merge (will be marked as merged)
- p_resolved_by: Who resolved this (for audit)

Process:
1. Moves all identifiers to keep cat
2. Moves all place relationships (avoiding duplicates)
3. Moves all procedures and appointments
4. Marks merge cat as merged_into_cat_id

Returns: JSON with success status and counts of moved records';

\echo 'Created merge_duplicate_cats function'

-- ============================================================================
-- Step 6: View for admin review queue
-- ============================================================================

\echo ''
\echo 'Step 6: Creating v_cat_duplicate_review view...'

CREATE OR REPLACE VIEW trapper.v_cat_duplicate_review AS
SELECT
    cdc.candidate_id,
    cdc.duplicate_confidence,
    cdc.likely_cause,
    cdc.flagged_at,
    -- Cat 1 details
    c1.cat_id AS cat1_id,
    c1.display_name AS cat1_name,
    c1.data_source AS cat1_source,
    c1_chip.id_value AS cat1_microchip,
    (SELECT COUNT(*) FROM trapper.cat_place_relationships WHERE cat_id = c1.cat_id) AS cat1_places,
    (SELECT COUNT(*) FROM trapper.sot_appointments WHERE cat_id = c1.cat_id) AS cat1_appointments,
    -- Cat 2 details
    c2.cat_id AS cat2_id,
    c2.display_name AS cat2_name,
    c2.data_source AS cat2_source,
    c2_chip.id_value AS cat2_microchip,
    (SELECT COUNT(*) FROM trapper.cat_place_relationships WHERE cat_id = c2.cat_id) AS cat2_places,
    (SELECT COUNT(*) FROM trapper.sot_appointments WHERE cat_id = c2.cat_id) AS cat2_appointments,
    -- Recommendation
    CASE
        WHEN c1.data_source = 'clinichq' AND c2.data_source != 'clinichq' THEN 'Keep cat1 (ClinicHQ source)'
        WHEN c2.data_source = 'clinichq' AND c1.data_source != 'clinichq' THEN 'Keep cat2 (ClinicHQ source)'
        WHEN (SELECT COUNT(*) FROM trapper.sot_appointments WHERE cat_id = c1.cat_id) >
             (SELECT COUNT(*) FROM trapper.sot_appointments WHERE cat_id = c2.cat_id) THEN 'Keep cat1 (more appointments)'
        WHEN (SELECT COUNT(*) FROM trapper.sot_appointments WHERE cat_id = c2.cat_id) >
             (SELECT COUNT(*) FROM trapper.sot_appointments WHERE cat_id = c1.cat_id) THEN 'Keep cat2 (more appointments)'
        ELSE 'Review manually'
    END AS recommendation
FROM trapper.cat_duplicate_candidates cdc
JOIN trapper.sot_cats c1 ON c1.cat_id = cdc.cat1_id
JOIN trapper.sot_cats c2 ON c2.cat_id = cdc.cat2_id
LEFT JOIN trapper.cat_identifiers c1_chip ON c1_chip.cat_id = c1.cat_id AND c1_chip.id_type = 'microchip'
LEFT JOIN trapper.cat_identifiers c2_chip ON c2_chip.cat_id = c2.cat_id AND c2_chip.id_type = 'microchip'
WHERE cdc.resolution = 'pending'
ORDER BY cdc.duplicate_confidence DESC, cdc.flagged_at ASC;

COMMENT ON VIEW trapper.v_cat_duplicate_review IS
'Admin review queue for potential duplicate cats.
Shows both cats, their data sources, and a recommendation for which to keep.';

\echo 'Created v_cat_duplicate_review view'

-- ============================================================================
-- Step 7: Health check view
-- ============================================================================

\echo ''
\echo 'Step 7: Creating v_cat_dedup_health view...'

CREATE OR REPLACE VIEW trapper.v_cat_dedup_health AS
SELECT
    -- Pending duplicates
    (SELECT COUNT(*) FROM trapper.cat_duplicate_candidates WHERE resolution = 'pending') AS pending_review,
    -- High confidence pending
    (SELECT COUNT(*) FROM trapper.cat_duplicate_candidates WHERE resolution = 'pending' AND duplicate_confidence >= 0.9) AS high_confidence_pending,
    -- Resolved stats
    (SELECT COUNT(*) FROM trapper.cat_duplicate_candidates WHERE resolution = 'merged') AS merged_count,
    (SELECT COUNT(*) FROM trapper.cat_duplicate_candidates WHERE resolution = 'not_duplicate') AS not_duplicate_count,
    -- Microchip duplicates (exact matches - should be 0)
    (SELECT COUNT(*) FROM (
        SELECT id_value FROM trapper.cat_identifiers
        WHERE id_type = 'microchip'
        GROUP BY id_value HAVING COUNT(*) > 1
    ) sub) AS exact_microchip_duplicates,
    -- Cats with no microchip
    (SELECT COUNT(*) FROM trapper.sot_cats s
     WHERE NOT EXISTS (
         SELECT 1 FROM trapper.cat_identifiers ci
         WHERE ci.cat_id = s.cat_id AND ci.id_type = 'microchip'
     ) AND s.merged_into_cat_id IS NULL) AS cats_without_microchip,
    -- Total active cats
    (SELECT COUNT(*) FROM trapper.sot_cats WHERE merged_into_cat_id IS NULL) AS total_active_cats;

COMMENT ON VIEW trapper.v_cat_dedup_health IS
'Health metrics for cat deduplication system.
Use this to monitor for data quality issues.';

\echo 'Created v_cat_dedup_health view'

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=== MIG_633 Complete ==='
\echo ''
\echo 'Created:'
\echo '  - v_potential_cat_duplicates: Detects similar microchips'
\echo '  - cat_duplicate_candidates: Tracks flagged duplicates'
\echo '  - flag_cat_duplicates(): Scans and flags new candidates'
\echo '  - merge_duplicate_cats(): Merges confirmed duplicates'
\echo '  - v_cat_duplicate_review: Admin review queue'
\echo '  - v_cat_dedup_health: Health metrics'
\echo ''
\echo 'Usage:'
\echo '  -- Flag duplicates (run periodically)'
\echo '  SELECT * FROM trapper.flag_cat_duplicates(0.7);'
\echo ''
\echo '  -- Review pending'
\echo '  SELECT * FROM trapper.v_cat_duplicate_review;'
\echo ''
\echo '  -- Merge confirmed duplicate'
\echo '  SELECT trapper.merge_duplicate_cats(keep_id, merge_id, ''staff_name'');'
\echo ''
\echo '  -- Check health'
\echo '  SELECT * FROM trapper.v_cat_dedup_health;'
\echo ''
