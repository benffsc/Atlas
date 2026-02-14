\echo '=== MIG_485: Place Quality & Google Deduplication ==='
\echo 'Adds google_place_id to places table and creates merge candidate infrastructure'
\echo ''

-- ============================================================================
-- PURPOSE
-- 1. Add google_place_id directly to places table for deduplication
-- 2. Sync existing google_place_id from sot_addresses
-- 3. Create place_merge_candidates table for duplicate review
-- 4. Create functions for finding nearby duplicates
-- ============================================================================

\echo 'Step 1: Adding google_place_id to places table...'

-- Add google_place_id column
ALTER TABLE trapper.places ADD COLUMN IF NOT EXISTS
    google_place_id TEXT;

-- Add is_google_verified flag
ALTER TABLE trapper.places ADD COLUMN IF NOT EXISTS
    is_google_verified BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN trapper.places.google_place_id IS
'Google Place ID for deduplication. Two places with same google_place_id are the same physical location.';

COMMENT ON COLUMN trapper.places.is_google_verified IS
'TRUE if this place has been verified via Google Maps geocoding.';

-- Create unique index on google_place_id (partial - only non-null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_places_google_place_id
ON trapper.places(google_place_id)
WHERE google_place_id IS NOT NULL AND merged_into_place_id IS NULL;

\echo 'Added google_place_id column to places'

-- ============================================================================
-- Step 2: Sync google_place_id from sot_addresses
-- ============================================================================

\echo ''
\echo 'Step 2: Syncing google_place_id from sot_addresses...'

UPDATE trapper.places p
SET google_place_id = sa.google_place_id,
    is_google_verified = TRUE,
    updated_at = NOW()
FROM trapper.sot_addresses sa
WHERE p.sot_address_id = sa.sot_address_id
  AND sa.google_place_id IS NOT NULL
  AND p.google_place_id IS NULL;

\echo 'Synced google_place_id from sot_addresses'

-- ============================================================================
-- Step 3: Create place_merge_candidates table
-- ============================================================================

\echo ''
\echo 'Step 3: Creating place_merge_candidates table...'

CREATE TABLE IF NOT EXISTS trapper.place_merge_candidates (
    candidate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The two places that might be duplicates
    place_id_a UUID NOT NULL REFERENCES trapper.places(place_id),
    place_id_b UUID NOT NULL REFERENCES trapper.places(place_id),

    -- Match details
    match_reason TEXT NOT NULL,  -- 'same_google_id', 'normalized_match', 'within_50m'
    distance_meters NUMERIC,  -- Distance between places (if applicable)
    match_confidence NUMERIC(3,2) CHECK (match_confidence BETWEEN 0 AND 1),
    match_details JSONB DEFAULT '{}',

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
    UNIQUE (place_id_a, place_id_b)
);

-- Ensure place_id_a < place_id_b to avoid A-B and B-A duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_place_merge_ordered
ON trapper.place_merge_candidates (LEAST(place_id_a, place_id_b), GREATEST(place_id_a, place_id_b));

-- Index for finding pending reviews
CREATE INDEX IF NOT EXISTS idx_place_merge_pending
ON trapper.place_merge_candidates (status) WHERE status = 'pending';

COMMENT ON TABLE trapper.place_merge_candidates IS
'Queue of potential place duplicates for staff review.
Created when places are within 50m or have similar addresses.';

\echo 'Created place_merge_candidates table'

-- ============================================================================
-- Step 4: Function to find nearby place duplicates
-- ============================================================================

\echo ''
\echo 'Step 4: Creating find_nearby_place_duplicates function...'

CREATE OR REPLACE FUNCTION trapper.find_nearby_place_duplicates(
    p_max_distance_meters NUMERIC DEFAULT 50
)
RETURNS TABLE (
    place_id_a UUID,
    place_id_b UUID,
    distance_m NUMERIC,
    addr_a TEXT,
    addr_b TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        a.place_id as place_id_a,
        b.place_id as place_id_b,
        ST_Distance(a.location::geography, b.location::geography) as distance_m,
        a.formatted_address as addr_a,
        b.formatted_address as addr_b
    FROM trapper.places a
    JOIN trapper.places b ON a.place_id < b.place_id
        AND ST_DWithin(a.location::geography, b.location::geography, p_max_distance_meters)
    WHERE a.merged_into_place_id IS NULL
      AND b.merged_into_place_id IS NULL
      AND a.location IS NOT NULL
      AND b.location IS NOT NULL
      AND NOT EXISTS (
          -- Skip if already in candidates
          SELECT 1 FROM trapper.place_merge_candidates pmc
          WHERE (pmc.place_id_a = a.place_id AND pmc.place_id_b = b.place_id)
             OR (pmc.place_id_a = b.place_id AND pmc.place_id_b = a.place_id)
      );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_nearby_place_duplicates IS
'Find places within specified distance that might be duplicates.
Default: 50 meters.';

\echo 'Created find_nearby_place_duplicates function'

-- ============================================================================
-- Step 5: Function to populate place merge candidates
-- ============================================================================

\echo ''
\echo 'Step 5: Creating populate_place_merge_candidates function...'

CREATE OR REPLACE FUNCTION trapper.populate_place_merge_candidates()
RETURNS TABLE (
    candidates_added INT,
    candidates_total INT
) AS $$
DECLARE
    v_added INT := 0;
    v_dup RECORD;
BEGIN
    -- Find nearby duplicates (within 50m)
    FOR v_dup IN SELECT * FROM trapper.find_nearby_place_duplicates(50) LOOP
        INSERT INTO trapper.place_merge_candidates (
            place_id_a, place_id_b, match_reason, distance_meters,
            match_confidence, match_details
        )
        VALUES (
            v_dup.place_id_a,
            v_dup.place_id_b,
            'within_50m',
            v_dup.distance_m,
            CASE
                WHEN v_dup.distance_m < 10 THEN 0.95
                WHEN v_dup.distance_m < 25 THEN 0.85
                ELSE 0.70
            END,
            jsonb_build_object(
                'address_a', v_dup.addr_a,
                'address_b', v_dup.addr_b,
                'distance_meters', v_dup.distance_m
            )
        )
        ON CONFLICT DO NOTHING;

        GET DIAGNOSTICS v_added = v_added + ROW_COUNT;
    END LOOP;

    RETURN QUERY SELECT
        v_added,
        (SELECT COUNT(*)::INT FROM trapper.place_merge_candidates WHERE status = 'pending');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.populate_place_merge_candidates IS
'Scan for potential place duplicates and add to review queue.
Run periodically after geocoding completes.';

\echo 'Created populate_place_merge_candidates function'

-- ============================================================================
-- Step 6: Function to execute place merge
-- ============================================================================

\echo ''
\echo 'Step 6: Creating execute_place_merge function...'

CREATE OR REPLACE FUNCTION trapper.execute_place_merge(
    p_candidate_id UUID,
    p_keep_place_id UUID,  -- Which place to keep
    p_staff_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_candidate RECORD;
    v_merge_place_id UUID;
BEGIN
    -- Get candidate
    SELECT * INTO v_candidate
    FROM trapper.place_merge_candidates
    WHERE candidate_id = p_candidate_id;

    IF v_candidate IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Candidate not found');
    END IF;

    IF v_candidate.status != 'pending' THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Candidate already processed');
    END IF;

    -- Determine which place to merge
    IF p_keep_place_id = v_candidate.place_id_a THEN
        v_merge_place_id := v_candidate.place_id_b;
    ELSIF p_keep_place_id = v_candidate.place_id_b THEN
        v_merge_place_id := v_candidate.place_id_a;
    ELSE
        RETURN jsonb_build_object('success', FALSE, 'error', 'keep_place_id must be one of the candidate places');
    END IF;

    -- Mark the merged place
    UPDATE trapper.places
    SET merged_into_place_id = p_keep_place_id,
        merge_reason = 'duplicate_merge',
        merged_at = NOW(),
        updated_at = NOW()
    WHERE place_id = v_merge_place_id;

    -- Move relationships to the kept place
    UPDATE trapper.person_place_relationships
    SET place_id = p_keep_place_id
    WHERE place_id = v_merge_place_id;

    UPDATE trapper.cat_place_relationships
    SET place_id = p_keep_place_id
    WHERE place_id = v_merge_place_id;

    UPDATE trapper.sot_requests
    SET primary_place_id = p_keep_place_id
    WHERE primary_place_id = v_merge_place_id;

    -- Update colony estimates
    UPDATE trapper.place_colony_estimates
    SET place_id = p_keep_place_id
    WHERE place_id = v_merge_place_id
    ON CONFLICT DO NOTHING;

    -- Update candidate status
    UPDATE trapper.place_merge_candidates
    SET status = 'merged',
        reviewed_by = p_staff_id,
        reviewed_at = NOW(),
        review_notes = p_notes,
        updated_at = NOW()
    WHERE candidate_id = p_candidate_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'kept_place_id', p_keep_place_id,
        'merged_place_id', v_merge_place_id
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.execute_place_merge IS
'Execute a place merge from the candidates queue.
Marks one place as merged into the other and moves relationships.';

\echo 'Created execute_place_merge function'

-- ============================================================================
-- Step 7: View for place merge review
-- ============================================================================

\echo ''
\echo 'Step 7: Creating place merge review view...'

CREATE OR REPLACE VIEW trapper.v_place_merge_review AS
SELECT
    pmc.candidate_id,
    pmc.status,
    pmc.match_reason,
    pmc.distance_meters,
    pmc.match_confidence,
    pmc.created_at,

    -- Place A details
    pmc.place_id_a,
    pa.formatted_address as place_a_address,
    pa.display_name as place_a_name,
    pa.google_place_id as place_a_google_id,
    ST_Y(pa.location::geometry) as place_a_lat,
    ST_X(pa.location::geometry) as place_a_lng,

    -- Place B details
    pmc.place_id_b,
    pb.formatted_address as place_b_address,
    pb.display_name as place_b_name,
    pb.google_place_id as place_b_google_id,
    ST_Y(pb.location::geometry) as place_b_lat,
    ST_X(pb.location::geometry) as place_b_lng,

    -- Reviewer
    s.display_name as reviewed_by_name,
    pmc.reviewed_at,
    pmc.review_notes

FROM trapper.place_merge_candidates pmc
JOIN trapper.places pa ON pa.place_id = pmc.place_id_a
JOIN trapper.places pb ON pb.place_id = pmc.place_id_b
LEFT JOIN trapper.staff s ON s.staff_id = pmc.reviewed_by
ORDER BY
    CASE pmc.status WHEN 'pending' THEN 0 ELSE 1 END,
    pmc.match_confidence DESC,
    pmc.distance_meters ASC NULLS LAST,
    pmc.created_at DESC;

COMMENT ON VIEW trapper.v_place_merge_review IS
'Place merge candidates with full details for review queue.';

\echo 'Created v_place_merge_review view'

-- ============================================================================
-- Step 8: Summary
-- ============================================================================

\echo ''
\echo '=== MIG_485 Complete ==='
\echo ''
\echo 'Place quality infrastructure:'
\echo '  - Added google_place_id and is_google_verified to places table'
\echo '  - Synced existing google_place_id from sot_addresses'
\echo '  - Created place_merge_candidates table'
\echo '  - find_nearby_place_duplicates(): Find places within distance'
\echo '  - populate_place_merge_candidates(): Add duplicates to queue'
\echo '  - execute_place_merge(): Merge places and move relationships'
\echo '  - v_place_merge_review: View for review UI'
\echo ''
\echo 'Usage:'
\echo '  SELECT * FROM trapper.populate_place_merge_candidates();'
\echo '  SELECT * FROM trapper.v_place_merge_review WHERE status = ''pending'';'
\echo ''

