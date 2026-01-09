-- MIG_110__tnr_stage_function.sql
-- TNR Stage classification function
--
-- Purpose:
--   Maps request_status enum to high-level TNR lifecycle stages:
--   - intake: Request received, needs assessment/triage
--   - fieldwork: Active trapping work underway
--   - paused: Temporarily on hold
--   - closed: Complete, archived, or no longer actionable
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_110__tnr_stage_function.sql
--
-- See also: docs/TNR_LOGIC_LAYER_PROPOSAL.md

-- ============================================
-- 1) SQL FUNCTION: get_tnr_stage
-- ============================================

CREATE OR REPLACE FUNCTION trapper.get_tnr_stage(status trapper.request_status)
RETURNS text AS $$
BEGIN
    RETURN CASE status::text
        -- Intake: needs assessment or triage
        WHEN 'new' THEN 'intake'
        WHEN 'needs_review' THEN 'intake'
        -- Fieldwork: active trapping work
        WHEN 'in_progress' THEN 'fieldwork'
        WHEN 'active' THEN 'fieldwork'
        -- Paused: temporarily on hold
        WHEN 'paused' THEN 'paused'
        -- Closed: terminal states
        WHEN 'closed' THEN 'closed'
        WHEN 'resolved' THEN 'closed'
        -- Default unknown to intake for visibility
        ELSE 'intake'
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

COMMENT ON FUNCTION trapper.get_tnr_stage(trapper.request_status) IS
'Maps request_status enum to TNR lifecycle stage (intake/fieldwork/paused/closed).
See docs/TNR_LOGIC_LAYER_PROPOSAL.md for stage definitions.';

-- ============================================
-- 2) OVERLOAD: text version for flexibility
-- ============================================

CREATE OR REPLACE FUNCTION trapper.get_tnr_stage(status text)
RETURNS text AS $$
BEGIN
    IF status IS NULL OR trim(status) = '' THEN
        RETURN 'intake';
    END IF;

    RETURN CASE lower(trim(status))
        -- Intake
        WHEN 'new' THEN 'intake'
        WHEN 'needs_review' THEN 'intake'
        WHEN 'needs review' THEN 'intake'
        WHEN 'requested' THEN 'intake'
        -- Fieldwork
        WHEN 'in_progress' THEN 'fieldwork'
        WHEN 'in progress' THEN 'fieldwork'
        WHEN 'active' THEN 'fieldwork'
        WHEN 'revisit' THEN 'fieldwork'
        WHEN 'partially complete' THEN 'fieldwork'
        -- Paused
        WHEN 'paused' THEN 'paused'
        WHEN 'hold' THEN 'paused'
        WHEN 'on hold' THEN 'paused'
        -- Closed
        WHEN 'closed' THEN 'closed'
        WHEN 'resolved' THEN 'closed'
        WHEN 'complete' THEN 'closed'
        WHEN 'complete/closed' THEN 'closed'
        WHEN 'denied' THEN 'closed'
        WHEN 'duplicate' THEN 'closed'
        WHEN 'duplicate request' THEN 'closed'
        WHEN 'referred elsewhere' THEN 'closed'
        -- Default
        ELSE 'intake'
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

COMMENT ON FUNCTION trapper.get_tnr_stage(text) IS
'Maps status text (including Airtable raw values) to TNR lifecycle stage.
Handles variations like "In Progress", "in_progress", etc.';

-- ============================================
-- 3) VERIFICATION
-- ============================================
\echo ''
\echo 'TNR Stage function created. Testing...'

SELECT
    trapper.get_tnr_stage('new'::trapper.request_status) AS new_stage,
    trapper.get_tnr_stage('in_progress'::trapper.request_status) AS in_progress_stage,
    trapper.get_tnr_stage('paused'::trapper.request_status) AS paused_stage,
    trapper.get_tnr_stage('closed'::trapper.request_status) AS closed_stage;

\echo ''
\echo 'Stage distribution for current requests:'

SELECT
    trapper.get_tnr_stage(status) AS tnr_stage,
    COUNT(*) AS request_count
FROM trapper.requests
GROUP BY tnr_stage
ORDER BY
    CASE tnr_stage
        WHEN 'intake' THEN 1
        WHEN 'fieldwork' THEN 2
        WHEN 'paused' THEN 3
        WHEN 'closed' THEN 4
        ELSE 5
    END;

\echo ''
\echo 'MIG_110 complete. Function trapper.get_tnr_stage() is now available.'
