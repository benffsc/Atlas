\echo ''
\echo '=============================================='
\echo 'MIG_534: Cat Count Semantic Shift'
\echo '=============================================='
\echo ''
\echo 'This migration separates two concepts that were conflated:'
\echo '  - estimated_cat_count: "Cats needing TNR" (operational tracking)'
\echo '  - total_cats_reported: "Total cats at location" (colony estimation)'
\echo ''
\echo 'Legacy requests are marked with cat_count_semantic = legacy_total'
\echo 'New requests use cat_count_semantic = needs_tnr'
\echo ''

-- ============================================================================
-- PART 1: Schema Changes to sot_requests
-- ============================================================================

\echo 'Adding new columns to sot_requests...'

-- Add total_cats_reported for colony size (separate from TNR target)
ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS total_cats_reported INTEGER;

-- Add semantic flag to distinguish old vs new meaning
ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS cat_count_semantic TEXT DEFAULT 'needs_tnr';

-- Add check constraint for valid values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sot_requests_cat_count_semantic_check'
    ) THEN
        ALTER TABLE trapper.sot_requests
        ADD CONSTRAINT sot_requests_cat_count_semantic_check
        CHECK (cat_count_semantic IN ('legacy_total', 'needs_tnr'));
    END IF;
END $$;

-- Update column comments
COMMENT ON COLUMN trapper.sot_requests.estimated_cat_count IS
'Cats STILL NEEDING TNR at this location. NOT total colony size.
For legacy requests (cat_count_semantic = legacy_total), this may mean total cats.
New requests should always use this as "cats needing TNR".';

COMMENT ON COLUMN trapper.sot_requests.total_cats_reported IS
'Total cats initially reported at location (optional). Used for colony estimation.
Separate from estimated_cat_count which tracks TNR progress.
For legacy requests, this is backfilled from estimated_cat_count.';

COMMENT ON COLUMN trapper.sot_requests.cat_count_semantic IS
'Indicates the meaning of estimated_cat_count:
- legacy_total: Old semantic - estimated_cat_count means total colony size
- needs_tnr: New semantic - estimated_cat_count means cats still needing TNR';

\echo 'sot_requests columns added.'

-- ============================================================================
-- PART 2: Schema Changes to web_intake_submissions
-- ============================================================================

\echo 'Adding cats_needing_tnr to web_intake_submissions...'

ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS cats_needing_tnr INTEGER;

COMMENT ON COLUMN trapper.web_intake_submissions.cats_needing_tnr IS
'Cats requester believes STILL NEED spay/neuter. Maps to request.estimated_cat_count.
Distinct from cat_count_estimate (total cats) which is used for colony estimation.
For colony calls: cat_count_estimate = total, cats_needing_tnr = unfixed.
For single strays: both fields may be the same.';

\echo 'web_intake_submissions column added.'

-- ============================================================================
-- PART 3: Data Migration - Mark existing requests as legacy
-- ============================================================================

\echo 'Marking existing requests with legacy semantic...'

-- First, set NULL values to legacy (existing requests)
UPDATE trapper.sot_requests
SET cat_count_semantic = 'legacy_total'
WHERE cat_count_semantic IS NULL;

-- Count affected
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM trapper.sot_requests
    WHERE cat_count_semantic = 'legacy_total';

    RAISE NOTICE 'Marked % requests with legacy_total semantic', v_count;
END $$;

-- ============================================================================
-- PART 4: Backfill total_cats_reported for legacy requests
-- ============================================================================

\echo 'Backfilling total_cats_reported from legacy estimated_cat_count...'

UPDATE trapper.sot_requests
SET total_cats_reported = estimated_cat_count
WHERE total_cats_reported IS NULL
  AND estimated_cat_count IS NOT NULL
  AND cat_count_semantic = 'legacy_total';

-- Count affected
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM trapper.sot_requests
    WHERE total_cats_reported IS NOT NULL;

    RAISE NOTICE 'Backfilled total_cats_reported for % requests', v_count;
END $$;

-- ============================================================================
-- PART 5: Update Colony Estimate Trigger Function
-- ============================================================================

\echo 'Updating add_colony_estimate_from_request function...'

CREATE OR REPLACE FUNCTION trapper.add_colony_estimate_from_request(
    p_request_id UUID
) RETURNS UUID AS $$
DECLARE
    v_request RECORD;
    v_estimate_id UUID;
    v_total_cats INTEGER;
    v_existing UUID;
BEGIN
    -- Get request details
    SELECT
        request_id, place_id, requester_person_id,
        estimated_cat_count, total_cats_reported,
        kitten_count, eartip_count, cat_count_semantic,
        source_created_at, source_system, source_record_id
    INTO v_request
    FROM trapper.sot_requests
    WHERE request_id = p_request_id;

    -- Skip if no request or no place
    IF v_request IS NULL OR v_request.place_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Check for existing estimate from this request (idempotent)
    SELECT estimate_id INTO v_existing
    FROM trapper.place_colony_estimates
    WHERE source_entity_type = 'request'
      AND source_entity_id = v_request.request_id;

    IF v_existing IS NOT NULL THEN
        RETURN v_existing;
    END IF;

    -- Determine total cats for colony estimation based on semantic
    -- CRITICAL: For colony estimates, we want TOTAL cats, not just TNR target
    v_total_cats := CASE
        WHEN v_request.cat_count_semantic = 'legacy_total' THEN
            -- Legacy: estimated_cat_count IS the total
            v_request.estimated_cat_count
        ELSE
            -- New semantic: prefer total_cats_reported, fall back to estimated_cat_count
            COALESCE(v_request.total_cats_reported, v_request.estimated_cat_count)
    END;

    -- Skip if no cat count data at all
    IF v_total_cats IS NULL AND v_request.kitten_count IS NULL THEN
        RETURN NULL;
    END IF;

    -- Determine source type based on request source
    -- trapping_request has 60% confidence, intake_form has 55%
    INSERT INTO trapper.place_colony_estimates (
        estimate_id,
        place_id,
        total_cats,
        kitten_count,
        altered_count,
        source_type,
        source_entity_type,
        source_entity_id,
        reported_by_person_id,
        observation_date,
        reported_at,
        is_firsthand,
        source_system,
        source_record_id
    ) VALUES (
        gen_random_uuid(),
        v_request.place_id,
        v_total_cats,
        v_request.kitten_count,
        v_request.eartip_count,
        CASE
            WHEN v_request.source_system = 'web_intake' THEN 'intake_form'
            ELSE 'trapping_request'
        END,
        'request',
        v_request.request_id,
        v_request.requester_person_id,
        COALESCE(v_request.source_created_at::date, CURRENT_DATE),
        COALESCE(v_request.source_created_at, NOW()),
        TRUE,
        v_request.source_system,
        v_request.source_record_id
    )
    RETURNING estimate_id INTO v_estimate_id;

    RETURN v_estimate_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.add_colony_estimate_from_request IS
'Creates a colony estimate from a request. Uses total_cats_reported for colony size
(new semantic) or estimated_cat_count for legacy requests. This ensures colony
estimates reflect TOTAL cats, not just cats needing TNR.';

\echo 'Colony estimate trigger function updated.'

-- ============================================================================
-- PART 6: Create Helper View for UI
-- ============================================================================

\echo 'Creating v_request_cat_counts helper view...'

CREATE OR REPLACE VIEW trapper.v_request_cat_counts AS
SELECT
    r.request_id,
    r.estimated_cat_count AS cats_needing_tnr,
    r.total_cats_reported,
    r.cat_count_semantic,
    r.kitten_count,
    r.eartip_count,
    -- Computed: effective total for display
    CASE
        WHEN r.cat_count_semantic = 'legacy_total' THEN r.estimated_cat_count
        ELSE COALESCE(r.total_cats_reported, r.estimated_cat_count)
    END AS effective_total_cats,
    -- Is this a legacy request that might need clarification?
    (r.cat_count_semantic = 'legacy_total' AND r.total_cats_reported IS NULL) AS needs_clarification
FROM trapper.sot_requests r;

COMMENT ON VIEW trapper.v_request_cat_counts IS
'Helper view for displaying cat counts with correct semantics.
- cats_needing_tnr: For new requests, this is the TNR target
- effective_total_cats: For colony estimation, this is the total
- needs_clarification: TRUE if legacy request with ambiguous count';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_534 Complete!'
\echo '=============================================='
\echo ''
\echo 'Schema changes:'
\echo '  - sot_requests.total_cats_reported (new): Total cats at location'
\echo '  - sot_requests.cat_count_semantic (new): legacy_total or needs_tnr'
\echo '  - web_intake_submissions.cats_needing_tnr (new): Cats needing TNR'
\echo ''
\echo 'Data migration:'
\echo '  - All existing requests marked as legacy_total'
\echo '  - total_cats_reported backfilled from estimated_cat_count'
\echo ''
\echo 'Trigger update:'
\echo '  - add_colony_estimate_from_request now uses total_cats_reported'
\echo '    for new requests, estimated_cat_count for legacy'
\echo ''
\echo 'New view:'
\echo '  - v_request_cat_counts: Helper for UI display'
\echo ''
\echo 'Next steps:'
\echo '  1. Update UI labels to say "Cats Needing TNR"'
\echo '  2. Update intake form to collect both total and TNR counts'
\echo '  3. Add clarification step to LegacyUpgradeWizard'
\echo ''
