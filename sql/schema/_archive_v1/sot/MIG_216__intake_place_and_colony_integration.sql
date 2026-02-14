-- MIG_216__intake_place_and_colony_integration.sql
-- Connect intake submissions to places and colony estimates
--
-- Purpose:
--   - Add place_id to web_intake_submissions
--   - Create trigger to add colony estimates from intake submissions
--   - Document the full data flow from intake -> places -> colony estimates
--
-- Data Flow:
--   1. User submits intake form with cat location
--   2. match_intake_to_person() links to existing/new person
--   3. NEW: create_intake_colony_estimate() creates colony estimate when place is linked
--   4. v_place_ecology_stats shows combined estimates from all sources
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_216__intake_place_and_colony_integration.sql

\echo ''
\echo 'MIG_216: Intake Place and Colony Integration'
\echo '============================================='
\echo ''

-- ============================================================
-- 1. Add place_id column to web_intake_submissions
-- ============================================================

\echo 'Adding place_id column to web_intake_submissions...'

ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS place_id UUID REFERENCES trapper.places(place_id);

CREATE INDEX IF NOT EXISTS idx_web_intake_place
ON trapper.web_intake_submissions(place_id)
WHERE place_id IS NOT NULL;

COMMENT ON COLUMN trapper.web_intake_submissions.place_id IS
'Links intake submission to places table for colony tracking.';

-- ============================================================
-- 2. Create function to create colony estimate from intake
-- ============================================================

\echo ''
\echo 'Creating create_intake_colony_estimate function...'

CREATE OR REPLACE FUNCTION trapper.create_intake_colony_estimate(
    p_submission_id UUID
) RETURNS UUID AS $$
DECLARE
    v_sub RECORD;
    v_estimate_id UUID;
    v_total_cats INTEGER;
BEGIN
    -- Get submission details
    SELECT
        submission_id,
        place_id,
        person_id,
        cat_count_estimate,
        peak_count,
        eartip_count_observed,
        fixed_status,
        observation_time_of_day,
        is_at_feeding_station,
        reporter_confidence,
        kitten_count,
        submitted_at
    INTO v_sub
    FROM trapper.web_intake_submissions
    WHERE submission_id = p_submission_id;

    IF NOT FOUND OR v_sub.place_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Determine total cats (prefer peak_count, then cat_count_estimate)
    v_total_cats := COALESCE(v_sub.peak_count, v_sub.cat_count_estimate);

    IF v_total_cats IS NULL OR v_total_cats = 0 THEN
        RETURN NULL;
    END IF;

    -- Check if we already have an estimate for this submission
    SELECT estimate_id INTO v_estimate_id
    FROM trapper.place_colony_estimates
    WHERE source_record_id = p_submission_id::TEXT
      AND source_type = 'intake_form';

    IF v_estimate_id IS NOT NULL THEN
        RETURN v_estimate_id;
    END IF;

    -- Create colony estimate
    INSERT INTO trapper.place_colony_estimates (
        place_id,
        total_cats,
        peak_count,
        kitten_count,
        eartip_count_observed,
        total_cats_observed,
        observation_time_of_day,
        is_at_feeding_station,
        reporter_confidence,
        source_type,
        observation_date,
        is_firsthand,
        reported_by_person_id,
        source_system,
        source_record_id
    ) VALUES (
        v_sub.place_id,
        v_total_cats,
        v_sub.peak_count,
        v_sub.kitten_count,
        v_sub.eartip_count_observed,
        COALESCE(v_sub.peak_count, v_sub.cat_count_estimate),  -- same observation
        v_sub.observation_time_of_day,
        v_sub.is_at_feeding_station,
        v_sub.reporter_confidence,
        'intake_form',
        v_sub.submitted_at::DATE,
        TRUE,  -- Person is at the location
        v_sub.person_id,
        'web_intake',
        p_submission_id::TEXT
    )
    RETURNING estimate_id INTO v_estimate_id;

    RETURN v_estimate_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_intake_colony_estimate IS
'Creates a colony estimate from an intake submission. Called when place_id is set.';

-- ============================================================
-- 3. Create trigger to auto-create colony estimate
-- ============================================================

\echo ''
\echo 'Creating trigger for intake colony estimates...'

CREATE OR REPLACE FUNCTION trapper.trg_intake_colony_estimate()
RETURNS TRIGGER AS $$
BEGIN
    -- Only fire when place_id is set/changed
    IF NEW.place_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.place_id IS DISTINCT FROM NEW.place_id) THEN
        PERFORM trapper.create_intake_colony_estimate(NEW.submission_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_intake_colony_estimate ON trapper.web_intake_submissions;
CREATE TRIGGER trg_intake_colony_estimate
    AFTER INSERT OR UPDATE OF place_id ON trapper.web_intake_submissions
    FOR EACH ROW
    EXECUTE FUNCTION trapper.trg_intake_colony_estimate();

-- ============================================================
-- 4. Add 'intake_form' to colony source confidence
-- ============================================================

\echo ''
\echo 'Adding intake_form to colony_source_confidence...'

INSERT INTO trapper.colony_source_confidence (source_type, base_confidence, description)
VALUES ('intake_form', 0.55, 'Web intake form - reporter at location but informal estimate')
ON CONFLICT (source_type) DO NOTHING;

-- ============================================================
-- 5. Create function to link intake to place (for API use)
-- ============================================================

\echo ''
\echo 'Creating link_intake_to_place function...'

CREATE OR REPLACE FUNCTION trapper.link_intake_to_place(
    p_submission_id UUID,
    p_formatted_address TEXT,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_place_id UUID;
BEGIN
    -- Find or create place using deduped function
    v_place_id := trapper.find_or_create_place_deduped(
        p_formatted_address,
        NULL,  -- display_name (will use address)
        p_lat,
        p_lng,
        'web_intake'
    );

    -- Update submission with place_id
    UPDATE trapper.web_intake_submissions
    SET place_id = v_place_id,
        updated_at = NOW()
    WHERE submission_id = p_submission_id;

    RETURN v_place_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_intake_to_place IS
'Links an intake submission to a place (finds existing or creates new).
Call this after geocoding the cats_address from the submission.
Triggers automatic colony estimate creation.';

-- ============================================================
-- 6. Backfill existing submissions (if any have geocoded data)
-- ============================================================

\echo ''
\echo 'Checking for submissions that could be linked...'

SELECT
    COUNT(*) as total_submissions,
    COUNT(place_id) as already_linked,
    COUNT(*) - COUNT(place_id) as needs_linking
FROM trapper.web_intake_submissions;

-- ============================================================
-- 7. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Colony source confidence:'
SELECT source_type, base_confidence, description
FROM trapper.colony_source_confidence
ORDER BY base_confidence DESC;

\echo ''
\echo 'Triggers on web_intake_submissions:'
SELECT trigger_name, event_manipulation
FROM information_schema.triggers
WHERE event_object_table = 'web_intake_submissions';

\echo ''
\echo 'Functions created:'
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name IN ('create_intake_colony_estimate', 'link_intake_to_place');

SELECT 'MIG_216 Complete' AS status;
