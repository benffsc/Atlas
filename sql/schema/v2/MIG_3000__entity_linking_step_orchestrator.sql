-- ============================================================================
-- MIG_3000: Entity Linking Step Orchestrator (Phase 1D — Long-Term Strategy)
-- ============================================================================
-- Problem: run_all_entity_linking() runs all 6 steps in a single call,
-- taking 26-55s. At 2x data this breaks the 60s Vercel cron limit.
--
-- Solution: Track per-cycle progress so the cron can run steps in phases:
--   Phase 1: catch-up + steps 1-3 (cat linking, ~15-25s)
--   Phase 2: steps 4-6 + disease computation (~15-25s)
--
-- The existing SQL functions stay unchanged — only orchestration changes.
-- The TypeScript cron picks up where the previous invocation left off.
--
-- FFS-900
-- ============================================================================

\echo ''
\echo '================================================'
\echo '  MIG_3000: Entity Linking Step Orchestrator'
\echo '================================================'
\echo ''

-- ============================================================================
-- 1. Create ops.entity_linking_cycles table
-- ============================================================================

\echo '1. Creating ops.entity_linking_cycles table...'

CREATE TABLE IF NOT EXISTS ops.entity_linking_cycles (
  cycle_id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'failed', 'stale')),

  -- Phase tracking: 0 = not started, 1 = catch-up + steps 1-3, 2 = steps 4-6 + disease
  last_completed_phase INT NOT NULL DEFAULT 0,

  -- Results accumulated across phases
  phase1_result JSONB,
  phase2_result JSONB,
  combined_result JSONB,

  -- Timing
  phase1_duration_ms INT,
  phase2_duration_ms INT,
  total_duration_ms INT
);

CREATE INDEX IF NOT EXISTS idx_el_cycles_status
  ON ops.entity_linking_cycles(status)
  WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS idx_el_cycles_started
  ON ops.entity_linking_cycles(started_at DESC);

COMMENT ON TABLE ops.entity_linking_cycles IS
'Tracks entity linking cycle progress across multiple cron invocations.
Each cycle has 2 phases. Phase 1: catch-up + steps 1-3. Phase 2: steps 4-6 + disease.
The cron picks up where the previous invocation left off.
MIG_3000, FFS-900.';

\echo '   Created ops.entity_linking_cycles'

-- ============================================================================
-- 2. Helper: Get or create current cycle
-- ============================================================================

\echo ''
\echo '2. Creating ops.get_current_linking_cycle() function...'

CREATE OR REPLACE FUNCTION ops.get_current_linking_cycle()
RETURNS TABLE (
  cycle_id INT,
  next_phase INT,
  is_new BOOLEAN
) AS $$
DECLARE
  v_cycle RECORD;
BEGIN
  -- Mark stale cycles (in_progress for > 30 min — likely crashed)
  UPDATE ops.entity_linking_cycles
  SET status = 'stale',
      completed_at = NOW()
  WHERE status = 'in_progress'
    AND started_at < NOW() - INTERVAL '30 minutes';

  -- Check for existing in-progress cycle
  SELECT ec.cycle_id, ec.last_completed_phase
  INTO v_cycle
  FROM ops.entity_linking_cycles ec
  WHERE ec.status = 'in_progress'
  ORDER BY ec.started_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT
      v_cycle.cycle_id,
      v_cycle.last_completed_phase + 1,
      FALSE;
    RETURN;
  END IF;

  -- No active cycle — create new one
  INSERT INTO ops.entity_linking_cycles (status, last_completed_phase)
  VALUES ('in_progress', 0)
  RETURNING ops.entity_linking_cycles.cycle_id INTO v_cycle;

  RETURN QUERY SELECT
    v_cycle.cycle_id,
    1,  -- start with phase 1
    TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.get_current_linking_cycle IS
'Get or create the current entity linking cycle. Returns cycle_id, next phase to run,
and whether this is a new cycle. Stale cycles (>30 min) are auto-marked.';

\echo '   Created ops.get_current_linking_cycle()'

-- ============================================================================
-- 3. Helper: Complete a phase
-- ============================================================================

\echo ''
\echo '3. Creating ops.complete_linking_phase() function...'

CREATE OR REPLACE FUNCTION ops.complete_linking_phase(
  p_cycle_id INT,
  p_phase INT,
  p_result JSONB,
  p_duration_ms INT
)
RETURNS VOID AS $$
BEGIN
  IF p_phase = 1 THEN
    UPDATE ops.entity_linking_cycles SET
      last_completed_phase = 1,
      phase1_result = p_result,
      phase1_duration_ms = p_duration_ms
    WHERE cycle_id = p_cycle_id;
  ELSIF p_phase = 2 THEN
    UPDATE ops.entity_linking_cycles SET
      last_completed_phase = 2,
      phase2_result = p_result,
      phase2_duration_ms = p_duration_ms,
      status = 'completed',
      completed_at = NOW(),
      combined_result = COALESCE(phase1_result, '{}'::jsonb) || p_result,
      total_duration_ms = COALESCE(phase1_duration_ms, 0) + p_duration_ms
    WHERE cycle_id = p_cycle_id;

    -- Also write to the existing entity_linking_runs table for backward compat
    INSERT INTO ops.entity_linking_runs (result, status, warnings, completed_at)
    SELECT
      COALESCE(phase1_result, '{}'::jsonb) || p_result,
      CASE
        WHEN (COALESCE(phase1_result, '{}'::jsonb) || p_result)->>'status' IS NOT NULL
          THEN (COALESCE(phase1_result, '{}'::jsonb) || p_result)->>'status'
        ELSE 'completed'
      END,
      CASE
        WHEN (COALESCE(phase1_result, '{}'::jsonb) || p_result)->'warnings' IS NOT NULL
          THEN ARRAY(SELECT jsonb_array_elements_text(
            (COALESCE(phase1_result, '{}'::jsonb) || p_result)->'warnings'
          ))
        ELSE '{}'::text[]
      END,
      NOW()
    FROM ops.entity_linking_cycles
    WHERE cycle_id = p_cycle_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.complete_linking_phase IS
'Mark a phase as complete with its results. Phase 2 completion also completes the cycle
and writes to ops.entity_linking_runs for backward compatibility.';

\echo '   Created ops.complete_linking_phase()'

-- ============================================================================
-- 4. View: Recent cycle history
-- ============================================================================

\echo ''
\echo '4. Creating ops.v_entity_linking_cycle_history view...'

CREATE OR REPLACE VIEW ops.v_entity_linking_cycle_history AS
SELECT
  cycle_id,
  started_at,
  completed_at,
  status,
  last_completed_phase,
  phase1_duration_ms,
  phase2_duration_ms,
  total_duration_ms,
  -- Extract key metrics from combined result
  (combined_result->>'cat_coverage_pct')::numeric AS cat_coverage_pct,
  (combined_result->>'step2_cats_linked')::int AS cats_via_appointments,
  (combined_result->>'step3_cats_linked')::int AS cats_via_person_chain,
  (combined_result->>'step4_cats_linked_to_requests')::int AS cats_linked_to_requests,
  combined_result->>'status' AS pipeline_status
FROM ops.entity_linking_cycles
ORDER BY started_at DESC;

COMMENT ON VIEW ops.v_entity_linking_cycle_history IS
'Recent entity linking cycles with key metrics extracted from JSONB results.';

\echo '   Created ops.v_entity_linking_cycle_history'

-- ============================================================================
-- 5. Verification
-- ============================================================================

\echo ''
\echo '5. Verifying...'

SELECT
  c.relname AS table_name,
  (SELECT COUNT(*) FROM information_schema.columns ic
   WHERE ic.table_schema = 'ops' AND ic.table_name = c.relname) AS column_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'ops' AND c.relname = 'entity_linking_cycles';

\echo ''
\echo '================================================'
\echo '  MIG_3000 Complete (FFS-900)'
\echo '================================================'
\echo ''
\echo 'Created:'
\echo '  - ops.entity_linking_cycles table'
\echo '  - ops.get_current_linking_cycle()'
\echo '  - ops.complete_linking_phase()'
\echo '  - ops.v_entity_linking_cycle_history view'
\echo ''
\echo 'The TypeScript cron now orchestrates phases:'
\echo '  Phase 1: catch-up + steps 1-3 (~15-25s)'
\echo '  Phase 2: steps 4-6 + disease (~15-25s)'
\echo ''
