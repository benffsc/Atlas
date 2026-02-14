-- MIG_622: Classification Suggestion Fields on Requests
--
-- Problem: Colony classification (MIG_615) is purely manual. We collect rich
-- intake data (ownership_status, cat counts, feeding behavior) but don't use
-- it to suggest classifications automatically.
--
-- Solution: Add fields to sot_requests to store auto-computed classification
-- suggestions based on intake signals. Staff can accept, override, or dismiss.
--
-- Key insight: ownership_status (owned/community/foster) indicates WHO is
-- responsible for the cat. classification (individual/colony) indicates HOW
-- cats aggregate at the location. These are orthogonal dimensions.

\echo ''
\echo '========================================================'
\echo 'MIG_622: Classification Suggestion Fields on Requests'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Add suggestion fields to sot_requests
-- ============================================================

\echo 'Adding classification suggestion fields to sot_requests...'

-- Suggested classification from intake signals
ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS suggested_classification trapper.colony_classification;

COMMENT ON COLUMN trapper.sot_requests.suggested_classification IS
'Auto-computed classification suggestion based on intake signals (ownership, cat count, feeding duration, etc.)';

-- Confidence score (0.00 to 1.00)
ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS classification_confidence NUMERIC(3,2);

COMMENT ON COLUMN trapper.sot_requests.classification_confidence IS
'Confidence in the suggested classification (0.00-1.00). 0.9+ can auto-apply.';

-- JSON object storing the signals used
ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS classification_signals JSONB;

COMMENT ON COLUMN trapper.sot_requests.classification_signals IS
'JSONB storing the signals that contributed to the suggestion: {ownership_status: {value, weight}, cat_count: {value, weight}, ...}';

-- Staff disposition
ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS classification_disposition TEXT
CHECK (classification_disposition IN ('pending', 'accepted', 'overridden', 'dismissed'));

COMMENT ON COLUMN trapper.sot_requests.classification_disposition IS
'Staff action on suggestion: pending (not reviewed), accepted (applied to place), overridden (different classification applied), dismissed (ignored)';

-- Timestamps and attribution
ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS classification_suggested_at TIMESTAMPTZ;

ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS classification_reviewed_at TIMESTAMPTZ;

ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS classification_reviewed_by TEXT;

-- ============================================================
-- PART 2: Create compute_classification_suggestion function
-- ============================================================

\echo 'Creating compute_classification_suggestion function...'

CREATE OR REPLACE FUNCTION trapper.compute_classification_suggestion(
  p_ownership_status TEXT,
  p_cat_count INTEGER,
  p_cat_count_semantic TEXT DEFAULT 'legacy_total',
  p_fixed_status TEXT DEFAULT NULL,
  p_feeding_duration TEXT DEFAULT NULL,
  p_has_kittens BOOLEAN DEFAULT FALSE,
  p_kitten_age TEXT DEFAULT NULL,
  p_request_count_at_place INTEGER DEFAULT 1
)
RETURNS TABLE(
  classification trapper.colony_classification,
  confidence NUMERIC,
  signals JSONB
) AS $$
DECLARE
  v_individual_score NUMERIC := 0;
  v_colony_score NUMERIC := 0;
  v_signals JSONB := '{}';
  v_classification trapper.colony_classification;
  v_confidence NUMERIC;
BEGIN
  -- ===================
  -- OWNERSHIP STATUS
  -- ===================
  -- Note: ownership tells us owned vs unowned, not individual vs colony
  -- But 'my_cat' strongly suggests individual pet
  IF p_ownership_status = 'my_cat' THEN
    v_individual_score := v_individual_score + 50;
    v_signals := v_signals || jsonb_build_object('ownership_status',
      jsonb_build_object('value', p_ownership_status, 'weight', 50, 'toward', 'individual'));
  ELSIF p_ownership_status = 'neighbors_cat' THEN
    v_individual_score := v_individual_score + 30;
    v_signals := v_signals || jsonb_build_object('ownership_status',
      jsonb_build_object('value', p_ownership_status, 'weight', 30, 'toward', 'individual'));
  END IF;
  -- community_colony ownership doesn't indicate individual vs colony by itself

  -- ===================
  -- CAT COUNT
  -- ===================
  IF p_cat_count IS NOT NULL THEN
    IF p_cat_count = 1 THEN
      v_individual_score := v_individual_score + 60;
      v_signals := v_signals || jsonb_build_object('cat_count',
        jsonb_build_object('value', p_cat_count, 'weight', 60, 'toward', 'individual'));
    ELSIF p_cat_count BETWEEN 2 AND 2 THEN
      -- 2 cats is ambiguous but leans individual
      v_individual_score := v_individual_score + 20;
      v_signals := v_signals || jsonb_build_object('cat_count',
        jsonb_build_object('value', p_cat_count, 'weight', 20, 'toward', 'individual'));
    ELSIF p_cat_count BETWEEN 3 AND 9 THEN
      v_colony_score := v_colony_score + 30;
      v_signals := v_signals || jsonb_build_object('cat_count',
        jsonb_build_object('value', p_cat_count, 'weight', 30, 'toward', 'small_colony'));
    ELSIF p_cat_count >= 10 THEN
      v_colony_score := v_colony_score + 60;
      v_signals := v_signals || jsonb_build_object('cat_count',
        jsonb_build_object('value', p_cat_count, 'weight', 60, 'toward', 'large_colony'));
    END IF;
  END IF;

  -- Reduce confidence if count semantic is legacy (meaning unclear)
  IF p_cat_count_semantic = 'legacy_total' AND p_cat_count IS NOT NULL THEN
    v_signals := v_signals || jsonb_build_object('cat_count_semantic',
      jsonb_build_object('value', 'legacy_total', 'weight', -10, 'note', 'reduced confidence'));
  END IF;

  -- ===================
  -- FIXED STATUS
  -- ===================
  IF p_fixed_status = 'some_fixed' AND COALESCE(p_cat_count, 0) > 2 THEN
    v_colony_score := v_colony_score + 30;
    v_signals := v_signals || jsonb_build_object('fixed_status',
      jsonb_build_object('value', p_fixed_status, 'weight', 30, 'toward', 'colony'));
  END IF;

  -- ===================
  -- FEEDING DURATION
  -- ===================
  IF p_feeding_duration IN ('over_year', 'years') THEN
    v_colony_score := v_colony_score + 40;
    v_signals := v_signals || jsonb_build_object('feeding_duration',
      jsonb_build_object('value', p_feeding_duration, 'weight', 40, 'toward', 'colony'));
  ELSIF p_feeding_duration = 'few_months' THEN
    v_colony_score := v_colony_score + 15;
    v_signals := v_signals || jsonb_build_object('feeding_duration',
      jsonb_build_object('value', p_feeding_duration, 'weight', 15, 'toward', 'colony'));
  END IF;

  -- ===================
  -- KITTENS
  -- ===================
  IF p_has_kittens THEN
    v_colony_score := v_colony_score + 35;
    v_signals := v_signals || jsonb_build_object('has_kittens',
      jsonb_build_object('value', TRUE, 'weight', 35, 'toward', 'colony'));

    IF p_kitten_age IN ('newborn', 'eyes_open') THEN
      v_colony_score := v_colony_score + 15;
      v_signals := v_signals || jsonb_build_object('kitten_age',
        jsonb_build_object('value', p_kitten_age, 'weight', 15, 'toward', 'breeding_colony'));
    END IF;
  END IF;

  -- ===================
  -- MULTIPLE REQUESTS
  -- ===================
  IF p_request_count_at_place > 1 THEN
    v_colony_score := v_colony_score + (p_request_count_at_place - 1) * 10;
    v_signals := v_signals || jsonb_build_object('request_count',
      jsonb_build_object('value', p_request_count_at_place, 'weight', (p_request_count_at_place - 1) * 10, 'toward', 'colony'));
  END IF;

  -- ===================
  -- DETERMINE CLASSIFICATION
  -- ===================
  IF v_individual_score > 60 AND v_colony_score < 30 THEN
    v_classification := 'individual_cats';
    v_confidence := LEAST(1.0, (v_individual_score - v_colony_score) / 100.0 + 0.5);
  ELSIF v_colony_score > 60 AND v_individual_score < 30 THEN
    IF COALESCE(p_cat_count, 0) >= 10 THEN
      v_classification := 'large_colony';
    ELSE
      v_classification := 'small_colony';
    END IF;
    v_confidence := LEAST(1.0, (v_colony_score - v_individual_score) / 100.0 + 0.5);
  ELSIF v_colony_score > 40 OR v_individual_score > 40 THEN
    -- Some signal but not clear
    IF v_colony_score > v_individual_score THEN
      v_classification := 'small_colony';
      v_confidence := LEAST(0.7, v_colony_score / 100.0 + 0.3);
    ELSE
      v_classification := 'individual_cats';
      v_confidence := LEAST(0.7, v_individual_score / 100.0 + 0.3);
    END IF;
  ELSE
    -- Insufficient signal
    v_classification := 'unknown';
    v_confidence := 0.3;
  END IF;

  -- Add semantic penalty for legacy data
  IF p_cat_count_semantic = 'legacy_total' THEN
    v_confidence := v_confidence * 0.85;
  END IF;

  -- Cap confidence
  v_confidence := LEAST(0.99, GREATEST(0.1, v_confidence));

  -- Add scores to signals
  v_signals := v_signals || jsonb_build_object(
    'individual_score', v_individual_score,
    'colony_score', v_colony_score
  );

  RETURN QUERY SELECT v_classification, v_confidence, v_signals;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.compute_classification_suggestion IS
'Computes a classification suggestion from intake signals.
Returns classification type, confidence (0-1), and signals JSONB explaining the reasoning.
Key insight: ownership_status tells us owned vs unowned, NOT individual vs colony.';

-- ============================================================
-- PART 3: Create view for pending suggestions
-- ============================================================

\echo 'Creating v_requests_pending_classification view...'

CREATE OR REPLACE VIEW trapper.v_requests_pending_classification AS
SELECT
  r.request_id,
  r.place_id,
  p.formatted_address,
  p.display_name AS place_name,
  r.suggested_classification,
  r.classification_confidence,
  r.classification_signals,
  r.classification_disposition,
  r.created_at AS request_created_at,
  r.summary,
  r.estimated_cat_count,
  p.colony_classification AS current_place_classification,
  -- Count of other requests at same place
  (SELECT COUNT(*) FROM trapper.sot_requests r2
   WHERE r2.place_id = r.place_id AND r2.request_id != r.request_id) AS other_requests_at_place
FROM trapper.sot_requests r
JOIN trapper.places p ON p.place_id = r.place_id
WHERE r.classification_disposition = 'pending'
  OR (r.classification_disposition IS NULL AND r.suggested_classification IS NOT NULL)
ORDER BY r.classification_confidence DESC NULLS LAST, r.created_at DESC;

COMMENT ON VIEW trapper.v_requests_pending_classification IS
'Requests with pending classification suggestions for staff review.
Ordered by confidence (highest first) to prioritize high-confidence suggestions.';

-- ============================================================
-- PART 4: Index for efficient querying
-- ============================================================

\echo 'Creating indexes...'

CREATE INDEX IF NOT EXISTS idx_requests_classification_pending
ON trapper.sot_requests(classification_disposition, classification_confidence DESC)
WHERE classification_disposition = 'pending' OR classification_disposition IS NULL;

CREATE INDEX IF NOT EXISTS idx_requests_suggested_classification
ON trapper.sot_requests(suggested_classification)
WHERE suggested_classification IS NOT NULL;

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Verification:'

SELECT 'suggested_classification column' AS check_item,
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'trapper' AND table_name = 'sot_requests'
         AND column_name = 'suggested_classification'
       ) THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'compute_classification_suggestion function' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'compute_classification_suggestion')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'v_requests_pending_classification view' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'trapper' AND viewname = 'v_requests_pending_classification')
            THEN 'OK' ELSE 'MISSING' END AS status;

-- Test the function
\echo ''
\echo 'Testing compute_classification_suggestion:'

SELECT * FROM trapper.compute_classification_suggestion(
  'my_cat',  -- ownership
  1,         -- cat count
  'needs_tnr',  -- semantic
  NULL,      -- fixed status
  NULL,      -- feeding duration
  FALSE,     -- has kittens
  NULL,      -- kitten age
  1          -- request count
);

SELECT * FROM trapper.compute_classification_suggestion(
  'community_colony',
  8,
  'needs_tnr',
  'some_fixed',
  'over_year',
  TRUE,
  'weaning',
  2
);

\echo ''
\echo '========================================================'
\echo 'MIG_622 Complete!'
\echo '========================================================'
\echo ''
\echo 'New fields on sot_requests:'
\echo '  - suggested_classification: Auto-computed suggestion'
\echo '  - classification_confidence: 0.00-1.00 confidence score'
\echo '  - classification_signals: JSONB explaining reasoning'
\echo '  - classification_disposition: pending/accepted/overridden/dismissed'
\echo ''
\echo 'New function: compute_classification_suggestion()'
\echo '  - Takes intake signals, returns classification + confidence + reasoning'
\echo ''
\echo 'Next: MIG_623 will add trigger to auto-compute on request creation'
\echo ''
